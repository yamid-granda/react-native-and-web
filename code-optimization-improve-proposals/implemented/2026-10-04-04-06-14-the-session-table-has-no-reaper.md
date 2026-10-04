# The `Session` table has an index built for a reaper that does not exist

## Problem / opportunity

api-rs has had a write path for sellers since
`improve-proposals/2026-10-03-seller-storefronts-my-store.md` landed. Every
successful `POST /auth/login` and every `POST /auth/register` inserts a row into
`"Session"` and **nothing ever removes it**. There is no reaper, no expiry
sweep, no cap per user, and no `SessionStore` method that could express one. The
table only ever grows.

This is not an inference from reading the handlers. It is checkable, and the
check is in **Validation** step 6. Three independent confirmations:

**1. Nothing in the codebase deletes a session by expiry.** A grep for any
expiry-bounded delete returns nothing but the *comments* that describe one:

```
$ grep -rni 'reap\|sweep\|expiresAt" *<\|expires_at *<' api-rs/src api-rs/tests api-rs/migrations
api-rs/src/cache/singleflight.rs:272:  // Held throughout, so it must survive the sweep.
api-rs/src/cache/singleflight.rs:284:  // The next insert sweeps everything with no holder left behind.
api-rs/src/handlers/auth.rs:570:  /// session: nothing has to sweep the table for correctness.
api-rs/src/store/sessions.rs:31:  /// one would make every reaper sweep mandatory for correctness.
api-rs/migrations/..._create_user_and_session.up.sql:42: -- Backs the expiry sweep that reaps dead sessions; ...
```

Three of those five hits are about the in-process `Singleflight` map, which does
have a prune (`singleflight.rs:48-50`). The other two are the two that matter,
and they are the reason this is a finding rather than a gap someone noticed:

- `api-rs/migrations/20261003120000_create_user_and_session.up.sql:42-44`:
  > `-- Backs the expiry sweep that reaps dead sessions; a plain index because
  > the lookup is "everything already past its expiry", not a point read.`
  > `CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");`

  **An index was shipped, with a comment naming its only consumer, and that
  consumer was never written.** `Session_expiresAt_idx` is currently read by
  zero queries. The only query that touches `expiresAt` is the point read at
  `store/sessions.rs:51`, which filters on `"tokenHash" = $1` and uses the
  primary key.

- `api-rs/src/store/sessions.rs:29-31`, on the `SessionStore` trait:
  > `/// find_valid folds the expiry check into the lookup rather than filtering
  > afterwards: an expired row is not a session, and treating it as one would
  > make every reaper sweep mandatory for correctness.`

  This is a **correct and valuable design decision** — folding expiry into the
  lookup is why no sweep is needed *for correctness*, and
  `tests/e2e_auth.rs:172-194` proves it. But the sentence is written from the
  point of view of a system that *has* a reaper. It names one, twice, and there
  is none. The decision it defends is "no sweep is needed for correctness"; the
  gap is that nobody ever decided whether a sweep is needed for **cost**.

**2. The two deletion paths that do exist both require someone to know a token
hash.** `SessionStore` has exactly three methods
(`store/sessions.rs:28-42`): `find_valid_session`, `create_session`,
`delete_session`. `delete_session` is keyed on `token_hash`
(`sessions.rs:76-83`, `DELETE ... WHERE "tokenHash" = $1`) and is called from
exactly one place: `handlers/auth.rs:131`, on logout. So a row dies only when its
own bearer presents it, or when its `User` is deleted —
`ON DELETE CASCADE` at migration line 39, which the repo notes is not reachable
through any route (`tests/e2e_my_store.rs:449-450`: *"Deleting a seller is not a
route (no account-deletion endpoint is in scope)"*).

**3. Login mints a new row every time, with no per-user bound.**
`handlers/auth.rs:123` calls `issue_token` on every successful login, which
calls `create_session` (`auth.rs:147-158`), and
`handlers/auth.rs:638-660` (`login_issues_a_new_token_each_time`) asserts that
two logins produce two different tokens. That is correct behaviour. The
consequence is that `"Session"` is an append-only log of *login events*, and
`SESSION_TTL_SECS` defaults to 604800 — seven days
(`config.rs:79`, `config.rs:288`) — after which the row is dead weight that
still costs a row, a primary-key entry, a `userId` foreign-key entry and an
`expiresAt` index entry forever.

### Why the cost is real, and why it is the *cheap* half of the problem

This is the service the whole repo is built around being able to scale, and
`ARCHITECTURE.md` §11 ("Trade-offs, stated plainly") lists nine trade-offs it
accepts — stale caches, per-instance stampede protection, non-covering indexes,
`OFFSET 4294967276`. **Session-table growth is not among them**, and it is the
only one on that list that is *unbounded and monotonic*. Everything else on that
list is bounded by a TTL, a pool, or a knob.

The growth rate is also not exotic. `tests/e2e_auth.rs:32-108` shows the
intended shape — register, then log in again, and **both tokens stay valid**
until each is individually logged out (`:76-77`: *"Logging out one of them
leaves the other alone: sessions are rows, and revoking one is not revoking the
account"*). That is a deliberate and defensible multi-device decision. It is
also, taken with no reaper, an unbounded append-only table with **no way to
enumerate a user's live sessions** — so "sign out everywhere" is not expressible
in the current `SessionStore` at all, and neither is "show this seller their
active devices".

Note what is *not* wrong here, because it is easy to overclaim: correctness is
fine. An expired row cannot authenticate (`sessions.rs:51`, asserted at
`e2e_auth.rs:172-194`), so this is **not** a security hole. It is a cost and a
missing-capability finding.

### The cost lands on the resource the architecture says is scarce

Every session query goes to the primary, by design —
`ARCHITECTURE.md:232`: *"Every user and session lookup | **primary** |
Authentication is a question that has to be answered now."* The primary pool is
`DB_MAX_CONNECTIONS` = 10 per instance (`config.rs:68`), and
`ARCHITECTURE.md:428-429` makes budgeting Σ connections against the Postgres
limit an explicit operator responsibility. So the write side of this leak is
contending for exactly the pool with the smallest budget in the service.

And the cleanup cost is *also* on the primary, which is why "just add a
periodic DELETE" is not free — it needs the same treatment as the generation
refresher (below), not a naive `tokio::spawn` in a handler.

## Proposed approach

Keep `find_valid_session`'s expiry folding exactly as it is — it is the right
decision and it is tested. Add the missing half: a bounded way for a row to
leave the table, and a place for that to run that matches how this service
already runs background work.

### 1. One deletion method on the trait

```rust
// api-rs/src/store/sessions.rs — added to SessionStore, beside delete_session
/// Delete every row for `user_id` whose `expiresAt` is in the past.
///
/// Separate from [`SessionStore::delete_session`] on purpose: that one
/// revokes a credential the caller already holds a token for, and this one is
/// the sweep `Session_expiresAt_idx` was created for. Returns the number of
/// rows removed, so the caller can log and count it.
async fn delete_expired_for_user(&self, user_id: &str) -> Result<u64, StoreError>;
```

**Why per-user rather than a global sweep.** A global
`DELETE FROM "Session" WHERE "expiresAt" < now()` is the shape the index comment
implies, and it is the wrong shape here for three reasons:

1. It is a primary-pool write that scans an index nobody sized, on a schedule,
   forever — for a table whose *hot* rows are the recent ones.
2. `ARCHITECTURE.md` §12's rule 1 is *"Never in the request path"*. A global
   sweep has to be triggered by something, and the only things running today
   are request handlers.
3. Per-user gives a natural bound and a natural trigger: a seller who logs in
   again is the moment their dead rows are worth reclaiming, and it is the
   moment `create_session` is already running.

`delete_expired_for_user` is therefore called from `issue_token`
(`handlers/auth.rs:147-158`) **immediately before `create_session`** — one extra
statement on a path that is already a write, on a request that already costs an
argon2 hash for the login case. That is deliberately the cheapest possible
placement: it needs no scheduler, no new config key, and no new background
task, and it degrades to "no-op" if the store errors (the row is already
unusable, so a failed cleanup has no correctness consequence — say that in the
doc comment rather than leaving it implied).

Three impls to update, in dependency order:

- `SqlProductStore` (`sessions.rs:45-84`) — `DELETE FROM "Session" WHERE "userId" = $1 AND "expiresAt" <= $2`, returning `rows_affected()`. The existing `Session_expiresAt_idx` is not what this uses — `"userId"` is, and it has **no index**
  (migration lines 38-44 declare a PK on `"tokenHash"` and an index on
  `"expiresAt"`, nothing on `"userId"`). That is a genuine gap this surfaces,
  and it needs a migration: `CREATE INDEX "Session_userId_idx" ON "Session"("userId")`.
  State it in the proposal rather than letting `EXPLAIN` discover it later.
- `InMemoryStore` (`sessions.rs:87-112`) — `retain` on the map, which makes the
  double's behaviour finally match the trait's semantics.
- `CountingStore` (`handlers/products.rs:549-569`) — one forwarding line, like
  its other two `SessionStore` methods.

**This is why the delegation cleanup should land first.**
`code-optimization-improve-proposals/2026-10-03-22-37-46-make-the-store-contract-executable.md`
step 2 deletes those 19 lines of `CountingStore` forwarding and replaces them
with `DelegatingStore`. Land that first and this step is one line instead of
three; land this first and it is 3 mechanical lines that step 2 deletes. Either
order works. Say which was chosen.

### 2. Bound the live sessions a user can hold

Expiry sweeping alone does not bound the table: a seller who logs in 200 times
in a week holds 200 live rows for 7 days. `login_issues_a_new_token_each_time`
(`auth.rs:638-660`) pins multi-token-per-user as intended behaviour, and that
should stay — but "intended" and "unbounded" are different claims, and today only
the first is written down.

The minimum that makes the claim true is a **stated** bound rather than an
enforced one, and a `SessionStore` method that makes "sign out everywhere"
expressible:

```rust
/// Every live row for `user_id`, newest first. The read half of
/// "sign out everywhere" and of an active-devices list; without it neither is
/// writable, because nothing can enumerate a user's sessions today.
async fn list_sessions(&self, user_id: &str) -> Result<Vec<Session>, StoreError>;
```

Decide the cap explicitly, in the same commit, and write the number into
`api-rs/README.md`'s env table next to `SESSION_TTL_SECS` (`:171`). Two honest
options:

- **Cap by count** (e.g. keep the newest N per user, delete the rest on login).
  Bounded, simple, and it revokes a device the seller is still using — a real
  behaviour change that needs saying out loud.
- **Cap by age only** (the sweep alone) and record that a user *can* hold
  unbounded live sessions within the TTL window.

Either is defensible. What is not defensible is leaving it unwritten, because
the next person to read `login_issues_a_new_token_each_time` will conclude the
unbounded case was chosen on purpose.

`Session` (`sessions.rs:11-14`) already carries `user_id` and `expires_at`, so
`list_sessions` needs no schema change. Note that it must return the hash, never
the token — `Session` has no token field, which is the right shape and should
stay.

### 3. The `Session_expiresAt_idx` question, answered rather than left dangling

Once `delete_expired_for_user` lands, is `Session_expiresAt_idx` earning its
keep? On a per-user delete, no — the query filters on `"userId"`. It becomes a
write cost on an append-only table and a read cost nothing pays.

The honest options, for the reviewer to pick:

- **Keep it** and delete nothing, because the *global* sweep is still the right
  thing to add eventually and the index is already paid for. Then say so in the
  migration's sibling documentation, because a comment that names a consumer
  which does not exist is the actual defect here.
- **Drop it** in a reversible `.down.sql`-paired migration, and change the
  migration comment at `:42-43` to name the query that uses it.

Either way the comment stops describing a system that does not exist. **That is
the cheapest item in this proposal and arguably the most valuable per line**,
because it is the thing that misleads the next reader and the next agent.

### What this deliberately does not do

- **No scheduler, no new background task, no new config key.** The repo already
  runs one (`spawn_generation_refresher`, `cache/mod.rs:122-135`, spawned from
  `main.rs:60`) and the argument for adding a second has not been made. If a
  reviewer wants a true periodic global sweep instead of the login-triggered
  one, that is a legitimate disagreement about `ARCHITECTURE.md` §12 rule 1, and
  it should be argued in review rather than smuggled in here.
- **No change to `find_valid_session`, the 401 contract, or any response body.**
  `tests/e2e_auth.rs` and `tests/parity.rs` must pass byte-identical.
- **No change to the multi-device behaviour itself** — several concurrent
  sessions per seller stays correct. Only its bound becomes explicit.
- **No `expo-secure-store`, no `httpOnly` cookie.** That is
  `ARCHITECTURE.md:468-472`'s recorded follow-up and it is a different decision.

## Impact

**Scalability — the reason this is worth doing.** A monotonic,
never-shrinking table on the primary, in a service whose own architecture
document budgets a 10-connection primary per instance
(`ARCHITECTURE.md:428-429`), becomes one that is bounded by construction. The
growth rate is one row per successful login or registration, and today the only
thing that ever reduces it is a user action (`logout`) or an unreachable
account-deletion route.

**Maintainability / AI-developer cost.** This is the expensive kind of
knowledge, and the shape of it is worth being precise about: **three separate
files describe a reaper that does not exist** — the migration comment
(`:42-43`), the trait doc (`sessions.rs:29-31`), and the test comment
(`e2e_auth.rs:170-171`, *"a row nobody swept still cannot authenticate"*). An
agent asked to "add session expiry cleanup" or "cap sessions per user" will
read all three, find the index, and conclude the work is done. It is the same
failure class as the `stores.rs:90-92` comment that contradicts its own code in
`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
— a comment that outran the implementation and then became load-bearing.

**Testability.** `SessionStore` gains the two methods that make the lifecycle
assertable at all. Today nothing can be written that asks "how many live
sessions does this seller have", because the trait cannot answer it. After this,
`tests/e2e_auth.rs` can assert the actual property — log in three times, wait
out an expiry via a direct `UPDATE` (the technique already used at `:181-185`),
log in again, and assert the row count is 1, not 4.

**Consistency.** `ARCHITECTURE.md` §11 gains the trade-off it currently omits,
in the section whose stated job is stating them.

**Performance.** The sweep is one indexed `DELETE` on a login, on a request
that already runs an argon2 hash — negligible next to the work already on that
path. The `Session_userId_idx` migration adds a write cost per login to remove a
sequential scan per login; with a handful of rows per user that is a wash today
and the wrong trade at 10⁴. The measurable win is not speed, it is that the
table stops growing.

**What does not improve.** Correctness is unchanged and was never broken — an
expired row already cannot authenticate, and `tests/e2e_auth.rs:172-194` proves
it. `ARCHITECTURE.md:232`'s decision to put session lookups on the primary is
deliberate and untouched. The multi-device story is unchanged. And if a reviewer
picks "cap by age only", a seller can still hold unbounded live sessions inside
one TTL window — that is a real residual and belongs in §11 rather than in
silence. Nothing in `web-application`, `mobile-application` or
`components-library` changes, so no frontend suite is evidence either way.

## Risks / trade-offs

- **It deletes rows, which is the one irreversible thing in this proposal.**
  The blast radius is bounded by design — only rows already past `expiresAt` are
  eligible, and such a row already answers 401 (`sessions.rs:51`) — but the
  `.down.sql` for any migration here must be reversible per `AGENTS.md`, and the
  reviewer should confirm the delete predicate is `expiresAt <= now()` and
  **not** `expiresAt < now()` against a clock read twice, or the boundary row
  flickers. One `chrono::Utc::now().naive_utc()` bound to a variable, passed
  once.
- **Capping live sessions per user revokes a device the seller is using.** That
  is a real UX regression for anyone on more than N devices, and it is why the
  cap is called out as an explicit decision rather than a default. Recommend
  documenting it in `api-rs/README.md` in the same commit.
- **A cleanup failure must be non-fatal.** If `delete_expired_for_user` returns
  `Err` from a login, the login must still succeed — the credential it is about
  to mint is unaffected, and failing the request would turn a housekeeping
  problem into an outage. Warn and count (`tracing::warn!` plus a counter, the
  shape `record_redis_error` already uses at `rate_limit.rs:163-166`), do not
  propagate. This is the fail-open posture §7 already mandates and it needs to
  be said in the doc comment or the next reader will "fix" it.
- **A new index on `"userId"` is a schema change**, so it needs a reversible
  migration pair under `api-rs/migrations/` per `AGENTS.md`, and `api-rs-db`
  applies them — the server binary does not (`ARCHITECTURE.md:499-503`). It also
  needs a line in `api-rs/README.md`, because that document is where operators
  look.
- **Ordering with the delegation proposal is a real dependency, not a
  preference.** See step 1.
- **Scope.** `ARCHITECTURE.md:468-472`'s credential-storage follow-up
  (`expo-secure-store` / `httpOnly` cookie), the `"Session"` rows that
  `ON DELETE CASCADE` already handles, `middleware/session.rs`'s single-error
  401 (already correct and already tested at `session.rs:89-96`), and the
  `auth_login_total` metric are all real and all separate. None of them belong
  here.

## Validation

1. `pnpm --filter @rnw/api-rs test` — the cheapest gate. All existing suites
   pass **unchanged**. Specifically watch `handlers/auth.rs`'s
   `logout_revokes_the_token_immediately_and_twice_is_still_a_204` (`:597-625`),
   which is the test most likely to notice a delete that deletes too much, and
   `an_expired_session_is_rejected` (`:571-595`).
2. **The property test, in `api-rs/tests/e2e_auth.rs`** (needs Docker; add
   `--test e2e_auth` is already in `package.json:13`'s `test:e2e` list, so no
   script change is needed):
   - register, then log in three times → three live rows (assert via
     `SELECT COUNT(*) FROM "Session" WHERE "userId" = $1`);
   - `UPDATE "Session" SET "expiresAt" = now() - 1 day` — the technique already
     proven at `:181-185`;
   - log in again → the count is back to 1, not 4.
   This is red before the change and green after, and it is the whole finding in
   one assertion.
3. **Negative check**, in a scratch branch: make `delete_expired_for_user` a
   no-op returning `Ok(0)` and confirm step 2's assertion fails. If it passes,
   the test is not asserting the thing this proposal is about.
4. **Fail-open check**, also in a scratch branch: make
   `delete_expired_for_user` return `Err` and confirm `POST /auth/login` still
   returns 200 with a working token. This is the assertion that keeps the
   fail-open rule from being "fixed" later.
5. `pnpm --filter @rnw/api-rs test:e2e` (needs Docker) — `tests/parity.rs`
   byte-compares committed goldens and none of them is an auth response, so it
   must pass untouched; that is the check that no response body moved.
   `tests/e2e_my_store.rs` proves the seller flows, including the cascade
   assertion at `:472-479`, which is the one place `ON DELETE CASCADE` is
   exercised and must keep working.
6. **Mechanical check of the central claim, before and after** — this is the
   command that shows the reaper does not exist, and it should return only
   comments before the change and a real `DELETE` after:
   ```bash
   grep -rni 'reap\|sweep\|expiresAt" *<=\|expires_at *<=' \
     api-rs/src api-rs/tests api-rs/migrations
   ```
   Success is not "zero hits" — it is that every remaining hit is a comment or
   is about `singleflight.rs`'s in-process prune, and that
   `grep -rn 'Session_expiresAt_idx\|Session_userId_idx' api-rs/migrations`
   names an index whose comment describes a query that exists.
7. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings`. The new trait method touches
   three impls and the `rows_affected()` return type is clippy-relevant.
8. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate must still pass.
   Expect it to *rise* slightly: the new `SqlProductStore` and `InMemoryStore`
   bodies are covered by step 2, and the `CountingStore` forward is not new
   uncovered surface.
9. **Measurable, and honestly optional**: with a seeded database, count rows in
   `"Session"` before and after N logins past an expiry. Success is that the
   count stops tracking the number of logins. This is a `psql` query, not a
   commit-worthy test.
10. **Not required, and honestly so**: nothing here touches `web-application`,
    `mobile-application` or `components-library`. No frontend suite is evidence,
    and `pnpm --filter @rnw/mobile-application test:e2e` (which needs a native
    build and a simulator regardless) is doubly irrelevant to a server-side
    table.

## Related proposals

- **`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  — related, not superseded, and it is the only document that mentions this
  problem.** Its Risks section closes with a scope note at `:389` listing three
  things it deliberately does not touch: *"The probe-before-cache at
  `stores.rs:63`, the `Session`-table growth in `auth`, and the
  `iter().cloned()`-equivalent patterns elsewhere in `store/products.rs` are
  separate problems with separate designs. This proposal does not touch them and
  should not grow to."* **That one clause is the entire prior art for this
  document.** It names the problem, scopes it out, and proposes nothing — which
  is a deferral, not a proposal. This document is the first analysis of it.
  Surface overlap is nil: that proposal is `api-rs/src/handlers/` read paths and
  cache keys, this is `api-rs/src/store/sessions.rs` and the `Session` table.
- **`code-optimization-improve-proposals/2026-10-03-22-37-46-make-the-store-contract-executable.md`
  — related, not superseded, with an ordering dependency.** It is about
  `api-rs/src/store/` and claims `SessionStore` as one of its three traits,
  including `CountingStore`'s 19 forwarding lines at `handlers/products.rs:549-569`
  that step 1 of this proposal also touches. Land its step 2 first and this
  proposal's `CountingStore` edit is one line instead of three. Its own
  "What does not improve" (`:365-367`) says `store/sessions.rs` "still has no
  tests of its own" — true, and unchanged by this proposal, which adds
  lifecycle methods rather than trait-level assertions. Its `DelegatingStore`
  does mean the new method needs no forwarding boilerplate in any *future* spy.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md` — related,
  not superseded; this is the proposal that created the gap.** Its §1
  (`:59`) specifies the `"Session"` table *and* `an index on ("expiresAt")`
  without ever naming a consumer for it, and its Verification section (`:275`)
  lists logout-revokes-immediately and expired-token-rejection but no cleanup
  case. Its §7 states the client's storage limitation is recorded rather than
  discovered — the same standard this proposal holds the server's index comment
  to. It does not reopen anything else in it: transport duplication stays
  (`:172`), the generation counter stays (§4), the 404-not-403 rule stays.
- **`code-optimization-improve-proposals/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`,
  `…-2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`,
  `…-2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`,
  `…-2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`,
  `…-2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — unrelated surfaces** (client react-query cache, persisted zustand stores,
  platform splits, bundler config, per-app route files). None touches
  `api-rs/src/store/sessions.rs` or the `"Session"` table. Their `useSessionStore`
  and `SessionGate` references are the *client* half of the same feature and are
  untouched by this proposal.
- **`improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`
  — unrelated, with one shared precedent.** It is the api-rs scale-gap pass and
  does not mention sessions (it predates them). Its relevance is only
  methodological: it is the document that established this repo's habit of
  naming a deferred cost in `ARCHITECTURE.md` rather than leaving it implicit,
  which is what step 3 of this proposal extends to the table §11 currently
  omits.
