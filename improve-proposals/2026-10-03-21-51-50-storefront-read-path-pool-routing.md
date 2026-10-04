# The storefront read path: one uncached probe in front of the cache, and a pool split decided where nobody can see it

## Problem / opportunity

`GET /stores/{id}/products` is the second-most-cached route in the service — it
has a generation-folded list key (`api-rs/src/handlers/stores.rs:67-68`), the
same two-phase singleflight check the marketplace list uses
(`stores.rs:79-88`), the same `X-Cache` reporting
(`stores.rs:110-118`), and edge `Cache-Control`
(`ARCHITECTURE.md:229` calls it a public page). It is also the only cached read
in the service that issues a database query on **every** request, cache hit or
not, and the only public read whose queries ignore the read replica — and both
are invisible to anyone reading the route.

### 1. An uncached existence probe runs before the cache lookup

```rust
// api-rs/src/handlers/stores.rs:57-70
let (parts, _body) = request.into_parts();
let query = parse_page(parts.uri.query())?;
…
// A 404 is not cached: an id that has no store today may have one tomorrow,
// and the page is the only way a shopper finds out.
if state.store.find_user_by_id(&id).await?.is_none() {
    return Err(AppError::StoreNotFound(id));
}

let key = format!("stores:{id}:products:list:{}:{}", …);

if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
```

`find_user_by_id` acquires the **primary** and issues a `SELECT`
(`api-rs/src/store/users.rs:98-103`), and it runs *above* both cache checks.
So the request cost is:

| `X-Cache` | primary queries | replica queries |
| --- | --- | --- |
| `hit-l1` / `hit-l2` | **1** | 0 |
| `miss` | **3** (probe + list + count) | 0 |

Compare `GET /products` (`handlers/products.rs:138-146`), where the cache check
is the *first* thing after parsing and a warm request costs zero queries. The
cache on this route saves two of three queries on a fill and none of one on a
hit — it cannot absorb load, because every in-flight request still consumes a
primary connection. `DB_MAX_CONNECTIONS` is 10 per instance with a 2 s acquire
timeout (`api-rs/src/config.rs:68,70`), so this route is the first thing to
saturate the scarce pool regardless of its hit rate.

Worse, the probe makes the metrics disagree with reality: `X-Cache: hit-l1`
(`stores.rs:113`) is reported while Postgres was queried, so the cache-hit-ratio
and `sqlx_pool_acquire_seconds{pool="primary"}`
(`handlers/products.rs:275-280`) together paint a picture in which a route
looks free and is not.

The comment at `stores.rs:61-62` explains why a 404 must not be *cached*, which
is true and is not a reason to re-derive it on every hit.

### 2. The route's queries go to the primary, and the docs say they do not

`ARCHITECTURE.md:225-233` is a table of which pool each query uses, and its
first row is explicit:

> `GET /products`, `GET /products/{id}`, `GET /stores/{id}/products`,
> `COUNT(*)` → **read replica when configured** — "Public pages. Eventually
> consistent by choice."

The code does not implement that row. `list_owned_page` and `count_owned` both
call `acquire_primary()` unconditionally
(`api-rs/src/store/products.rs:457`, `:468`), while the three methods that *do*
respect the split go through `Self::acquire(self.reads(), self.read_role())`
(`products.rs:432`, `:439`, `:445`). The handler even says so itself:

```rust
// api-rs/src/handlers/stores.rs:90-92
// Reads from the replica, like `GET /products`: this is a public page, so
// read-your-writes is not a promise it makes. The seller's own `GET
// /my-store/products` is the one that does.
```

Three places in the repository — the architecture table, this comment, and
`improve-proposals/2026-10-03-seller-storefronts-my-store.md:140` — say the
storefront page reads from the replica. It does not. The reason is structural:
`list_owned_page` / `count_owned` serve **both** `/my-store/products`
(read-your-writes, must be the primary — `stores` are per-user and per-seller,
`my_store.rs:55-59`) and `/stores/{id}/products` (public and eventually
consistent by design). The pool decision is therefore baked into the store
method, where the call site cannot see it and the two callers want opposite
answers. Nothing in the type or the name says which one you are getting.

### 3. The storefront `COUNT(*)` is uncached while the marketplace's is not

`ARCHITECTURE.md:201-206` documents `COUNT(*)` as cached under `products:count`
with the generation folded in. `handlers/products.rs:254-271` implements that
(`catalog_total`, with its own singleflight and a fail-open parse).
`handlers/stores.rs:94` calls `state.store.count_owned(&id)` directly — a
`COUNT(*)` against the primary on every cache fill, in a route that has no
shared count entry at all.

### 4. Nothing tests any of it

The only pool-routing assertion in the suite is
`tests/e2e_products.rs:148-178` (`reads_are_served_from_the_read_replica`),
and it covers `/products` and `/products/{id}`. There is no counterpart for
`/stores/{id}/products`, no unit test asserting *which pool* any handler's
queries use, and no k6 scenario that mentions `/stores` at all (the whole of
`load-tests/` greps clean). So the divergence between the docs and the code has
nothing that could ever fail.

### Relationship to existing proposals

- **`implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`** introduced the
  read replica (item 2.3). It predates the storefront route and has nothing to
  say about it. This proposal **extends** that work; it does not replace or
  contradict any of its four items, all of which remain done.
- **`2026-10-03-seller-storefronts-my-store.md`** is the proposal this route came
  from. It specifies the correct behaviour in three places (§4's shared list
  generation, §5's replica routing at line 140, and the ARCHITECTURE.md edits in
  §10) and does not implement §5's routing. This proposal is not a
  re-scoping of that proposal — it is the follow-up that makes the code match
  what that proposal already claims, and adds the missing tests. It does not
  change a single route, response body, or client.
- Not related to the five open feature proposals (search, coupons, checkout
  form, order history, ratings): none of them touches `/stores/*` or the pool
  split. Notably, server-side search (`2026-09-29-12-22-…:140-142`) makes this
  *worse* — every distinct query is another list key, so a search-heavy
  workload on the storefront route multiplies fills that each cost three primary
  queries.

## Proposed approach

### 1. Make the consistency requirement an argument, not an assumption

In `api-rs/src/store/products.rs`, next to `ProductStore`:

```rust
/// Which pool a read may use. Named after the promise the caller is making to
/// its own caller, because that is what the choice is actually about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Consistency {
    /// Read-your-writes. The primary, always.
    Current,
    /// The read replica when one is configured, the primary otherwise.
    Eventual,
}
```

Add it to the two owner-scoped read methods:

```rust
async fn list_owned_page(&self, owner_id: &str, offset: i64, limit: i64,
                         consistency: Consistency) -> Result<Vec<Product>, StoreError>;
async fn count_owned(&self, owner_id: &str, consistency: Consistency)
                     -> Result<i64, StoreError>;
```

and one helper on `SqlProductStore` so there is exactly one place that maps the
policy onto a pool:

```rust
async fn acquire_for(&self, consistency: Consistency)
    -> Result<PoolConnection<Postgres>, StoreError> {
    match consistency {
        Consistency::Current => self.acquire_primary().await,
        Consistency::Eventual => Self::acquire(self.reads(), self.read_role()).await,
    }
}
```

`InMemoryStore` ignores the argument (`store/memory.rs:91-102`) — the seam
already takes `_owner_id`-style unused bindings, so this is a signature-only
change and no unit test fixture moves.

Call sites become the single readable statement of the §5 table:

- `handlers/my_store.rs:58-59` → `Consistency::Current`, with the existing
  comment at `my_store.rs:55-57` kept as the reason.
- `handlers/stores.rs:93-94` → `Consistency::Eventual`, and the comment at
  `stores.rs:90-92` becomes true, so it is no longer a lie a reviewer has to
  re-derive.

`find_owned_by_id` stays `acquire_primary()` (`:481`) — it is only reached from
the owner-scoped PATCH/DELETE paths, and the trait doc at `products.rs:112-113`
explains the 404-not-403 reasoning.

### 2. Move the existence probe below both cache checks

In `handlers/stores.rs`, relocate the `find_user_by_id` block from lines 63-65
to immediately after the singleflight re-check (after line 88). The 404
contract is unchanged — the probe still runs on every fill, so
`app.rs:331-347` (`the_public_store_routes_need_no_token`, which asserts
`{"message":"Store usr-nobody not found",…}`) keeps passing, and a bad id still
gets a 404 rather than an empty 200. What changes is that a warm request costs
zero queries.

The honest bound: a storefront that disappears would keep serving its last
cached page until `L1_LIST_TTL_SECS` expires. There is no delete-store route
today, so this is hypothetical, and 5 s of staleness is already the contract of
the list cache (`cache/mod.rs:81-83`).

### 3. One cached-count implementation, used by both list routes

Generalise `catalog_total` (`handlers/products.rs:254-271`) into a reusable
`pub(crate) async fn cached_count<F>(state, key, load: F) -> Result<i64, AppError>`
holding the flight, the fail-open parse and the `Kind::List` write. The
marketplace calls it with `count_key(state)` and `|| state.store.count()`; the
storefront calls it with
`format!("stores:{id}:count:{}", state.cache.generation())` and
`|| state.store.count_owned(&id, Consistency::Eventual)`. One implementation
means one fail-open rule and one unreadable-entry warning, and the storefront
gains the generation-folded count it is documented to have.

### 4. Make the policy testable, then test it

Two tests turn the §5 table from prose into an assertion:

- **Unit, Docker-free**, in `handlers/stores.rs` and
  `handlers/my_store.rs`: a recording `ProductStore` wrapper that captures
  `(method, Consistency)` per call, asserting that `/stores/{id}/products`
  records `Eventual` for both queries, `/my-store/products` records `Current`
  for both, and the write paths record `Current`. This is the test that would
  have failed when the docs and the code diverged, and it keeps failing the day
  somebody adds a fifth owner-scoped route and copies the wrong line.
- **Hermetic E2E**, in `tests/e2e_my_store.rs`, mirroring
  `e2e_products.rs:148-178`: with `TestStack::start_with_read_replica`
  (`tests/common/mod.rs:196-202`), run an `UPDATE "Product" SET "price" = …`
  against `ReplicaDatabase.pool` for `prod-owned-1` — the fixture owned by
  `FIXTURE_STORE_ID`, so it is already inside that store's listing — then assert
  `GET /stores/usr_fixture_store/products` returns the replica's price. It
  returns the primary's today. No new fixture, no new container.

## Impact

**Reuse / consistency.** One `Consistency` enum replaces a decision duplicated
implicitly across three files that disagree with each other. After this change,
`ARCHITECTURE.md:225-233` is a description of code rather than an aspiration, and
the next owner-scoped read cannot silently pick the wrong pool — the signature
forces the question at every call site.

**Performance.** A warm `GET /stores/{id}/products` goes from one primary query
to **zero**, and a cold one from three primary queries to one replica list
query plus a replica count that is cached per generation. That is the difference
between a route that consumes a primary connection per in-flight request and
one that consumes none while warm — which is the property the whole tiered cache
in §5 was built to have.

**Observability.** `X-Cache: hit-l1` starts meaning what it says, and
`sqlx_pool_acquire_seconds{pool="primary"}` stops carrying a route that reports
itself as cached. The `pool="read"` label (`products.rs:416`) starts covering
the storefront route, so the dashboard can show the split it advertises.

**Testability.** The read/write split becomes an asserted property of each route
instead of a claim in a markdown table, and the two existing suites
(`reads_are_served_from_the_read_replica`, `a_write_retires_every_cached_list_page`)
gain the storefront sibling they are missing.

**What does *not* improve.** Response bodies, status codes, and headers are
untouched — `products-page-{1,2}.json` and the other goldens must not need
regeneration, and `parity.rs` must pass untouched. Nothing gets faster for
`GET /stores/{id}` (one uncached primary row, `stores.rs:32-50`), which
`ARCHITECTURE.md:233` calls deliberate; nothing improves for
`/my-store/products`, which stays on the primary by design. `web-application`
and `mobile-application` are not modified at all. Load-test numbers will not
move in any existing scenario, because none of them touches `/stores`.

## Risks / trade-offs

- **A trait signature change ripples.** `ProductStore` gains a parameter on two
  methods, so `SqlProductStore` (`products.rs:451-474`) and `InMemoryStore`
  (`memory.rs:91-102`) both change, and `benches/handlers.rs` may construct a
  store. It is mechanical and `cargo check` finds every site, but it is not a
  one-line diff.
- **The public storefront page becomes eventually consistent.** It is already
  cached for up to `L1_LIST_TTL_SECS` and edge-cached per
  `edge_cache_control`, so this is the smaller of the two staleness bounds being
  made explicit — but it is a real behaviour change on a route with no replica
  configured in local dev or CI today, so it will be invisible until an
  operator sets `DATABASE_READ_URL`. `ARCHITECTURE.md:241-250` already records
  the two consequences (broken replica, stale replica); both now cover this
  route too and should say so.
- **Moving the probe introduces a bounded window** for a storefront that
  disappears (see §2). Not reachable today; worth the one-line note.
- **The count cache adds a key family** (`stores:{id}:count:{gen}`) to retire.
  It is folded into the same generation, so `bump_list_generation` already
  invalidates it — no new invalidation path, but a new key shape to recognise
  when reading `l1.rs`/`l2.rs`.
- **`cargo-llvm-cov`'s 80% line gate** must stay green; the new `acquire_for`
  and `cached_count` branches (`Eventual` with a replica, `Current`, the
  unreadable-count fallback) each need a test, not just a happy path.

## Validation

**Rust unit tests (no Docker)**

- `handlers/stores.rs`: a recording store asserts `/stores/{id}/products`
  issues `list_owned_page(_, Eventual)` and `count_owned(_, Eventual)`, and
  that two sequential requests against the same router call `find_user_by_id`
  **once**, not twice.
- `handlers/my_store.rs`: the same recording store asserts `Current` for
  `list_owned_page` and `count_owned` on `GET /my-store/products`, and for
  `create` / `update_owned` / `delete_owned`.
- `store/products.rs`: `acquire_for(Consistency::Current)` is the primary pool
  even when a read pool is configured — assertable by wrapping
  `broken_read_pool` and showing the call still succeeds where the `Eventual`
  one does not, mirroring `e2e_products.rs:184-202` at unit level.
- `handlers/products.rs`: `cached_count` keeps today's three properties
  (single flight for one `COUNT(*)` per window, fail-open on an unreachable
  tier, a 200 with a correct `total` on a store error) after the
  generalisation, plus the storefront key variant.
- `app.rs:331-347` and every existing `handlers/stores.rs` / `handlers/my_store.rs`
  test unchanged — the 404 body and the `no-store` headers are the contract.

**Hermetic E2E (`pnpm --filter @rnw/api-rs test:e2e`, needs Docker)**

- `e2e_my_store.rs`, new: `start_with_read_replica` + a replica-only
  `UPDATE` on `prod-owned-1` ⇒ `GET /stores/usr_fixture_store/products` reports
  the replica's price (primary's today — the test is red before the change).
- The mirror case: `GET /my-store/products` still reflects a write immediately
  with a replica configured, so the split cannot be "fixed" by sending
  everything to the replica.
- Existing `e2e_my_store.rs` cases unchanged, including
  `a_write_retires_every_cached_list_page` (`:271-322`) — the storefront's count
  key now also carries the generation, so a create must retire it.
- `parity.rs` and the six goldens unchanged; `api-rs/tests/fixtures/generate_goldens.py`
  not re-run.

**Checks**

```bash
pnpm --filter @rnw/api-rs test          # unit
pnpm --filter @rnw/api-rs test:e2e      # hermetic E2E + parity parity (Docker)
pnpm --filter @rnw/api-rs lint          # fmt + clippy
pnpm --filter @rnw/api-rs typecheck
pnpm --filter @rnw/api-rs coverage      # 80% line gate
```

**Measurement (optional, not a gate)**

`k6 run load-tests/k6/steady.js` with a `GET /stores/{id}/products` scenario
added, before and after, comparing `sqlx_pool_acquire_seconds{pool="primary"}`
request count against `http_requests_total{route="/stores/{id}/products"}`. The
expected result is that the primary-acquire count for that route goes from ~1
per request to ~0 while warm. No existing scenario changes, so this is additive.

**Docs to update in the same change**

`ARCHITECTURE.md:225-233` (the table stays, and is now true),
`ARCHITECTURE.md:241-250` (the two replica consequences now include this route),
`ARCHITECTURE.md:201-206` (the count bullet gains the store-scoped key), and
`README.md:285-293` (the replica section should name `/stores/{id}/products`).
