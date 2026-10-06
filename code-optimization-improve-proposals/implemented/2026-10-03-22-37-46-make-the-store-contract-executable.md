# Make api-rs's store contract executable instead of hand-maintained

## Problem / opportunity

`api-rs` stores everything behind three traits — `ProductStore`
(`api-rs/src/store/products.rs:94-130`), `UserStore`
(`api-rs/src/store/users.rs:79-85`) and `SessionStore`
(`api-rs/src/store/sessions.rs:27-42`) — and gives each of them **three
hand-written implementations**. Nothing ties them together. The compiler checks
that each impl has the right *shape*; it cannot check that they mean the same
thing, and no test asserts that they do.

Measured, from the `impl` blocks themselves (spans are the blocks; the line count
is method bodies only):

| Trait | production — `SqlProductStore` | double — `InMemoryStore` | spy — `CountingStore` |
| --- | --- | --- | --- |
| `ProductStore` | `store/products.rs:430-567` (136) | `store/memory.rs:77-190` (112) | `handlers/products.rs:445-518` (72) |
| `UserStore` | `store/users.rs:88-129` (40) | `store/users.rs:145-173` (27) | `handlers/products.rs:525-546` (20) |
| `SessionStore` | `store/sessions.rs:45-84` (38) | `store/sessions.rs:87-112` (24) | `handlers/products.rs:549-569` (19) |
| **total** | **214** | **163** | **111** |

488 lines of method bodies for three traits. 274 of them exist only under
`#[cfg(test)]`, and `scripts/coverage.sh` runs `cargo llvm-cov --workspace
--fail-under-lines 80` with no exclusions, so those 274 lines sit in the
denominator of the 80% gate — and are covered by tests that *use* the double.

Four consequences follow, in increasing order of how much they cost.

### 1. Adding a store method is a three-site edit, two of them pure ceremony

`CountingStore`'s 111 lines are, in every one of its 16 methods, exactly one
`self.inner.…(…).await`. Twelve of them are nothing else at all: the six
owner-scoped and write-path `ProductStore` methods at
`handlers/products.rs:477-517` (41 lines), `UserStore` at `:525-546` (20) and
`SessionStore` at `:549-569` (19) — **80 lines that forward and do nothing
else**. The four instrumented methods add a counter, a 30 ms sleep and two
failure switches (`:446-472`).

Those 80 lines are not a design choice. They are forced by the shape of
`MarketplaceStore`, a blanket supertrait over all three
(`store/products.rs:137-150`), which `AppState` holds as one
`Arc<dyn MarketplaceStore>`. The code says so itself:

```rust
// handlers/products.rs:520-523
/// The read-path tests above never touch identity, so these two are plain
/// pass-throughs to the in-memory store's own maps. They exist only because
/// `AppState` holds one `Arc<dyn MarketplaceStore>` rather than three
/// handles.
```

So the compiler does catch a new `ProductStore` method — in three places at
once — and the author then hand-writes ~30 lines of no-content forwarding, twice,
to get back to green. Every store method the queued feature work needs
(`improve-proposals/2026-09-29-product-ratings-and-reviews.md`,
`…-order-history.md`, `…-15-22-coupon-discount-codes.md` are all writes) pays
that toll before it pays any of its own cost.

### 2. The double cannot fail, so `/health`'s error path has no unit test

`grep -c "Err(" api-rs/src/store/memory.rs` returns **0**. All ten `ProductStore`
methods and every inline helper are infallible, and `store/sessions.rs:87-112`
likewise contains no `Err`. `ping()` in particular:

```rust
// store/memory.rs:187-189
async fn ping(&self) -> Result<(), StoreError> {
    Ok(())
}
```

That matters because every router-level unit test in the crate runs against the
double. `app.rs:197-199` is the shared `test_state()`, and it is the `AppState`
behind `handlers/auth.rs:332`, `handlers/auth.rs:574`,
`handlers/my_store.rs:244` and `handlers/products.rs:404` — 50 unit tests across
`auth.rs` (18), `my_store.rs` (17) and `products.rs` (15), plus `app.rs`'s 8.
`InMemoryStore` is not a convenience; outside Docker it **is** api-rs's test
environment.

So both down branches of the health handler are unreachable from a unit test:

```rust
// handlers/health.rs:67-74
Ok(Err(error)) => { /* … */ down_body(error.to_string(), response_time) }
Err(_elapsed)  => { /* … */ down_body(format!("timeout of {}ms exceeded", …), …) }
```

`health.rs`'s only two tests (`:98`, `:113`) test body *constructors*. The sole
coverage of the branch itself is `tests/e2e_products.rs:123-143`, which is
Docker-gated. Eight lines of timeout-and-failure handling — the code a
load-balancer readiness probe depends on — are verifiable only with Docker.

The fix for this already exists in the repo, in the wrong place.
`CountingStore` carries two failure switches:

```rust
// handlers/products.rs:424-425, used at :450-452 and :458-460
fail_list: Arc<AtomicBool>,
fail_count: Arc<AtomicBool>,
// Consumed on use, so only the first attempt fails.
```

That mechanism is proven and it is about fifteen lines. It is private to one
handler's test module, so `health.rs` — or any future handler — cannot reach
it. Hoisting it onto `InMemoryStore` is the whole of this item.

### 3. The two implementations already disagree about documented semantics, in four places

**(a) `store_name` is a read-time join in production and a write-time snapshot in
the double.** All four production statements derive it with a `LEFT JOIN` —
`store/products.rs:195`, `:201`, `:206`, `:208` — and
`store/products.rs:39-41` documents that as the design. The double instead copies
it out of the users map once, at insert:

```rust
// store/memory.rs:119-136 (abridged)
// Mirrors the store name the SQL path gets from its LEFT JOIN.
let store_name = self.users().lock()… .map(|record| record.user.store_name.clone());
```

`update_owned` (`memory.rs:144-177`) never refreshes it. So "the store name on a
product" is a *derived* value in production and *stored* state in the double,
and the two answers diverge the moment a seller renames.

This is **latent, not live**: `handlers/auth.rs` exposes register, login, me and
logout and nothing that renames, so nothing can change a store name yet. The
problem is that the double is being kept warm for a field it models wrongly, and
its own fixture bakes the wrong model in: `memory.rs:206-219`'s `owned()` stamps
a `store_name` onto a product whose owner has **no `UserRecord` in the store at
all**, and `store()` at `:236-242` builds on that. `memory.rs:249` and `:287`
then assert against a state the real store cannot be in. Note that
`handlers/my_store.rs:242-268` gets this right — it calls `create_user` before
creating products — so the two test suites disagree about whether an owner has a
row.

**(b) A duplicate `id` on registration has two different wrong answers.** The
production path maps *any* unique violation to `EmailTaken`
(`store/users.rs:115-117` → `classify_insert:134-142`), so a primary-key
collision answers 409 "Email already registered". The double checks only the
email (`users.rs:158-160`) and then:

```rust
// store/users.rs:167-170
users.insert(
    user.id.clone(),
    UserRecord { user: user.clone(), password_hash: new_user.password_hash },
);
Ok(user)
```

`HashMap::insert` **replaces**, so the double returns 201 and has just destroyed
an existing seller's `storeName` and password hash. Also latent — ids come from
`opaque_id("usr_")` (`handlers/auth.rs:91`), so a collision is not reachable.

**(c) They disagree about what a bad `offset`/`limit` means.** The double clamps
(`memory.rs:56-60`, `offset.max(0)` / `limit.max(0)`); production binds the
values straight into `LIMIT`/`OFFSET` (`store/products.rs:434`). Unreachable
today only because `prisma_offset` (`handlers/products.rs:115-127`) guarantees
`offset >= 0`.

**(d) `created_at` comes from different clocks.** `store/users.rs:119-127` reads
the column back so the 201 body and every later read agree — the comment at
`:119-121` says exactly why — while `users.rs:165` stamps `Utc::now()`.

None of (a)–(d) is a production bug today. All four are places where a unit test
green on the double can be describing behaviour the service does not have, which
is the exact failure mode a second implementation invites: the fake agrees with
itself.

### 4. The committed Criterion baselines measure the double, not the service

`benches/handlers.rs:39` builds 50,000 products into an `InMemoryStore`, so
`list-page-cache-miss-50k` (`:65-70`) times `rows()`:

```rust
// store/memory.rs:45-54
let mut rows: Vec<Product> = products.iter().filter(…).cloned().collect();  // :50
sort_by_contract(&mut rows);                                                  // :52
```

which `.cloned()`-copies **every matching row** — 50,000 `Product`s, five
`String`s each — and re-sorts them, before `slice()` (`:79`) keeps 20. The number
is dominated by that copy. It measures no cache key, no singleflight, no query,
and not `sqlx_pool_acquire_seconds` (`store/products.rs:416`), which is the
metric the architecture actually gates on.
`improve-proposals/implemented/2026-10-01-marketplace-api-high-traffic-performance.md:490`
puts a `critcmp` regression gate in CI for changes under `src/store/` and
`src/handlers/`, so today that gate watches a re-sorting `Vec` clone. The bench
is not wrong to exist; its name over-promises.

### 5. The production store has no trait-level tests at all

`store/products.rs`'s test module (`:569-700`) contains eight tests:
`product_ids_are_unique_and_prefixed`, `an_empty_patch_changes_nothing`, and
six pool-bootstrap tests. **Zero** of them exercise the 139-line
`impl ProductStore for SqlProductStore` above them. `store/users.rs:175-197` has
two, neither touching a query. `store/sessions.rs` has **none** — and the
expiry-folding invariant its own doc comment calls out
(`store/sessions.rs:29-31`) is asserted nowhere at the trait level.

Meanwhile `ProductPatch::is_empty` (`store/products.rs:67-75`) is dead in
production: its only callers are its own two assertions at `:585-586`.

The asymmetry is the tell. 274 lines of double are tested by using them; 214
lines of the real thing are tested only through Docker-gated HTTP.

## Proposed approach

Keep the three traits, keep `SqlProductStore` as-is, keep `InMemoryStore`. Three
changes, in this order, each independently landable.

### 1. Hoist the failure switches onto `InMemoryStore`

Move the mechanism that already exists at `handlers/products.rs:424-425` /
`:450-452` / `:458-460` out of that handler's test module and onto the shared
double, so any handler can reach it:

```rust
// api-rs/src/store/memory.rs
pub enum StoreOp { Products, Count, Product, Ping, Users, Sessions }

impl InMemoryStore {
    /// Fail the next call to `op`. Consumed on use, so a test can make exactly
    /// one attempt fail — the same one-shot semantics `CountingStore` relies on.
    pub fn fail_once(&self, op: StoreOp) { … }
    /// Fail every call to `op`, and never time out. For `ping` this is what makes
    /// `/health`'s timeout arm reachable without a hung socket.
    pub fn fail_always(&self, op: StoreOp) { … }
}
```

`ping()` (`:187-189`) becomes a real query result instead of `Ok(())`.

`CountingStore` keeps its counters but loses its two failure switches and
delegates those to the double — one fewer place where the same idea is written.

This alone buys the two missing `/health` tests, with no Docker and no new
mechanism:

```rust
// handlers/health.rs, new tests
// down when the store errors
// down when the store hangs past health_ping_timeout_ms
```

The timeout arm needs the future to not resolve. `fail_always` alone will not do
it; give the fake an explicit `hang` variant, or assert the error arm only and say
plainly that the timeout arm stays Docker-only. Do not fake a hang with a sleep
longer than the test — that is a slow test, not a proof.

### 2. One reusable delegating wrapper, so a spy overrides only what it spies on

New `api-rs/src/store/delegating.rs`:

```rust
#[derive(Clone)]
pub struct DelegatingStore(Arc<dyn MarketplaceStore>);

#[async_trait]
impl ProductStore for DelegatingStore { /* one-line forwards */ }
#[async_trait]
impl UserStore for DelegatingStore     { /* … */ }
#[async_trait]
impl SessionStore for DelegatingStore  { /* … */ }
```

`CountingStore` becomes `struct CountingStore { inner: DelegatingStore, counters }`
and implements **only** `ProductStore`. Its 39 lines of `UserStore` +
`SessionStore` forwarding (`handlers/products.rs:525-546`, `:549-569`) are
deleted, and adding a `UserStore` or `SessionStore` method costs zero edits in
that module from then on. A new spy — including the one
`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
step 6 calls for in `stores.rs` — composes `DelegatingStore` instead of copying
111 lines. Land this **before** that proposal's step 6, or it will copy the
boilerplate a second time.

> **Corrected by `2026-10-05-23-55-37-one-owner-for-the-store-test-double`.** Three
> claims above did not hold, and two of them are why the residue existed:
>
> - **`CountingStore` kept its `UserStore` and `SessionStore` impls.** The 39 lines
>   were not deleted. `Arc<dyn MarketplaceStore>` is what a spy is *stored as*, and
>   Rust has no partial trait impl, so the spy owes all three traits whatever it
>   composes. Composing `DelegatingStore` moves where the forwards are written; it
>   does not remove them from the spy. This proposal's own step 6 went on to copy
>   129 lines in `stores.rs` for that reason.
> - **"Costs zero edits in that module" was false**, for the same reason. The
>   forwards cost one edit in `DelegatingStore`; the spy still grew a method of its
>   own. Machine evidence in the repository: `bd01f17` added `list_sessions` and
>   `delete_expired_for_user` three hours after `DelegatingStore` landed and had to
>   hand-edit the spy.
> - **The ordering instruction was not followed.** Step 6 of
>   `2026-10-03-22-34-46-one-read-path-for-the-product-lists.md` shipped in
>   `stores.rs` without this landing first. That proposal picked up the residue:
>   `DelegatingStore` is now `store/testdouble.rs` and carries one shared
>   `CountingStore` that both handler suites use, so there is one copy of the
>   forwards rather than three.

The 6 pass-through `ProductStore` methods at `:477-517` are harder to remove
without a partial trait impl, which Rust does not have. Leave them, and let the
compiler keep naming the site — that part is honest and cheap.

### 3. A store contract suite, run against both implementations

New `api-rs/src/store/contract.rs`, holding `async fn` assertions that any
`ProductStore` / `UserStore` / `SessionStore` must satisfy:

```rust
pub async fn assert_product_store_contract<S: ProductStore + ?Sized>(store: &S) { … }
pub async fn assert_user_store_contract<S: UserStore + ?Sized>(store: &S) { … }
```

Called twice: from `store/memory.rs`'s tests (fast, no Docker, under
`cargo test --lib`) and from `tests/e2e_products.rs` against `SqlProductStore`
(Docker). Same assertions, two implementations, so a divergence becomes a red
build instead of a reading.

The suite starts with the four cases above, because a contract that documents a
divergence is worse than no contract:

1. `ping` can return `Err` — and `/health`'s two down arms become unit-testable.
2. Registering an already-registered email returns `Err(StoreError::EmailTaken)`
   **and leaves the existing row byte-identical**. Four lines, and it fails today
   against `users.rs:167-170`.
3. `store_name` on a returned product reflects the **current** seller record.
   This one cannot pass until `memory.rs:120-136` stops snapshotting *and*
   `owned()` (`:206-219`) inserts a real `UserRecord`. That is the honest cost of
   the contract: it forces the double's fixtures to model the schema they claim
   to. Fixing it is also what makes the double correct for the rename endpoint
   that will eventually land.
4. `list_page` / `list_owned_page` state one answer for `offset = 0`,
   `offset` past the end, and `limit <= 0`. Pick the production answer and make
   `memory.rs:56-60` stop clamping.

Then move the assertions that already exist but only run once:
`find_owned_by_id` returning `None` for another owner is asserted for the double
at `memory.rs:261-271` and for nothing else — the contract suite asserts it for
`SqlProductStore` too, which is where a real regression in
`store/products.rs:476-488` would show up.

Sequencing: 1 and 2 are mechanical and safe; 3 is the substantive one and should
land as its own commit so a reviewer can reject the `store_name` decision without
losing the delegation cleanup.

### 4. Rename the bench, do not redesign it

`list-page-cache-miss-50k` (`benches/handlers.rs:65`) → something that says what
it times. Either drop the 50k count to something that does not clone the whole
catalogue per iteration, or rename it to `list-page-in-memory-store-cache-miss`
and add one line saying it exercises the double's `rows()` and not a query. The
existing proposal's validation step 6 says to run `pnpm --filter @rnw/api-rs
bench` before and after its refactor; that number should mean something.

## Impact

**Maintainability and AI-developer cost.** A store method goes from a
three-site edit to a two-site one, and the third site stops being hand-written
ceremony. More importantly, item 3 converts "these two implementations are
supposed to agree" from something a reviewer has to hold in their head to
something CI checks. That is the expensive kind of knowledge for an agent: it is
distributed across two files, it is only partly written down, and nothing fails
when it stops being true.

**Testability.** The measurable gain is `/health`. `handlers/health.rs:67-74` goes
from Docker-only to `cargo test --lib`, using a mechanism the repo already
proves at `handlers/products.rs:450-452`. The structural gain is that
`SqlProductStore`'s 214 lines get their first trait-level assertions, written
once and run against both implementations.

**Consistency.** Four documented-semantics disagreements (a–d) stop being
disagreements. Today they are invisible because the two impls never meet; after
this they are four assertions.

**Reuse.** 39 of `CountingStore`'s 111 lines are deleted outright, and the next
spy written for any handler gets them for free.

**Performance.** None, deliberately, with two honest exceptions. Nothing here
touches a request path, a query, or a cache. Separately, item 4 removes a
misleading number from the benchmark suite rather than a bottleneck from the
service — the real per-request costs are the ones the concurrent
`…one-read-path-for-the-product-lists.md` proposal is already measuring.

**What does not improve.** `SqlProductStore`'s SQL is still unverified without
Docker — the contract suite runs under `test:e2e`, not `pnpm --filter
@rnw/api-rs test`, and it asserts trait semantics, not query plans or index
usage. `store/sessions.rs` still has no tests of its own; the contract suite
asserts `find_valid_session`'s expiry folding against both impls but adds no
session-specific coverage. The 80% gate still includes the double's lines, since
`InMemoryStore` is real library code under `lib.rs:11`. And nothing here makes
the double faster — item 4 only stops the benchmark from claiming to measure it.

## Risks / trade-offs

- **This contradicts a deliberate decision, and that is the main thing to
  adjudicate.** `improve-proposals/2026-10-03-seller-storefronts-my-store.md:75`
  says: *"`InMemoryStore` (`api-rs/src/store/memory.rs`) needs in-memory
  equivalents for handler unit tests, exactly as it does for products."* This
  proposal does **not** remove the in-memory equivalents — it agrees they are
  needed and argues that a hand-written second implementation is the expensive
  way to keep them honest. If a reviewer reads "delete the fake", the proposal
  dies on framing; the diff has to show the equivalents staying and gaining the
  ability to fail.
- **Contract item 3(c) changes the double's fixtures, which changes what existing
  tests assert.** `store/memory.rs:249` and `:287` currently assert a
  `store_name` for an owner with no user row; making the fixture honest means
  those two assertions change. That is the point, and it is also the part most
  likely to draw a "you are changing tests to fit the code" objection. The answer
  is that the *production* behaviour is the reference — `store/products.rs:195`
  joins, `memory.rs:120` snapshots, and one of them is wrong — but the reviewer
  should be told which way the argument runs before reading the diff.
- **`DelegatingStore` is 40 lines of forwarding that replace 39 lines of
  forwarding.** The win is not line count; it is that the forwarding exists once,
  outside any handler's test module, and is inherited by every future spy. If the
  reviewer wants the honest version of that trade, the justification has to be
  reuse, not size — and if the next spy is never written, the change was
  premature.
- **`Arc<dyn MarketplaceStore>` in `AppState` is not being changed.** Splitting it
  into three handles would delete the boilerplate at the source, and
  `store/products.rs:132-136` explains why one handle is right (one pool; each
  method picks its own pool). Reopening that is a larger architectural change
  than this proposal is, and it is deliberately left alone.
- **A contract suite can ossify the wrong behaviour.** If item 3 pins the double
  to today's clamping or today's snapshot semantics, it makes the bug permanent.
  Every assertion added must be one the reviewer would want both implementations
  to hold in two years.
- **Scope.** The api-rs `config.rs` env-var sprawl, the dead `ProductPatch::is_empty`
  (`:67-75`, callers only at `:585-586`), `cache/l1.rs` and `cache/l2.rs` having
  no test modules at all, and the `products:detail:` key literal shared between
  `handlers/products.rs:181` and `cache/mod.rs:158` are all real and all
  separate. The last of those is already claimed by
  `…one-read-path-for-the-product-lists.md` finding 4. None of them belong here.

## Validation

1. `pnpm --filter @rnw/api-rs test` (`cargo test --lib`) — the cheapest gate and
   the one that proves the point. Must pass with the 111-line `CountingStore`
   reduced and `InMemoryStore` able to fail. Specifically watch
   `handlers/products.rs`'s six stampede tests, which are the reason
   `fail_once` must keep one-shot semantics — if `:450-452`'s behaviour changes,
   they fail.
2. The two new `handlers/health.rs` tests, run alone, with no Docker daemon
   running. That is the proof of item 1: before it, they cannot be written.
3. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings`. The delegation newtype and the
   `fail_*` API are both clippy-relevant.
4. `pnpm --filter @rnw/api-rs test:e2e` — needs Docker. `tests/parity.rs`
   byte-compares committed goldens, so it is the check that no response body
   moved; run it first. Then the contract suite's assertions against
   `SqlProductStore`, including `find_owned_by_id` cross-owner invisibility,
   which nothing asserts today.
5. `pnpm --filter @rnw/api-rs coverage` — the 80% gate must still pass. Expect
   it to *rise* slightly: the deleted 39 forwarding lines leave the denominator,
   and the new contract and failure-path lines are covered.
6. Negative check, the one that matters for item 2: add a method to
   `UserStore` in a scratch branch and confirm the compiler reports **one**
   error site (`store/users.rs` plus the production impl) and not three. That is
   the whole claim about delegation, stated as a command.
7. Negative check for item 3: in a scratch branch, break `store/products.rs`'s
   `store_name` mapping and confirm the contract suite fails. If it passes, the
   suite is not actually asserting anything.
8. `pnpm --filter @rnw/api-rs bench` before and after, for the rename only — the
   number should not move, and that is the point of item 4.
9. Not required, and honestly so: nothing in `api-rs/src/store/` is reachable
   from a web or mobile suite, so no frontend check applies.

## Related proposals

- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md`** — **related,
  not superseded.** Its §"API" at line 75 is the decision this proposal
  qualifies: the in-memory equivalents stay, and the argument is that a
  hand-written second implementation of every trait is the expensive way to
  maintain them. It also lists `api-rs/src/store/mod.rs` and
  `store/memory.rs` among files to edit (`:221`) — those are the files this one
  changes most.
- **`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`**
  — **orthogonal, and there is an ordering dependency.** That proposal is about
  `api-rs/src/handlers/`; this one is about `api-rs/src/store/`. It does not
  mention `memory.rs`, `users.rs`, `sessions.rs`, or the double, and it does not
  claim the store layer. But its step 6 says `stores.rs` should gain tests
  "using the same counting-store approach (`products.rs:417-518`)" — so item 2
  here should land **first**, or that step copies 111 lines of boilerplate a
  second time. Its finding 4 is the `products:detail:` key literal, which I had
  independently flagged and am dropping: `handlers/products.rs:181` and
  `cache/mod.rs:158` are its to fix, with `detail_key(id)`.
- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`**
  — unrelated surface (frontend route files). Its one api-rs mention is the
  client-side `["product", id]` query key. No overlap.
- **`improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`**
  — **related, not superseded, and partly a precedent for this shape.** Its item
  1 specified singleflight with "handler tests in `handlers/products.rs` using
  `InMemoryStore` wrapped in a counting store" (`:354`), which is exactly the
  third implementation this proposal says should not be hand-written again — the
  next such wrapper should compose `DelegatingStore`. Its "Key files/areas"
  lists `store/memory.rs (trait signature change)` (`:332`), i.e. it touched the
  double only to keep the trait satisfied. It predates `store/users.rs` and
  `store/sessions.rs`, so it could not have seen three traits × three
  implementations. Its item 2.3 read-replica work is untouched here.
- **`improve-proposals/implemented/2026-10-01-marketplace-api-high-traffic-performance.md`**
  — the Rust rewrite. Its `:490` "critcmp diff runs in CI when `src/store/` or
  `src/handlers/` change" is the regression gate item 4 is about; this proposal
  does not change what CI runs, only what one of its numbers means.
