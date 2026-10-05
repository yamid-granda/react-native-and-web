# The list tiebreaker is resolved by the database's collation, not by byte order

## Problem / opportunity

The repository documents a single ordering contract for the product list, and
three places restate it. The tiebreaker that makes that order total is pinned
to nothing.

### 1. The claim

`api-rs/src/store/memory.rs:96-99`, on `InMemoryStore::rows`:

> The rows one query would return, in the order `LIST_QUERY` and
> `LIST_OWNED_QUERY` produce them — so a pagination assertion written against
> this store is the same assertion the E2E suite makes against Postgres.

`api-rs/ARCHITECTURE.md:480` assigns `src/store/products.rs` ownership of "the
ordering contract", and `ARCHITECTURE.md:207` asserts "**The list sort is
indexed.** `@@index([createdAt, id])` matches the ordering". So this is a
first-class invariant, stated three times.

### 2. The three implementations of it, and the one that is unpinned

| Implementation | Line | Order it uses |
|---|---|---|
| Postgres, public list | `api-rs/src/store/products.rs:212` | `ORDER BY p."createdAt" ASC, p."id" ASC` |
| Postgres, owner list | `api-rs/src/store/products.rs:223` | `ORDER BY p."createdAt" ASC, p."id" ASC` |
| In-memory double | `api-rs/src/store/memory.rs:213-215` | `sort_by(\|a, b\| (&a.created_at, &a.id).cmp(...))` — `String: Ord`, i.e. **byte order** |
| Golden generator | `api-rs/tests/fixtures/generate_goldens.py:57` | `sorted(products, key=lambda p: (p["createdAt"], p["id"]))` — **codepoint order** |

`"id"` is `TEXT` (`api-rs/migrations/20260926133034_create_product.up.sql:2`,
primary key at `:10`) and neither `ORDER BY` clause carries a `COLLATE`, so
Postgres resolves the tiebreaker in **the cluster's default collation**.
Rust's byte order and Python's codepoint order agree with each other. Neither is
guaranteed to agree with the database, and the repository never states or pins
which collation it depends on.

### 3. Production ids are mixed case, which is exactly where the two disagree

`api-rs/src/auth/token.rs:29-33` builds every row id from
`URL_SAFE_NO_PAD` base64 over 12 CSPRNG bytes — alphabet `A–Z a–z 0–9 - _` — and
`api-rs/src/store/products.rs:475-477` uses it for products via
`opaque_id("prd_")`. So every id minted in production carries mixed case.

Under a glibc or ICU collation, `a` sorts **before** `A` (tertiary weight).
Under byte order, `A` (0x41) sorts before `a` (0x61). The two orders are
*opposite*, not merely different. Any catalogue larger than one page containing
both cases can hand back different rows on page 1 depending on which
implementation answers.

### 4. The tiebreaker is load-bearing, not a corner case

Twenty-five of the twenty-six rows in `api-rs/tests/fixtures/products.json` share
`createdAt` = `2026-01-01 00:00:00.000`; only `prod-owned-1` differs. So `id`
decides the page split for essentially the whole fixture catalogue. Production is
no better: `createdAt` is `TIMESTAMP(3)`
(`api-rs/migrations/20260926133034_create_product.up.sql:8`), i.e. millisecond
precision, and `api-rs/src/seed.rs` inserts rows in bulk. Ties are the normal
case, which is precisely why the tiebreaker exists.

### 5. Why nothing has ever failed

Every fixture id is lowercase ASCII (`prod-1`, `prod-gen-9`, `prod-owned-1`),
and C collation and `en_US` agree on lowercase-ASCII-plus-digit strings of a
single shape. So the goldens pass under *either* collation, and the defect only
appears once an id set mixes cases — which only production ever generates. The
hermetic suite's Postgres (`api-rs/tests/common/mod.rs:213-221`,
`postgres:17-alpine`) sets only `POSTGRES_DB`/`USER`/`PASSWORD`, no
`POSTGRES_INITDB_ARGS`, so the test container's collation is inherited from the
image and is not something this repository controls either.

### 6. The executable contract has a hole exactly where the order is decided

`api-rs/src/store/contract.rs:86-127`, `listing_windows_state_one_answer`, is
the suite that exists to stop the two implementations drifting. It asserts that
page 0's first row is the whole catalogue's first row (`:91-95`), that pages
partition, that the total matches. **Every assertion is order-agnostic.** Each
implementation is only ever compared against itself, so *both* orderings pass.
The one invariant both stores are documented to share — the total order — is the
one thing the suite never checks.

### 7. The repository already knows this is a trap

`api-rs/migrations/20261003120000_create_user_and_session.up.sql` rejects a
`citext` extension or a functional index for email case-insensitivity, and gives
the reason: it would "make the one guarantee this service draws from Postgres
depend on a collation nobody else in the repo shares". The list tiebreaker
depends on a collation and shares it with nothing.

### What it costs

`GET /products` and `GET /stores/{id}/products` can return different page 1 for
the same catalogue depending on which implementation answers. Because
`InMemoryStore` is what `cargo test --lib` runs, a unit test can assert a page
split the production database never produces, and an E2E test can assert one the
unit tests disagree with — **with both suites green**. For an agent this is the
expensive shape: an invariant asserted in three places, load-bearing on nearly
every fixture row, and dependent on a setting nobody wrote down.

## Proposed approach

Make the tiebreaker explicit, in the schema and in the query, so Postgres
resolves it by byte order — the same rule `String: Ord` and Python's `sorted`
already use.

### 1. `api-rs/migrations/<timestamp>_pin_product_id_collation.{up,down}.sql` (new)

A reversible pair, per `AGENTS.md`. Both list indexes must be rebuilt, because a
`COLLATE "C"` `ORDER BY` is only index-satisfiable by a `COLLATE "C"` index:

```sql
DROP INDEX "Product_createdAt_id_idx";
CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id" COLLATE "C");

DROP INDEX "Product_ownerId_createdAt_id_idx";
CREATE INDEX "Product_ownerId_createdAt_id_idx"
    ON "Product"("ownerId", "createdAt", "id" COLLATE "C");
```

The `.down.sql` restores both without the collation. Reuse the plain-`CREATE
INDEX` lock justification already written at
`api-rs/migrations/20261002120000_add_product_list_index.up.sql:5-7`, and state
in the comment that a deployment holding mixed-case ids will see page boundaries
shift once — a one-time reordering, not data loss, and the point of the change.

### 2. `api-rs/src/store/products.rs:212` and `:223`

`ORDER BY p."createdAt" ASC, p."id" COLLATE "C" ASC` in both `LIST_QUERY` and
`LIST_OWNED_QUERY`, with a comment saying that `C` is what makes Postgres agree
with `String: Ord`, and that the index must carry the same collation or the sort
stops being index-satisfiable.

**Steps 1 and 2 must land in the same commit.** One without the other silently
turns the hottest query into a full sort per page.

### 3. `api-rs/src/store/memory.rs:213-215`

No behaviour change. Add a comment on `sort_by_contract` naming the two queries
it mirrors and the `COLLATE "C"` that makes the `:96-99` claim true, so the next
reader knows the equivalence is now guaranteed rather than coincidental.

### 4. `api-rs/src/store/contract.rs` — close the hole

Add one assertion to the contract suite, generic over `S: MarketplaceStore` so
it covers the double and Postgres from one definition: seed several products with
an **identical** `created_at` whose ids mix cases, then assert `list_page(0,
PAGE_SIZE)` returns them in one specific order. This is the assertion whose
absence let §6 happen.

### 5. `api-rs/tests/fixtures/generate_goldens.py:57`

No behaviour change — the sort is already codepoint order. Add one line saying it
mirrors `COLLATE "C"`, so the third restatement of the contract points at the
same rule.

### 6. `api-rs/ARCHITECTURE.md:207`

Change "the list sort is indexed" to say it is indexed **and** collation-pinned,
so the index-satisfiability claim stays true after this change.

## Impact

**What gets better.** The equivalence between `InMemoryStore` and Postgres
becomes a property of the schema rather than of the operator's locale. The
contract suite gains the one assertion it was missing, and gains it in the place
designed to hold both implementations to it. Page boundaries stop depending on
how a cluster was initialised.

**What does not improve.** No response body, status code or header changes. No
performance change — the rebuilt index still satisfies the ordering, and the
golden generator, `parity.rs`, the cache tiers and every frontend file are
untouched. The twelve goldens do not move (see Validation 5). And this does not
make `id` any less opaque: a mixed-case id is still a valid primary key, now
just ordered by bytes everywhere.

## Risks / trade-offs

- **Losing the index is the serious failure mode.** Rebuild the index without
  changing the query text, or change the query without rebuilding the index, and
  the `ORDER BY` stops being index-satisfiable: every list page full-sorts. That
  is a silent performance regression on the hottest read in the service, and it
  is why steps 1 and 2 are one commit and why Validation 3 exists.
- **`COLLATE "C"` is byte order, not "alphabetical".** That is the intent — it is
  what `String: Ord` does — and it is also what every other byte-comparing
  system in the toolchain does, so it is the least surprising choice available.
  It does mean `prd_A…` sorts before `prd_a…`, which is correct but reads oddly
  to a human skimming fixture output.
- **A live deployment with mixed-case ids sees one reordering.** Page boundaries
  shift once when this lands. Nothing is lost and no row is unreadable; it is the
  defect being corrected. Say so in the migration comment so an operator is not
  surprised.
- **Test-container collation is still not pinned.** This proposal makes the
  service independent of it, which is the property that matters. Asserting the
  container's collation in `common/mod.rs` would be belt-and-braces and is
  deliberately out of scope.
- **Blocked by nothing.** No proposal in `in-progress/` touches
  `api-rs/migrations/`, `store/products.rs`, `store/contract.rs` or
  `store/memory.rs`.

## Validation

1. `pnpm --filter @rnw/api-rs test` (`cargo test --lib`) — the new contract
   assertion green against `InMemoryStore`. This half needs no Docker.
2. `pnpm --filter @rnw/api-rs test:e2e` (needs Docker) — green.
3. **The index check, and it is the one that matters.** In the test container,
   run `EXPLAIN (ANALYZE, BUFFERS)` for the list query with
   `ORDER BY "createdAt" ASC, "id" COLLATE "C" ASC LIMIT 20 OFFSET 0` and confirm
   the plan is still an index scan over `Product_createdAt_id_idx` with **no
   `Sort` node**. A `Sort` means the migration and the query text are out of step.
   Run the same `EXPLAIN` for the owner-scoped query and
   `Product_ownerId_createdAt_id_idx`.
4. **The negative check.** In a scratch branch, revert only the `COLLATE "C"` in
   `products.rs:212`/`:223` and keep the index change; the new `contract.rs`
   assertion must then fail against Postgres — proving the assertion has teeth
   and that the collation was the only thing making it pass. Confirm
   `cargo test --lib` still passes in that state: the double cannot fail, only
   Postgres can, which is exactly the blindness this proposal removes.
5. **No golden drift.** After step 2, `git status --porcelain` must show nothing
   under `api-rs/tests/fixtures/`. Every fixture id is lowercase ASCII, on which
   `C` and `en_US` agree, so all twelve goldens must be byte-identical. A changed
   golden means the reasoning above is wrong.
6. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings`; the new contract assertion is
   `--all-targets` surface.
7. `pnpm --filter @rnw/api-rs typecheck` — `cargo check --all-targets` compiles
   the new assertion.
8. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate must still pass; this
   change adds tests, not production lines.
9. `pnpm typecheck` and `pnpm --filter @rnw/components-library test` — expected
   untouched. Run them to prove the change is confined to `api-rs`, not because
   they should fail.
10. Not required: no web, mobile or library file imports `api-rs/src`.

## Related proposals

Nothing is superseded, and nothing claims this. `grep -rliE 'collat'` across
`code-optimization-improve-proposals/` **and** `improve-proposals/` returns no
file. No proposal in any of the four folders addresses the tiebreaker, byte
order, or the list ordering's dependence on a cluster setting. The one document
that mentions `ORDER BY` at all treats it as correct.

- **`in-progress/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md`
  — adjacent, and this proposal removes one of its assumptions.** Its table at
  `:23` lists "List ordering | `ORDER BY p."createdAt" ASC, p."id" ASC` |
  `sorted(..., key=(createdAt, id))`" among the duplicated contract elements, and
  its step 1 at `:189-191` sorts the new goldens "through the same key the SQL
  uses … so `products-page-1.json` and `products-page-2.json` split where
  Postgres splits". That last clause holds only while Postgres's collation
  coincides with byte order; this proposal is what makes it hold unconditionally.
  The two share **no file** — that one touches `tests/fixtures.rs`,
  `tests/parity.rs`, `generate_goldens.py` and the success-path serializers; this
  one touches `migrations/`, `store/products.rs`, `store/memory.rs`,
  `store/contract.rs`. No golden byte moves under either (Validation 5), so
  whichever lands first leaves the other's gate green. If it lands first, its
  `FixtureProduct → Product` conversion still sources `created_at` from
  `products.json` and this proposal's assertion is unaffected.
- **`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md` —
  related, not superseded; this is a hole in its deliverable.** It created
  `store/contract.rs` precisely so the two implementations could not drift, and
  `:14-17` states its assertions were chosen to stay stable for two years. The
  ordering assertion was left order-agnostic, which is why the one invariant both
  stores are documented to share is the one thing never checked. This adds that
  assertion and changes nothing about `assert_store_contract`'s shape;
  `delegating.rs` and the failure-switch pattern are untouched.
- **`implemented/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`
  — the shape precedent, applied with the opposite move.** It solved "several
  tools answer the same question and they do not give the same answer" for
  bundler and test resolution. This is that shape on the data layer, but the fix
  inverts: rather than adding a checker to report the disagreement, it makes the
  tools agree, because the database is the authority and there is nothing to
  check it against.
- **`in-progress/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md`
  — unrelated surface.** It changes `PATCH` request semantics in
  `handlers/my_store.rs` and keeps response bytes identical. This proposal
  changes no handler and no response.
- **`implemented/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  and `implemented/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md`
  — cite `parity.rs` as a gate that must stay green.** Both unaffected: no golden
  moves.