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

`db:seed` writes one demo seller and **no products**, on purpose: the marketplace
is meant to hold only what sellers create through the app, so a fresh `pnpm dev`
shows the (already implemented) empty state rather than a fabricated catalogue.
Register a store through the UI, or log in as `seller@rnw.test` /
`rnw-demo-password`, and add products to get real data to click.

The e2e fixture products live behind their own commands, so a test run can have
them without a developer's database keeping them. Their values come from the
canonical catalogue `api-rs/fixtures/products.json` — the same file the hermetic
E2E harness seeds and the byte-compared goldens are derived from — and
`db:seed-fixtures` writes its `prod-*` subset of it:

| Command | Writes |
| --- | --- |
| `db:seed` | the demo seller |
| `db:seed-fixtures` | the demo seller **and** the fixed products `prod-1`…`prod-8`, `prod-owned-1` |
| `db:clear-fixtures` | deletes exactly those fixture products, leaving sellers and anything created through the API alone |

`web-application/e2e/global-setup.ts` and `mobile-application/e2e/global-setup.js`
call `db:seed-fixtures` before a run and their teardown counterparts call
`db:clear-fixtures` after it, so a run leaves the database as it found it.
`clear-fixtures` is idempotent — a run killed mid-flight is cleaned up by the
next one.

`api-rs dev` serves port 3001, the contract port both clients default to, so it
is part of the root `pnpm dev` task. Grafana stays on 3002.

On startup it retries the first Postgres connection for a few seconds before
giving up, so a database that is still coming up does not take the rest of
`pnpm dev` down with it. That is a courtesy, not a setup order: run the `db:*`
scripts first, because a reachable database with no schema still fails.

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

A database migrated by Prisma has an **empty** `_sqlx_migrations` table, so sqlx
tries to re-apply `create_product` and fails with
`relation "Product" already exists`. The objects are already there — the table,
its columns, and every product row — so the fix is to tell sqlx those migrations
ran, not to recreate the schema.

```sql
-- Baseline only the migrations whose effects are already in the schema.
-- `checksum` is the SHA-384 of that migration's `.up.sql`, hex, as a bytea
-- literal — copy it from the command below rather than typing it.
INSERT INTO _sqlx_migrations (version, description, installed_on, success, checksum, execution_time)
VALUES (20260926133034, 'create product', now(), true, '\x<sha384 of create_product.up.sql>', 0),
       (20260929101635, 'add product stock', now(), true, '\x<sha384 of add_product_stock.up.sql>', 0)
ON CONFLICT (version) DO NOTHING;
```

Compute a checksum without guessing:

```bash
# inside api-rs/
python3 -c "import hashlib,sys;print(hashlib.sha384(open(sys.argv[1],'rb').read()).hexdigest())" \
  migrations/20260929101635_add_product_stock.up.sql
```

sqlx compares that digest on **every** subsequent run and refuses with
`VersionMismatch` if it differs (`sqlx-core`'s `Migrator::run`), so a checksum
typed by hand that is even slightly wrong turns into a different confusing
failure. Only `.up.sql` is hashed — `.down.sql` is skipped by `run()`.

Then migrate and seed as usual:

```bash
pnpm --filter @rnw/api-rs db:migrate
pnpm --filter @rnw/api-rs db:seed
```

Check what the schema already has before baselining anything, so you only mark
what is genuinely applied:

```bash
psql "$DATABASE_URL" -c '\d "Product"'          # columns and indexes
psql "$DATABASE_URL" -c 'SELECT * FROM _sqlx_migrations ORDER BY version;'
psql "$DATABASE_URL" -c 'SELECT * FROM _prisma_migrations ORDER BY started_at;'
```

`Product_createdAt_id_idx` is a common one to be missing — it is a later migration
than the Prisma-era pair, so it is *not* baselined and `db:migrate` creates it.

**Recreating the schema (`docker compose down -v`) throws the catalogue away.**
It is the right answer only for a disposable database, and it is the wrong answer
when Postgres is not the compose container at all: `down -v` removes the
*compose project's* volume, so a database served by a natively-installed Postgres
on `localhost:5432` — which shadows the published container port — survives the
command untouched and is still broken afterwards. Check which server actually
answers before reaching for either route:

```bash
psql "$DATABASE_URL" -c 'SELECT current_database(), inet_server_port();'
lsof -nP -iTCP:5432 -sTCP:LISTEN    # a second listener on the loopback port wins
```

`db:seed` is idempotent — every row it writes is a fixture, upserted, so
re-running it never duplicates data. It generates nothing and it deletes nothing:
the catalogue is what sellers create, plus `db:seed-fixtures` when a test run
asks for it.

### An existing database keeps whatever it already had

Because no seed command deletes, a database seeded before this split still holds
its old rows — the 1,000 generated `prod-gen-*` products, and whatever the
Prisma-era seed left behind. `db:clear-fixtures` removes the *fixture* products
only, so it will not touch those; they are rows in a table no command owns any
more. To get the empty marketplace, recreate the database (`docker compose down
-v`, with the caveats above) and run `db:migrate && db:seed`. To see what is
actually in there first:

```bash
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "Product";'
```

## Environment

| Variable | Default | Purpose |
|---|---:|---|
| `DATABASE_URL` | local Postgres URL | Postgres connection, read by the server and by `api-rs-db`. Prisma-only query params such as `schema=public` are stripped so URLs carried over from the old Prisma setup still parse. |
| `DATABASE_READ_URL` | unset | Optional read replica for product reads. Unset keeps every query on the primary; an unreachable replica also degrades to the primary. `/health` always pings the primary. |
| `VALKEY_URL` | `redis://127.0.0.1:6379` | L2 cache + shared rate limits. Set `off` to disable. |
| `PORT` | `3001` | Listen port. |
| `DB_MAX_CONNECTIONS` | `10` | Per-instance sqlx pool cap for the primary. Budget the sum across replicas against Postgres. |
| `DB_READ_MAX_CONNECTIONS` | `10` | Separate cap for the read pool. Per-pool, not per-instance. |
| `DB_ACQUIRE_TIMEOUT_MS` | `2000` | Maximum wait for a pool connection **during a request**. Startup does not use this: sqlx bounds the first connection by the same value, so the bootstrap probes with its own 4 s deadline and retries (see `ARCHITECTURE.md` §7). |
| `REQUEST_TIMEOUT_MS` | `10000` | Request deadline. |
| `L1_LIST_TTL_SECS` | `5` | Per-process list cache TTL. |
| `L1_DETAIL_TTL_SECS` | `60` | Per-process detail cache TTL. |
| `L2_TTL_SECS` | `60` | Shared Valkey cache TTL. |
| `L1_MAX_ENTRIES` | `50000` | Entry ceiling for **each** in-process cache tier (list and detail). Counts pages, so on its own it is not a memory bound — `L1_MAX_VALUE_BYTES` is the other half. |
| `L1_MAX_VALUE_BYTES` | `1048576` | Ceiling on one cached body. A larger response is refused rather than stored and counted as `cache_l1_oversize_total` / `cache_l2_oversize_total`; the caller still gets its response and the next request re-reads Postgres. Well above any real page — `MAX_DESCRIPTION_LENGTH` and `MAX_IMAGE_URL_LENGTH` bound the inputs first — so a non-zero count means something upstream of the field caps is not doing its job. |
| `GLOBAL_CONCURRENCY_LIMIT` | `1024` | In-flight requests before returning 503. |
| `PER_IP_CONCURRENCY_LIMIT` | `64` | In-flight requests per client IP. |
| `RATE_LIMIT_GLOBAL_RPS` | `0` | Fleet-wide Valkey-backed requests/second; zero disables. |
| `RATE_LIMIT_PER_IP_RPS` | `100` | Per-IP Valkey-backed requests/second; zero disables. |
| `RATE_LIMIT_MAX_TRACKED_IPS` | `100000` | Distinct client IPs the per-IP concurrency semaphore will track. Past the cap an unseen IP is served **without** a per-IP permit — counted as `http_load_shed_total{scope="ip-untracked"}` rather than shed, because blanket 503s are worse than a weaker bound. Idle entries are swept when the cap is hit, so this is a high-water mark rather than a permanent state. |
| `TRUSTED_PROXY_HEADERS` | `cf-connecting-ip,x-forwarded-for` | Comma-separated headers consulted, in order, for the client IP that keys every per-IP limit. Set to empty to use the socket peer only — see below. |
| `AUTH_LOGIN_ATTEMPTS_PER_MIN` | `10` | Per-IP login/registration attempts per minute, on its own 60-second window. This one bounds a password-guess rate rather than a traffic burst; zero disables it. |
| `SESSION_TTL_SECS` | `604800` (7 days) | How long a session token stays valid. `POST /auth/logout` revokes immediately; this is the backstop for a token nobody revoked. A login also deletes that seller's rows already past this TTL, so the table does not grow without bound — see "Session rows" below for what is and is not bounded. |
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

### Session rows

Every successful login and registration inserts a `"Session"` row, and several
rows per seller is intended behaviour — logging out of one device is not logging
out of the account. What keeps the table bounded is age, not count: a login
deletes that seller's rows whose `expiresAt` is already past, so nothing is left
behind once it can no longer authenticate.

That bound is **by age only**, and the choice is deliberate rather than
overlooked:

- **Bounded:** rows stop accumulating once they are older than
  `SESSION_TTL_SECS`, without any scheduler, cron entry or background task.
- **Not bounded:** a seller who logs in many times inside one TTL window holds
  one live row per login for the length of that window. There is deliberately no
  per-seller cap on *live* sessions, because enforcing one would revoke a device
  the seller is still using — a real behaviour change, and not one this service
  makes silently. If that is ever wanted it is a stated cap plus a documented
  policy question, not a default.

`ARCHITECTURE.md` §11 records the same trade-off, and the migration that adds
`Session_userId_idx` records why `Session_expiresAt_idx` is kept even though no
query reads it yet.

## Proxy trust and client IPs

Every per-IP limit — the per-IP concurrency semaphore, `RATE_LIMIT_PER_IP_RPS`,
and the login throttle — keys on one string: the client IP. `TRUSTED_PROXY_HEADERS`
decides which headers are believed when resolving it, and that is a security
setting rather than a detail. Rotating a single client-supplied header resets all
three limits at once, so the default trusts Cloudflare's `CF-Connecting-IP` and
then the first `X-Forwarded-For` hop, which is correct only when a trusted edge
sits in front.

**Behind Cloudflare**, keep the default *and* lock origin access to Cloudflare's
published IP ranges (security groups, or a Cloudflare Tunnel). The second half is
the part that actually closes the hole: the header is only meaningful if the edge
is the only thing that can reach the origin. That is an operator action on the
network, and no setting in this service can substitute for it — with the origin
open, `TRUSTED_PROXY_HEADERS` can only be read as trusting whoever can send a
header.

**Direct to origin** (which is what `docker-compose.yml` and local dev are), set
`TRUSTED_PROXY_HEADERS=`. The peer address is then the only source, and the
per-IP limits cannot be reset from the request at all.

The global limits are keyed on the literal `"global"` and survive either way:
`GLOBAL_CONCURRENCY_LIMIT` still caps the process regardless of what any client
sends.

## Auth and seller storefronts

The marketplace itself is public and unauthenticated. Selling is not: a seller
registers, gets an opaque bearer token, and manages their own products under
`/my-store`.

| Route | Auth | Purpose |
|---|---|---|
| `POST /auth/register` | — | Create a seller and a session. `201 { user, token }`. |
| `POST /auth/login` | — | Exchange credentials for a token. `200 { user, token }`. |
| `POST /auth/logout` | Bearer | Delete the session row. `204`, so the token stops working immediately. |
| `GET /auth/me` | Bearer | The signed-in seller. `200 { user }`. |
| `GET /my-store/products?page=N` | Bearer | The caller's own products. Never cached. |
| `POST /my-store/products` | Bearer | Create a product owned by the caller. `201`. |
| `PATCH /my-store/products/{id}` | Bearer | Update one of the caller's products. |
| `DELETE /my-store/products/{id}` | Bearer | Delete one of the caller's products. `204`. |
| `GET /stores/{id}` | — | A store's public record. |
| `GET /stores/{id}/products?page=N` | — | That store's public catalogue. |

Four things about that table are design decisions rather than implementation
details:

- **Only the SHA-256 of a token is stored**, never the token. A database leak
  must not hand over live sessions.
- **Passwords are argon2id**, verified on `spawn_blocking`, because the default
  parameters cost tens of milliseconds of pure CPU and that belongs on the
  blocking pool rather than on an async worker.
- **A `PATCH`/`DELETE` on someone else's product is a `404`, not a `403`.** A 403
  would confirm the id exists on a public catalogue.
- **Every authenticated or mutating response is `Cache-Control: no-store`,** and
  `/my-store/products` is never entered into `CacheTier` at all.

`db:seed` creates one demo seller (`seller@rnw.test` / `rnw-demo-password`,
store `Riverbend Vintage`) and no products, so there is a way to log in and act as
a real seller without seeding a catalogue. `db:seed-fixtures` adds one owned
product for that seller, for a test run that needs the storefront paths.
**No session is ever seeded** — a seeded token would be a live credential in every
developer's database.

Login is throttled per client IP on its own 60-second window
(`AUTH_LOGIN_ATTEMPTS_PER_MIN`), separately from the general requests-per-second
limiter, because a password guess is cheap to make and expensive to serve. Like
every Valkey consumer here it is fail-open: an unreachable Valkey removes the
throttle. Watch `auth_login_total{result="invalid"}` — the limiter exists to be
observable.

## Tests and quality gates

```bash
pnpm test                # cargo test --lib  — unit tests
pnpm test:e2e            # cargo test --test e2e_products --test e2e_auth --test e2e_my_store --test parity --test seed
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
Valkey 8 containers, apply the embedded migrations, seed 26 deterministic
fixtures (including one owned by a seller), then drive real HTTP. They cover
pagination boundaries, exact JSON goldens, health readiness and the degraded
shapes while the database is down, cache behavior, 404 shapes, rate limiting, and
Valkey-absent fail-open behavior. `e2e_auth.rs` and `e2e_my_store.rs` add the
auth and write paths: concurrent registration, session revocation, read-your-writes
for the seller, the `404`-not-`403` ownership rule, and cache invalidation against a
warm cache. Docker must be running.

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

Replica lag means a just-created product can briefly be missing from the *public*
reads, so those are not read-your-writes. Owner-scoped reads and every write are
routed to the primary unconditionally, so a seller never sees that lag. Unsetting
`DATABASE_READ_URL` puts every read on the primary if the public lag is not
acceptable — see `ARCHITECTURE.md` §5.

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

## The write path

The first mutations landed with the seller storefronts, and they had to retire
the cache the read path depends on. Both tiers key list pages under a namespace
counter (`api-rs:products:list:gen`), so one `INCR` after a write makes every
cached page unreachable at once — including `products:count`, which is the field a
new product changes most visibly. `invalidate_detail(id)` runs *first*, so no
reader can pair a fresh detail entry with a list that was filled before the write.

Three list families fold in that counter: `products:list` (the marketplace) and
`stores:{id}:products:list` (a public storefront). The owner-scoped list is not
cached at all, because it is per-user.

The counter is held in process rather than read per request: `bump` writes through
to the local value and refreshes the shared one, and a background task re-reads it
every `L2_TTL_SECS`. The trade-off is that an instance which did not perform the
write may serve a pre-write list page until its next refresh. See
`ARCHITECTURE.md` §12.

Owner-scoped reads and every write go to the **primary**, so a seller always sees
their own changes immediately. `GET /products` and `GET /stores/{id}/products` read
from the replica, so the *public* marketplace may show a just-created product only
after replica lag. Unsetting `DATABASE_READ_URL` puts every read on the primary
and is a one-line change.
