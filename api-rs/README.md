# api-rs

Rust + Axum implementation of the marketplace read API. It serves the contract
on port 3001, reads the Prisma-managed PostgreSQL schema, and is the only API
in the repo — the NestJS `api/` it replaced has been decommissioned.

## Prerequisites

- Rust stable (the crate pins 1.99.0 in `rust-toolchain.toml`; rustup installs
  it automatically). On macOS the linker also needs an accepted Xcode license
  (`sudo xcodebuild -license accept`); without it every `cargo build`/`test`
  fails with `linking with 'cc' failed`.
- Postgres 17 with the Prisma migrations in `prisma/migrations/` applied.
- Valkey 8 is optional. Without it, the L1 cache and Postgres path continue to
  serve requests; shared L2 caching and distributed rate limiting fail open.
- Node + pnpm, for the Prisma CLI that drives migrations and seeding.
- Docker is needed for the hermetic integration tests.
- `cargo-llvm-cov` is only needed for `pnpm --filter @rnw/api-rs coverage`
  (`cargo install cargo-llvm-cov`); `test` and `test:e2e` are plain cargo. The
  `llvm-tools-preview` component it shells out to is listed in
  `rust-toolchain.toml`, so rustup provisions it with the pinned toolchain — but
  only for the pinned one, so an existing toolchain installed before that line
  was added still needs `rustup component add llvm-tools-preview` once.
  `scripts/coverage.sh` checks for both and prints those commands if either is
  missing, rather than letting cargo fail with `no such command: llvm-cov`.

## Run locally

From the repository root:

```bash
docker compose up -d postgres valkey
cp api-rs/.env.example api-rs/.env
pnpm --filter @rnw/api-rs db:migrate
pnpm --filter @rnw/api-rs db:seed
pnpm --filter @rnw/api-rs dev
```

`db:migrate` and `db:seed` both run `prisma generate` first, so the seed script
always finds the generated client. If `cargo-watch` is installed the dev script
watches sources; otherwise it runs `cargo run` once. Running Cargo directly in
`api-rs/` uses the same default unless `api-rs/.env` sets `PORT`.

`api-rs dev` serves port 3001, the contract port both clients default to, so it
is part of the root `pnpm dev` task. Grafana stays on 3002.

## Database ownership

api-rs reads Postgres through sqlx but does **not** own its schema. Migrations
and seeding stay owned by `prisma/schema.prisma` plus `prisma/migrations/`,
driven by the Prisma CLI (`prisma.config.ts`) through the `db:*` scripts above
— do not add a second migration system. `prisma/seed.ts` is the only consumer
of the generated client; the Rust service never imports it.

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
`hit-l1`, or `hit-l2`). Response bodies preserve the documented JSON field order
and serialization that the web and mobile clients parse; edge/cache headers are
additive.

## Tests and quality gates

```bash
pnpm test                # cargo test --lib  — unit tests
pnpm test:e2e            # cargo test --test e2e_products --test parity — hermetic E2E
pnpm test:all            # both of the above, in order (needs Docker)
pnpm lint                # cargo fmt --check && cargo clippy --all-targets -- -D warnings
pnpm typecheck           # cargo check --all-targets
pnpm coverage            # cargo llvm-cov --workspace --fail-under-lines 80 --lcov --output-path lcov.info
pnpm bench               # cargo bench (Criterion, in-process, needs no services)
```

| Kind | Command | Requires |
| --- | --- | --- |
| Unit tests | `pnpm test` | — |
| Hermetic E2E + contract parity | `pnpm test:e2e` | Docker |
| All tests (unit + E2E) | `pnpm test:all` | Docker |
| Coverage gate (80% lines) | `pnpm coverage` | `cargo-llvm-cov` |
| Benchmarks | `pnpm bench` | — |
| Lint (fmt + clippy) | `pnpm lint` | — |
| Typecheck | `pnpm typecheck` | — |

`test`/`test:e2e` deliberately stay on plain `cargo test` so they work with
only a Rust toolchain; the coverage gate is the separate `coverage` script,
which needs `cargo-llvm-cov`. `test:all` just chains `test` then `test:e2e` —
it is deliberately not named `test`, so the root `turbo run test` stays free of
the Docker-dependent E2E run. From the repository root, prefix each with
`pnpm --filter @rnw/api-rs`.

Integration tests use testcontainers-rs to start isolated Postgres 17 and
Valkey 8 containers, apply the Prisma migrations in `prisma/migrations/`, seed
25 deterministic fixtures, then drive real HTTP. They cover pagination
boundaries, exact JSON goldens, health readiness and the degraded shapes while
the database is down, cache behavior, 404 shapes, rate limiting, and
Valkey-absent fail-open behavior. Docker must be running.

`cargo test --test parity` compares every response byte-for-byte against the
committed fixtures in `tests/fixtures/`. Health `responseTime` is normalized
before comparison, since it is timing-dependent by nature.

## Container

`Dockerfile` uses cargo-chef to cache dependency layers and builds one release
binary with OTLP support. It runs as a non-root user on port 3001. Supply
`DATABASE_URL`, `VALKEY_URL`, and (optionally) the OTLP endpoint at runtime.

## Scale path

The service is stateless across instances. Put the binary behind a load
balancer and Cloudflare; use a shared Valkey, budget each sqlx pool against
the primary connection limit, and direct read-only product queries to a
regional PostgreSQL read pool when replicas are introduced.
