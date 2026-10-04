# One cached read path for the three product lists

## Problem / opportunity

`GET /products` has a carefully factored read path in
`api-rs/src/handlers/products.rs`: a key builder (`products.rs:231-233`), a
cached-response helper (`products.rs:208-221`), a documented two-phase stampede
check (`products.rs:148-155`), a header builder (`products.rs:275-280`) and a
page envelope (`products.rs:160-168`). `GET /stores/{id}/products` re-implements
all five inline, in one handler, and the re-implementation has already drifted
from the original in three places that matter.

**1. The cached-response helper exists and is used four times — all in its own
file.** `products.rs:144`, `:153`, `:184` and `:192` all call `cached(...)`.
Nothing outside the module does; `grep -rn "cached(" api-rs/src` returns those
four plus the definition. `stores.rs:70-77` and `stores.rs:81-88` are the same
eight lines, twice, inside the handler, doing by hand exactly what
`products.rs:208-221` does:

```rust
// stores.rs:70-77 and stores.rs:81-88 — byte-identical to each other
if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
    return Ok(json_response(
        StatusCode::OK,
        bytes.to_vec(),
        &store_headers(&state, Some(source)),
        conditional,
    ));
}
```

Sixteen lines collapse to two.

**2. The stampede ordering the original file calls "the whole design" is
re-derived with no comment.**

```rust
// products.rs:148-150
// Stampede protection. The ordering is the whole design: check, then take
// the flight, then check *again*, because the leader we waited behind may
// have just populated the cache.
```

```rust
// stores.rs:79-88
let flight = state.cache.flights().for_key(Kind::List, &key).await;
let _fill = flight.lock().await;
if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
```

Same order, no explanation of why the order is load-bearing. `products.rs` has
six tests defending this exact sequence (`products.rs:617-693`); the copy in
`stores.rs` has none, because a reviewer reading `stores.rs` cannot tell a
deliberate ordering from an accidental one.

**3. The cache-key scheme — the correctness mechanism for write-driven
invalidation — is written three times, and one of the three is a bare string
literal in a test.**

```rust
// products.rs:231-233
pub fn list_key(state: &AppState, page: f64) -> String {
    format!("products:list:{}:{}", state.cache.generation(), page.to_bits())
}
```

```rust
// stores.rs:67-68
let key =
    format!("stores:{id}:products:list:{}:{}", state.cache.generation(), query.page.to_bits());
```

```rust
// cache/mod.rs:204 — inside the test that proves a bump retires list pages
let key = |generation: i64| format!("products:list:{generation}:{}", 1.0f64.to_bits());
```

`ARCHITECTURE.md` §12 documents this scheme as the reason a write can retire
every cached page with one `INCR` and no `SCAN`. `cache/mod.rs:200-212` is the
test that proves it works. Neither knows that a second handler spells the scheme
independently. If the storefront's copy ever dropped the generation — one
`format!` edit — its pages would never be retired by a write, and
`cache/mod.rs:200-212` would still pass.

**4. A second, quieter key duplication, where drift fails silently.**
`products:detail:{id}` is a literal in two modules:

```rust
// products.rs:181
let key = format!("products:detail:{id}");
```
```rust
// cache/mod.rs:158
pub async fn invalidate_detail(&self, id: &str) {
    let key = format!("products:detail:{id}");
```

If these diverge, `invalidate_after_write` (`my_store.rs:137-140`) becomes a
no-op: the write path still bumps the generation and still answers 201/200, and
`GET /products/{id}` keeps serving the pre-write body until the detail TTL runs
out. `cache/mod.rs:237-250` exercises only the pair using its *own* literal, so
it cannot catch a change to `products.rs:181`.

**5. `store_headers` is `product_headers` renamed, and its doc comment describes
a difference that does not exist.**

```rust
// stores.rs:109
/// The same additive headers `GET /products` sends, minus `no-store`.
```

Both functions return exactly `CACHE_CONTROL` (parsed from
`state.config.edge_cache_control`) plus `x-cache` — `products.rs:275-280` and
`stores.rs:110-118`. Neither mentions `no-store`. The comment asserts a
distinction; the code does not have one. (The one endpoint that genuinely means
`no-store` is `stores::detail` at `stores.rs:49`, and it passes a literal
`&[NO_STORE]` — correctly, and untouched by this proposal.)

Both copies also re-parse `state.config.edge_cache_control` on **every** request,
including every cache hit, via `HeaderValue::from_str`. That string is fixed at
`config.rs:151` and never mutated, and a value `from_str` rejects degrades
silently to `public` with no log — on the two hottest public paths.

**6. The page envelope is written three times, and one copy is already
inconsistent.**

```rust
// products.rs:160-168          stores.rs:96-102            my_store.rs:61-69
let body = ProductsPageJson {   let body = ProductsPageJson {  let body = ProductsPageJson {
    items: products                items: items                 items: products.iter().cloned()
        .into_iter()                   .into_iter()                  .map(ProductJson::from)
        .map(ProductJson::from)         .map(ProductJson::from)       .collect(),
        .collect(),                  ...                         ...
    ...
    has_next_page: (query.skip + item_count) < total as f64,   //  identical in all three
```

`has_next_page` is contract fidelity, not formatting: `products.rs:165-166` says
it is "`skip + items.length < total` in float arithmetic, on the unwrapped
skip, exactly as `ProductsService.findAll` evaluates it", and `parse_page`
(`products.rs:68-75`) deliberately keeps `skip` as an `f64` for this reason,
with `products.rs:359-361` pinning the float values. Three copies of that
expression is the wrong place for it.

`my_store.rs:62` also uses `products.iter().cloned()` where the other two use
`into_iter()`. `products` is an owned `Vec` bound at `my_store.rs:58`, so this
clones all 20 `Product`s — including their `String`s — before converting each
one, on every request, for no reason.

**7. The consequence that makes this more than tidiness: three sources describe
the storefront's read routing, and no two agree.**

| Source | What it says |
| --- | --- |
| `stores.rs:90-92` | "Reads from the replica, like `GET /products`: this is a public page, so read-your-writes is not a promise it makes." |
| `ARCHITECTURE.md`, "Which pool a query uses" | `GET /stores/{id}/products` → "read replica when configured". |
| the code: `store/products.rs:457`, `:468` | `list_owned_page` and `count_owned` both call `acquire_primary()`. |
| `tests/e2e_my_store.rs:111-121` | "And on the seller's public store page, **which is also owner-scoped**" — asserts the new product is visible immediately. |

The comment and the architecture document are wrong; the code and the test are
right. Nothing caught it, because the replica-routing test
(`e2e_products.rs:148-178`) only asserts `/products` and `/products/{id}`, and
the replica-only fixture (`common/mod.rs:76`, `:355`) has no owner, so an
owner-scoped read cannot see it either way.

The root cause is naming, not the individual line. One method,
`list_owned_page` (`store/products.rs:105-110`, implemented at `:451-465`),
serves two callers with opposite requirements:

- `my_store.rs:58` — the seller's own catalogue. Must not race replica lag; the
  reasoning is written down at `my_store.rs:55-57`.
- `stores.rs:93` — a public storefront page, which by the service's own stated
  policy is eventually consistent by choice.

A method called `list_owned_page` states *whose* rows it returns and says nothing
about *how fresh* they are, so the second caller inherited the first caller's
routing by accident and then documented the opposite.

**8. The duplicated endpoint is the one with no tests.** `stores.rs` has exactly
one unit test — `the_store_shape_is_id_name_created_at` (`stores.rs:124-140`) —
and it asserts a JSON string. Nothing anywhere asserts that
`/stores/{id}/products` respects a generation bump, deduplicates a cold burst, or
serves distinct stores independently. `tests/parity.rs` has eight committed
golden bodies including one for `/stores/{id}` (`parity.rs:66-73`) but none for
`/stores/{id}/products`. The E2E suite touches the endpoint twice
(`e2e_my_store.rs:113`, `:471`) and asserts bodies, never caching.

That is the direct cost of the duplication: the copy has no owner reviewing it,
so it acquired a wrong comment, a routing decision nobody chose, and no tests.

## Proposed approach

Keep all three routes and both response contracts exactly as they are. This is a
change of *where* the read path is written, plus one naming change that forces
the routing contradiction to be resolved on purpose.

### 1. One key builder — `api-rs/src/cache/mod.rs`

Move the scheme next to `GENERATION_KEY` (`cache/mod.rs:22`), so the strings and
the counter they fold in live in the same module. Three constructors:

```rust
pub fn detail_key(id: &str) -> String                    // products:detail:{id}
pub fn list_key(state: &AppState, page: f64) -> String    // products:list:{gen}:{bits}
pub fn store_list_key(state: &AppState, store_id: &str, page: f64) -> String
```

The byte format **must not change** — these are live Valkey keys across a fleet,
and `cache/mod.rs:204` hardcodes the shape in the test that proves retirement
works. This moves where the string is built, not what it is.

`products.rs:181` and `stores.rs:67-68` then call these, and
`cache/mod.rs:158` uses `detail_key(id)`. The `invalidate_detail` / handler
duplication at finding 4 becomes structurally impossible. Fix
`cache/mod.rs:204` to use `list_key`'s format via a small helper rather than a
literal, so the test exercises the builder it is testing.

### 2. One header builder — delete `stores.rs:110-118`

Make `product_headers` (`products.rs:275-280`) `pub(crate)` and delete
`store_headers`. The output is identical, so there is nothing to preserve. The
comment at `stores.rs:109` describes a `no-store` difference that does not
exist and should not be carried forward.

*Optional, and a behaviour change a reviewer should decide on:* add a
pre-parsed `HeaderValue` to `Config` beside `edge_cache_control` (`config.rs:56`,
set at `config.rs:151`) so the parse happens once at boot. This also turns a
malformed `EDGE_CACHE_CONTROL` from a silent downgrade to `public` into a startup
failure. That is better, but it is a new failure mode for an operator, so it
belongs in its own commit or not at all.

### 3. One cached-response helper — promote `products.rs:208-221`

Make `cached()` `pub(crate)` and call it from `stores.rs:70` and `stores.rs:81`.
Sixteen lines become two, and the storefront inherits `products.rs`'s tested
stampede ordering instead of a silent copy of it.

### 4. One envelope builder — next to `ProductsPageJson` (`products.rs:57-66`)

```rust
impl ProductsPageJson {
    pub fn from_page(items: Vec<Product>, query: &PageQuery, total: i64) -> Self {
        let item_count = items.len() as f64;
        Self {
            items: items.into_iter().map(ProductJson::from).collect(),
            page: query.page,
            limit: PAGE_SIZE,
            total,
            // `skip + items.length < total` in float arithmetic, on the unwrapped
            // skip, exactly as `ProductsService.findAll` evaluates it.
            has_next_page: (query.skip + item_count) < total as f64,
        }
    }
}
```

Taking `Vec<Product>` fixes `my_store.rs:62` as a side effect — there is no
`iter()` available to get wrong. Replace all three sites (`products.rs:160-168`,
`stores.rs:96-102`, `my_store.rs:61-69`).

`my_store::list` keeps its own uncached read, and that is correct: `my_store.rs:55-57`
gives a real reason (per-user, no shared key could be correct for more than one
caller). It stops being a fourth copy of the envelope, not a fifth copy of the
cache.

### 5. Split the owner-scoped store method, and name the routing

In `store/products.rs`, replace `list_owned_page` / `count_owned`
(`:105-111`, impls at `:451-474`) with names that state consistency:

```rust
/// The seller's own rows. Always the primary: a seller must see their own writes.
async fn list_page_for_owner(&self, owner_id, offset, limit) -> ...
/// A public storefront page. Replica-safe: eventually consistent by choice.
async fn list_public_page_by_owner(&self, owner_id, offset, limit) -> ...
```

`my_store.rs:58-59` calls the first; `stores.rs:93-94` calls the second. Then
`stores.rs:90-92`'s comment and `ARCHITECTURE.md`'s table row are true by
construction, because the method name cannot be inherited by accident.

**This is the one behavioural change in the proposal and it needs an explicit
decision.** Moving the storefront to the replica means, under
`DATABASE_READ_URL`, a public page may briefly omit a just-created product.
`ARCHITECTURE.md` already chose that for this page ("Eventually consistent by
choice"), and the alternative — leaving the code as-is — means the shipped
behaviour is the one place on the public read surface that no document describes.
Land steps 1-4 as a pure refactor, then step 5 as its own commit so it can be
reverted independently, and update the `ARCHITECTURE.md` table row and
`e2e_my_store.rs:111-121` in the same commit. If a reviewer prefers the primary,
that is a legitimate answer — but then the comment, the table and the code all
have to change together, which is the point.

### 6. Tests, in the modules that now own the code

`stores.rs` gains a test module modelled on `products.rs`'s, using the same
counting-store approach (`products.rs:417-518`):

- 64 concurrent cold `/stores/{id}/products` requests issue one page query and
  one count — the stampede claim, now asserted where the copy lives.
- `bump_list_generation()` makes a previously cached storefront page unreachable.
  This is the property the duplicated key scheme exists for, and it is untested
  today.
- Two store ids are not serialised against each other.
- `stores.rs` calls `cache::list_key`-shaped builders such that
  `products.rs`'s existing generation test (`products.rs:402-412`) covers them
  too, or a sibling test does.

Plus two additions outside that module:

- A one-line assertion that `products::detail` and `CacheTier::invalidate_detail`
  address the same key — closes finding 4's drift hole.
- A golden body for `/stores/{id}/products` in `tests/parity.rs`, next to the
  existing `/stores/{id}` golden (`parity.rs:66-73`).

`e2e_products.rs:148-178` cannot assert storefront routing until there is a
replica-only fixture that *has an owner*; `common/mod.rs:355` currently inserts
`REPLICA_ONLY_ID` with none. That is a fixture gap, not a blocker — note it
rather than pretend step 5 is E2E-proven.

## Impact

**Reuse.** 43 lines of handler code that currently exists in two or three places
stop existing more than once: `stores.rs:70-77` + `stores.rs:81-88` (16, and
byte-identical to each other), `stores.rs:110-118` (9), `stores.rs:67-68` (2),
`stores.rs:96-102` (7) and `my_store.rs:61-69` (9). They become four call sites
and three small builders. The count is mechanical and checkable — after this,
`grep -rn "x-cache" api-rs/src` should show one builder, and
`grep -rn "has_next_page: (query.skip" api-rs/src` should show one expression.

**Consistency.** This is the real gain. One place decides the stampede ordering,
one place stamps `x-cache`, one place computes `hasNextPage`, and one method
name decides which pool a storefront read uses. The current state — a comment
that contradicts its own code, an architecture table that contradicts both, and
a test that contradicts the table — is the kind of thing that survives review
precisely because no single reader holds all three files.

**Testability.** The storefront's read path becomes testable by the mechanism
that already works for `/products`: a counting store plus a real `CacheTier`.
Nothing about it needs a database, and it currently has no unit test at all
because a copied 16-line cache dance is not recognisable as something with
checkable properties.

**Scalability / performance.** Small and honest, and mostly not from this change.
`my_store.rs:62`'s full-page clone disappears (20 `Product`s, with their
`String`s, per request). The per-request `HeaderValue` parse becomes per-process
if the optional `Config` change lands. Step 5, if it lands, moves the public
storefront page onto the replica — the only measurable throughput win here, and
it is a consequence of fixing the routing decision rather than of the refactor.

**What does not improve.** The storefront still costs one primary round trip per
request even on an L1 hit, because the existence probe at `stores.rs:63` sits
*before* the cache read at `stores.rs:70` and is load-bearing: no invalidation
hook exists for seller deletion, so `e2e_my_store.rs:442-490` (delete a seller,
assert the store 404s) depends on it. Caching "this store exists" needs its own
design and is explicitly out of scope. `catalog_total` (`products.rs:254-271`)
still takes its flight lock before checking the cache, inverting the ordering
`products.rs:148-150` calls "the whole design" — unchanged here. `my_store::list`
stays uncached, correctly. Nothing about the frontend, the two api clients, or
any route file changes.

## Risks / trade-offs

- **Step 5 is a behaviour change disguised as a rename.** Under
  `DATABASE_READ_URL`, `/stores/{id}/products` moves from primary to replica.
  `e2e_my_store.rs:111-121` asserts immediate visibility of a new product there
  and will still pass in CI (no replica is configured by default) while no longer
  asserting anything true in production. It must be rewritten in the same commit
  to say "eventually consistent", or it becomes a test that lies. This is the
  single most likely reason to reject the proposal, and the reviewer should
  decide it deliberately rather than inherit it.
- **Key format changes would be a fleet-wide invalidation event.** Not a risk if
  the format is preserved byte-for-byte, which the test at `cache/mod.rs:204`
  pins. Worth stating because "tidy up the key scheme" is exactly the change
  someone would make while in here.
- **Sharing `product_headers` removes the ability to diverge later.** If a
  future endpoint needs `Cache-Control: no-store` on the product read path, it
  will have to pass its own header slice (as `stores::detail` already does at
  `stores.rs:49`) rather than adding a flag to the shared builder. That is the
  right outcome — the flag would be a bool nobody reads — but it is a real change
  in what the code can express.
- **`pub(crate)` on `cached()` and `product_headers` widens the module boundary
  of `products.rs`.** If a reviewer would rather these live in `cache/mod.rs` or
  a new `handlers/read_path.rs`, that is a better home for all of it and costs
  nothing but a different import path. Worth picking deliberately.
- **The optional `Config` `HeaderValue` change trades a silent degradation for a
  boot failure.** Better, but it is a new way for the service to refuse to start.
  Keep it in its own commit or drop it.
- **Scope.** The probe-before-cache at `stores.rs:63`, the `Session`-table growth
  in `auth`, and the `iter().cloned()`-equivalent patterns elsewhere in
  `store/products.rs` are separate problems with separate designs. This proposal
  does not touch them and should not grow to.

## Validation

1. `pnpm --filter @rnw/api-rs test` — the existing unit tests must pass
   unchanged, especially `products.rs`'s six stampede tests
   (`:617-693`), the generation test (`:402-412`), and `cache/mod.rs`'s five
   (`:170-250`). `cache/mod.rs:204` is expected to be edited; the assertion must
   not be.
2. `pnpm --filter @rnw/api-rs lint` — `cargo fmt` and `clippy` over the new
   constructors and the split trait methods.
3. `pnpm --filter @rnw/api-rs test:e2e` — requires Docker. Specifically:
   - `tests/parity.rs` byte-compares against committed goldens, so it proves the
     refactor changed no response body. Run it first.
   - `tests/e2e_products.rs:148-178` (`reads_are_served_from_the_read_replica`)
     and `:183-202` (`health_checks_the_primary_…`) prove the primary/replica
     split still holds for `/products` after the store-method rename.
   - `tests/e2e_my_store.rs` proves the seller flows, the 404-not-403 rule
     (`:400-438`) and the seller-deletion cascade (`:442-490`) are intact. The
     storefront assertion at `:111-121` is the one step 5 changes.
4. New assertions, listed in the proposal: the storefront stampede test, the
   storefront generation-retirement test, the distinct-stores-not-serialised
   test, and the detail-key agreement assertion. Before/after, `stores.rs` has
   one test; after, the read path it owns has four.
5. Line-count check, the same mechanical measurement that produced this proposal:
   re-run a normalised diff of `products.rs:138-173,206-233,273-280` against
   `stores.rs:52-118`. Success is not "0 identical lines" — it is that the
   remaining shared lines are the two handler signatures and nothing else, and
   that `stores.rs` contains no `format!` for a cache key.
6. `pnpm --filter @rnw/api-rs bench` — `benches/handlers.rs` builds the same
   list path; run it before and after for steps 1-4 to confirm no regression.
   Step 5 will show the storefront moving pools, but the bench does not exercise
   `/stores/*`, so do not expect it to.
7. Not required and not claimed: nothing in this proposal touches the frontend,
   so no web or mobile suite needs to run.

## Related proposals

- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`** — unrelated surface (frontend routes vs `api-rs` handlers), and it is the only other document in this folder. It does touch `api-rs`'s contract in one place: its `productQueryKey(id)` step names `web-application/app/marketplace/[id]/page.tsx:13` as a client-side duplicate of this proposal's finding 4, but on the other side of the wire. Independent changes; neither blocks the other.
- **`improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`** — **related, not superseded, and not re-proposed here.** Its item 2.3 landed the read pool and specified that "the store routes `list_page`/`find_by_id` to the read pool" (`:136`, `:196-207`), and its §"Validation" named `/products` and `/health` as the coverage (`:370-372`). It predates `stores.rs`, so it could not have considered that `list_owned_page` would be shared between a private seller read and a public storefront read. This proposal does not re-open the read-replica decision — it makes the storefront's half of it explicit and separately revertible.
- **`improve-proposals/implemented/2026-10-01-marketplace-api-high-traffic-performance.md`** — the Rust rewrite itself. Its §"Read replicas are a later config step" (`:170-172`) is the plan `ARCHITECTURE.md`'s pool table implements; no overlap with handler read-path factoring.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md`** — the feature proposal that created `stores.rs` and `my_store.rs`. It is where the storefront's uncached-404 rule (`stores.rs:61-62`) and the generation-bump contract (`my_store.rs:88-90`) come from. Both are preserved here; this proposal only changes how they are written down and tested.
- **`improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md` §2.2** (cached `COUNT(*)`) is left alone. `products.rs:254-271` is the only place `total` is cached, and step 4 does not change that — see "What does not improve".
