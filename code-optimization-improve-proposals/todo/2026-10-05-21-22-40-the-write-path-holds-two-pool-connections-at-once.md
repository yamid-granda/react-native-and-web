# The seller write path holds two primary pool connections at once, and self-deadlocks at exactly `DB_MAX_CONNECTIONS`

## Problem / opportunity

Three store methods acquire a second connection from the primary **while still
holding the first**, because the second `let` shadows the first rather than
replacing it, and Rust shadowing does not drop the shadowed binding. Both
connections are live until the function returns, so each in-flight write holds
two permits from a pool sized for one-per-request.

`api-rs/src/store/products.rs:630-654` (`ProductStore::create`):

```rust
630  async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError> {
631      let id = generate_product_id();
632      let mut connection = self.acquire_primary().await?;      // connection A
633      sqlx::query(INSERT_PRODUCT)
...
642      .execute(&mut *connection)
643      .await?;
644
645      // Read back through the same join the list/detail queries use, so the
646      // 201 body cannot disagree with what a later GET returns.
647      let mut connection = self.acquire_primary().await?;      // connection B; A is still alive
648      let row: ProductRow = sqlx::query_as(DETAIL_OWNED_QUERY)
```

The comment at `:645-646` states the read-back exists so the 201 body cannot
disagree with a later `GET`. That goal is right and worth keeping. The
*implementation* is what is wrong: the read-back reuses the join but not the
connection, so the second `acquire_primary()` at `:647` is a second permit from
the same pool. There is no `drop(connection)` anywhere in `api-rs/src` — the only
`drop(` calls in the crate are on `rate_limit.rs` semaphores and
`singleflight.rs` guards (`grep -rn "drop(" api-rs/src` returns 10 hits, none of
them a connection).

The same shape appears twice more, for the same reason — a write followed by a
read-back through a different query:

- `api-rs/src/store/products.rs:662` and `:679` — `update_owned`: acquires A,
  runs `UPDATE_PRODUCT`, checks `rows_affected()`, then acquires B for
  `DETAIL_OWNED_QUERY`.
- `api-rs/src/store/users.rs:106` and `:122` — `create_user`: acquires A, runs
  `INSERT_USER`, then acquires B for `SELECT_USER_BY_ID`. The comment at
  `:119-121` gives the same read-back rationale.

That `PoolConnection` is returned to the pool on drop, and only on drop, is
what makes this a resource bug rather than a style one:
`sqlx-core-0.9.0/src/pool/connection.rs:199-208` implements
`Drop for PoolConnection` to spawn `return_to_pool()`, and the pool's admission
is a counting semaphore (`sqlx-core-0.9.0/src/pool/inner.rs:28` `semaphore:
AsyncSemaphore`, initialised to `semaphore_capacity` at `:57`). A permit is
returned only when the guard drops.

### Why this is not a theoretical limit

`DB_MAX_CONNECTIONS` defaults to `10` and `DB_ACQUIRE_TIMEOUT_MS` to `2000`
(`api-rs/src/config.rs:78`, `:80`), and `main.rs:18-22` wires both into
`connect_primary_pool`. So the arithmetic is:

- **Effective write concurrency is halved.** Ten permits serve five concurrent
  writes, because each write parks two.
- **At exactly `N = DB_MAX_CONNECTIONS` concurrent writes, every one of them
  fails.** All N tasks take their first connection (N/N permits), all N then
  block on the second, and no holder can finish to release. Every task dies on
  `PoolTimedOut` after 2 s, which `StoreError::Database` (`store/products.rs:128-130`,
  `From<sqlx::Error>` at `:138-142`) turns into `AppError::Store(_)` →
  `StatusCode::INTERNAL_SERVER_ERROR` (`error.rs:101-103`) →
  `500 {"statusCode":500,"message":"Internal server error"}`.

Nothing sheds before that point: `GLOBAL_CONCURRENCY_LIMIT` is `1024`
(`config.rs:85`), four orders of magnitude above the pool size, so the load
shedder's global semaphore never engages for a write burst. The pool is the
first and only ceiling, and the service walks into it at half the configured
capacity.

`ARCHITECTURE.md:339` documents `Pool saturated | Acquire timeout after 2 s →
500` as the *expected* degradation for genuine saturation. This is a different
thing wearing the same symptom: a burst of ordinary seller writes saturates the
pool at half the budget through the service's own code. `ARCHITECTURE.md:50`
names the failure this creates as **X4** (connection/pool exhaustion), and
`ARCHITECTURE.md:216-218` presents the bounded pool as the mitigation for X4.
The mitigation is real for reads; for writes the same section understates it,
because it does not say the write path draws two permits per request.

The read paths are all correct — every read method acquires exactly once
(`list_page` `:561`, `count` `:568`, `find_by_id` `:574`, `find_by_ids` `:584`,
`owned_page` `:510`, `owned_count` `:527`, `find_owned_by_id` `:621`,
`delete_owned` `:689`, `ping` `:696`). This is exclusively the write-then-read-back
shape, which is why it survived: the read path was factored and reviewed, and
the three methods that double-acquire are the only ones that issue two
statements in one call.

### Why nothing catches it

- **No unit test can reach it.** `app.rs`'s `test_state()` builds an
  `InMemoryStore`, and `InMemoryStore::create` (`store/memory.rs`) takes a
  single `Mutex` lock — it has no pool and cannot express this.
- **No E2E test reaches it either.** The only concurrent-write test is
  `concurrent_registrations_of_one_address_produce_exactly_one_seller`
  (`tests/e2e_auth.rs:140-167`), which spawns **4** tasks against a pool of
  `max_connections(5)` (`tests/common/mod.rs:281-283`, `:319`) with
  `db_acquire_timeout: 500ms`. Four concurrent `create_user` calls park 8
  permits against 5 — already over budget, but 4 < 5 so each task's second
  acquire eventually resolves and the test passes. It is one task short of
  proving the bug. There is no concurrent `POST /my-store/products` test at all.
- **Lint does not see it.** `api-rs/package.json:10` runs
  `cargo clippy --all-targets -- -D warnings`, which does not enable the
  `shadow_unrelated` *restriction* lint — so the shadowing that causes the
  defect is invisible to `pnpm lint`.
- **The load tests never write.** `load-tests/k6/` has `steady.js`, `spike.js`,
  and `soak.js`; `load-tests/README.md:29` states `db:seed` writes the demo
  seller and *no products*, so no scenario drives a write burst.

### Why it is expensive for an agent to get right

The three sites look correct in isolation: each acquires from the primary, runs
its statement, and reads the row back so the response matches the database.
A reviewer reasoning about *correctness* sees nothing wrong, because there is
nothing wrong with either query. The defect lives only in the interaction
between two correct-looking acquisitions and a shared bounded resource — and the
thing that would flag it (`shadow_unrelated`) is not enabled. An agent asked to
"add a field to the product write path" would copy this shape, because the three
existing methods are the pattern.

## Proposed approach

One rule: **a store method holds at most one primary connection at a time.**
Keep all three read-backs, all three queries, and every byte of every response
identical. Reuse the connection already held.

**Step 1 — `ProductStore::create`** (`store/products.rs:630-654`). Delete the
second acquisition at `:647` and run the read-back on the existing connection.
The `id` is already bound and `owner_id` is already in scope, so the only edit
is removing one line and letting `:648-652` use the binding from `:632`:

```rust
let mut connection = self.acquire_primary().await?;
sqlx::query(INSERT_PRODUCT)/* … */ .execute(&mut *connection).await?;

// Read back through the same join the list/detail queries use, so the
// 201 body cannot disagree with what a later GET returns — on the same
// connection, so a write never parks two permits from the pool.
let row: ProductRow = sqlx::query_as(DETAIL_OWNED_QUERY)
    .bind(&id)
    .bind(owner_id)
    .fetch_one(&mut *connection)
    .await?;
```

This is also *more* correct than what it replaces: read-back on the same
connection runs in the same implicit transaction as the `INSERT`, so the row
cannot have been deleted by a concurrent request between the write and the read.

**Step 2 — `ProductStore::update_owned`** (`store/products.rs:656-686`). Same
edit at `:679`. Note the early return at `:675-677` (`rows_affected() == 0` →
`Ok(None)`) currently drops both permits at once; after the change it holds
exactly one, which is the point.

**Step 3 — `UserStore::create_user`** (`store/users.rs:105-128`). Same edit at
`:122`. This also closes a latent ordering wrinkle: `classify_insert` at
`:134-142` matches on SQLSTATE `23505` rather than an index name, and with one
connection the `INSERT` and its classification stay on one connection's session
rather than being split across two pool checkouts.

**Step 4 — make the rule enforceable rather than documented.** The defect is
invisible to `cargo clippy` as configured, and a future method will reintroduce
it by copying `:630`. Two options, and the choice belongs to review:

- (a) Enable `shadow_unrelated` in `api-rs/Cargo.toml`'s `[lints.clippy]`
  section (as a `restriction` lint, so it must be opted into explicitly), with
  `#[allow]` on any legitimate shadow in the crate. Highest signal; needs a
  sweep to confirm the codebase is otherwise clean.
- (b) Add a store-layer contract assertion in `store/contract.rs` (the suite
  built for exactly this purpose) that a write completes against a
  `max_connections(1)` pool. If any method needs two permits, it fails.

(b) is the stronger guarantee and the one this repository's own precedent
favours — `store/contract.rs` already exists to make two implementations agree,
and `assert_store_contract` is run against both `InMemoryStore` and
`SqlProductStore`. It also produces a test that fails *before* the fix and
passes after, which is what makes this change verifiable. Prefer (b); take (a)
as an additional commit if the shadow sweep is clean.

**Step 5 — the regression test that is currently missing.** In
`tests/e2e_products.rs` (or `tests/e2e_my_store.rs`, whichever the write-path
tests live in), add a test that drives `concurrent_writes_do_not_exhaust_the_pool`:
build a stack with `max_connections(2)` and `db_acquire_timeout` unchanged,
register a seller, then issue `create` calls concurrently enough to park 2× the
pool size (4 against a pool of 2 — or, closer to production, assert that N
concurrent creates against a pool of N all return 201). It fails today with
500s and passes after steps 1–3. This is the test whose absence let the defect
reach `main`; `e2e_auth.rs:140`'s existing concurrent test is one task short of
reaching it, and the new test should say so in a comment.

**Step 6 — correct the two documentation lines.** `ARCHITECTURE.md:216-218`
should record that the write path now draws exactly one permit per in-flight
write, so `DB_MAX_CONNECTIONS` is a true per-request budget; and `ARCHITECTURE.md:339`'s
`Pool saturated` row should note that saturation is now reachable only by reads
plus writes together. Add one line to `ARCHITECTURE.md:50`'s X4 row or to
§12's rule 2 (`:472-474`) stating the invariant explicitly, so the next method
author has it in the place they will actually read.

## Impact

- **Scalability (the point).** Write concurrency goes from `DB_MAX_CONNECTIONS/2`
  to `DB_MAX_CONNECTIONS`. At the default of 10, five concurrent seller writes
  become ten. The cliff at exactly `N` concurrent writes disappears, because no
  write can now need more than its share of the pool.
- **Correctness.** Each read-back becomes transactional with its own write, so
  the 201/200 body cannot be assembled from a row that a concurrent request has
  since changed or removed. This is a real (if narrow) improvement over the
  current two-connection form, and it is free.
- **Maintainability / AI-developer experience.** Three of the most-copied
  methods in the store layer stop being a template for the defect. Combined with
  step 4's contract assertion, the next method added to `ProductStore` or
  `UserStore` is checked against the rule rather than against a reviewer having
  the insight. This is the part that compounds: the store traits are the seam
  every future feature writes through (`store/contract.rs`, `delegating.rs`, and
  the `CountingStore` spies all hang off them), so the rule is enforced at the
  one place new code necessarily passes.
- **Latency.** One fewer pool checkout per write, and one fewer `sqlx_pool_acquire_seconds`
  observation per write — so the metric that `ARCHITECTURE.md:218` calls "the
  earliest visible sign of X4 developing" becomes an accurate signal rather than
  a doubled one on the write path.

**What does not improve.** Read paths are untouched and were already correct;
this changes nothing for `/products`, `/products/by-ids`, or the storefront list.
It does not raise Postgres's own `max_connections`, does not change
`DB_MAX_CONNECTIONS`' default, and does not make the pool bigger — it stops the
service from wasting half of it. `InMemoryStore` is unaffected (no pool), so
every unit test behaves identically. If (a) is adopted, the shadow sweep may
surface unrelated findings; that is a reason to land it as its own commit.

## Risks / trade-offs

- **The read-back must stay.** It is what guarantees the response body matches
  the row, per the comments at `products.rs:645-646` and `users.rs:119-121`, and
  it is what makes `createdAt` and the joined `storeName` come from the database
  rather than from the request arguments. Removing it to "save a round trip"
  would be a regression; this proposal only removes the second *acquisition*.
- **A transaction could be argued for instead.** Steps 1–3 reuse the connection
  but do not open an explicit transaction, which preserves today's behaviour
  exactly (each statement autocommits). Wrapping the write and read-back in
  `BEGIN`/`COMMIT` would be a stronger guarantee and is deliberately *not*
  proposed here: it changes locking behaviour on the write path, which is a
  larger decision than a bug fix should smuggle in. Worth raising in review if
  the team wants it, as a separate change.
- **The e2e test needs Docker.** Step 5 belongs to the hermetic E2E suite
  (`pnpm --filter @rnw/api-rs test:e2e`), so it will not run in an environment
  without Docker. It should still be written: it is the check that makes steps
  1–3 verifiable rather than merely plausible. Validation below lists the
  Docker-free checks separately so the change is not blocked on it.
- **`max_connections(1)` in the contract suite (option b) is the tightest
  formulation but may be too tight.** `store/contract.rs` runs against
  `InMemoryStore` too, which has no pool; the assertion has to be
  `SqlProductStore`-only or it asserts nothing on the double. If a
  `max_connections(1)` pool turns out to be too aggressive for some legitimate
  future method, the right answer is to widen it to 2 and document why — not to
  drop the assertion.
- **Enabling `shadow_unrelated` (option a) may be noisy.** It is a `restriction`
  lint precisely because it flags idiomatic shadowing. Landing it as its own
  commit keeps it from blocking the fix, and the `[lints]` section can start with
  it at `warn` and be promoted to `deny` once the codebase is clean.

## Validation

Docker-free, in this order:

1. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` plus
   `cargo clippy --all-targets -- -D warnings` (`api-rs/package.json:10`) stays
   green, confirming no unused binding or type change was introduced.
2. `pnpm --filter @rnw/api-rs typecheck` — green.
3. `pnpm --filter @rnw/api-rs test` (`cargo test --lib`) — green. Proves the
   `InMemoryStore` side and every handler test are unaffected, as expected.
4. **Negative check, in a scratch branch:** revert step 1 only and confirm the
   new `max_connections(1)` contract assertion (option b) fails; re-apply and
   confirm it passes. A test that was never seen red proves nothing.
5. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate
   (`scripts/coverage.sh`) stays green; the change removes lines rather than
   adding uncovered ones, so the ratio should improve slightly.

Requires Docker:

6. `pnpm --filter @rnw/api-rs test:e2e` — green, including the new
   `concurrent_writes_do_not_exhaust_the_pool` and the existing
   `concurrent_registrations_of_one_address_produce_exactly_one_seller`
   (`tests/e2e_auth.rs:140`).
7. **The measurement that justifies the whole change.** Against the compose
   stack with `DB_MAX_CONNECTIONS=10`, drive 10 concurrent `POST
   /my-store/products` with valid tokens and count status codes. Before:
   500s after a 2 s `PoolTimedOut` per request. After: 10 × 201, completing in
   single-digit milliseconds. Then repeat at concurrency 5 and confirm latency
   did not regress. This is the before/after that belongs in the pull request
   body, and it is the number `ARCHITECTURE.md:473`'s
   `Σ DB_MAX_CONNECTIONS` arithmetic was always assuming.
8. Confirm `sqlx_pool_acquire_seconds{pool="primary"}` records exactly one
   observation per write after the change, against two before — the metric
   `ARCHITECTURE.md:218` nominates as the X4 early-warning signal.

Not covered by this change, and named so it is not mistaken for included:
Postgres-side `max_connections`, the read-replica decision, `GLOBAL_CONCURRENCY_LIMIT`'s
value relative to the pool, and the non-atomic `register` (account created, then
session issued — a `create_session` failure leaves an account behind a 500;
recoverable by a subsequent login, and already a documented trade-off at
`ARCHITECTURE.md:82-86`).

## Related proposals

Read across all four lifecycle folders — `todo/` (0 proposals), `in-progress/`
(0 proposals), `implemented/` (19), `rejected/` (0) — plus `improve-proposals/`
and its `implemented/`. **Nothing claims this, and nothing is superseded.**

- **`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md`** —
  related, not superseded; this proposal is a hole in its deliverable, and it
  supplies the enforcement mechanism. It built `store/contract.rs` and
  `store/delegating.rs` precisely so the store layer's invariants stop being
  reviewer knowledge and become assertions, and it noted at `:315` that
  `find_owned_by_id` cross-owner invisibility is asserted for the double. It
  asserts *what the queries return*; nothing anywhere asserts *how many
  connections they take*. Its "What does not improve" section lists
  `config.rs` env-var sprawl and the dead `ProductPatch::is_empty` as out of
  scope — the pool's connection accounting is not in that list, and no
  `DelegatingStore` forwarding line changes here (the trait signatures are
  untouched). Step 4(b) extends its own pattern. If it landed first — and it
  has — its `contract.rs` is where the assertion belongs.
- **`implemented/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md`** —
  related, not superseded; it is the document that makes this arithmetic
  unavoidable. It states `DB_MAX_CONNECTIONS = 10` at `:17` and again at `:429`
  as the pool the shedder exists to protect, and its §2 makes the limiter's
  degradation states countable so an operator can see them. It treats the pool
  as an external budget with a fixed size. This proposal's finding is that the
  service draws two permits per write against that budget, which makes
  `ApiRsPoolAcquireLatency` (`monitoring/rules.yml`) fire for a burst of
  *successful* writes. Its `GLOBAL_CONCURRENCY_LIMIT = 1024` (`config.rs:85`) is
  why nothing sheds first. **It changes no line of `rate_limit.rs`** and its
  `CounterStore` seam, `TRUSTED_PROXY_HEADERS`, and `max_tracked` work are all
  unaffected. Where the two meet: its premise is that the shedder is the
  mitigation for pool exhaustion, and this proposal removes one of the two ways
  that exhaustion is reached by the service's own code.
- **`implemented/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md`**
  — related, not superseded; it fixed *which requests* reach the limiter and
  explicitly left the pool budget alone. Its §7 matrix row and its
  `fallback_service` work change no store method and no acquisition. It is
  cited here for one reason: it is the most recent document to touch
  `app.rs`'s middleware ordering and it correctly declined to grow. This
  proposal does not either.
- **`implemented/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`**
  — related, not superseded, and the two compose. It made every seller write go
  through one `useMutation` seam on the client, and its Impact section is
  about the client react-query cache. This proposal is entirely server-side
  pool accounting for the same three endpoints
  (`my_store.rs:83`, `:109`, `:123`). No shared file. Its validation step 5
  depends on the client seeing a fresh price after a write; if the write itself
  500s under concurrency, that test's scenario is unreachable in production
  while remaining green in the harness — which is why the two are worth landing
  in the same review cycle even though neither blocks the other.
- **`implemented/2026-10-04-04-06-14-the-session-table-has-no-reaper.md`** —
  unrelated surface, cited for one shared precedent. It added
  `delete_expired_for_user` and an index on `"User"."id"`, and it cites
  `DB_MAX_CONNECTIONS = 10` at `:105` for the same "unbounded growth on the
  primary" argument this proposal makes from the other direction. It touches
  `store/sessions.rs`, not `products.rs` or `users.rs`'s write path. Its own
  finding — three files describing a reaper that does not exist — is the same
  failure class as a comment describing a one-permit budget the code does not
  honour.
- **`implemented/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md`**
  — the only other proposal that edits `update_owned`. It changes
  `ProductPatch`'s request semantics at `store/products.rs:574-576` and adds
  presence tracking; its tests call `update_owned` at `:149-150`. **No
  connection handling changes**, and its response bytes stay identical, so its
  goldens and assertions are unaffected by steps 2–3. If it lands first, apply
  this on top: the edit at `:679` is the same line region and the two do not
  conflict textually.
- **`implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`** —
  unrelated surface and, usefully, the reason this went unnoticed. It factored
  the *read* paths onto shared helpers and cites `store/products.rs:457`/`:468`
  calling `acquire_primary()` as evidence about *routing*. Its entire scope is
  reads and cache keys; the three methods that double-acquire issue two
  statements and were never in it. Worth reading alongside this one, because
  the read-path review is exactly what makes the write path look symmetrical.
- **`implemented/2026-10-05-09-13-35-by-ids-issues-one-query-per-id.md`,
  `implemented/2026-10-04-22-05-57-the-metrics-contract-has-no-owner.md`,
  `implemented/2026-10-04-20-11-10-the-list-tiebreaker-depends-on-the-databases-collation.md`,
  `implemented/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md`,
  `implemented/2026-10-05-12-16-01-one-owner-for-the-e2e-fixture-catalogue.md`,
  and the twelve remaining implemented documents** — unrelated surfaces
  (cache keys, metrics names, collation, goldens, fixtures, client cache
  policy, accessibility, design tokens, platform splits, bundler resolution,
  transport, persisted stores, storage fallback, session reaper). No file this
  proposal edits — `store/products.rs:630-686`, `store/users.rs:105-128`,
  `tests/e2e_*.rs`, `ARCHITECTURE.md:216-218`/`:339`/`:472-474` — is edited by
  any of them for this reason.
- **`improve-proposals/` (feature proposals)** — unrelated. The my-store
  proposal created the write path but specifies no connection handling; it
  states the transport and generation decisions this proposal preserves.

**Nothing is superseded.** Steps 1–3 change no query, no response byte, no
status, no header, and no trait signature. The only behavioural change is that
a write stops parking two permits, which is the defect.