# Cached payload size is unowned: the cache bounds entry *count*, and the only fields a seller can make unbounded are the ones nobody bounds

## Outcome

Implemented. Steps 1, 2, 3, 4 and 6 landed as written. Step 5 landed in a
different shape than proposed, for a reason worth keeping:

- **`cache_l1_evictions_total` was not emitted.** `moka` 0.12.16 exposes no
  eviction count at all. Its counters live behind the explicitly
  `unstable-debug-counters` feature and are surfaced as `debug_stats()`, a
  snapshot that would need polling and differencing to become a counter — an
  unstable dependency feature adopted to serve one line of a proposal, which is
  the wrong trade. What shipped instead is `cache_entry_size_bytes{kind}`, the
  signal that actually predicts the cliff: entry size is the input to the
  pathology, and hit ratio is the lagging symptom.
- **The refusal counter is split per tier** (`cache_l1_oversize_total` and
  `cache_l2_oversize_total`) rather than being one `cache_l1_*` series, because
  the two tiers refuse for different reasons — an LRU evicts its neighbours, the
  shared store competes with `api-rs:rl:*` — and the crate already splits
  `cache_l1_*` from `cache_l2_*` throughout.
- **Two status/placement details differ from the text.** Validation errors in
  this service answer `400`, not the `422` the proposal assumed; the new caps
  answer `400` so they match the existing title cap exactly, which is what the
  proposal actually asked for ("the same message shape as an over-long title").
  And the byte bound lives in `CacheTier::set`, so its test lives in
  `cache/mod.rs` rather than `cache/l1.rs` — `L1Cache` has no bound to test.
  The L2 branch is covered by the L1 assertions plus the shared code path; a
  dedicated L2 test would need a `Valkey` socket and a trait seam that does not
  exist.

Everything else in **Proposed approach** is implemented as described, and the
**Validation** list was worked through: `cargo test --lib` (212 passing),
`test:e2e` against Docker (Postgres contract, parity goldens, seed — all
passing), the metric contract, `coverage` at 94.15% lines against a gate of 80%,
and `bench`. Two items could not be run and are recorded in the pull request:
the mobile app was not launched on a simulator, and `web-application`'s Playwright
suite could not start because the local development database has never had this
repository's migrations applied — a pre-existing condition, unrelated to this
change.

## Problem / opportunity

`api-rs` caches whole serialized response bodies in two tiers, and both tiers are
sized in **entries**. Nothing anywhere sizes an entry in **bytes**, because the two
seller-controlled fields that decide how large an entry is are the only free-text
fields the API accepts with **no length cap at all**. The result is that the
service's memory ceiling is governed by a hardcoded literal that cannot see what it
is storing, in a store that also holds the load-shedding counters.

This is not an inference from reading handlers. It is four facts, each independently
checkable, and the arithmetic at the end of each one is the finding.

### 1. The cache's only memory bound is a literal, and it counts entries

```rust
// api-rs/src/cache/l1.rs:57-58
fn build(ttl: Duration) -> Cache<String, Bytes> {
    Cache::builder().time_to_live(ttl).max_capacity(50_000).build()
}
```

That is the **only** capacity bound anywhere in the repository. Verified:
`grep -rn "max_capacity\|maxmemory\|MAX_BODY\|max_body\|capacity" api-rs/src
docker-compose.yml monitoring/` returns this one line and nothing else.

`build` is the constructor for **both** caches in `L1Cache::new`
(`api-rs/src/cache/l1.rs:30-32`), so the process ceiling is 50,000 list entries
**plus** 50,000 detail entries — 100,000 entries, at whatever size each one happens
to be.

It is also not configurable. `Config::ENV_KEYS` (`api-rs/src/config.rs:264-287`)
carries `L1_LIST_TTL_SECS`, `L1_DETAIL_TTL_SECS` and `L2_TTL_SECS` — three TTLs and
no capacity key. `AppState::new` builds the tiers from config and nothing else:

```rust
// api-rs/src/app.rs:46-49
        let cache = CacheTier::new(
            L1Cache::new(config.l1_list_ttl, config.l1_detail_ttl),
            valkey.clone().map(|conn| L2Cache::new(conn, config.l2_ttl)),
        );
```

So an operator who wants a smaller cache has no knob to turn, and an operator who
wants a *larger* one cannot have it either. `ARCHITECTURE.md` never discusses cache
memory, entry size or occupancy at all (grep for `maxmemory|capacity|entry
count|bytes|amplification` in `api-rs/ARCHITECTURE.md` returns only the pool gauges at
`:401` and unrelated hits).

**Why "entries" is the wrong unit.** A cached list page is one entry holding up to
`PAGE_SIZE = 20` products (`api-rs/src/store/products.rs:18`). One cached detail entry
holds one product. The entry-count ceiling therefore cannot distinguish a 400-byte
list page from a 40 MB one — both are "1 of 50,000". See finding 2 for what that is
worth.

### 2. `description` and `imageUrl` are the only uncapped request fields in the API

```rust
// api-rs/src/handlers/my_store.rs:20-30
#[derive(Deserialize)]
pub struct CreateProductRequest {
    title: String,
    #[serde(default)]
    description: Option<String>,
    price: f64,
    #[serde(rename = "imageUrl", default)]
    image_url: Option<String>,
    #[serde(default)]
    stock: Option<i32>,
}
```

The handler validates three of the five. `validate_title` (`my_store.rs:138-152`)
rejects empty and over-long; `validate_price` (`:154-162`) rejects non-finite and
negative; `validate_stock` (`:164-169`) rejects negative. `description` and
`image_url` go through `trim_to_none` (`:175-177`) and `trim_to_patch` (`:184`), which
**trim and do not bound**:

```rust
// api-rs/src/handlers/my_store.rs:175-177
fn trim_to_none(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}
```

The four caps that do exist are `MAX_TITLE_LENGTH = 200`
(`api-rs/src/store/products.rs:28`), `MAX_STORE_NAME_LENGTH = 80`
(`api-rs/src/handlers/auth.rs:22`) and `MAX_PASSWORD_LENGTH = 1024`
(`auth.rs:25`). The crate **already names this exact hazard, in prose, and applies
it to exactly one field**:

```rust
// api-rs/src/handlers/auth.rs:23-25
/// argon2 has no practical input limit, but an unbounded body field is a free
/// memory-amplification lever, and 1 KiB is far beyond any real passphrase.
const MAX_PASSWORD_LENGTH: usize = 1024;
```

The column is `TEXT`, so the database does not bound it either:
`api-rs/migrations/20260926133034_create_product.up.sql:4` — `"description" TEXT`.

Nor is the *request* bounded below the field level. `JsonBody` delegates straight to
axum's `Json` (`api-rs/src/handlers/mod.rs:29-33`) and no `DefaultBodyLimit` layer is
installed — `grep -rn "DefaultBodyLimit\|body_limit" api-rs/src` returns nothing — so
axum's 2 MiB default is the only ceiling on a single write, and it applies to the
whole body, not to the field.

The write path is authenticated, but registration is public and one request away
(`api-rs/src/app.rs:72` — `.route("/auth/register", post(auth::register)`), and
nothing rate-limits a body by its size.

### 3. Every fill copies the unbounded field into both tiers

The cached value is the whole serialized product, not a reference to it:

```rust
// api-rs/src/handlers/products.rs:228-229  (detail fill)
            let bytes = serde_json::to_vec(&ProductJson::from(product))?;
            state.cache.set(Kind::Detail, &key, Bytes::copy_from_slice(&bytes)).await;
// api-rs/src/handlers/products.rs:200       (list fill)
    state.cache.set(Kind::List, &key, Bytes::copy_from_slice(&bytes)).await;
```

`CacheTier::set` (`api-rs/src/cache/mod.rs:183-189`) writes L1 **and** L2, and L2 is
a plain `SET` with a TTL:

```rust
// api-rs/src/cache/l2.rs:51-56
        let result: redis::RedisResult<redis::Value> = redis::cmd("SET")
            .arg(Self::prefixed(key))
            .arg(value)
            .arg("EX")
            .arg(self.ttl_secs)
```

**The arithmetic.** Take the maximum single write the service accepts, ~2 MiB of
`description`.

- One product with a 2 MiB description serializes to a ~2 MB detail entry. It costs
  **one** of the 50,000 detail slots.
- That product appearing on any list page makes that page up to 20 × 2 MiB ≈ 40 MB.
  It still costs **one** of the 50,000 list slots.
- Roughly 1,250 such products evict the entire hot detail set, and roughly 1,250
  distinct pages evict the entire hot list set — while hit rate (`cache_l1_hits_total`
  / `cache_l1_misses_total`, `api-rs/src/metrics_names.rs:46-47`) shows a healthy
  cache right up until it collapses, because moka's eviction is invisible to a
  two-counter ratio.

### 4. The shared tier has no ceiling either, and it is the same tier as the load shedder

`docker-compose.yml:19-29` runs the shared Valkey with no memory ceiling and no
eviction policy:

```yaml
  valkey:
    image: valkey/valkey:8-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
```

No `--maxmemory`, no `--maxmemory-policy`, anywhere in the repository (grep: zero
hits). And it is one instance shared with the request-shedding state —
`AppState::new` says so in its own doc comment:

```rust
// api-rs/src/app.rs:39
    /// `valkey` feeds both cache tiers and the shared rate-limit counters;
```

confirmed by the wiring at `app.rs:46-53` and `main.rs:45-54`. The two key families
share the memory: cache keys are `products:list:…` / `products:detail:…` /
`stores:{id}:products:list:…` (`cache/mod.rs:47`, `:53`), rate-limit keys are
`api-rs:rl:…` (`api-rs/src/middleware/rate_limit.rs:218`).

So the growth curve above runs into a store with no ceiling whose other tenant is the
service's only process-wide backstop, and `main.rs:75-78` states the failure mode
for a Valkey that cannot be reached: *"the L2 cache and shared rate limiting stay off
(fail-open)"*. A seller-controlled text field is therefore an input to *losing load
shedding*, and nothing in the repository says so.

### 5. There is no series that would show any of this happening

`api-rs/src/metrics_names.rs:46-55` declares the eight cache series: L1 hits, L1
misses, L2 errors, L2 hits, L2 misses, L2 writes, generation bumps, singleflight
leader/follower/wait. `L1Cache::get` increments hits and misses and nothing else
(`l1.rs:41-46`). **No entry size, no occupancy, no eviction count** — so the cliff
above has no signal at all; it surfaces as a slow fall in hit ratio and then as an
OOM kill.

## Proposed approach

Six changes, each in the module that already owns the concern. No new subsystem.

**1. Cap the two fields, in the module that already caps the others.**
`api-rs/src/store/products.rs:28` already hosts `MAX_TITLE_LENGTH` as a `pub const`
precisely so the client can mirror it ("matches what the API accepts"). Add
`MAX_DESCRIPTION_LENGTH` (4 KiB is far beyond any real product description) and
`MAX_IMAGE_URL_LENGTH` (2 KiB; a URL is not prose) beside it, each with the same
rationale comment `auth.rs:23-24` already uses. Reuse the exact validation shape at
`my_store.rs:138-152` — a `chars().count()` check returning
`AppError::Validation`. Wire them into the `create` path (`:75-81`) and the `PATCH`
path (`:99-103`) *before* `trim_to_none`/`trim_to_patch`, so an over-long field is a
`422` with the same message shape as an over-long title rather than a silent store.

**2. Mirror the caps in the shared form, where the other one already is.**
`components-library/src/business/ProductFormScreen/ProductFormScreen.tsx:45` already
declares `const MAX_TITLE_LENGTH = 200` and enforces it at `:182-186`. Add the two
constants beside it and the matching checks in the same `validate` function, so the
seller gets an inline error instead of a round trip. (This is the third copy of the
200 — the repo already duplicates every cap it bothers to write. Two fields have no
cap, and so no copy.)

**3. Make the L1 ceiling configurable, and count bytes as well as entries.**
Change `build` (`cache/l1.rs:57-58`) to take its capacity, thread it through
`L1Cache::new` (`:30-32`) and `CacheTier::new` (`cache/mod.rs:88`), and add
`L1_MAX_ENTRIES` to `Config` at all four of the places the repo's own doc comment
names (`config.rs:40-42` field, `:73-100` default, `:137` `from_env` branch,
`:264-287` `ENV_KEYS` — the four-place pattern recorded in
`improve-proposals/2026-10-03-seller-storefronts-my-store.md:200`). Then add
`l1_max_value_bytes`: in `CacheTier::set` (`cache/mod.rs:183-189`), refuse a value
above it and count the refusal. A 40 MB value in an LRU is the pathological case —
evicting it costs the whole page — and today nothing prevents it.

**4. Refuse an oversize value on the way to the shared tier.**
Same place, L2 branch. The L2 tier exists so a fleet shares a page; a multi-megabyte
value is the worst possible citizen in the store that also holds `api-rs:rl:*`. Skipping
the L2 write for an oversize body is a two-line change and loses nothing a real
catalogue page needs.

**5. Publish the signal.** Add `cache_l1_evictions_total{kind}` and an entry-size
histogram to the table at `metrics_names.rs:44-67`, emit them from `l1.rs`, and
describe them. Note that this file *is* the enforced contract: `metrics_names.rs:532`
(`every_emitted_series_is_declared_here_and_…`), `:561` (label keys),
`:675` (`every_declared_series_is_described`) and `:619`
(`the_series_with_no_consumer_are_the_documented_ones`) will each fail until all four
things are done. That is the gate working, not an obstacle.

**6. Give the shared Valkey a ceiling.** Add `--maxmemory` and
`--maxmemory-policy allkeys-lru` to `docker-compose.yml:19-29`. `allkeys-lru` is the
policy that matches the service's own posture: the cache is an accelerator and the
limiter is the thing that must survive, and `noeviction` would instead turn a full
cache into write failures that the limiter's fail-open path then absorbs.

## Impact

**What gets better.** A seller can no longer choose the size of a cache entry, so the
L1 ceiling in `l1.rs:58` becomes a real memory bound instead of an entry count, and
it becomes tunable by an operator who can see it in `ENV_KEYS`. The shared tier stops
being an unbounded-growth target for a text field. Eviction and entry size become
visible on the same dashboards the pool gauges already live on
(`ARCHITECTURE.md:401`). For an agent changing this repo, the win is specific: today
"how big can a cached body get?" has to be answered by reading a handler validator, a
cache builder and a compose file, and there is no single line that owns it. After
this, `MAX_DESCRIPTION_LENGTH` and `l1_max_value_bytes` are the two lines to read.

**Consistency.** The two uncapped fields become the fifth and sixth fields subject to
the pattern the other four already follow (`store/products.rs:28`, `auth.rs:22,25`),
and the shared form mirrors the server the way it already mirrors the title cap.

**Scalability.** Memory per instance stops scaling with `catalog size × seller input
size`. The shared tier stops being a place where the cache and the load shedder can
evict each other.

**What does *not* get better, stated plainly.** This does not reduce steady-state
memory for the catalogue as it exists today — real descriptions are a few hundred
bytes and nothing changes for them. It does not change cache *hit rate*, which is
governed by the generation-folding design. It does not touch the key-retention
trade-off: `ARCHITECTURE.md:692-695` already documents and accepts that bumping the
generation renames the namespace rather than evicting, so occupancy still scales with
write rate × TTL. That is a settled decision and this proposal does not reopen it —
the finding is about the **size of each value**, which is a different question from
the **number of keys**, and which nothing in the repository has an answer to.

## Risks / trade-offs

- **Product 4 KiB descriptions will break sellers** who paste a long description into
  an existing product. That is the intended cost of a bound, and it needs to be a
  `422` naming the field and the limit, not a truncation. Anyone who genuinely needs
  more prose than 4 KiB is past what a product card renders anyway.
- **A `l1_max_value_bytes` refusal changes cache behaviour**, not just its budget: an
  oversize body is never served from L1 or L2, so that product's page is re-rendered
  from Postgres on every request. With the 4 KiB field cap in place this path should
  be unreachable for real content, which is the argument for doing (1) and (3)
  together rather than shipping (3) alone as protection.
- **Step 5 will fail four metric-contract tests** until the series are declared,
  emitted, described and either monitored or explicitly documented as
  monitoring-only. That is the intended process, but it makes the change look broken
  halfway.
- **`--maxmemory allkeys-lru` is a real behaviour change** for the local stack: the
  rate-limit windows become evictable under pressure. They already have a TTL and
  already fail open, so this converts a memory-exhaustion kill into a window that
  expires — but it should be a deliberate, reviewed choice, not a drive-by.
- **Steps 3 and 4 touch the cache write path**, which is the read path's hottest
  code and the subject of `implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`.
  The `set` call sites do not move; only what `set` is willing to accept changes.

## Validation

1. **The cap is enforced and the message is right.**
   `cargo test -p api-rs handlers::my_store` — add cases mirroring
   `my_store.rs:226-227` (which already assert the title boundary at exactly the cap
   and one over) for `description` and `imageUrl`, on both `POST` and `PATCH`.
2. **The whole crate still passes.**
   `pnpm --filter @rnw/api-rs test` (`cargo test --lib`), then
   `pnpm --filter @rnw/api-rs test:e2e` with Docker for the Postgres-backed contract
   and parity suites — required, because `assert_store_contract` only runs against
   `SqlProductStore` under `test:e2e`.
3. **The metric contract passes**, which is the real check on step 5:
   `cargo test -p api-rs metrics_names` covers `metrics_names.rs:532`, `:561`, `:590`,
   `:619`, `:640`, `:661`, `:675`.
4. **The bound is real, not just declared.** Add a test in `api-rs/src/cache/l1.rs`
   that inserts a value over `l1_max_value_bytes` and asserts it is absent from L1 and
   that `cache_l1_oversize_total` incremented; and in `cache/mod.rs` that the same
   value never reaches the `CounterStore`/L2 seam.
5. **No regression on the read path.**
   `pnpm --filter @rnw/api-rs bench`. Note its known limit, recorded in
   `implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md:423-424`:
   it times `InMemoryStore::rows()` over 50,000 rows, not the SQL path, so it will not
   catch a cache regression on its own — read the numbers, do not gate on them.
6. **The shared form mirrors the server.** `pnpm --filter @rnw/components-library test`
   and `pnpm --filter @rnw/web-application test:e2e` for
   `web-application/e2e/my-store.spec.ts`, whose seller journey (`:28-112`) already
   fills and clears a description and is the cheapest place to add an over-long-input
   assertion.
7. **Coverage gate still passes**: `pnpm --filter @rnw/api-rs coverage`
   (`--fail-under-lines 80`).

## Relationship to existing proposals

**Not a duplicate of any of them, and it is adjacent to four.**

- `implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md` owns the
  *factoring* of the cached read path. This proposal does not touch that structure; it
  bounds what is put into it. Complementary, not a restatement.
- `implemented/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md` and
  `implemented/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md`
  both treat load shedding as the thing under threat. **This proposal names the input
  that reaches it**: they fixed how shedding is reached and what it does when it
  fails; neither considers that the shared store holding the shedding counters also
  holds seller-controlled payload with no ceiling. It does not contradict either —
  it is upstream of them, and neither is in `in-progress/`.
- `implemented/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md`
  owns the *semantics* of `description` (three-state, so a seller can clear it). That
  is a different axis from its *size*, and this proposal must keep the three-state
  behaviour it landed: an over-long field is a validation error, not a truncation and
  not a silent drop.
- `implemented/2026-10-04-04-06-14-the-session-table-has-no-reaper.md` is the same
  *shape* of finding — a table or tier that only ever grows, with an index or capacity
  shipped for a consumer that was never built — applied to `Session` rather than to
  the cache. That similarity is why this is worth writing down rather than leaving in
  a run log: the pattern has now appeared twice, and the cache instance is the one
  with a hostile input rather than a merely absent one.

**Nothing in `in-progress/` claims this area.** The one entry there,
`in-progress/2026-10-05-21-22-40-the-write-path-holds-two-pool-connections-at-once.md`,
is about `api-rs/src/store/products.rs` acquiring two primary-pool permits per write.
Steps 1 and 3 of this proposal touch that file, but only to add a `pub const` beside
`MAX_TITLE_LENGTH:28` and read it from the handler; it does not change how a write
acquires a connection and does not conflict.