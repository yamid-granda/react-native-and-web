# Close the deferred scale gaps in api-rs: singleflight, list index, read replica, write seam

## Problem / opportunity

`api-rs` shipped the high-traffic rewrite (see
`implemented/2026-10-01-marketplace-api-high-traffic-performance.md`) and its
`ARCHITECTURE.md` is honest about what was left undone. Four gaps remain, three
of them already named in the project's own design docs and one of them a latent
build bug nobody has hit yet:

1. **No stampede protection on a cold L2** (`ARCHITECTURE.md:350-352`, listed
   under "Trade-offs, stated plainly": *"A burst on an expired key can fan out to
   Postgres. Singleflight would fix it, and the concurrency limiter caps the
   damage meanwhile. Worth doing before a real flash crowd."*). Today
   `CacheTier::get` (`api-rs/src/cache/mod.rs:44-55`) is a straight
   L1 → L2 → handler fallback: on an expired key, **every** concurrent request
   misses both tiers and independently runs the two-query store call
   (`handlers/products.rs:143` → `store/products.rs:105-113`, a paged `SELECT`
   plus a full `COUNT(*)`). The `PER_IP_CONCURRENCY_LIMIT` (64) and
   `GLOBAL_CONCURRENCY_LIMIT` (1024) bounds *total* damage but does nothing to
   collapse the duplicate work: 64 concurrent requests for page 1 issue 128
   identical queries. This is the single cheapest remaining win in the service.

2. **The documented read scale path is not implemented, and the list query has
   no supporting index.** `README.md:133-138` ("Scale path") and
   `ARCHITECTURE.md:298-321` both promise routing reads to a replica "when
   replicas are introduced," and the original proposal calls it "a config-level
   step later, no code rework" (line 170). It is not config-level today:
   `Config` has a single `database_url` (`config.rs:29`), `main.rs:18-22` builds
   exactly one `PgPool`, and `SqlProductStore` holds that one pool
   (`store/products.rs:80-82`) and uses it for every method. Worse, the list
   query orders by `("createdAt" ASC, "id" ASC)` (`store/products.rs:77`) but
   `api-rs/prisma/schema.prisma:17-27` declares **only** the primary key on
   `id` — there is no index backing that sort, so every list page pays a full
   sort over the whole table before the `LIMIT` can be applied. The composite
   index is a one-line schema change and a larger win than anything else here.
   The same query has two more costs: `SELECT COUNT(*) FROM "Product"` runs on
   *every* request (`store/products.rs:109-111`) even though the value is
   per-catalog rather than per-page, and `prisma_offset` deliberately accepts
   absurd pages — `(truncated as i64) as u32 as i64` (`handlers/products.rs:117`)
   turns `?page=2147483648` into `OFFSET 4294967276`, which
   `ARCHITECTURE.md:355-356` accepts as a contract-fidelity trade-off. Keyset
   pagination would fix the offsets, but it collides head-on with the contract:
   the envelope is `{items, page, limit, total, hasNextPage}`
   (`handlers/products.rs:47-56`), and `total` is an exact count a cursor
   structurally cannot produce.

3. **`Cargo.toml` does not declare the tokio features the code uses.**
   `Cargo.toml:50` declares `features = ["macros", "rt-multi-thread",
   "signal"]`, but the code also calls `tokio::time::{interval,sleep,timeout}`
   (`telemetry.rs:77,89`, `cache/mod.rs:93`, `handlers/health.rs:51`),
   `tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore}`
   (`middleware/rate_limit.rs:11`), and `tokio::net::TcpListener`
   (`main.rs:36`, `tests/common/mod.rs:224`) — needing `time`, `sync`, and
   `net`. It compiles today **only** because cargo's feature unification across
   `redis`/`sqlx`/`hyper`/`tonic` happens to enable them. Drop or trim any of
   those dependencies (a legitimate, unremarkable refactor) and the build breaks
   with an error pointing at unrelated files. This is the cheapest item here and
   the only one that is a latent defect rather than deferred scope.

4. **Nothing is written down about what happens when writes arrive.** The
   service is read-only today, so there is no event bus, no job queue, and no
   `events/` module anywhere — and that is correct for a read-only catalog. But
   `invalidate_detail` already exists (`cache/mod.rs:64-70`) and is described as
   "the seam the first write endpoint will use" (`ARCHITECTURE.md:181-183`),
   while the open proposals for reviews, stock, coupons, and order history all
   require writes. Whoever lands the first mutation will face the invalidation
   design with no guidance, and will most likely reach for Kafka or RabbitMQ
   because that is the default answer for "event-driven marketplace." The right
   answer is much cheaper, and it should be written down before someone spends a
   week on it.

This proposal is four independent work items, not one change. They are bundled
because they share a root cause (gaps the rewrite deliberately deferred) and
because they are cheap enough to land together, but **each is separately
landable and none blocks another.**

## Proposed approach

### Goals / non-goals

Goals:

- Collapse duplicate store work on a cold cache miss, in process, without
  touching the HTTP contract or adding infrastructure.
- Make the read-replica and deep-pagination stories real, in the order that
  actually pays: index first (zero risk), then cached `COUNT(*)`, then the
  replica pool; true keyset pagination only if the envelope can change.
- Declare the tokio features the code already relies on, so the build stops
  depending on transitive crates' feature choices.
- Document the write-path/event seam and the cost ladder, so the first mutation
  lands on a considered design instead of a broker.
- Keep every item falsifiable: each one names the measurement that proves it
  worked.

Non-goals:

- **No broker. No Kafka, RabbitMQ, NATS, or Valkey Streams client in this
  proposal.** Event-driven architecture is a *decoupling* tool, not a
  performance tool; it cannot make a GET faster, and putting a broker in the
  read path adds a network hop and a new failure mode to a service whose stated
  rule is "no cached value, counter, or limiter is worth a failed request"
  (`ARCHITECTURE.md:232-251`). Item 4 is documentation precisely so that the
  decision gets made deliberately and later.
- No change to the response envelope, routes, ports, or client code in either
  app. Keyset pagination, if it ever happens, is out of scope here (see below).
- No new infrastructure requirement for local dev or CI: everything still runs
  on the existing compose stack, and every item degrades to today's behaviour
  when its env var is unset.

### Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Stampede collapsing | `tokio::sync::Mutex` + a `HashMap<String, Weak<Mutex<()>>>` in a new `api-rs/src/cache/singleflight.rs` | No new crate, no new process, no distributed lock. Per-instance is the correct scope: cross-instance warming is already Valkey's job, and 2–3 instances means 2–3 cold fills instead of N× |
| Stampede observability | `metrics` counters `cache_singleflight_{leader,follower}_total` + histogram `cache_singleflight_wait_seconds` | Proves the mechanism fires and shows follower wait time; without it the change is unfalsifiable, which `ARCHITECTURE.md` §8 explicitly rejects |
| List sort support | `@@index([createdAt, id])` on `Product` via a Prisma migration | Turns a full sort into an index scan that stops at `LIMIT`. The ordering tuple is already `(createdAt, id)`, so the index matches it exactly with no reordering |
| `total` | Cached under `products:count` in the existing `Kind::List` tier | It is per-catalog, not per-page; one `COUNT(*)` per TTL window instead of one per request. Fail-open like every other cache read (`l2.rs:46-50`) |
| Read replicas | A second `PgPool` in `main.rs`, selected by an optional `DATABASE_READ_URL` | sqlx pools are independent; the store routes `list_page`/`find_by_id` to the read pool and keeps `ping` on the primary so `/health` still detects a dead primary (`store/products.rs:122-127`) |
| Event seam | Prose only, in `api-rs/ARCHITECTURE.md` | Item 4 is a decision record. Code for it belongs to whichever proposal actually adds a write endpoint |

### Item 1 — singleflight on the cold-cache path

Add `api-rs/src/cache/singleflight.rs` holding a
`Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>` exposed through `CacheTier` as
`fn flights(&self) -> &Singleflight`. The `Arc` matters: `AppState` derives
`Clone` and axum clones it per request (`app.rs:24-32`), so the map must be
shared rather than per-clone.

The handler uses a two-phase check — this ordering is the whole design:

```rust
// handlers/products.rs::list
let flight = state.cache.flights().for_key(Kind::List, &key);
let _guard = flight.lock().await;                       // followers wait here
// Re-check: the leader we waited for may have just populated the cache.
if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
    return /* cached response */;
}
let (products, total) = state.store.list_page(query.offset, PAGE_SIZE).await?;
state.cache.set(Kind::List, &key, /* … */).await;       // release the guard after
```

Three properties worth calling out, because they are what make this safe rather
than merely clever:

- **Errors self-heal.** If the leader's store call fails, the guard drops and the
  next waiter re-checks, misses, and becomes the new leader. There is no cached
  failure and no poisoning, so no DLQ is needed — consistent with the fail-open
  posture everywhere else in the crate.
- **Cancellation is safe.** A client disconnect or the 10 s `TimeoutLayer`
  (`config.rs:58`) drops the guard mid-flight and the next waiter proceeds. This
  is why the guard must be a `tokio::sync::Mutex` guard held across `.await` and
  never a `std::sync::Mutex`.
- **The key must include `Kind`.** `products:list:<bits>` and
  `products:detail:<id>` are already distinct strings today
  (`handlers/products.rs:131,166`), but the singleflight key should be built
  from `kind.as_str()` + key so the two tiers can never collide if either
  naming scheme changes later.

Apply it to both `list` and `detail`. Detail keys are one-to-one with product
ids, so they have a much lower collision probability, but a viral product link
produces exactly the same fan-out.

### Item 2 — index first, then cached `COUNT(*)`, then the read pool, then keyset

Sequenced by cost-to-benefit, because the ordering matters more than usual here:

**2.1 — `@@index([createdAt, id])` on `Product`.** One line in
   `prisma/schema.prisma`, one migration via `pnpm --filter @rnw/api-rs
   db:migrate`, zero Rust changes, zero contract change, fully reversible
   (`DROP INDEX`). This alone should flatten the list-query latency curve.

**2.2 — Cache the `COUNT(*)`.** Move it out of `list_page` behind its own cache
   key so it is evaluated once per `L2_TTL_SECS` instead of once per request.
   Follow the existing fail-open shape: a count failure degrades to the current
   behaviour (recompute) rather than erroring the page.

**2.3 — `DATABASE_READ_URL` read pool.** New optional `Config` field plus
   `DB_READ_MAX_CONNECTIONS` (a *separate* budget — `DB_MAX_CONNECTIONS` is
   per-pool and both pools count against the primary's connection limit when
   the replica is not yet in place). `SqlProductStore` gains a read pool; reads
   go to it when present, `ping` stays on the primary. When the env var is unset
   the store behaves exactly as it does now, so local dev and the hermetic
   testcontainers suite need no replica.
   **Documented hazard:** replica lag means a just-created product can 404 or be
   absent from a list. That is acceptable *only* while products are immutable
   once visible. The day `POST /products` lands this becomes a correctness
   problem and needs either a read-your-writes session or replication-slot
   waiting. That coupling is the real reason to land the replica pool together
   with the write-seam docs in item 4.

**2.4 — Keyset pagination, explicitly deferred, with the reason.** Keyset fixes
   deep offsets, but it is not a drop-in here, so it should not ride along in
   this proposal. The envelope carries an exact `total`
   (`handlers/products.rs:47-56`) and a numeric `page`, and
   `useInfiniteProducts` in
   `components-library/src/business/ProductListScreen/useInfiniteProducts.ts`
   drives pagination with React Query page numbers on both apps. A cursor
   structurally cannot produce `total`, and switching the clients to cursors is a
   cross-platform contract change — a separate proposal with its own migration
   story. Steps 2.1 and 2.2 remove most of the pressure that would motivate it;
   re-open this when `sqlx_pool_acquire_seconds` or deep-offset latency is
   actually the binding constraint, and only if `total` becomes droppable.

### Item 3 — declare the tokio features the code uses

Change `Cargo.toml:50` to:

```toml
tokio = { version = "1", features = ["macros", "net", "rt-multi-thread", "signal", "sync", "time"] }
```

and add a comment recording why each non-obvious one is there (`time` for the
metric samplers and the health-check timeout, `sync` for the rate limiter's
`Mutex`/`Semaphore`, `net` for the listener) so a future reader does not "clean
up" the seemingly-redundant set. Item 1 makes `sync` load-bearing in a second
place, which is a further reason not to leave it implicit.

There is no practical automated guard for this — it is a known cargo
limitation, not a repo mistake — so the honest verification is
`cargo tree -e features -i tokio` before and after, plus the rule that
api-rs declares what it uses regardless of what its dependencies happen to
enable.

### Item 4 — document the write-path event seam

Add a section to `api-rs/ARCHITECTURE.md` (after §5, which already introduces
`invalidate_detail`) covering:

- **The trigger condition**, stated so it is decidable: *"a write exists **and**
  at least two consumers must react to it."* One consumer means call it directly.
- **The ladder, cheapest first**, with the cost of each rung: direct call (free,
  and what `invalidate_detail` already is) → Postgres transactional outbox
  (free, same DB) → Valkey Streams (free — Valkey is already deployed and the
  `redis` crate already has `tokio-comp`) → Valkey Pub/Sub (free, at-most-once,
  fine for invalidation) → NATS JetStream (small) → Kafka/Redpanda (real money).
  Stop at the first rung that hurts.
- **The rule:** never in the request path. The write returns on the DB
  transaction; delivery is asynchronous. This follows directly from §7's
  fail-open matrix.
- **The list-invalidation answer, which is currently a hole.** `invalidate_detail`
  deletes `products:detail:<id>` from both tiers, but list keys are
  `products:list:<page_bits>` — there is no way to enumerate or delete them all,
  so a price change leaves stale lists until the 5 s TTL expires.
  `ARCHITECTURE.md:345-346` admits this ("needs a list-key strategy") without
  solving it. The recommended strategy is a **namespace generation counter**: a
  single `api-rs:products:list:gen` integer folded into every list key, bumped
  with `INCR` on any product mutation, which invalidates all list pages
  atomically in one round trip. Roughly 15 lines, no key enumeration, no
  `SCAN`. The mutation endpoint's contract should be: `invalidate_detail(id)` +
  bump the generation, in that order.
- **An explicit "we are not adding Kafka now"** note with the reasoning, so the
  next person re-opens it as a decision rather than an assumption.

### Sequencing

| Order | Item | Risk | Reversible |
| --- | --- | --- | --- |
| 1 | Item 3 (tokio features) | none — pure manifest | trivially |
| 2 | Item 2.1 (index) | low — write lock on `Product` during migration only | `DROP INDEX` |
| 3 | Item 1 (singleflight) | low — additive, no contract change; needs the two-phase check done correctly | yes, feature-gateable |
| 4 | Item 2.2 (cached count) | low — new cache key, fail-open | yes |
| 5 | Item 4 (docs) | none | n/a |
| 6 | Item 2.3 (read pool) | medium — replica lag, coupling to the write path | env var unset |

### Trade-offs and alternatives considered

- **A distributed lock (Valkey `SET NX`) instead of in-process singleflight** —
  collapses the stampede across instances too, at the cost of a network round
  trip on the miss path and a new failure mode in the one code path §7 says must
  fail open. With 2–3 instances the marginal benefit is 2 fewer queries per cold
  key; not worth a lock protocol. Revisit at instance counts where per-instance
  collapse stops being enough.
- **`moka::future::Cache::get_with` instead of a hand-rolled guard** — the
  serious alternative, since moka is already a dependency and `get_with`
  (`moka-0.12.16/src/future/cache.rs:1049`) deduplicates concurrent inits for
  the same key, which is exactly singleflight. Rejected for three reasons:
  (a) **Layering inversion** — `get_with` takes the computing future, so the
  store call would have to move *inside* the cache layer. `CacheTier` is
  deliberately a pure read-through (`cache/mod.rs:44-70`) and the handler owns
  the store call, the serialization, and the headers.
  (b) **It cannot express a missing product.** `get_with` returns `V`, so
  `find_by_id` → `None` would have to be smuggled in as a sentinel `Bytes` that
  must then be invalidated on create — a real correctness hazard for a case the
  handler handles naturally today (`handlers/products.rs:178-185`).
  (c) **Two uncoordinated fill paths** — moka's dedup is scoped to one `Cache`
  instance and knows nothing about the L2-hit-repopulates-L1 path
  (`cache/mod.rs:48-52`), so the mechanisms coexist without sharing
  instrumentation. An explicit guard with its own counters keeps the behaviour
  measurable, which `ARCHITECTURE.md` §8 treats as a requirement. Revisit this
  if `get_with` ever gains a fallible/no-entry variant.
- **Serving stale on a cold miss instead of collapsing** (`stale-if-error` on
  the L2 entries) — arguably better for the user, and Cloudflare already does
  this at the edge (`EDGE_CACHE_CONTROL`'s `stale-while-revalidate`). Rejected
  here as a duplicate of an existing layer; worth revisiting only if the
  measured `X-Cache: miss` rate on hot keys is high.
- **Keyset pagination now** — see item 2.4: blocked on an exact `total` in the
  contract, not on effort.
- **A background pre-warm job** (crawl all list pages on boot) — reduces
  cold-fill frequency without adding lock complexity, but needs a job runner,
  which is the thing this proposal deliberately avoids introducing. Singleflight
  first; revisit if post-deploy p99 is still spike-sensitive.

## Key files/areas

- New: `api-rs/src/cache/singleflight.rs` (+ unit tests)
- Edit: `api-rs/src/cache/mod.rs` (expose `flights()`, the singleflight key
  builder), `api-rs/src/handlers/products.rs` (two-phase check in `list` and
  `detail`)
- Edit: `api-rs/Cargo.toml:50` (tokio features + rationale comment)
- Edit: `api-rs/prisma/schema.prisma` (`@@index([createdAt, id])`) + a
  migration under `api-rs/prisma/migrations/` via `db:migrate`
- Edit: `api-rs/src/store/products.rs` (`COUNT(*)` behind a cache key; read pool
  selection; `ping` stays on the primary), `api-rs/src/store/memory.rs` (trait
  signature change)
- Edit: `api-rs/src/config.rs` + `api-rs/.env.example`
  (`DATABASE_READ_URL`, `DB_READ_MAX_CONNECTIONS`, and the new keys must be added
  to `ENV_KEYS` in `config.rs:179-196`, which is what keeps the env tests honest)
- Edit: `api-rs/src/main.rs` (build the second pool)
- Edit: `api-rs/ARCHITECTURE.md` (new write-path section after §5; amend §11's
  stampede entry once item 1 lands), `api-rs/README.md` (Scale path: replicas
  are implemented, not aspirational)
- Untouched: `web-application/`, `mobile-application/`,
  `components-library/`, the Prisma migration ownership model, and every
  response shape.

## Verification

- **Item 3:** `cargo check` and `cargo test` pass; `cargo tree -e features -i
  tokio` shows `time`, `sync`, and `net` enabled by api-rs's own declaration
  rather than only by transitive deps (compare before/after output). Negative
  check: temporarily drop `redis`'s features in a scratch branch and confirm the
  crate still builds.
- **Item 1:** unit tests in `singleflight.rs` for the guard's bookkeeping (two
  concurrent `for_key` calls yield the same `Arc`). Handler tests in
  `handlers/products.rs` using `InMemoryStore` wrapped in a counting store:
  (a) 64 concurrent `GET /products` on a cold cache produce **exactly one**
  `list_page` call; (b) 64 concurrent requests across 64 *distinct* pages
  produce 64 calls (no over-serialization); (c) when the leader's store call
  errors, a subsequent request retries rather than replaying a cached failure;
  (d) a cancelled leader (dropped future) does not wedge the key. Plus the
  existing cold-cache E2E in `api-rs/tests/e2e_products.rs` re-run unchanged.
- **Item 2.1:** `EXPLAIN (ANALYZE, BUFFERS)` on `LIST_QUERY` before and after,
  recorded in `load-tests/README.md` — expect the sort node (`Sort Method:
  external merge Disk` or an in-memory quicksort over N rows) to disappear in
  favour of an index scan stopping at `LIMIT`. E2E and parity suites unchanged,
  proving the contract is untouched.
- **Item 2.2:** a test asserting two sequential requests to the same page within
  one TTL window issue **one** `COUNT(*)`; a cold-count-error path still returns
  a 200 with a correct `total`.
- **Item 2.3:** hermetic E2E with testcontainers starting a primary and a
  streaming replica (`tests/common/mod.rs` is the existing harness to extend):
  a detail read is served from the replica, and `/health` still reflects the
  *primary*. With `DATABASE_READ_URL` unset the store routes everything to the
  primary, as today.
- **Item 4:** no tests; verify by reading — a reviewer who has never seen this
  codebase should be able to answer "the price changed; which cache entries are
  stale and what invalidates them?" from the new section alone.
- **Cross-cutting:** `pnpm --filter @rnw/api-rs test:all` (needs Docker),
  `cargo clippy -- -D warnings`, `cargo fmt --check`, the 80% coverage gate, and
  the k6 `spike.js` scenario (100 → 5,000 rps) re-run against a **cold** L2 with
  `VALKEY_URL` flushed between runs — the condition under which singleflight is
  supposed to help, and the p99 it should improve.