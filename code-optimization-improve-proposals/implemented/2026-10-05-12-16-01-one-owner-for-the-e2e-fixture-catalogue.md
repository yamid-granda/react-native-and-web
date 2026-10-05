# One owner for the e2e fixture catalogue, so the frontend specs and the wire goldens stop describing different databases

## Problem / opportunity

The repository has **two hand-written descriptions of the same fixture
catalogue**, in two files, in two formats, in two different halves of the test
story — and nothing in the repository compares them.

| | owner | rows | format | read by |
| --- | --- | --- | --- | --- |
| A | `api-rs/src/seed.rs:16-77` (`fixture_products`), plus `seed()` at `:79-96` and `owned_fixture()` at `:101-111` | **9** (`prod-1`…`prod-8`, `prod-owned-1`) | Rust literals | `db:seed-fixtures` (`seed.rs:179-187`) → `web-application/e2e/global-setup.ts:14-16` and `mobile-application/e2e/global-setup.js` → **both platforms' Playwright and Detox suites** |
| B | `api-rs/tests/fixtures/products.json` | **26** (A's nine, plus `prod-gen-9`…`prod-gen-25`) | JSON | `api-rs/tests/common/mod.rs:56` → the hermetic E2E harness (`common/mod.rs:431-467`) and the byte-compared goldens (`tests/fixtures/mod.rs:54-70`) |

Both files claim the same job in their own doc comments.
`seed.rs:13-15`: *"The catalogue [`seed_fixtures`] writes and nothing else: fixed
ids so both platforms' e2e specs can target a known product."*
`common/mod.rs:47-50`: *"The same rows the goldens in `tests/fixtures/` are
derived from, through the same conversion — so a golden and the database cannot
describe different products."*

Neither mentions the other. `grep -rn "products.json" api-rs/src` returns
nothing; `grep -rn "fixture_products" api-rs` shows two same-named functions in
two crates' worth of code (`seed.rs:16`, `common/mod.rs:54`) that share no code
and no types.

### 1. The nine shared rows are field-for-field identical today — by hand

Comparing the two descriptions row by row (id, `title`, `description`, `price`,
`imageUrl` nullability, `stock`):

| id | `seed.rs` | `products.json` |
| --- | --- | --- |
| `prod-1` | Wireless Headphones, 129.99, stock 42, image | identical |
| `prod-2` | Mechanical Keyboard, 89.5, stock 0, image | identical |
| `prod-3` | Ceramic Coffee Mug, 18.0, stock 120, image | identical |
| `prod-4` | Running Shoes, 74.99, stock 2, image | identical |
| `prod-5` | Backpack, 54.0, stock 15, **no image** | identical |
| `prod-6` | Desk Lamp, 32.25, stock 0, image | identical |
| `prod-7` | Yoga Mat, 24.99, stock 3, **no image, no description** | identical |
| `prod-8` | Bluetooth Speaker, 45.0, stock 60, image | identical |
| `prod-owned-1` | Leather Weekender Bag, 189.0, stock 6, image | identical except `ownerId` (see §2) |

Nine rows × six fields, spelled twice, agreeing by maintenance. Nothing asserts
it, and the duplication crosses a format boundary — Rust struct literals versus
JSON — so neither language's tooling can see the other file's copy.

### 2. They already disagree in four places, and every disagreement is load-bearing

**(a) The owning seller is two different sellers with the same display name.**

```rust
// api-rs/src/seed.rs:109, :121
owner_id: Some(DEMO_SELLER_ID.to_string()),   // "usr_demo_seller"
```
```json
// api-rs/tests/fixtures/products.json — the only ownerId in the file
"ownerId": "usr_fixture_store"                // api-rs/tests/common/mod.rs:89
```

Both sellers are called **"Riverbend Vintage"**, and the name is a constant in
each file independently: `seed.rs:124` (`DEMO_STORE_NAME`) and
`common/mod.rs:90` (`FIXTURE_STORE_NAME`). So `GET /products/prod-owned-1`
answers `"storeId": "usr_demo_seller", "storeName": "Riverbend Vintage"` against a
database seeded by `db:seed-fixtures`, and `"storeId": "usr_fixture_store",
"storeName": "Riverbend Vintage"` against a database seeded by the E2E harness.
The public storefront route is keyed on that id, so **the storefront the
frontend e2e specs drive and the storefront the Rust e2e suite drives are two
different URLs**. Nothing notices, because `web-application/e2e/my-store.spec.ts:88`
asserts the *name* (`Sold by ${storeName}`) and never the id, and
`api-rs/tests/e2e_my_store.rs:154` asserts the *name* (`"Riverbend Vintage"`) and
never the id.

**(b) `createdAt` is `now()` in one database and pinned in the other.**

`upsert_fixture` (`seed.rs:225-249`) does not mention `createdAt` in its column
list at all, so the insert takes the schema default
(`migrations/20260926133034_create_product.up.sql:8`,
`DEFAULT CURRENT_TIMESTAMP`) — and the `ON CONFLICT` clause at `:229-236` does
not update it either, so a re-seed leaves the original stamp. `products.json`
pins every row to `2026-01-01 00:00:00.000`, with `prod-owned-1` a month later at
`2026-02-01`, and `common/mod.rs:442`/`:459` bind those values explicitly.

`createdAt` is the *primary* sort key of the list contract
(`store/products.rs` `LIST_QUERY`, `ORDER BY p."createdAt" ASC, p."id" COLLATE
"C" ASC`), and it is what
`implemented/2026-10-04-20-11-10-the-list-tiebreaker-depends-on-the-databases-collation.md`
made load-bearing. So the frontend e2e suites exercise ordering where the `id`
tiebreaker decides every page, and the Rust suite exercises ordering where the
pinned timestamps decide `prod-owned-1`'s position. Neither suite can see the
other's ordering.

**(c) The catalogue has two sizes, and three files state the size as a literal.**

- `seed.rs:161-163` `fixture_count()` returns `fixture_products().len() +
demo_sellers().len()` = **10**, asserted at `seed.rs:306-308`.
- `tests/seed.rs:34` asserts **9** products after seeding the same function.
- `api-rs/README.md:59` documents `db:seed-fixtures` as writing
  *"the fixed products `prod-1`…`prod-8`, `prod-owned-1`"* — nine.
- `tests/e2e_products.rs:81-82` asserts `total == 26` with the comment
  *"26 fixtures: the 25 seeded rows plus prod-owned-1"*, and
  `tests/e2e_my_store.rs:150` asserts `total == 27`.

All four are true. None of them can tell you which catalogue it is talking
about, because the answer depends on which database the assertion ran against.

**(d) `db:clear-fixtures` deletes nine ids; the E2E catalogue has 26.**

`clear_fixtures` (`seed.rs:193-202`) derives its `= ANY($1)` id list from
`fixture_products()`, i.e. the nine. That is correct for the database `db:seed-fixtures`
wrote — but it means the two cleanup stories are asymmetric with respect to
"the fixtures", and `README.md:65` presents `db:clear-fixtures` as the undo for a
test run without saying which test run.

### 3. The asymmetry that makes this cost something: only one copy is defended

`products.json` is behind three independent checks:

1. `tests/fixtures/mod.rs:54-70` derives the seven success goldens from it
   through the production serializers, and
   `tests/parity.rs:186` (`the_success_goldens_are_reproducible_from_the_fixture`)
   byte-compares them against the committed files. Changing a price there fails
   a `cargo test` until someone runs the regeneration step at `tests/parity.rs:196`.
2. `tests/parity.rs:70` (`responses_match_committed_golden_fixtures`) then
   byte-compares the *served* bodies against those goldens.
3. `tests/e2e_products.rs:81-85` asserts `total == 26`, `items[0].id == "prod-1"`
   and `items[0].price == 129.99` against the database `common/mod.rs:450-466`
   seeded from it.

`seed.rs` is behind **one** check, and that check restates the file:

```rust
// api-rs/src/seed.rs:256-261
let fixtures = fixture_products();          // the very function seed_fixtures writes
assert_eq!(fixtures.len(), 9);
assert_eq!(fixtures[0].id, "prod-1");
assert_eq!(fixtures[0].title, "Wireless Headphones");
assert_eq!(fixtures[0].price, 129.99);
```

Every value it asserts is a value written a few lines above in the same file, so
the assertion moves with the change. `tests/seed.rs:30-64` is a real check —
nine rows in, nine out, idempotent, and `clear_fixtures` leaves `real-1` alone —
but it asserts *shape and lifecycle*, never a field value.

The consequence is a concrete, reproducible blind spot. Edit `seed.rs:24` and
change `prod-1`'s price from `129.99` to `149.99`, update `seed.rs:261` in the
same commit (that is what the tautological assertion forces), and then run:

```bash
pnpm lint && pnpm typecheck && pnpm test                 # green
pnpm --filter @rnw/api-rs test                          # green
pnpm --filter @rnw/api-rs test:e2e                      # green — parity.rs and e2e_products.rs read products.json
```

Every gate is green and both catalogues now describe different `prod-1`. The
only assertions in the repository that notice are the two that quote the price
out of catalogue A:

- `mobile-application/e2e/cart.e2e.ts:20-22` — `// prod-1 is a fixture at
  $129.99 (api-rs/src/seed.rs)` … `await expect(element(by.text("Total:
  $129.99"))).toBeVisible()`
- `web-application/e2e/global-setup.ts:4` — *"The specs click
  `product-card-prod-1` and assert its `$129.99` price, so they need the e2e
  fixture products in the database"*

Neither is in `pnpm test`; both need api-rs running against a seeded development
database and a Playwright browser or an iOS simulator. The repository's own
comment at `web-application/e2e/global-setup.ts:5-7` explains why the fixtures are
opt-in — *"a dev marketplace should hold only what sellers create through the
app"* — which is exactly why those two suites are the least-run gate in the
project and exactly why the copy with no cross-check is the one that rots
quietly.

### 4. Why it survives a careful reading: this is not the goldens proposal again

`implemented/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md`
closed the *other* half of this. It deleted
`tests/fixtures/generate_goldens.py` — *"a second, independent implementation of
the response contract, in another language, that no task, hook or test in the
repository ever ran"* — and replaced it with `tests/fixtures/mod.rs` deriving the
goldens from the production serializers. That document's "what deliberately does
not change" section says `products.json` *"keeps all twenty-six rows and its
current numbering"* and that *"`common::TestStack`, the container harness, the
fixture seller and every E2E assertion stay as they are."*

It does not mention `api-rs/src/seed.rs` once. The file it consolidated was the
Python generator of the goldens; the file it did not consolidate is the Rust
seeder that writes the fixtures the *frontend* suites run against. `grep -rn
"seed.rs" code-optimization-improve-proposals/ improve-proposals/` returns five
hits in six documents, and all five are incidental: `= ANY($1)` as an idiom
(`implemented/2026-10-05-09-13-35-by-ids-issues-one-query-per-id.md:131`, `:252`)
and *"seed.rs inserts rows in bulk"* as the source of ordering ties
(`implemented/2026-10-04-20-11-10-the-list-tiebreaker-depends-on-the-databases-collation.md:58`).
Neither proposes giving the catalogue one owner.

## Proposed approach

Keep every existing behaviour — every id, every value, both seed commands, the
goldens, the harness. This changes *where the catalogue is written*, plus one
deliberate decision the duplication currently hides.

### 1. Move the canonical file where both crates can read it

`src/` must not reach into `tests/`, and today the canonical copy is *only*
reachable from a test binary (`common/mod.rs:56`). Move it to a neutral path and
update the two readers:

```
git mv api-rs/tests/fixtures/products.json api-rs/fixtures/products.json
```

- `tests/common/mod.rs:56` becomes
  `include_str!("../../fixtures/products.json")`.
- `seed.rs` gains `include_str!("../fixtures/products.json")` — a
  compile-time embed, the same mechanism `migrations.rs:6` already uses for the
  SQL (`sqlx::migrate!("./migrations")`). Nothing is read from disk at runtime,
  so `db:seed-fixtures` keeps working from any working directory.

This is a new top-level directory. If a reviewer prefers one file, the
alternative is `src/fixtures/products.json`, which is worse: it puts test data
inside the library's source tree and makes "is this shipped?" a judgement call
rather than a path fact.

### 2. One row type, one parse, and `seed.rs` declares its two real differences

`seed.rs` gets the same `#[derive(Deserialize)]` row struct
`tests/common/mod.rs:27-41` already declares, and `fixture_products()` becomes a
filter over the parsed catalogue rather than a hand-written list. The two
differences in §2 become *named arguments* instead of invisible drift:

```rust
/// The subset of `fixtures/products.json` the platform e2e suites target.
///
/// A deliberate subset: the seventeen `prod-gen-*` rows exist to make page two
/// and the `total` count interesting for the Rust harness, and a developer
/// database has no reason to hold them. Everything else — title, description,
/// price, image, stock — is the catalogue's, not this file's.
const E2E_FIXTURE_IDS: [&str; 9] =
    ["prod-1", "prod-2", "prod-3", "prod-4", "prod-5", "prod-6", "prod-7", "prod-8", "prod-owned-1"];

/// The one override, and the reason it is an override rather than a second copy.
///
/// `products.json` gives `prod-owned-1` to `usr_fixture_store`, the row the
/// hermetic harness inserts so its `LEFT JOIN` resolves. A developer's seeded
/// catalogue belongs to `DEMO_SELLER_ID`, because the whole point of that seller
/// is that `seller@rnw.test` can log in and see the product in My Store.
fn owner_for(id: &str) -> Option<String> {
    (id == "prod-owned-1").then(|| DEMO_SELLER_ID.to_string())
}
```

`seed()` (`:79-96`) and `owned_fixture()` (`:101-111`) then **delete**: the image
URL is already spelled out per row in the JSON rather than derived from a
`with_image: bool`, which is one fewer place to be wrong. `fixture_count()`
(`:161-163`) stays a function of the filtered list, so the number `api-rs-db`
prints still cannot drift from what it wrote.

`createdAt` (§2b) is the one field that must stay out of `upsert_fixture`: the
JSON pins it because a golden needs a fixed byte, and a developer's catalogue
should look like it was just created. Say that in a comment on the function
rather than leaving it as an accident of the column list, and assert the
divergence once instead of leaving two files to disagree about it.

### 3. Replace the self-referential assertions with the check that was missing

`seed.rs:255-271` currently proves `fixture_products()` equals itself. Replace it
with two assertions that reach across the boundary:

- **Every row `db:seed-fixtures` will write is present, unmodified, in the
  canonical catalogue** — id, title, description, price, image and stock, for
  all nine. This is the assertion whose absence is the finding: it is what turns
  "two files that agree today" into "two files that cannot disagree".
- **No row outside `E2E_FIXTURE_IDS` is written**, and the count
  (`seed.rs:306-308`) stays asserted so the filter cannot silently grow.

Then add the mirror of `tests/parity.rs:186` for the other direction, next to
`tests/seed.rs:30-64`: after `seed_fixtures`, `SELECT` the nine rows and compare
them to `products.json`. That is the one assertion that would have caught the
`149.99` edit, and it belongs where `tests/seed.rs` already asserts the
database-boundary facts about the same two commands.

### 4. Collapse the count and the store name

- `api-rs/README.md:59` keeps naming `prod-1`…`prod-8`, `prod-owned-1` — now
  true by construction rather than by two files happening to agree. Add one
  sentence that the canonical catalogue is `api-rs/fixtures/products.json` and
  that `db:seed-fixtures` writes its `prod-*` subset.
- `tests/e2e_products.rs:81` and `tests/e2e_my_store.rs:150` keep their 26/27
  literals — they are assertions, not documentation, and they are correct for
  the database that harness seeds. Add the catalogue path to the comment at
  `tests/e2e_products.rs:81` so the next reader knows which of the two
  descriptions it is talking about.
- The store name has one owner. Either `DEMO_STORE_NAME` (§ `seed.rs:124`)
  becomes the single constant and `common/mod.rs:90` reads it, or the two
  constants stay and the *equality* is asserted once with a comment saying it is
  deliberate. Pick one; the current state — two independent `const` declarations
  of the same string, in two files, for two different sellers — is the third
  instance of the same pattern and should not survive this change.

## Impact

**Reuse.** Two hand-maintained descriptions of nine products collapse to one
file plus a nine-element id list. Six fields × nine rows is 54 values that today
exist twice; after this they exist once, and the Rust literals at `seed.rs:17-76`
(60 lines) and `:79-111` (33 lines) go away — 93 lines of duplicated catalogue
and its bespoke `with_image: bool` constructor.

**Consistency.** This is the real gain. One catalogue decides what `prod-1` is,
and both databases are derived from it, so the id, the price, the null image and
the null description cannot disagree between the suite that byte-compares
wire bodies and the suite that drives a browser. The two remaining divergences
stop being invisible and become named arguments (`E2E_FIXTURE_IDS`,
`owner_for`) with a stated reason each.

**Testability.** A new gate appears where there was none: the two catalogues
cannot drift, and the assertion is a pure `cargo test --lib` comparison plus one
row of `cargo test --test seed`. Before this, the only thing that noticed a
change to `prod-1`'s price was two e2e suites that need a running api-rs, a
seeded development database, and (for the Detox half) an iOS simulator — per the
root `AGENTS.md`, the Detox suite "requires a native build and a simulator".

**Performance.** None, and none is claimed. `include_str!` parses the same 7 KB
file the test harness already parses; `db:seed-fixtures` writes the same nine
rows in the same nine statements. The only runtime change is a compile-time
embed where there was a disk read, which is strictly less I/O.

**What does not improve.** The seventeen `prod-gen-*` rows still never reach a
developer's database — that asymmetry is the point of `E2E_FIXTURE_IDS`, not a
bug it fixes. The ordering contract stays as subtle as it is today; this makes
the two databases' `createdAt` policies *visible* in one comment, it does not
make them equal (making them equal would break the freshness a dev catalogue
should have). The goldens stay committed and byte-compared exactly as
`implemented/2026-10-04-17-42-28-…` established. And nothing here touches the
frontend: `web-application/e2e/` and `mobile-application/e2e/` keep asserting
`$129.99` against a database this change now derives from the same file those
goldens are derived from.

## Risks / trade-offs

- **This touches a `git mv` of a committed fixture the goldens depend on.** The
  path changes in `tests/common/mod.rs:56` and in every doc that names
  `tests/fixtures/products.json` (`ARCHITECTURE.md:98`, `:424`, `:493`, `:507`;
  `api-rs/README.md`; `tests/fixtures/mod.rs:6-27`). Miss one and the failure is
  a compile error, not a silent drift — `include_str!` is checked at build time —
  but the diff is wider than the change itself. Land the move on its own, with
  the doc updates, before the `seed.rs` half.
- **Embedding the catalogue in the library means test data ships inside the
  `api-rs` binary.** It is 7 KB of JSON and `seed.rs` is already part of the
  lib (`src/lib.rs:9`) while being reachable only from `api-rs-db`. If a
  reviewer objects on size or on principle, the alternative is a runtime read of
  `api-rs/fixtures/products.json` resolved from `CARGO_MANIFEST_DIR`, exactly as
  `metrics_names.rs:80-86` does for `monitoring/` — but that trades a build-time
  guarantee for a runtime one and can fail on a stripped deployment. Recommend
  the embed; name the trade-off rather than hiding it.
- **Reading the catalogue into `seed.rs` means `db:seed` no longer has an
  independent description of the fixtures.** That is the point, but it also means
  a corrupt or truncated `products.json` now breaks `db:seed-fixtures` with a
  serde panic rather than a wrong row count. `fixture_products()` should
  `.expect("the committed fixture catalogue parses")`, matching
  `common/mod.rs:57`, so the message names the file.
- **The owner override (`owner_for`) is the one place this proposal introduces a
  second value, and a reviewer may reasonably ask why `products.json` does not
  simply name `usr_demo_seller`.** It cannot: that seller is created by the
  harness at `common/mod.rs:433-445` with a deliberately unusable hash
  (`common/mod.rs:440`, and the goldens proposal documented the disagreement), and
  it does not exist in a developer's database at all. Keep the override, and say
  in the comment that the JSON's owner id is meaningful only inside the harness.
- **Scope.** The two `api-rs/tests/e2e_my_store.rs` count literals and the
  `prod-gen-*` naming are not this proposal's business. Nor is making the two
  catalogues the *same* size — that would put seventeen generated rows in every
  developer's database and change what `db:clear-fixtures` deletes, which is a
  product decision about the dev experience rather than a refactor.

## Validation

1. `pnpm --filter @rnw/api-rs test` — `seed.rs`'s rewritten test module must
   pass, and it now proves something the old one could not: that all nine rows
   `db:seed-fixtures` writes match `products.json` field-for-field. Confirm the
   old assertions are genuinely gone rather than kept alongside (they were
   tautological; keeping them would look like coverage and be none).
2. `pnpm --filter @rnw/api-rs test:e2e` — requires Docker. Run in this order:
   - `tests/parity.rs:70` first: twelve responses byte-identical to the committed
     goldens, which is the proof that the `git mv` changed no byte.
   - `tests/parity.rs:186`: the seven derived goldens still reproduce from the
     moved file.
   - `tests/seed.rs`: the new cross-check that the database now holds the
     catalogue's values, and that `db:clear-fixtures` still removes exactly nine
     rows and leaves `real-1` alone.
   - `tests/e2e_products.rs:81-85`: `total == 26`, `prod-1` at `129.99`, still
     green — the harness path is untouched by design, and this proves it.
3. **The mutation check, which is the whole point.** Do this by hand before
   calling the proposal done: change `prod-1`'s price in
   `api-rs/fixtures/products.json` from `129.99` to `149.99` and confirm
   `pnpm --filter @rnw/api-rs test` goes red naming the catalogue and the row.
   Then revert. Today that edit only fails `test:e2e`, and only after the goldens
   are regenerated; after this change it fails a unit test immediately.
4. `pnpm lint && pnpm typecheck` — cheap, and covers the Rust half. Nothing in
   the TypeScript half changes, so `pnpm test` is a no-op here; say so rather than
   quoting it as evidence.
5. `pnpm --filter @rnw/web-application test:e2e` — `e2e/marketplace.spec.ts`
   clicks `product-card-prod-1` and `e2e/cart.spec.ts` asserts `Total:`, both
   against the `db:seed-fixtures` database. This is the only check that the seed
   path still produces the rows the frontend suites target. Needs api-rs running
   and mutates the development database.
6. **Not runnable here, and honestly so:** `pnpm --filter @rnw/mobile-application
   test:e2e` needs a native build and a simulator per the root `AGENTS.md`.
   `mobile-application/e2e/cart.e2e.ts:20-22` is the assertion that quotes
   `prod-1`'s price with a comment naming `api-rs/src/seed.rs` — that comment
   should be updated in the same commit to name the catalogue instead, and the
   Detox leg has to be run on a machine with Xcode before this is called done.

## Related proposals

- **`implemented/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md`
  — related, not superseded, and it is the direct precedent.** It solved the same
  class of problem one layer over: a second, never-executed implementation of the
  wire contract (`generate_goldens.py`) standing in for the bytes the goldens
  hold, replaced by derivation from the production serializers. This proposal
  solves the remaining instance one layer down — a second, hand-maintained
  implementation of the *fixture catalogue*. That document's "what deliberately
  does not change" section keeps `products.json` at 26 rows, keeps
  `common::TestStack` as it is, and does not mention `api-rs/src/seed.rs` at all;
  nothing in it is contradicted or undone here. Its step 6 (correct
  `ARCHITECTURE.md`'s "Six responses" to twelve) is the same kind of doc edit
  this proposal's step 4 makes, and its discipline — *derive from the owner, keep
  the committed artefact, assert both directions* — is the pattern to follow.
- **`implemented/2026-10-04-20-11-10-the-list-tiebreaker-depends-on-the-databases-collation.md`
  — related, not superseded, and this is a hole in the environment its assertions
  run in.** It pins the `createdAt, id COLLATE "C"` ordering contract, pins the
  index and the migration to match, and notes at `:58` that
  *"twenty-five of the twenty-six rows in `api-rs/tests/fixtures/products.json`
  share a `createdAt`"*. Every one of those assertions runs against the harness
  database. The frontend e2e suites run against the *other* catalogue, where
  `createdAt` is `CURRENT_TIMESTAMP` (§2b), so the contract is verified in exactly
  one of the two environments the frontend specs actually exercise. This proposal
  does not re-open the collation work or touch `LIST_QUERY`; it makes the second
  environment's ordering policy visible in one comment instead of leaving it as an
  accident of `upsert_fixture`'s column list.
- **`implemented/2026-10-05-09-13-35-by-ids-issues-one-query-per-id.md` — related,
  incidental, not superseded.** It cites `seed.rs:195` twice (`:131`, `:252`) as
  the repository's existing `= ANY($1)` batching idiom. This proposal rewrites
  the function above that line (`fixture_products()`) and leaves the delete
  statement's shape exactly as it is; the idiom survives untouched.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md` — the origin of
  half of this, related, not superseded.** Its `:120` specifies that
  `api-rs/src/seed.rs` *"gains one demo seller plus one owned product so the
  `LEFT JOIN` and the owner-scoped queries are exercisable locally"*, which is
  `owned_fixture()` at `seed.rs:101-111` and the `DEMO_SELLER_*` constants at
  `:121-124`. It predates `api-rs/tests/fixtures/products.json` as the harness's
  source, so it could not have considered that the owned fixture would be
  described twice with two different owner ids. Its storefront requirements —
  that the `LEFT JOIN` resolves, that the owned row is findable — all still hold
  and are all preserved by step 2's `owner_for` override.
- **`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md` —
  related, not superseded, and the naming precedent.** It established the shape
  this proposal follows: a duplicated contract becomes executable by giving it
  one owner and asserting both directions, rather than by documenting that the
  two copies should match. Its `store/contract.rs` suite runs against both
  implementations; the assertion proposed here is the fixture-catalogue
  equivalent, one layer out.
- **`implemented/2026-10-04-22-05-57-the-metrics-contract-has-no-owner.md` —
  related, not superseded; the closest structural sibling.** It gave
  `/metrics` a single name list (`api-rs/src/metrics_names.rs:44-66`) with
  tests comparing Rust call sites and `monitoring/` in *both* directions, and it
  is the most recent document to apply that pattern in this repository. It is
  worth reading before implementing: its note at `:26-32` — emission sites still
  spell literals, the list stays a checked reference rather than a second place
  to update — is the same judgement call step 2 makes about `seed.rs`'s insert.
- **Nothing is superseded.** No proposal in any folder proposes giving
  `api-rs/src/seed.rs` and `api-rs/tests/fixtures/products.json` a shared owner,
  and none mentions the `usr_demo_seller` / `usr_fixture_store` divergence or the
  two `createdAt` policies. Verified by `grep -rn "seed.rs"` across both
  proposal folders (five hits, all incidental, listed above) and by reading all
  twenty documents in `code-optimization-improve-proposals/`.