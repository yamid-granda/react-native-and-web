# api-rs

Rust + Axum implementation of the marketplace read API. It serves the contract
on port 3001, owns its PostgreSQL schema, and is the only API in the repo — the
NestJS `api/` and the Prisma toolchain it replaced have been decommissioned.

For the design strategy, the challenges it addresses, and diagrammed request
paths, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Prerequisites

- Rust stable (the crate pins 1.99.0 in `rust-toolchain.toml`; rustup installs
  it automatically). On macOS the linker also needs an accepted Xcode license
  (`sudo xcodebuild -license accept`); without it every `cargo build`/`test`
  fails with `linking with 'cc' failed`.
- Postgres 17, with the migrations in `migrations/` applied.
- Valkey 8 is optional. Without it, the L1 cache and Postgres path continue to
  serve requests; shared L2 caching and distributed rate limiting fail open.
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

Both `db:*` scripts run the `api-rs-db` binary, which reads `DATABASE_URL` from
`api-rs/.env`. `db:seed` applies pending migrations first, so seeding a fresh
database is a single command. If `cargo-watch` is installed the dev script
watches sources; otherwise it runs `cargo run` once. Running Cargo directly in
`api-rs/` uses the same default unless `api-rs/.env` sets `PORT`.

`api-rs dev` serves port 3001, the contract port both clients default to, so it
is part of the root `pnpm dev` task. Grafana stays on 3002.

## Database ownership

api-rs owns its schema. `migrations/` is the single source of truth, applied by
sqlx's embedded migrator and tracked in `_sqlx_migrations`; `src/seed.rs` owns
seeding. Do not add a second migration system.

To change the schema, add a reversible migration pair under `migrations/` named
`<version>_<description>.up.sql` / `.down.sql` — `cargo sqlx migrate add -r
<name>` scaffolds them with the right version prefix — then run `db:migrate`.
The two files must match in style: sqlx rejects a directory that mixes
reversible and simple migrations.

```bash
# inside api-rs/, with sqlx-cli installed: cargo install sqlx-cli --no-default-features --features postgres,rustls
cargo sqlx migrate add -r add_product_rating
# edit the .up.sql / .down.sql pair
pnpm db:migrate
```

`src/migrations.rs` embeds the directory via `sqlx::migrate!`, so the migration
history ships inside the binary and `build.rs` re-runs the macro when the
directory changes. The E2E suite applies that same embedded set, which is why a
test schema can never drift from the committed migrations.

`api-rs-db` is deliberately excluded from the release image (the Dockerfile
builds `--bin api-rs`), so migrations run from a checkout rather than from a
deployed instance. `db:migrate` is idempotent, and sqlx takes a Postgres
advisory lock, so several instances or developers running it at once is safe.

### First-time setup on an existing database

A database already migrated by Prisma has no `_sqlx_migrations` table, so
sqlx will try to re-apply `create_product` and fail with
`relation "Product" already exists`. Recreate the schema once:

```bash
docker compose down -v
docker compose up -d postgres valkey
pnpm --filter @rnw/api-rs db:migrate
pnpm --filter @rnw/api-rs db:seed
```

`db:seed` is idempotent — fixture rows are upserted and generated rows are left
alone on conflict — so re-running it never duplicates data.

## Environment

| Variable | Default | Purpose |
|---|---:|---|
| `DATABASE_URL` | local Postgres URL | Postgres connection, read by the server and by `api-rs-db`. Prisma-only query params such as `schema=public` are stripped so URLs carried over from the old Prisma setup still parse. |
| `DATABASE_READ_URL` | unset | Optional read replica for product reads. Unset keeps every query on the primary; an unreachable replica also degrades to the primary. `/health` always pings the primary. |
| `SEED_COUNT` | `1000` | Generated products for `db:seed`; used by the k6 load tests (`SEED_COUNT=50000`). Must be a non-negative integer. |
| `VALKEY_URL` | `redis://127.0.0.1:6379` | L2 cache + shared rate limits. Set `off` to disable. |
| `PORT` | `3001` | Listen port. |
| `DB_MAX_CONNECTIONS` | `10` | Per-instance sqlx pool cap for the primary. Budget the sum across replicas against Postgres. |
| `DB_READ_MAX_CONNECTIONS` | `10` | Separate cap for the read pool. Per-pool, not per-instance. |
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
Valkey 8 containers, apply the embedded migrations, seed 25 deterministic
fixtures, then drive real HTTP. They cover pagination
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

The image contains no Node runtime and no Node toolchain: the built binary
carries its own migrations and needs nothing from `pnpm` at runtime.

## Scale path

The service is stateless across instances. Put the binary behind a load
balancer and Cloudflare, and use a shared Valkey.

Read replicas are implemented, not aspirational: set `DATABASE_READ_URL` and
product reads use a second pool while `/health` keeps pinging the primary.
Budget `DB_MAX_CONNECTIONS` and `DB_READ_MAX_CONNECTIONS` separately — both are
per-pool, so they add up against Postgres when both point at the same server.

Replica lag means a just-created product can briefly be missing, so reads are
not read-your-writes. That is fine while products are immutable once visible and
stops being fine once `POST /products` exists — see `ARCHITECTURE.md` §12.

## Caching and stampede protection

A miss on an expired key does not fan out to Postgres: concurrent fills of one
cache key are collapsed in-process (`cache/singleflight.rs`), so the first
request runs the store call and the rest are answered from the cache it fills.
It is deliberately per instance — an L2 hit never reaches Postgres at all, so
cross-instance warming is already Valkey's job, and a distributed lock would put
a network round trip on the one path that must fail open. Watch
`cache_singleflight_leader_total` against `cache_singleflight_follower_total`
and `cache_singleflight_wait_seconds` to confirm it is doing its job.

The `COUNT(*)` behind the `total` field is cached under `products:count`, so it
is paid once per TTL window instead of once per request. The list query's
`ORDER BY createdAt, id` is backed by `@@index([createdAt, id])`, measured
before/after in `load-tests/README.md`.
