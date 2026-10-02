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

## Failure drills

- Stop Valkey during a run: product requests should keep succeeding via L1 / Postgres; `cache_l2_errors_total` rises and the Grafana alert fires.
- Set `RATE_LIMIT_PER_IP_RPS=5`, then send >5 requests in a second with `CLIENT_IPS=1`: 429s should appear while database pool wait stays bounded.
- Stop Postgres: `/health` should return 503 and product reads should return the generic 500 shape.
- Verify shutdown: send SIGTERM while requests are in flight and confirm the process drains before exiting.

Drills 1, 3, and 4 are also asserted automatically: the fail-open cache path
and the degraded shapes in `cargo test --test e2e_products`, and the drain
path in the graceful-shutdown handler used by `cargo run`.
