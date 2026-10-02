# api-rs

Rust + Axum implementation of the existing marketplace read API. It serves
the NestJS contract on port 3001, reads the Prisma-managed PostgreSQL schema,
and remains an independent, reversible service during the parity/soak period.

## Prerequisites

- Rust stable (the crate pins 1.99.0 in `rust-toolchain.toml`; rustup installs
  it automatically). On macOS the linker also needs an accepted Xcode license
  (`sudo xcodebuild -license accept`); without it every `cargo build`/`test`
  fails with `linking with 'cc' failed`.
- Postgres 17 with the existing Prisma migrations applied.
- Valkey 8 is optional. Without it, the L1 cache and Postgres path continue to
  serve requests; shared L2 caching and distributed rate limiting fail open.
- Docker is needed for the hermetic integration tests.
- `cargo-llvm-cov` is only needed for `pnpm --filter @rnw/api-rs coverage`
  (`cargo install cargo-llvm-cov`); `test` and `test:e2e` are plain cargo.

## Run locally

From the repository root:

```bash
docker compose up -d postgres valkey
pnpm --filter @rnw/api db:migrate
pnpm --filter @rnw/api db:seed
cp api-rs/.env.example api-rs/.env
pnpm --filter @rnw/api-rs dev
```

`api-rs dev` uses port 3003 so `pnpm dev` can run NestJS on 3001 and Grafana
on 3002 beside it during parity testing. Run `PORT=3001 pnpm --filter
@rnw/api-rs dev` to occupy the production/default port. If `cargo-watch` is
installed the script watches sources; otherwise it runs `cargo run` once.
Running Cargo directly in `api-rs/` also uses port 3001 unless `api-rs/.env`
sets `PORT`.

## Environment

| Variable | Default | Purpose |
|---|---:|---|
| `DATABASE_URL` | local Postgres URL | Required Postgres connection. Prisma-only query params such as `schema=public` are stripped. |
| `VALKEY_URL` | `redis://127.0.0.1:6379` | L2 cache + shared rate limits. Set `off` to disable. |
| `PORT` | `3001` | Listen port. |
| `DB_MAX_CONNECTIONS` | `10` | Per-instance sqlx pool cap. Budget the sum across replicas against Postgres. |
| `DB_ACQUIRE_TIMEOUT_MS` | `2000` | Maximum wait for a pool connection. |
| `REQUEST_TIMEOUT_MS` | `10000` | Request deadline. |
| `L1_LIST_TTL_SECS` | `5` | Per-process list cache TTL. |
| `L1_DETAIL_TTL_SECS` | `60` | Per-process detail cache TTL. |
| `L2_TTL_SECS` | `60` | Shared Valkey cache TTL. |
| `GLOBAL_CONCURRENCY_LIMIT` | `1024` | In-flight requests before returning 503. |
| `PER_IP_CONCURRENCY_LIMIT` | `64` | In-flight requests per client IP. |
| `RATE_LIMIT_GLOBAL_RPS` | `0` | Fleet-wide Valkey-backed requests/second; zero disables. |
| `RATE_LIMIT_PER_IP_RPS` | `100` | Per-IP Valkey-backed requests/second; zero disables. |
| `EDGE_CACHE_CONTROL` | `public, max-age=0, s-maxage=30, stale-while-revalidate=60` | Cache policy for product GETs at Cloudflare. |
| `CORS_ORIGIN` | `http://localhost:3000` | Browser origin allowed by CORS. |
| `HEALTH_PING_TIMEOUT_MS` | `1000` | Database readiness probe timeout. |
| `RUST_LOG` | `info,sqlx=warn` | JSON tracing filter. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTLP/gRPC endpoint when built with `--features otlp`. |
| `OTEL_TRACES_SAMPLE_RATIO` | `0.1` | Trace sampling ratio with the `otlp` feature. |

`GET /products*` responses also carry an operational `X-Cache` header (`miss`,
`hit-l1`, or `hit-l2`). Response bodies preserve the NestJS JSON field order
and serialization; edge/cache headers are additive.

## Tests and quality gates

```bash
cargo test --lib                       # unit tests (pnpm test)
cargo test --test e2e_products --test parity   # hermetic E2E (pnpm test:e2e)
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo llvm-cov --workspace --fail-under-lines 80 --lcov --output-path lcov.info
cargo bench
```

`test`/`test:e2e` deliberately stay on plain `cargo test` so they work with
only a Rust toolchain; the coverage gate is the separate `coverage` script,
which needs `cargo-llvm-cov`.

Integration tests use testcontainers-rs to start isolated Postgres 17 and
Valkey 8 containers, apply the current Prisma migrations, seed 25 deterministic
fixtures, then drive real HTTP. They cover pagination boundaries, exact JSON
goldens, health readiness and the degraded shapes while the database is down,
cache behavior, 404 shapes, rate limiting, and Valkey-absent fail-open
behavior. Docker must be running.

`cargo test --test parity` always compares against committed fixtures. To
compare against a live NestJS API too, set `PARITY_API_URL` to its base URL;
the NestJS database must be seeded with the same fixture rows from
`tests/fixtures/seed.sql` first. Health `responseTime` is normalized before
comparison.

The NestJS suites in `api/test/*.e2e-spec.ts` drive the app in-process through
supertest, so they cannot be pointed at a running api-rs process; the same
assertions are covered over real HTTP instead:

| NestJS e2e spec | api-rs equivalent |
|---|---|
| `GET /products` page shape | `e2e_products.rs::product_read_contract_and_pagination_boundaries` |
| `GET /products?page=2` non-overlapping page | same test, page 1/page 2 id sets |
| `GET /products/:id` | `e2e_products.rs::detail_404_health_and_cache_are_contract_compatible` |
| `GET /products/:id` unknown id → 404 | same test, byte-compared body |
| `GET /health` → 200 | same test plus `parity.rs` golden |
| page = `-1` → 500 | `parity.rs::responses_match_committed_golden_fixtures` |

## Container

`Dockerfile` uses cargo-chef to cache dependency layers and builds one release
binary with OTLP support. It runs as a non-root user on port 3001. Supply
`DATABASE_URL`, `VALKEY_URL`, and (optionally) the OTLP endpoint at runtime.

## Scale path

The service is stateless across instances. Put the binary behind a load
balancer and Cloudflare; use a shared Valkey, budget each sqlx pool against
the primary connection limit, and direct read-only product queries to a
regional PostgreSQL read pool when replicas are introduced. Migrations and
seeding remain owned by `api/prisma`—do not add a second migration system.
