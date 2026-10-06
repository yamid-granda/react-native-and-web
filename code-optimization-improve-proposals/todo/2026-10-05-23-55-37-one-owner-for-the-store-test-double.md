# One owner for the store test double, and four places that claim it already has one

## Problem / opportunity

`api-rs` has one `AppState`, one store trait object, and **two** hand-written
copies of the same ~240-line test apparatus. `store/delegating.rs` was written to
collapse that duplication, its doc comment says it did, and **two shipped proposal
records repeat the claim — and it is false.** The reason it is false is that
`MarketplaceStore` is a supertrait, so a spy cannot forward "for free"; the cost
was paid four hours after `DelegatingStore` landed, and is still being paid.

Every claim below is checkable with `grep`, `diff` and two `git log` commands.

### 1. The root cause is one trait object, and the code says so in three places

```rust
// api-rs/src/app.rs:27-30
    /// Products, users and sessions behind one trait object. One `Arc`, one
    /// pool, and each store method decides for itself whether a replica is safe
    /// to answer it.
    pub store: Arc<dyn MarketplaceStore>,
```

`MarketplaceStore` is an **empty marker supertrait** with a blanket impl:

```rust
// api-rs/src/store/products.rs:209-212
pub trait MarketplaceStore:
    ProductStore + super::users::UserStore + super::sessions::SessionStore + Send + Sync + 'static
{
}
```

Rust has no partial trait impl, and `products.rs:214-218` blanket-impls the marker
for anything holding all three. So anything passed as `Arc<dyn MarketplaceStore>` —
which is every test double — must implement `ProductStore` **and** `UserStore`
**and** `SessionStore`. A spy that only instruments product reads must still
hand-write 3 user methods and 5 session methods.

The repository names this cause itself, in three separate places, and fixes it in
none of them:

- `api-rs/src/store/delegating.rs:14-15` — "`AppState` holds one `Arc<dyn
  MarketplaceStore>` rather than three handles, so a test double that cares about
  one method still has to satisfy all three traits."
- `api-rs/src/handlers/products.rs:796-797` — "`AppState` holds one `Arc<dyn
  MarketplaceStore>` rather than three handles, so `CountingStore` still has to be
  a `UserStore` and a `SessionStore`."
- `api-rs/src/handlers/stores.rs:278-280` — "They exist only because `AppState`
  holds one `Arc<dyn MarketplaceStore>` rather than three handles."

`stores.rs:278-280` is a near-verbatim restatement of `delegating.rs:14-15`. The
module that was created to answer that sentence quotes it as its own excuse.

### 2. `DelegatingStore` cannot fix this, and its doc says it can

`api-rs/src/store/delegating.rs` is 149 lines: the same 13 `ProductStore` forwards
(`:36-105`), 3 `UserStore` forwards (`:110-120`) and 5 `SessionStore` forwards
(`:125-148`). It was added by `b99d836` ("make the store contract executable
instead of hand-maintained", 2026-10-04 12:53). Its doc states the benefit:

```rust
// api-rs/src/store/delegating.rs:21-24
    /// Composing this instead means a spy overrides one method and nothing else, and
    /// a new trait method costs zero edits in it. The forwards below are the same
    /// forwards `CountingStore` used to own; they are just not owned by a handler's
    /// test module any more.
```

**"a new trait method costs zero edits in it" is false**, because the *spy* is
what has to satisfy `MarketplaceStore`, not `DelegatingStore`. Composing it does
not remove the spy's three impl blocks; it only changes what `self.inner` points
at. `handlers/products.rs:796-799` concedes this in the same breath and then
contradicts itself:

```rust
// api-rs/src/handlers/products.rs:796-799
    // `AppState` holds one `Arc<dyn MarketplaceStore>` rather than three handles,
    // so `CountingStore` still has to be a `UserStore` and a `SessionStore` —
    // but it forwards them instead of writing them, which is the 39 lines that
    // used to live here.
```

They are still here. `products.rs:800-856` is 57 lines today, and the sentence
claims 39 lines *used to live here* — i.e. it asserts they were deleted from a
block that was never deleted.

### 3. The cost was proven real, four hours later, by machine

```
$ git log --oneline --date=iso b99d836 -1
b99d836 2026-10-04 12:53:24 -0500 refactor(api-rs): make the store contract executable instead of hand-maintained
$ git log --oneline --date=iso bd01f17 -1
bd01f17 2026-10-04 16:48:55 -0500 fix(api-rs): reclaim expired session rows when a seller logs in
$ git merge-base --is-ancestor b99d836 bd01f17 && echo YES
YES
$ git show bd01f17 -- api-rs/src/handlers/products.rs | grep '^+' | grep list_sessions
+        async fn list_sessions(
```

`bd01f17` added `list_sessions` and `delete_expired_for_user` to `SessionStore`.
`DelegatingStore` already existed. The commit still had to hand-edit the spy, and
those two methods are at `products.rs:846-855` today. **That is the "zero edits"
claim, falsified by the repository's own history, 3h55m after it was written.**

### 4. `handlers/stores.rs` never adopted it at all, and wrote the forwards twice over

`handlers/stores.rs:145-151` gives its spy an `InMemoryStore`, not a
`DelegatingStore`:

```rust
// api-rs/src/handlers/stores.rs:145-151
    #[derive(Clone)]
    struct CountingStore {
        inner: InMemoryStore,
```

and then hand-writes all three trait impls: `ProductStore` at `:198-276`,
`UserStore` at `:282-294`, `SessionStore` at `:297-325` — **129 lines**, of which
the spy needs only two instrumented methods (`list_calls` on
`list_public_page_by_owner` `:230`, `count_calls` on `count_public_by_owner`
`:240`). `DelegatingStore` is referenced in exactly one place in the whole crate:

```
$ grep -rn "DelegatingStore" api-rs/src api-rs/tests | grep -v "^api-rs/src/store/delegating.rs"
api-rs/src/handlers/products.rs:515   (import)
api-rs/src/handlers/products.rs:669   (inner: DelegatingStore,)
api-rs/src/handlers/products.rs:683   (DelegatingStore::new(Arc::new(inner)))
```

So the type exists to serve one call site, and at that one call site it delivers
nothing the 57 hand-written forwards did not already deliver.

### 5. The whole apparatus is written twice, and the second copy drifted

| | `handlers/products.rs` | `handlers/stores.rs` |
|---|---|---|
| spy struct + counters + delay | `:667-691` | `:145-195` |
| `impl ProductStore` (13 methods) | `:704-794` | `:198-276` |
| `impl UserStore` (3) | `:801-822` | `:282-294` |
| `impl SessionStore` (5) | `:825-856` | `:297-325` |
| `base_config` | `:860-868` | `:329-337` |
| `counting_state` | `:870-872` | `:339-341` |
| `get` | `:874-876` | `:343-345` |
| `get_all` | `:881-895` | `:350-364` |
| `body_of` | `:897-900` | `:366-370` |
| **total** | **242 lines** | **230 lines** |

The five helpers are identical bar import spelling and one-word doc drift:

```
$ diff <(sed -n '327,345p' api-rs/src/handlers/stores.rs) \
       <(sed -n '858,876p' api-rs/src/handlers/products.rs)
<     /// The concurrency limiter is a confounder here: these tests assert how many
<     /// queries reach the store, not that load was shed.
---
>     /// The concurrency limiter is a confounder in these tests: they assert how
>     /// many queries reach the database, not that load was shed.
```

Note the drift is not only cosmetic: one says "the store", the other "the
database". Both describe the same `InMemoryStore`. Two copies of the same
rationale will keep drifting, because nothing owns either.

**~240 duplicated lines is the largest single block of duplication in this
repository that no existing proposal covers.** For scale: `DelegatingStore`, the
type created to remove it, is 149 lines and does not remove it.

### 6. Two shipped proposal records assert the false version

This is the part that costs an agent the most, because both are *implemented* —
the folder a reader trusts as settled.

**Wrong about `stores.rs`** — `implemented/2026-10-05-09-13-35-by-ids-issues-one-query-per-id.md:163-166`:

> **`DelegatingStore`** — a four-line forward beside the existing one …
> The two `CountingStore` spies (`handlers/products.rs:631`, `handlers/stores.rs:198`)
> forward it for free through their `inner`, so neither needs a new hand-written body.

`handlers/stores.rs:198` is `impl ProductStore for CountingStore` — the spy
written at `:198`, which never imports `DelegatingStore` and whose `inner` is an
`InMemoryStore`. It has no hand-written body *because* it forwards for free; it
has one because `DelegatingStore` was never adopted there. The record's own
`Relationship` reasoning was checked against a line number, not against the type.

**Predicted the regression, then did not check it** —
`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md:271-276`:

> …including the one … step 6 calls for in `stores.rs` — composes `DelegatingStore`
> instead of copying 111 lines. Land this **before** that proposal's step 6, or it
> will copy the boilerplate a second time.

The ordering instruction named the exact risk. Step 6 shipped in `stores.rs`
anyway, and copied 129 lines instead of 111.

### 7. Nothing tests that the forwards forward

There is no assertion anywhere that any of the 21 pass-through methods in either
spy actually reaches the inner store. A self-recursive typo —
`self.find_by_id(...)` where `self.inner.find_by_id(...)` was meant — type-checks,
because both are `ProductStore`. It fails as a hang or a stack overflow inside an
unrelated test, not as a named failure. The compiler catches a *missing* method;
nothing catches a *wrong* one.

## Proposed approach

Four steps, in the modules that already own the concern. No production behaviour
changes; step 4 is documentation only.

**1. One owner for the double — `api-rs/src/store/delegating.rs`.** Rename it to
what it is (`store/testdouble.rs`) and give it the thing it lacks: a
`CountingStore`-shaped spy both handler test modules can use. Move into it, from
`handlers/stores.rs:145-370` and `handlers/products.rs:667-900`, the parts that
are genuinely common — the `list_calls` / `count_calls` / `delay` spy, its
`new()`/`register()`, and the five helpers `base_config`, `counting_state`,
`get`, `get_all`, `body_of`. Keep each module's *instrumented* methods local: the
two spies count different things (`products.rs` also has `find_calls` and
`batch_calls`, `:671-676`) and must stay readable side by side. This is the
`DelegatingStore` pattern the repo already chose, applied to the half that was
actually duplicated.

**2. Record the per-method cost honestly, and delete the claim that is false.**
Replace `delegating.rs:21-24` with the true statement: composing
`DelegatingStore` costs zero edits *in `DelegatingStore`*; the spy still needs its
own three impl blocks because `Arc<dyn MarketplaceStore>` (`app.rs:30`) demands
all three, and Rust has no partial trait impl. Note that no current caller wraps a
production store — the only use is the test double at `products.rs:683` — so do
not imply a use the repository does not have.

**3. Fix `products.rs:796-799`, which contradicts itself.** "…which is the 39
lines that used to live here" describes a deletion that did not happen; the block
is 57 lines at `:800-856`. Replace it with the real constraint and point at
`app.rs:27-30`.

**4. Correct the two shipped records.** In
`implemented/2026-10-05-09-13-35-…:163-166`, replace "the two `CountingStore`
spies … forward it for free" with the truth: `handlers/stores.rs`'s spy wraps
`InMemoryStore` and kept a hand-written body. In
`implemented/2026-10-03-22-37-46-…:271-276`, mark the ordering instruction as not
followed and say which proposal picks up the residue — this one. Both are
corrections to `implemented/` records, which is the same correction discipline
`implemented/2026-10-04-22-05-57-the-metrics-contract-has-no-owner.md` already
follows with its `## Implementation record`.

**Deliberately not in this change: splitting `AppState` into three handles.** It is
the only change that actually zeroes the per-method cost, and it is cheap on
paper — 20 call sites across 7 files (`my_store.rs` 5, `stores.rs` 3,
`products.rs` 3, `auth.rs` 3, `middleware/session.rs` 2, `app.rs` 2,
`health.rs` 1, `tests/common/mod.rs` 1). But it is a production-wiring refactor
made to serve test ergonomics, and `app.rs:27-29` argues the single handle is
deliberate ("One `Arc`, one pool"). Step 1 reduces the number of sites that pay
the per-method cost from 2 to 1, which is where the value is today. Revisit the
three handles when a second trait grows, not before.

## Impact

**Reuse.** ~240 duplicated test lines become one. `DelegatingStore` becomes a type
with a caller-visible purpose instead of a 149-line relocation of the same
forwards.

**Internal consistency.** The two spies stop describing the same mechanism in two
words ("the store" vs "the database", `stores.rs:327-328` vs `products.rs:858-859`)
and stop disagreeing about whether `MarketplaceStore` forces three impls.

**Maintainability, and the part that matters for an agent.** Today the cheapest
wrong move is to read `delegating.rs:21-24` or the by-ids record, conclude the
boilerplate is centralised, and add a third hand-written `SessionStore` block in a
new test module — which is precisely what step 6 of an implemented proposal did,
and what `bd01f17` had to do. Four places in the repository currently assert
something machine-checkably false, three of them in `implemented/`. After this,
the answer to "do I have to write the user/session forwards in my new spy?" is one
sentence in one file, and it is true.

**Testability.** Step 1 gives the shared double a home where a test for it can
live; that is what finding 7 needs.

**What does *not* get better, stated plainly.** The per-method cost is reduced from
two sites to one, not to zero — Rust's lack of partial trait impls and the single
`app.rs:30` handle both survive. No production code path changes, so there is no
runtime or latency effect at all. `handlers/stores.rs` keeps its own spy type if
step 1 keeps its instrumented methods local, which is the intent; this is not a
merge of the two tests. And the 57 lines at `products.rs:800-856` do not
disappear — they move to the shared module, and a reader of that module still has
to know why they exist.

## Risks / trade-offs

- **Moving ~240 lines of test code touches two modules' test suites at once.**
  `cargo test --lib` is the whole gate and neither module is Docker-dependent, so
  this is verifiable in seconds. The risk is a merge conflict with a concurrent
  change to `handlers/products.rs`, which is the file most likely to be under
  active edit.
- **Collapsing the two spies into one type would be a mistake.** They count
  different things and assert different cache paths. Step 1 must move the shared
  shape and helpers and leave the instrumented methods alone, or the two test
  modules become one test module that is wrong about both.
- **Correcting `implemented/` records is unusual** and a reviewer may prefer to
  leave history alone. The counter is that these records are read as current
  state by the next run of this very routine, which is what makes them worth
  correcting; if a reviewer disagrees, steps 1-3 stand alone and step 4 can be
  dropped without blocking anything.
- **`store/testdouble.rs` becomes `pub` and reachable from `src/`**, i.e. compiled
  into the production binary's dependency graph. That is already true of
  `delegating.rs:8` (`pub use delegating::DelegatingStore`), so this adds no new
  exposure — but if a reviewer wants test-only support out of `src/`, the home is
  `api-rs/tests/support/`, which costs a `#[cfg(test)]`-free `pub` API on
  `InMemoryStore`. Note that choice explicitly rather than discovering it later.

## Validation

1. **The suite still passes and the assertions still fire.**
   `pnpm --filter @rnw/api-rs test` (`cargo test --lib`). Then confirm the
   *behaviour* the two spies protect is still pinned by running the specific
   tests: `handlers::products::tests::concurrent_cold_page_requests_fill_once`
   (`products.rs:905`) and `handlers::stores::tests::concurrent_cold_storefront_requests_fill_once`
   (`stores.rs:375`) — both assert one store call under 64 concurrent requests, so
   a broken forward shows up as a count of 64, not as a hang.
2. **The duplication is actually gone, measured not asserted.**
   `grep -c "async fn" api-rs/src/handlers/stores.rs api-rs/src/handlers/products.rs`
   before and after, and
   `grep -rn "fn base_config\|fn counting_state\|fn body_of\|fn get_all" api-rs/src`
   must return one hit per helper, not two.
3. **Nothing regressed in the contract suite**, which is the other consumer of
   these traits: `pnpm --filter @rnw/api-rs test:e2e` with Docker, for
   `assert_store_contract` against `SqlProductStore`
   (`api-rs/src/store/contract.rs`) — required because that suite never runs in
   `cargo test --lib`.
4. **For finding 7, the new test.** In the shared double's own module, drive all
   three traits' forwards once against an `InMemoryStore` and assert each reached
   it. Then prove it bites: change one forward to `self.<method>` instead of
   `self.inner.<method>`, confirm the test fails, and revert. A test that cannot
   be shown to fail is not a test.
5. **The false claims are gone.** `grep -rn "forward it for free\|costs zero edits in it\|39 lines that" code-optimization-improve-proposals/ api-rs/src`
   returns nothing, and `grep -rn "DelegatingStore" api-rs/src | grep -v store/delegating.rs`
   returns the `products.rs` import and two construction sites or fewer.
6. **Coverage gate unchanged**: `pnpm --filter @rnw/api-rs coverage`
   (`--fail-under-lines 80`). Nothing here should move it; if it drops, a forward
   was lost in the move.
7. **Lint**: `pnpm --filter @rnw/api-rs lint` (`cargo fmt` + `clippy`). The move
   will reformat imports in both handler modules.

## Relationship to existing proposals

**This is the unfixed residue of `implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md`,
and nothing else in the corpus covers it.** Verified: `grep -rln "CountingStore\|DelegatingStore"`
across `code-optimization-improve-proposals/` and `improve-proposals/` returns six
files, and all six reference the double only in passing.

- **`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md`** — this
  proposal created `DelegatingStore` and is the direct parent. Its step 2 claimed
  the spy's `UserStore` + `SessionStore` blocks would be deleted
  (`:268-271`); they were not, and its step 3 predicted the `stores.rs` regression
  in the same document (`:274-276`). This proposal is not a restatement — it is the
  part that document got wrong, with the falsification evidence
  (`bd01f17`).
- **`implemented/2026-10-05-09-13-35-by-ids-issues-one-query-per-id.md`** — the most
  recent proposal. Its Implementation record (`:163-166`) is the specific sentence
  that is false about `stores.rs`. Step 4 corrects it. Not superseded: its own
  subject (the N+1 store query) landed and is unrelated.
- **`implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`** —
  step 6 of this document is what created the second copy in `stores.rs`. Adjacent
  history, not a duplicate finding.
- **`implemented/2026-10-04-04-06-14-the-session-table-has-no-reaper.md`** — landed
  as `bd01f17`, the commit that falsifies the "zero edits" claim. It did its job;
  this proposal records the cost it absorbed.

**Nothing in `in-progress/` claims this area.** The one entry,
`in-progress/2026-10-05-22-36-04-cached-payload-size-is-unowned.md`, concerns cache
entry sizing and uncapped `description` / `imageUrl` fields in
`api-rs/src/cache/` and `api-rs/src/handlers/my_store.rs`. This proposal touches
`api-rs/src/store/delegating.rs`, the `#[cfg(test)]` modules of
`handlers/products.rs` and `handlers/stores.rs`, and two markdown files under
`implemented/`. No overlap in files under edit.