# Marketplace API load tests

Run from the repository root with Docker and k6 installed (or use the
`docker run --rm -i grafana/k6:latest run - < load-tests/k6/<scenario>.js`
form shown below if you prefer not to install k6). These thresholds are
pass/fail SLO gates; measured baselines are intentionally marked pending
until the scenarios have been run on a known machine.

## Local stack and 50k-product seed

```bash
docker compose up -d postgres valkey prometheus grafana
cp api-rs/.env.example api-rs/.env
pnpm --filter @rnw/api-rs db:migrate
SEED_COUNT=50000 pnpm --filter @rnw/api-rs db:seed
pnpm --filter @rnw/api-rs dev
```

Run k6 in another terminal. Grafana is pre-provisioned at
http://localhost:3002 (admin / rnw); Prometheus is at http://localhost:9090.
The `Marketplace API — RED` dashboard shows request rate, p95/p99, cache
ratios, pool acquisition, 429/load-shed counts, and RSS live.

`pnpm --filter @rnw/api-rs dev` serves api-rs on the contract port 3001, and
Prometheus scrapes 3001 — so the default target needs no changes. To measure a
different port, pass the matching `BASE_URL` and point
`monitoring/prometheus.yml` at the port under test.

The default `PAGE_COUNT=2500` covers 50k products at 20 products per page.
Override `BASE_URL`, `PAGE_COUNT`, `CLIENT_IPS`, or `K6_*` options as needed.

## Scenarios

```bash
k6 run load-tests/k6/steady.js
k6 run load-tests/k6/spike.js
k6 run load-tests/k6/soak.js

# no local k6 install needed:
docker run --rm -i grafana/k6:latest run - < load-tests/k6/steady.js
```

| Scenario | Workload | Required thresholds |
|---|---|---|
| `steady.js` | 1,000 requests/s for 10 minutes | p95 < 50 ms; failed requests < 0.1%; checks > 99.9% |
| `spike.js` | Ramp 100 → 5,000 requests/s in 10 seconds, hold 2 minutes, ramp down | p99 < 200 ms; 5xx < 0.1%; connection-refusal rate = 0 |
| `soak.js` | 500 requests/s for 1 hour + RSS scrape every iteration | early and late p95 < 50 ms; RSS growth < 10%; no failed requests |

For a cold-cache run, restart api-rs and Valkey immediately before the
scenario. For a warm-cache run, first request every target page, then start
the scenario before the 60-second L2 TTL expires. Record whether Cloudflare
is enabled separately; local runs measure origin only.

Requests use random pages to avoid benchmarking a single hot item. Set
`PAGE_COUNT=50` to test a small, fully warm catalog; leave it at 2500 for the
50k seed. k6 thresholds fail the process on SLO breaches so they can gate CI
or a release job.

The scenarios send a synthetic `CF-Connecting-IP` per request (`CLIENT_IPS`,
default 500) so the per-IP limiter does not turn the run into a wall of 429s
from one source address. To measure the limiter itself, run with
`CLIENT_IPS=1` — expect 429s above `RATE_LIMIT_PER_IP_RPS` (100 by default) —
or disable it with `RATE_LIMIT_PER_IP_RPS=0`.

## Result table

Use the same laptop, Docker Postgres, seed size, request mix, k6 version, and
cache mode for cold and warm runs so they are comparable. The clients are
unchanged and use their existing `localhost:3001` defaults.

| Implementation | Cache | RPS | p95 | p99 at spike | RSS / instance | Notes |
|---|---|---:|---:|---:|---:|---|
| api-rs + sqlx | cold | pending | pending | pending | pending | |
| api-rs + sqlx | warm | pending | pending | pending | pending | |

Do not fill the table with benchmark estimates: capture the k6 summary and
process RSS from the same host and commit the measured values with the test
environment noted.

## List-query index: measured before/after

`@@index([createdAt, id])` on `Product` (`Product_createdAt_id_idx`) exists so
the list query's `ORDER BY "createdAt" ASC, "id" ASC LIMIT 20` becomes an index
scan that stops at the limit, instead of sorting the whole table first.

Measured on Postgres 17 in a throwaway container with 200 000 rows, using the
exact `LIST_QUERY` from `api-rs/src/store/products.rs`, page 1
(`OFFSET 0`), cold container:

| | Plan | Shared buffers | Execution time |
|---|---|---:|---:|
| Before | `Parallel Seq Scan` → `Gather Merge` → `Sort` (`top-N heapsort`) | 1904 | 16.264 ms |
| After | `Index Scan using Product_createdAt_id_idx` | 4 | 3.705 ms (first, still reading from disk) |
| After, warm | `Index Scan using Product_createdAt_id_idx` | 4 | 0.033–0.564 ms |

The `Sort` node disappears entirely, and the scan stops after 20 rows instead of
reading all 200 000.

What the index does **not** fix: a deep offset still has to walk every skipped
row, because `LIMIT` cannot help an index scan that must discard them first.
At `OFFSET 100000` the same plan costs 19.795 ms and reads 100 020 rows. That is
the measurement that keeps keyset pagination on the list — see the deep-offset
trade-off in `api-rs/ARCHITECTURE.md` §11.

Reproduce with:

```bash
docker run -d --name idxcheck -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=t postgres:17-alpine
# apply api-rs/prisma/migrations/, seed 200k rows, then:
#   EXPLAIN (ANALYZE, BUFFERS) <LIST_QUERY without the index>
#   CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id");
#   EXPLAIN (ANALYZE, BUFFERS) <LIST_QUERY>
```

## Cold-L2 stampede: measured before/after

Singleflight (`api-rs/src/cache/singleflight.rs`) collapses concurrent fills of
one cache key, so a burst on an expired key costs one store call instead of N.

Measured on a 50 000-row catalog (Postgres 17 + Valkey 8 containers, release
build), 200 barrier-released concurrent `GET /products` for **one cold key**
after `FLUSHALL`, so all 200 requests miss both tiers. The baseline binary is
this branch with only the *page* singleflight removed, which isolates item 1's
contribution: the cached-`COUNT(*)` flight is present in both.

| | DB round trips | p50 | p99 | max | wall |
|---|---:|---:|---:|---:|---:|
| Before (no page singleflight) | 201 | 118.8 ms | 132.8 ms | 133.1 ms | 171 ms |
| After (singleflight) | **2** | **31.2 ms** | **42.3 ms** | 42.8 ms | 69 ms |

201 → 2 is 1 page `SELECT` + 1 `COUNT(*)` instead of 200 of each, and p99 drops
3.1×. The follower wait (`cache_singleflight_wait_seconds`) peaks at roughly the
leader's database round trip, which is the expected shape: a collapsed request
waits for the leader and is then answered from cache.

This is a per-instance effect by design — cross-instance warming is Valkey's
job. `cache_singleflight_leader_total` against `cache_singleflight_follower_total`
is how you confirm it is doing its job in a given deployment.

To reproduce, start the stack, seed, run the release binary with
`PER_IP_CONCURRENCY_LIMIT=4096 RATE_LIMIT_PER_IP_RPS=0`, flush Valkey, then hit
one page with N threads released from a barrier. A process-per-request driver
(`xargs -P`) does *not* work: spawn skew means late requests hit the already
filled cache and the burst never actually overlaps.

## Failure drills

- Stop Valkey during a run: product requests should keep succeeding via L1 / Postgres; `cache_l2_errors_total` rises and the Grafana alert fires.
- Set `RATE_LIMIT_PER_IP_RPS=5`, then send >5 requests in a second with `CLIENT_IPS=1`: 429s should appear while database pool wait stays bounded.
- Stop Postgres: `/health` should return 503 and product reads should return the generic 500 shape.
- Verify shutdown: send SIGTERM while requests are in flight and confirm the process drains before exiting.

Drills 1, 3, and 4 are also asserted automatically: the fail-open cache path
and the degraded shapes in `cargo test --test e2e_products`, and the drain
path in the graceful-shutdown handler used by `cargo run`.
