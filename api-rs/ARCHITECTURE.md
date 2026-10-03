# api-rs — system design

A reading guide to the strategy behind `api-rs/`: what the service is, the
challenges it was built to solve, the capabilities that solve them, and how
each one is wired and verified. Everything below is grounded in the source;
file references are the authority, not this document.

For setup, env vars, and commands, see [`README.md`](README.md). For the
motivation and the rejected alternatives, see
`improve-proposals/implemented/2026-10-01-marketplace-api-high-traffic-performance.md`.

## 1. What this service actually is

A **single stateless HTTP binary on port 3001** that answers four GET routes:

| Route | Purpose |
|---|---|
| `GET /health` | Readiness probe with a real `SELECT 1` round trip against the primary |
| `GET /products?page=N` | Paginated list, page size fixed at 20 |
| `GET /products/{id}` | Product detail |
| `GET /metrics` | Prometheus scrape endpoint (operational, not part of the client contract) |

It replaced a single-process NestJS/Express API with **no client, schema, or
route changes**. The web and mobile apps still default to `localhost:3001` and
parse the exact same JSON. That constraint — *rewrite the engine, keep the
bytes* — shapes every decision below.

## 2. The challenges, stated as engineering problems

The original problem statement is about a marketplace API that could not absorb
traffic. Broken down into things a system design can actually answer:

| # | Challenge | Why it bites |
|---|---|---|
| **X1** | Single-threaded Node ceiling | Per-core throughput saturates; GC pauses land directly in p99. Clustering multiplies heap cost without fixing tail latency. |
| **X2** | Viral spikes reach the origin | No cache of any kind: every request became `findMany` + `count` against Postgres. |
| **X3** | Global users pay transoceanic RTT | One process, one region, no edge tier — full origin processing for every request. |
| **X4** | Connection/pool exhaustion | Concurrency is unbounded, so a burst turns into a connection pile-up and acquire waits. |
| **X5** | Dependency failure becomes an outage | Any cache or limiter added naively becomes a hard dependency and a new failure mode. |
| **X6** | Degradation is unmeasurable | No metrics, no traces, no cache-hit ratio, no pool visibility — so X1–X5 cannot even be tuned. |
| **X7** | Nothing protects the database | No admission control: load reaches Postgres at full strength until it falls over. |
| **X8** | Contract drift during a rewrite | A faster service that serializes `18.0` instead of `18`, or 404s differently, is a broken service. |
| **X9** | Schema ownership ambiguity | Two toolchains (Prisma + Rust) touching one database invites a second migration owner. |
| **X10** | Performance claims are unfalsifiable | No load tooling and no benchmarks — claims decay into opinions. |

## 3. The capability map

Seven capabilities, mapped to the layer that implements them. Read the boxes
downward: that is the order a request travels.

```mermaid
flowchart TB
    subgraph clients["Clients — untouched by the rewrite"]
        web["web-application<br/>Next.js SSR"]
        mobile["mobile-application<br/>Expo"]
    end

    subgraph edge["Tier 0 — Edge CDN · configuration only, no code"]
        cf["Cloudflare anycast PoP<br/>serves GET /products*<br/>Cache-Control + weak ETag"]
    end

    subgraph origin["Tier 1 — api-rs · one stateless binary on :3001"]
        direction TB
        mw["Middleware stack<br/>trace › compress › CORS › 10s timeout<br/>› RED metrics › load protection"]
        handlers["Handlers<br/>products::list · products::detail · health"]
        fidelity["Contract fidelity layer<br/>JS + Prisma semantics re-implemented in Rust"]
        cache["Cache tier — read-through, fail-open<br/>L1 moka (per process) › L2 Valkey (shared)"]
        store["Store trait ProductStore<br/>list_page · find_by_id · ping"]
        mw --> handlers --> fidelity --> cache --> store
    end

    subgraph state["Tier 2 — replaceable state, none of it required for correctness"]
        valkey[("Valkey 8<br/>L2 entries + shared rps windows")]
        pg[("PostgreSQL 17<br/>schema owned by Prisma")]
    end

    clients -->|"GET /products?page=2"| cf
    cf -->|"miss, or revalidate after TTL"| origin
    cache <-->|"GET / SET EX 60 · errors degrade to miss"| valkey
    store -->|"SELECT page + SELECT COUNT"| pg
    origin -.->|"otel feature · 10% sampled"| obs["OTLP collector"]
```

| Capability | Answers | Implemented in |
|---|---|---|
| **C1 Contract fidelity** | X8 | `serde_js.rs`, `prisma_offset` in `handlers/products.rs`, `error.rs`, golden fixtures in `tests/fixtures/` |
| **C2 Tiered read cache** | X2, X3, X5 | `cache/mod.rs`, `cache/l1.rs` (moka), `cache/l2.rs` (Valkey) |
| **C3 Edge-ready responses** | X3 | `Cache-Control` + weak ETag/`If-None-Match` → 304 in `error.rs`; `X-Cache` marker |
| **C4 Deliberate load shedding** | X4, X7 | `middleware/rate_limit.rs`: concurrency semaphores (503) + Valkey rps windows (429) |
| **C5 Async multi-core runtime** | X1 | tokio `rt-multi-thread` + bounded sqlx pool; one static binary; SIGTERM drain in `main.rs` |
| **C6 Observability** | X6 | `telemetry.rs`, `http_metrics` in `app.rs`, `/metrics`, JSON logs, optional OTLP |
| **C7 Falsifiable gates** | X10 | testcontainers E2E, `tests/parity.rs`, `benches/handlers.rs`, `load-tests/k6/*`, coverage gate |

## 4. C1 — Contract fidelity: emulating JavaScript and Prisma on purpose

The hard part of a "just rewrite it in Rust" is that clients parse *exact
bytes*, including behaviours nobody would design deliberately. api-rs
reproduces them deliberately, and documents the weird ones in comments.

```mermaid
flowchart LR
    subgraph node["What the retired Node + Prisma API produced"]
        n1["Number(page) || 1<br/>NaN and -0 are falsy → page 1"]
        n2["Prisma skip narrowing<br/>15 sig digits → truncate<br/>→ reject negative/overflow (500)<br/>→ cast to u32 (wraps!)"]
        n3["JSON.stringify(Float)<br/>18 not 18.0 · NaN → null"]
        n4["Prisma DateTime<br/>toISOString · 3 fraction digits + Z"]
        n5["Nest error bodies<br/>key order, message text,<br/>404 instead of 405"]
    end

    subgraph rust["What api-rs reproduces, and where"]
        r1["serde_js::js_number_or_nan<br/>+ handlers::products::parse_page"]
        r2["handlers::products::prisma_offset<br/>page=2.3 → OFFSET 26<br/>page=0.975 → OFFSET 0<br/>page=2147483648 → OFFSET 4294967276"]
        r3["serde_js::js_number"]
        r4["serde_js::prisma_datetime"]
        r5["error::ErrorBody + app::fallback"]
    end

    subgraph proof["Proof"]
        p["tests/parity.rs<br/>byte-compares 6 responses<br/>against committed goldens"]
    end

    n1 --> r1 --> proof
    n2 --> r2 --> proof
    n3 --> r3 --> proof
    n4 --> r4 --> proof
    n5 --> r5 --> proof
```

Two details worth internalising, because they are the difference between
"equivalent" and "compatible":

- **Key order is part of the contract.** `ProductJson`, `ProductsPageJson`,
  `HealthBody`, and `ErrorBody` declare fields in the exact order the Node
  serializers emitted them. `tests/parity.rs` compares raw strings, so a
  reordered struct fails the test.
- **Cache headers are additive only.** `Cache-Control`, `ETag`, and `X-Cache`
  are new headers; bodies are byte-identical. Cache hits replay the *same*
  stored bytes, so a hit and a miss cannot diverge.
- **Driver text never reaches the client.** A DB failure yields
  `{"statusCode":500,"message":"Internal server error"}` — note the inverted
  key order and the absent `error` key, matching the old unhandled-exception
  shape. `AppError::ProductNotFound` yields
  `{"message":"Product X not found","error":"Not Found","statusCode":404}`.

**X9 (schema ownership)** is answered by *not* solving it in Rust: `api-rs`
reads tables with sqlx, but `prisma/schema.prisma` + `prisma/migrations/` +
`prisma.config.ts` remain the only migration authority, driven by the
`db:migrate` / `db:seed` scripts. The generated Prisma client exists only for
the seed script.

## 5. C2 — The read path: two cache tiers, one store, no cascade

`GET /products?page=2` end to end. Note that the cache key is the *float bits*
of the parsed page, and that a Valkey error takes the same path as a miss.

```mermaid
flowchart TD
    req["GET /products?page=2"] --> parse{"parse_page: JS Number coercion<br/>then prisma_offset narrows skip"}
    parse -->|"negative / overflow / non-finite"| e500["500 {statusCode, message}"]
    parse -->|"OFFSET 20"| l1{"L1 · moka<br/>key products:list:bits<br/>list TTL 5s · detail TTL 60s<br/>max 50k entries each"}
    l1 -->|"hit"| body["response bytes"]
    l1 -->|"miss"| l2{"L2 · Valkey<br/>key api-rs:products:list:bits<br/>TTL 60s"}
    l2 -->|"hit"| repop["repopulate L1"] --> body
    l2 -->|"miss or error (fail-open)"| pg["Postgres<br/>SELECT ... ORDER BY createdAt ASC, id ASC LIMIT 20 OFFSET 20<br/>+ SELECT COUNT(*)<br/>pool acquire timed, acquire wait → metric"]
    pg --> ser["serde + JS number / datetime rules"]
    ser --> fill["write L1 and L2"]
    fill --> body
    body --> resp["json_response<br/>weak ETag W/len-sha1<br/>If-None-Match → 304 with no body<br/>charset-tagged content type"]
```

Design points that matter:

- **Two TTLs, not one.** List pages get 5 s because they repeat across shoppers
  *and* bound staleness; details get 60 s. One global TTL would be wrong for
  one of them.
- **An L2 hit repopulates L1** (`cache/mod.rs`), so a cold instance warms from
  the shared cache instead of hammering Postgres.
- **Only L2 misses reach Postgres**, and the pool is bounded
  (`DB_MAX_CONNECTIONS=10`, 2 s acquire timeout) with the acquire wait recorded
  as `sqlx_pool_acquire_seconds` — the earliest visible sign of X4 developing.
- **`invalidate_detail(id)` already exists** in `cache/mod.rs` and deletes from
  both tiers. It is not wired to a route because the service is read-only; it
  is the seam the first write endpoint will use. Nothing else is needed.
- **ETag/304 is a second absorber.** A revalidating client or CDN gets a
  bodiless 304 instead of a 20-item payload, and the ETag is derived from the
  body itself so it can never drift from the content.

## 6. C4 + C5 — Middleware stack and load protection

`.layer()` wraps the router, so the **last** layer declared is the **outermost**.
`route_layer` runs only for matched routes — which is why `app::fallback`
increments its own counter: an unmatched request has no `MatchedPath`.

```mermaid
flowchart TD
    conn["TCP connection · ConnectInfo for peer IP"] --> tr["TraceLayer<br/>span per request"]
    tr --> comp["CompressionLayer<br/>br · gzip · deflate"]
    comp --> cors["CorsLayer<br/>one origin, mirrors preflight"]
    cors --> tmo["TimeoutLayer · 10s → 408"]
    tmo --> met["route_layer: http_metrics<br/>labels = method · MatchedPath · status"]
    met --> rl["route_layer: rate_limit::enforce"]
    rl --> g1{"global semaphore<br/>1024 in flight"}
    g1 -->|"full"| shed["503 + http_load_shed_total<br/>scope=global-concurrency"]
    g1 -->|"permit held"| ip{"per-IP semaphore<br/>64 in flight<br/>registry capped at 100k IPs"}
    ip -->|"full"| shed2["503 + http_load_shed_total<br/>scope=ip-concurrency"]
    ip -->|"acquired, or Untracked (cap hit → fail open)"| win{"Valkey 1-second window<br/>INCR api-rs:rl:ip:unix_secs<br/>EXPIRE 2 on first hit"}
    win -->|"count > limit"| lim["429 + http_rate_limited_total<br/>scope=ip or global"]
    win -->|"under limit, or Valkey error → fail open"| h["handler"]
    h --> met
    met --> resp["response"]
    fb["unmatched path or wrong method"] -.->|"bypasses route_layers"| fb404["404 Cannot GET /nope?x=1<br/>self-counted as route=unmatched"]
```

The ordering is a design statement:

- **Metrics wrap the limiter**, so shed (503) and limited (429) responses appear
  in the RED series. If the limiter sat outside metrics, the moment you most
  need visibility would be the moment you lose it.
- **Concurrency is checked before rate.** A semaphore bounds work actually in
  flight; an rps counter bounds arrival rate. Shed first protects the process,
  limit second shapes the traffic.
- **Client IP resolution is edge-aware**: `CF-Connecting-IP` →
  first `X-Forwarded-For` hop → socket peer → `"unknown"`. Behind Cloudflare
  the socket peer is the edge, so the order matters.
- **Per-IP tracking is capped** at 100 000 entries. Past the cap the verdict is
  `Untracked` — the request still faces the global semaphore and the rps
  windows. Registering every spoofed IP would turn a flood of distinct
  addresses into blanket 503s for everyone.
- **Semaphore permits are held until the response is produced**, so the limits
  bound real in-flight requests rather than admission bursts.

## 7. X5 — Fail-open matrix

Every optional dependency degrades to "slower", never to "down". This is the
single most important property of the design: **no cached value, counter, or
limiter is worth a failed request.**

| Dependency fails | Behaviour | User sees | Alert |
|---|---|---|---|
| Valkey unreachable at startup | `connect_valkey` returns `None`; L2 and shared limits stay off | Normal 200s from L1 + Postgres | `api-rs listening` + a `warn` log |
| Valkey fails mid-flight | L2 error → treated as a miss; limiter allows | Higher p95, `error rate 0` | `ApiRsValkeyUnavailable` |
| Postgres down | Reads 500 with the contract body; `/health` reports `down` | 500 / 503 | `ApiRsHighErrorRate` |
| Pool saturated | Acquire timeout after 2 s → 500, wait visible as a metric | 500 | `ApiRsPoolAcquireLatency` |
| Concurrency saturated | 503 before work starts | Graceful refusal | `ApiRsLoadShed` |
| rps window exceeded | 429 | Graceful refusal | None by design — expected client behaviour, so it lives on the dashboard (`http_rate_limited_total`) instead of paging |
| Metrics recorder not installed | `/metrics` returns 503; the service is otherwise unaffected | n/a | startup `eprintln` |
| Traced exporter unavailable | Tracing falls back to JSON logs only | n/a | `eprintln` |

Note the asymmetry: **Postgres is the one hard dependency.** It is also the one
thing the caches exist to protect, and the reason `/health` pings the primary
rather than a cached value.

## 8. C6 + C7 — Observability and the falsifiable-gate loop

Performance work is only real if degradation is visible and regressions fail a
build. Both are wired: the same Prometheus scrape config runs locally and
against Grafana Cloud, and k6 thresholds fail the process rather than producing
a chart to squint at.

```mermaid
flowchart TB
    subgraph inst["api-rs instance · :3001"]
        red["http_requests_total<br/>http_requests_duration_seconds<br/>by method · route · status"]
        cache_m["cache_l1_hits/misses_total<br/>cache_l2_hits/misses/writes/errors_total"]
        protect["http_load_shed_total<br/>http_rate_limited_total<br/>rate_limit_errors_total"]
        pool_m["sqlx_pool_acquire_seconds · sqlx_pool_size<br/>sqlx_pool_idle · process_resident_memory_bytes"]
        logs["JSON logs · RUST_LOG<br/>default info,sqlx=warn"]
        spans["OTLP spans · --features otlp<br/>10% ratio, 100% parent-based"]
        red --> cache_m --> protect --> pool_m
    end

    k6["k6 · steady / spike / soak<br/>thresholds: p95<50ms · p99<200ms<br/>5xx<0.1% · RSS growth<10%"] -->|"HTTP load"| inst
    k6 -->|"non-zero exit on breach"| gate["CI / pre-deploy gate"]

    inst -->|"scrape /metrics"| prom["Prometheus :9090"]
    prom --> graf["Grafana :3002<br/>provisioned RED + cache + pool dashboard"]
    prom --> rules["Alert rules<br/>p95>100ms · 5xx>1%<br/>pool p95>50ms · Valkey errors · load shed"]
    inst -.-> spans --> otelc["otel-collector :4317"]
    graf -.->|"cache-hit collapse + flat error rate<br/>= fail-open working as designed"| ops["operator"]
```

Verification layers, cheapest first:

| Layer | Command | What it proves |
|---|---|---|
| Unit | `cargo test --lib` | Pagination math, JS coercion, ETag logic, error key order, limiter verdicts |
| Contract | `cargo test --test parity` | Six responses byte-identical to committed goldens (`responseTime` normalized) |
| E2E | `cargo test --test e2e_products` | Real HTTP against throwaway Postgres 17 + Valkey 8: page boundaries, 429s, cache hits, degraded `/health` with the DB down, fail-open with Valkey absent |
| Micro | `cargo bench` | Criterion: list-page cache miss over 50k rows, list hit, detail hit |
| Load | `k6 run load-tests/k6/spike.js` | Origin behaviour under 100 → 5 000 rps; SLO thresholds fail the run |
| Coverage | `pnpm --filter @rnw/api-rs coverage` | 80 % line gate over unit + E2E |

The E2E suite boots containers with the Prisma migration SQL compiled in via
`include_str!`, so the schema under test can never drift from the committed
migrations. It also resolves Colima's non-standard Docker socket, which is what
makes `pnpm test:e2e` work from an IDE or CI runner.

## 9. Scaling out: which challenge each step removes

Every step below is configuration. Nothing in the code assumes one instance.

```mermaid
flowchart LR
    today["Today<br/>1 instance · pool 10<br/>L1 + L2 + Postgres"] -->|"LB in front<br/>DB_MAX_CONNECTIONS budgeted across replicas"| fleet["N instances · stateless<br/>shared L2 keeps hit ratio high<br/>shared rps windows keep limits fleet-wide"]
    fleet -->|"Cloudflare in front<br/>Cache-Control + ETag already emitted"| global["Global<br/>cacheable GETs answered at the nearest PoP<br/>app tier can go multi-region — same binary"]
    global -.->|"second sqlx read pool"| replica["Postgres read replicas<br/>SELECTs routed to the nearest replica<br/>primary stays single-writer"]
```

The constraints that make this work, restated as rules:

1. **No instance-local state that matters.** L1 is a cache, not a source of
   truth — a lost L1 costs one Postgres read, never a wrong answer.
2. **Budget `Σ DB_MAX_CONNECTIONS` against the Postgres limit.** Ten replicas
   at the default of 10 is 100 connections; the knob exists so that arithmetic
   is explicit.
3. **The rps limiter lives in Valkey, not in a semaphore**, so limits stay
   meaningful across instances. The semaphores deliberately stay per-instance.
4. **Reads are the only workload**, which is why read replicas are a config
   step rather than a routing project.
5. **Deploys drain.** `SIGTERM`/`Ctrl-C` runs `with_graceful_shutdown`, so
   scale-down does not drop in-flight requests.

## 10. Code map

A reading order that follows the request path:

| File | Read it for |
|---|---|
| `src/main.rs` | Bootstrap order, bounded pool, optional Valkey, graceful shutdown |
| `src/config.rs` | Every knob and its default — the service's real policy surface |
| `src/app.rs` | `AppState`, the router, middleware order, RED metrics, the 404 fallback |
| `src/middleware/rate_limit.rs` | Shedding and limiting, IP resolution, the fail-open decisions |
| `src/cache/` | Read-through tiering, TTLs, key format, fail-open everywhere |
| `src/handlers/products.rs` | Pagination parsing and Prisma offset emulation |
| `src/serde_js.rs` | JS/Prisma serialization semantics |
| `src/store/products.rs` | The SQL, the ordering contract, pool-acquire instrumentation |
| `src/telemetry.rs` | Metrics/logging/traces bootstrap and the 5 s samplers |
| `src/error.rs` | Error shapes, weak ETag, 304 handling |
| `tests/`, `benches/` | The verification contract; `tests/fixtures/` is the golden set |

## 11. Trade-offs, stated plainly

- **A cache can serve stale data.** 5 s for lists, 60 s for details and L2.
  This is a deliberate product decision for a read-mostly marketplace; a
  write endpoint must call `invalidate_detail` (and needs a list-key strategy)
  the moment it lands.
- **`/products` runs two queries** (`page` + `COUNT(*)`) because the contract
  requires an exact `total`. That is fidelity, not an oversight; a keyset
  pagination redesign would change the envelope.
- **No stampede protection on a cold L2.** A burst on an expired key can fan
  out to Postgres. Singleflight would fix it, and the concurrency limiter caps
  the damage meanwhile. Worth doing before a real flash crowd.
- **The `otlp` feature is opt-in** because it roughly doubles a cold build.
  `/metrics` and JSON logs carry the observability load by default.
- **`/products` deep offsets stay slow.** `OFFSET 4294967276` is accepted for
  contract compatibility, and Postgres still has to walk the rows.