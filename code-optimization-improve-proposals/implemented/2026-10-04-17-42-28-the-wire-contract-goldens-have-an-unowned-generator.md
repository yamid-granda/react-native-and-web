# The wire-contract goldens are written by a second implementation of the contract that no check ever runs

## Problem / opportunity

`tests/parity.rs` is the only thing in this repository that pins the HTTP wire
contract. It byte-compares twelve committed JSON files against live responses
(`api-rs/tests/parity.rs:20-25`, `:27-131`). Those twelve files are not
hand-written. They are emitted by `api-rs/tests/fixtures/generate_goldens.py`,
which is a **second, independent implementation of the response contract**,
written in Python, that no task, hook, or test in the repository ever executes.

The duplication is total. Every one of these has a production owner in Rust and
a second spelling in Python:

| Contract element | Production owner | Second implementation |
|---|---|---|
| Product body: 10 fields, in order | `ProductJson`, `api-rs/src/handlers/products.rs:17-38` | `js_product`, `generate_goldens.py:35-50` |
| List envelope + `limit` | `ProductsPageJson::from_page`, `products.rs:72-102`; `PAGE_SIZE`, `api-rs/src/store/products.rs:18` | `generate_goldens.py:58-77`, `:103-112` (literal `20`) |
| Batch envelope (`items`, `missing`) | `ProductsByIdsJson`, `products.rs:66-70` | `generate_goldens.py:90-99` |
| Store profile body | `StoreJson`, `api-rs/src/handlers/stores.rs:24-31` | `generate_goldens.py:113` |
| Four error bodies | `AppError::body`, `api-rs/src/error.rs:107-148` | `generate_goldens.py:114-123` |
| Health body | `api-rs/src/handlers/health.rs` | `generate_goldens.py:124-132` |
| List ordering | `ORDER BY p."createdAt" ASC, p."id" ASC`, `api-rs/src/store/products.rs:212` | `sorted(..., key=(createdAt, id))`, `generate_goldens.py:57` |
| `createdAt` wire format | `prisma_datetime`, `api-rs/src/serde_js.rs:23-28` | `product["createdAt"].replace(" ", "T") + "Z"`, `generate_goldens.py:45` |
| **Number wire format** | `js_number`, `api-rs/src/serde_js.rs:9-19` | bare `json.dumps`, `generate_goldens.py:42` via `:54` |

### 1. Nothing runs the generator, so nothing keeps the two in agreement

`generate_goldens.py:1-5` documents a manual step:

```
"""Regenerates the committed goldens and seed.sql from products.json.

Run after editing tests/fixtures/products.json:

    python3 api-rs/tests/fixtures/generate_goldens.py
```

and `generate_goldens.py:7-8` asserts the ownership model — *"The product
fixtures are the single source of truth for the byte-compared responses in
`tests/parity.rs`"* — as does `api-rs/tests/common/mod.rs:41-43` (*"Mirrors the
constants in `tests/fixtures/generate_goldens.py`, which is what writes the
byte-compared goldens these rows have to reproduce"*).

Neither statement is enforced by anything:

- `api-rs/package.json:6-19` has no fixture task. Its twelve scripts are `dev`,
  `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `test:all`,
  `coverage`, `bench`, `db:migrate`, `db:seed`.
- Root `package.json:9-25` has none either, and `turbo.json` declares no such
  task.
- `.husky/` contains exactly one hook, `commit-msg` (commitlint). There is no
  `pre-commit`, so nothing regenerates before a commit either.
- There is no CI configuration in the repository at all — no `.github/`, no
  `.gitlab-ci.yml`, no `.circleci/`, no other runner file.

So the actual workflow, for a human or an agent changing the contract, is:
change Rust → run `pnpm --filter @rnw/api-rs test:e2e` → `parity.rs:24` fails
with a byte diff → **hand-edit the JSON file** → parity passes. The generator is
never consulted. It is not a slow-moving second owner; it is a dead one, and
after the first contract change it is *wrong*.

### 2. The two implementations agree on number formatting by coincidence, and the
coincidence is load-bearing

`js_number` (`api-rs/src/serde_js.rs:9-19`) deliberately prints an integral
`f64` through `serialize_i64`, so `18.0` goes on the wire as `18`. The Python
generator has no equivalent: it passes `product["price"]` straight into
`json.dumps` (`generate_goldens.py:42`, called from `:54`), and Python's encoder
distinguishes `int` from `float`.

The two agree today **only because `products.json` happens to spell integral
prices without a decimal point.** Twelve of its twenty-six rows do:
`18, 189, 20, 22, 24, 26, 28, 30, 32, 34, 45, 54`. Python parses those as `int`
and emits `18`; had they been written `18.0`, Python would emit `18.0` and Rust
would emit `18`.

Reproduced in a scratch copy of `tests/fixtures/` (the repository's own files
were not modified), rewriting one character in `products.json`:

```
before: "price": 18,
$ python3 generate_goldens.py
products-page-1.json:"price":18.0      <- what the generator now writes
```

`js_number` writes `18` for the same row, so `parity.rs:24` fails on a two-byte
difference. Note that the *database* is immune to this spelling — `FixtureProduct.price`
is an `f64` (`api-rs/tests/common/mod.rs:31`) and sqlx sends `18.0` to the
`DOUBLE PRECISION` column either way — so the row is fine and only the golden
moves. A fixture-numbering convention that is invisible in the schema, absent
from `products.json`, absent from the generator, and decisive for a byte
comparison is exactly the kind of knowledge that costs an agent an hour.

For honesty about the current state: I also regenerated all twelve goldens plus
`seed.sql` from an unmodified copy and diffed them against the committed files.
**There is no drift today.** The generator is currently in sync. That is the
point — it is in sync by hand, once, and nothing keeps it there.

### 3. The same fixture seller is seeded two different ways, and the Python one is
contradicted by the Rust one

`generate_goldens.py:22-24` and `api-rs/tests/common/mod.rs:44-45` hold the same
store id and name in two languages, and the Rust side says so in a doc comment.
More telling is the password hash for that one row:

- `generate_goldens.py:28-32` writes a structurally valid argon2id PHC string
  (`m=64,t=1,p=1`, 12-byte salt, 32-byte digest — I decoded both to confirm) and
  comments it *"A real (if cheap) argon2id PHC string"*.
- `common/mod.rs:393-395` binds `"$argon2id$fixture-not-a-real-hash"` for the
  same row and comments it *"Not a hash anything logs in with"*.

Neither is wrong — the row exists only so the `LEFT JOIN` in `LIST_QUERY`
resolves. But it is the duplication talking: two files describe one fixture row
and already disagree about what it is.

### 4. `seed.sql` is a generated artifact with no reader

`generate_goldens.py:139-166` writes `tests/fixtures/seed.sql`: a `User` insert
plus twenty-six `Product` inserts, using Python's `repr()` for the price column
(`:156`). Nothing reads it. `common/mod.rs:238` seeds every stack, and
`seed_fixtures` (`common/mod.rs:386-422`) loads `products.json` through serde
instead (`common/mod.rs:402-404`). A repository-wide search for `seed.sql`
returns only the generator itself, one migration comment
(`api-rs/migrations/20261003120100_add_product_owner.up.sql:2`), and two feature
proposals in `improve-proposals/`.

So `seed.sql` is 27 statements that look authoritative, can drift from
`products.json` with no failure, and are the file a human would reach for when
setting up a database by hand — while disagreeing with the harness about the
fixture seller's hash.

### 5. The documentation of the oracle is already stale

`api-rs/ARCHITECTURE.md:376` describes the contract gate as *"Six responses
byte-identical to committed goldens"*, and `:132` says the diagram's
`tests/parity.rs` *"byte-compares 6 responses against committed goldens"*. There
are twelve (`grep -c include_str! api-rs/tests/parity.rs` → `12`; ten
`assert_golden` calls plus the inline 500 at `:121-123` and health at `:125-130`).
`:98` lists *"golden fixtures in `tests/fixtures/`"* as the sole evidence for
invariant **C1 Contract fidelity** — an invariant whose fixtures are maintained
by a script the repository does not know how to run.

### 6. Why this is expensive for an agent, which is the point of the exercise

`parity.rs` reads as an oracle: an independent, human-reviewed statement of what
the wire format is. Nine existing proposals cite it as the gate that must stay
green (for example
`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md:425-427`
and `in-progress/2026-10-04-08-20-32-…:331-332`). None of them can see that its
inputs are machine-written from a reimplementation of the thing being tested. So
the one check whose whole value is independence has an unexamined dependency,
and the file an agent is told to trust is maintained by a file an agent is never
told about.

## Proposed approach

Delete the second implementation rather than adding a gate to maintain it. The
repo has already rejected this pattern once, in writing, for the store layer:
`implemented/2026-10-03-22-37-46-…:449-451` argues that *"a hand-written second
implementation of every trait is the expensive way to maintain them."* The same
argument applies here, and it applies harder — the Python copy cannot import
`js_number`, so the divergence class in §2 survives any amount of checking.

### 1. `api-rs/tests/fixtures.rs` — the seven success-path goldens, from the
production serializers

A new test-only module that builds each success golden from the same structs the
handlers return, so key order, `js_number` and `prisma_datetime` cannot drift:

```rust
// api-rs/tests/fixtures.rs  (new; `mod fixtures;` from parity.rs)
pub fn product_json(product: &FixtureProduct, store_name: Option<&str>) -> String
// -> serde_json::to_string(&ProductJson::from(...))   products.rs:17-55

pub fn products_page_json(rows: &[&FixtureProduct], page: f64, total: i64) -> String
// -> ProductsPageJson::from_page(rows, &parse_page(Some("page=N")).unwrap(), total)
//    products.rs:72-102 — PAGE_SIZE comes from api-rs/src/store/products.rs:18

pub fn products_by_ids_json(hits: &[&FixtureProduct], missing: &[&str]) -> String
// -> ProductsByIdsJson { items, missing }              products.rs:66-70

pub fn store_json(id: &str, name: &str, created_at: NaiveDateTime) -> String
// -> StoreJson                                        stores.rs:24-31
```

Two details that are load-bearing and must not be paraphrased:

- **Sorting** goes through the same key the SQL uses — `(created_at, id)`,
  `api-rs/src/store/products.rs:212` — so `products-page-1.json` and
  `products-page-2.json` split where Postgres splits.
- **Price normalisation happens in `FixtureProduct`, not in the fixture file.**
  `products.json` keeps whatever spelling a human finds natural; parsing coerces
  to `f64` (`common/mod.rs:31`) and `js_number` decides the wire form. That
  removes §2 entirely rather than documenting the convention.

`FixtureProduct` moves here from `common/mod.rs:25-39`, and gains a
`From<FixtureProduct> for Product` so `ProductJson::from` (the production
conversion, `products.rs:40-55`) is the only mapping in play.

### 2. `api-rs/tests/parity.rs` — a second test that makes the goldens derived

Add one test beside `responses_match_committed_golden_fixtures`:

```rust
#[tokio::test]
async fn the_success_goldens_are_reproducible_from_the_fixture() { /* … */ }
```

It regenerates the seven success goldens in memory and asserts each equals the
committed file, byte for byte, naming the file in the failure message. This is
what turns "did you remember to run the generator?" from tribal knowledge into a
test, and it is what makes a hand-edit impossible to leave behind: edit a golden
to make `assert_golden` pass and this test fails on the next run.

Keep both tests. The committed files stay the reviewed expectation and
`assert_golden` stays the check that the *server* matches them; the new test only
adds that they are also *derivable*. Neither replaces the other.

### 3. The five non-derivable goldens stay hand-written, on purpose

`product-404.json`, `route-404.json`, `internal-500.json`,
`unauthorized-401.json` and `health-up.json` are **not** generated, and this is a
decision rather than an omission:

- Their content *is* the contract. Four short strings with exact key order;
  deriving them from `AppError::body()` (`api-rs/src/error.rs:107-148`) would
  make them a restatement of the code, which is the tautology this proposal
  exists to remove.
- `route-404.json` embeds a URL — `"Cannot GET /nope?x=1"`
  (`generate_goldens.py:118`) — which is `fallback`'s format string
  (`api-rs/src/app.rs:177-181`) applied to a request, not a struct.
- `health-up.json` is never byte-stable: `parity.rs:5-18` rewrites `responseTime`
  to `0` before comparing, and the generator writes a `0` the server never
  emits (`generate_goldens.py:129`). Generating it would encode the normaliser.

### 4. Delete `generate_goldens.py`, and `seed.sql` with it

Both go in the same commit as §1, because leaving them leaves the second owner.
`seed.sql` has no reader (`§4`) and its only distinguishing content is a
password hash that `common/mod.rs:395` contradicts. `api-rs/migrations/20261003120100_add_product_owner.up.sql:2`
mentions it in a comment and needs a one-word edit to stop.

### 5. `api-rs/package.json` — one script, so "how do I regenerate" is answerable

```json
"test:e2e:update-goldens": "UPDATE_GOLDENS=1 cargo test --test parity -- --ignored"
```

with the regeneration test gated on that variable and marked `#[ignore]`, writing
the committed files. It shares the `api-rs-db` precedent
(`api-rs/package.json:17-18`) for a Rust-owned maintenance entry point. This
replaces a Python file that nothing in the repo referenced with a command a human
or an agent can find.

### 6. Correct `ARCHITECTURE.md` in the same commit

`:376` and `:132` say "Six responses"; say twelve, and name the derivation:
*"twelve responses byte-identical to committed goldens; the seven success bodies
are regenerated from the production serializers in the same run, so a golden
cannot drift from the code that produces it."* Update the `tests/fixtures/` entry
at `:457` to drop `seed.sql`.

### 7. What deliberately does not change

No route, status code, response body, header, or committed golden byte changes in
this proposal. `products.json` keeps all twenty-six rows and its current
numbering. `common::TestStack`, the container harness, the fixture seller and
every E2E assertion stay as they are. `parse_page`, `js_number` and
`prisma_datetime` are used, never modified.

## Impact

**What gets better.** The wire contract acquires the property the store contract
already has after `implemented/2026-10-03-22-37-46-…`: a single owner and an
executable check. Nine fields of `ProductJson`, three envelope shapes, the sort
order, the page size and the datetime format stop being restated in a second
language, so a field added to `ProductJson` cannot be silently absent from a
golden — the regeneration test fails and names the file. The number-formatting
divergence class disappears rather than being documented: `js_number` becomes the
only thing that decides how a price is printed. `seed.sql` stops being a 27-statement
artifact that looks load-bearing and is not.

For an agent this is the larger half. Today, "the parity test failed" points at
a JSON file with no stated provenance; the agent's only documented move is to
edit that file. Afterwards the failing test names the fixture row and the
struct, and the fix is in Rust where the contract lives.

**What does not improve.** Runtime behaviour is untouched — this is a test-surface
change and no request path, query, cache key or response byte moves. Coverage
does not rise; the new test is assertions, not new production lines. The four
error goldens and the health golden keep whatever drift risk they have today,
deliberately, because deriving them would cost more than it buys. And the
twelve-golden set still does not cover a single `POST`, `PATCH` or `DELETE`
response — three existing proposals rely on that gap staying open, and closing it
belongs to whichever of them lands first, not here.

## Risks / trade-offs

- **Losing the "hand-reviewed bytes" property on seven files.** Generating a
  golden from the code that produces it means a wrong serializer now yields a
  self-consistent golden. This is the real cost and it is not free. It is
  bounded three ways: the goldens stay committed and still reviewed in the diff,
  `assert_golden` still compares the live *server* against them, and the
  derivation test is a second independent assertion rather than a replacement. A
  reviewer who wants a from-scratch oracle for one route should add an inline
  literal in `e2e_products.rs`, which is the pattern already used at
  `api-rs/tests/e2e_products.rs:112` and `:169`.
- **`FixtureProduct` → `Product` is a new conversion.** It must set
  `store_name` from the joined seller the way `LIST_QUERY` does
  (`api-rs/src/store/products.rs:212`) or the owned goldens change. Wrong, it
  fails loudly at `parity.rs:24` — that is the intended discovery path, but it is
  a real chunk of the work.
- **`parity.rs` grows by one test and one module.** It is 131 lines today and
  would pass ~200. `e2e_products.rs:18-19` already calls into
  `store::contract`, so a shared fixture module is not a new shape.
- **Deleting `seed.sql` may surprise someone.** It is referenced by a migration
  comment and two `improve-proposals/` documents. If a human is using it to seed a
  scratch database by hand, deleting it costs them a `cargo run --bin api-rs-db
  -- seed` — which is `api-rs/package.json:18` and does the same job from
  `products.json`.
- **The `#[ignore]`d regeneration test is not run by `test:e2e`.** That is
  intentional — it writes files. It does mean a contributor who changes a
  contract and hand-edits a golden can still get a green run if they also
  somehow avoid the regeneration test; they cannot, because `test:e2e` includes
  `parity`, so the non-ignored derivation test always runs. Worth stating
  plainly: the gate is `pnpm --filter @rnw/api-rs test:e2e`, and the writer is
  opt-in.
- **Blocked by nothing.** No proposal in `in-progress/` touches
  `tests/fixtures/`, `tests/parity.rs`, `tests/common/mod.rs`, or the success-path
  serializers. This is independent of all five in-flight items.

## Validation

1. `pnpm --filter @rnw/api-rs test:e2e` — needs Docker. The existing
   `responses_match_committed_golden_fixtures` must pass **byte-identical**, which
   is the proof that generation did not move a single committed byte.
2. The same command must run the new `the_success_goldens_are_reproducible_from_the_fixture`
   green, with no file rewritten. `git status --porcelain` afterwards must show
   nothing under `api-rs/tests/fixtures/`.
3. `pnpm --filter @rnw/api-rs test` (`cargo test --lib`) — unaffected; `serde_js.rs`
   and `error.rs` are used, not edited.
4. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings`. New test-module code is
   `--all-targets` clippy surface.
5. `pnpm --filter @rnw/api-rs typecheck` — the new `tests/fixtures.rs` is compiled
   by `cargo check --all-targets`.
6. **The §2 negative check, and it is the one that matters.** In a scratch branch,
   change one `"price": 18,` in `products.json` to `"price": 18.0,`, run
   `test:e2e`. Today's tree fails `parity.rs:24` on two bytes. After this change
   it must pass, because `FixtureProduct.price` is an `f64`
   (`common/mod.rs:31`) and `js_number` prints `18` either way. If it still
   fails, the normalisation in step 1 is not where it needs to be.
7. **The hand-edit negative check.** In a scratch branch, hand-edit
   `product-prod-1.json` (add a space, change a price) so `assert_golden` fails,
   then confirm the new derivation test *also* names the file. Both must fail;
   one failing alone means the derivation check is not wired up.
8. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate must still pass. No
   production line is added or removed, so the ratio should be flat.
9. `pnpm --filter @rnw/api-rs test:e2e:update-goldens` — confirm it rewrites
   nothing when the tree is already consistent, i.e. the generator is now
   idempotent and reachable from a documented command.
10. `pnpm typecheck` and `pnpm --filter @rnw/components-library test` — expected to
    be untouched; this change is entirely inside `api-rs`. Run them to prove it,
    not because they should fail.
11. Not required: no web or mobile suite imports `api-rs/tests/`, and no frontend
    file changes.

## Related proposals

- **None is superseded, and none claims this.** Searching all fourteen documents
  across the four folders for `golden`, `parity`, `generate_goldens`, `fixture`
  and `seed.sql` returns no proposal about the goldens' provenance. Nine
  documents *cite* `parity.rs` — always as a gate that must stay green, never as
  a thing with an unexamined dependency. This is the first analysis of it.
- **`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md` —
  related, not superseded; the precedent this follows.** It made the *store*
  trait contract executable (`store/contract.rs::assert_store_contract`) and its
  §"Related proposals" at `:449-451` rejects hand-written second implementations
  as "the expensive way to maintain them". This proposal applies that same
  reasoning to the *wire* contract, which is the other of the two contracts the
  repo has. Different module, different language, no shared file. If it landed
  first, its `delegating.rs` and failure-switch pattern is the template for
  keeping the fixture module small; nothing in it needs to change.
- **`implemented/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`
  — related, not superseded; the closest structural precedent.** It solves the
  identical shape — "several tools answer the same question and they do not give
  the same answer" — for the bundler/test resolution lists, landing one owner
  (`web-resolution.ts`) plus one parity test (`svgWebEntryParity.web.test.tsx`).
  `in-progress/2026-10-04-05-04-58-the-design-tokens-have-no-owner.md:450-461`
  names that pair explicitly as the pattern to reuse and says of itself *"this
  proposal reaches for the same two moves on a different seam"*. This is a third
  instance of the same two moves on a third seam — one owner
  (`tests/fixtures.rs`) plus one check (`the_success_goldens_are_reproducible_from_the_fixture`).
  **None of the three blocks another**; they share no file.
- **`in-progress/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  — related, not superseded; a naming collision worth disambiguating.** Its §4 at
  `:361` explicitly scopes out the duplicated *TypeScript* test harness. This
  proposal is the *Rust* fixture layer underneath the HTTP boundary, and touches
  no file it does.
- **`todo/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md`
  — unrelated surface, and the two are compatible.** It changes
  `PATCH /my-store/products/{id}` request semantics and keeps every response
  byte-identical (`:193-194`), relying on the fact that no `PATCH` response has a
  golden (`:467-468`). This proposal adds no golden for `PATCH` either, so that
  reliance holds. Its step 2 introduces a `ProductPatch` presence list in
  `api-rs/src/handlers/my_store.rs`; this proposal's `FixtureProduct → Product`
  conversion does not touch that struct.
- **`in-progress/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md`
  — adjacent, and ordered after it.** Its step 2 deletes the manual counter in
  `app.rs:168-174` and its validation at `:331-332` requires `parity.rs` to stay
  byte-identical. `route-404.json` is one of the five goldens §3 keeps
  hand-written, so that proposal's gate is unaffected. If it lands first, the
  `fallback` change removes the only producer of the `Cannot {method} {url}`
  string this proposal declines to generate — which is one more reason to leave
  that golden alone.
