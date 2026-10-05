# `/products/by-ids` is documented as one batched query and is implemented as up to 50 sequential ones

## Problem / opportunity

`GET /products/by-ids` exists for one reason, and the reason is written down in
three places: it is the endpoint that lets a cart, a wishlist and a
recently-viewed rail resolve remembered ids **in one query instead of N**. That
claim is the whole justification for the endpoint, and it is repeated as a
contract at every layer that depends on it.

`components-library/src/business/ProductLookup/useProductLookup.ts:53-56`:

```ts
 * **One query, not N.** The fetcher takes the whole list because the API has a
 * batched endpoint for it (`GET /products/by-ids`); fanning out to
 * `GET /products/{id}` per id would be N requests for an N-item cart, and would
 * make a cart with ten lines unusable on a slow connection.
```

`api-rs/src/handlers/products.rs:233-240`, on the cap that bounds the damage:

```rust
/// How many ids one `/products/by-ids` request will resolve.
///
/// A cap, not a validation error: the callers are client stores whose size this
/// service does not control, and answering the first N is more useful than
/// refusing the whole cart. 50 is roughly five screens' worth of a cart plus a
/// recently-viewed rail, and it bounds the request at 50 indexed primary-key
/// lookups however long the query string gets.
const MAX_LOOKUP_IDS: usize = 50;
```

And the implemented proposal that chose this endpoint over the two rejected
alternatives, `implemented/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md:332-338`:

> (a) add `GET /products/by-ids?ids=a,b,c` to api-rs … — **one round trip**, honours
> the existing generation-folded cache, and is the smallest thing that makes the
> seam honest; … **Do not choose (b) or (c) silently** — the whole point is that
> one lookup is one query.

One HTTP round trip is what the endpoint delivers. **One query is not.** The
handler loops over the ids and issues one store call per id, serially:

`api-rs/src/handlers/products.rs:281-311`:

```rust
    for id in &ids {
        let key = cache::detail_key(id);

        if let Some((bytes, _source)) = state.cache.get(Kind::Detail, &key).await {
            bodies.push(String::from_utf8_lossy(&bytes).into_owned());
            continue;
        }
        …
        match state.store.find_by_id(id).await? {          // ← one query per id
            Some(product) => { … }
            None => missing.push(id.clone()),
        }
    }
```

Each of those `find_by_id` calls is a full round trip plus a fresh pool
acquisition. `api-rs/src/store/products.rs:559-564`:

```rust
    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let row: Option<ProductRow> =
            sqlx::query_as(DETAIL_QUERY).bind(id).fetch_optional(&mut *connection).await?;
        Ok(row.map(Product::from))
    }
```

`Self::acquire` is `pool.acquire()` plus a histogram observation
(`api-rs/src/store/products.rs:523-534`), and `DETAIL_QUERY` binds a single id
(`:280`). So a cold batch of *n* ids is *n* sequential acquisitions and *n*
sequential statements, each paying its own network latency — the loop is
`await` inside a `for`, so nothing overlaps. The cap bounds the request at 50
indexed lookups; it does not make them concurrent or make them one.

### The cost lands on exactly the screens the endpoint was built for

Every screen that resolves a remembered product goes through this one call:
`CartScreen.tsx:36`, `CheckoutScreen.tsx:40`, `WishlistScreen.tsx:31`,
`ProductListScreen.tsx:83` and `ProductListScreen.web.tsx:45`. The worst case is
the largest one, because the ids are unbounded — the cart store accepts a new id
per `addItem` (`useCartStore.ts`) and the wishlist appends without a cap
(`useWishlistStore.ts:29-33`), so a shopper who browses for a while really does
send the full 50.

This is the slowest read path in the service, and it is on the critical path of
every screen a returning shopper opens. `GET /products` — the route that carries
the catalogue — is one paged query plus one cached `COUNT(*)`
(`products.rs:193-194`), so a shopper opening the marketplace does *one* round
trip, and then opening their cart does up to fifty, serially, on a route whose
documented purpose is to avoid the N-for-1 shape.

### Three tests currently pin the per-id behaviour instead of the contract

Nothing asserts the query count, so the batch shape can be lost silently. Worse,
one test asserts the *opposite* of the proposal:

`api-rs/src/handlers/products.rs:1080-1094`:

```rust
    async fn a_repeated_batch_is_served_from_the_detail_cache() {
        …
        assert_eq!(find_calls.load(Ordering::SeqCst), 2, "two ids, two lookups, not four");
    }
```

That assertion is correct as written — it is about the *cache* doing its job, not
about the store being asked N times — but "two ids, two lookups" is precisely the
count a batched store call would collapse to one. Whoever implements the fix has
to read this carefully rather than delete it, which is exactly the friction this
proposal should name rather than hide.

The store contract suite
(`api-rs/src/store/contract.rs:101-108`, eight assertions run against both
`InMemoryStore` and `SqlProductStore`) has no assertion about batch reads at all,
because `ProductStore` has no batch method to assert on
(`api-rs/src/store/products.rs:144-197`). So the two implementations cannot
currently disagree about batch behaviour — there is nothing to disagree about.

### Why this is a real gap and not a premature optimisation

The repo has already answered "is a batch worth it" for a neighbouring case. In
`improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`
the read-replica item was specified in terms of what `list_page` and `find_by_id`
route where, and the repo already accepts `= ANY($1)` as its batching idiom —
`api-rs/src/seed.rs:195` uses exactly that for `DELETE … WHERE "id" = ANY($1)`.
The idiom is in the codebase; it was just never applied to the one read path
whose stated contract is "one query".

## Proposed approach

One new store method, one new SQL constant, and one change to the handler loop.
No wire-contract change, no client change, no cache-key change.

### 1. `ProductStore::find_by_ids` — `api-rs/src/store/products.rs:144-197`

Add to the trait, next to `find_by_id`:

```rust
/// The rows for `ids`, in an unspecified order, with no entry for an id that
/// does not exist. The batched form of [`Self::find_by_id`]: one statement and
/// one pool acquisition for the whole set, which is what `GET /products/by-ids`
/// needs and what `find_by_id`-per-id cannot give it.
async fn find_by_ids(&self, ids: &[String]) -> Result<Vec<Product>, StoreError>;
```

Three implementations, all mechanical forwards or filters:

- **`SqlProductStore`** — a `find_by_ids` impl beside `find_by_id`
  (`:559-564`), pairing a new `DETAIL_BATCH_QUERY` constant with
  `DETAIL_QUERY` (`:280`). The shape is already in the repo:
  `WHERE p."id" = ANY($1)`, same projection and same `LEFT JOIN`, so a row is
  byte-identical to what the singular query returns. Reuse `Self::acquire` with
  the same `self.reads()` / `self.read_role()` pair, so the pool decision and
  the `sqlx_pool_acquire_seconds` label stay where they are.
- **`InMemoryStore`** — filter-and-collect beside `find_by_id`
  (`api-rs/src/store/memory.rs:250`), one lock acquisition, not N.
- **`DelegatingStore`** — a four-line forward beside the existing one
  (`api-rs/src/store/delegating.rs:44-46`). The two `CountingStore` spies
  (`handlers/products.rs:631`, `handlers/stores.rs:198`) forward it for free
  through their `inner`, so neither needs a new hand-written body.

Empty input returns an empty vec without touching the pool — `by_ids` with no
ids already short-circuits in the handler's loop today, and that must stay true.

### 2. One batched call in the handler — `api-rs/src/handlers/products.rs:281-311`

Keep the loop exactly as it is for the **cache** decisions — `detail_key`, the
`X-Cache` accounting, the singleflight, the "no entry for a missing id, so a
re-published id is visible next time" rule at `:306-309`. Those are per-id
properties and none of them changes.

Change only the store call. Two passes over the same loop:

1. First pass: for each id, do the cache read and the two-phase singleflight
   check. Record which ids fell through to the store, in first-seen order.
2. One `state.store.find_by_ids(&missed).await?` for the whole missed set.
3. Second pass over `missed`: for each returned row, serialize, write the detail
   key, push the bytes; for each id in `missed` with no returned row, push to
   `missing`.

First-seen order is preserved because `parse_lookup_ids` (`:249-267`) already
de-duplicates and orders, and the response contract depends on it
(`products.rs:996-998`, "First-seen order is the response order, so the caller
can zip `items` back onto its own list"). Reconstruct `missing` as
`missed` minus the returned ids — do not rely on the database's row order, which
`ANY` does not promise.

Update the comment at `:274-277` to say what is now true: one cache entry and one
serialization per product, one query for the whole batch.

### 3. Make the contract executable for it — `api-rs/src/store/contract.rs:101-108`

Add one assertion, `a_batch_read_is_the_singular_read_repeated`, to the sequence
at `:101-108`. It creates three rows, batches all three ids, and asserts the
returned set equals what three `find_by_id` calls return — including that a
requested id which does not exist is simply absent from the result rather than
an error or a placeholder. That runs against both implementations for free,
which is the entire point of the suite.

### 4. Fix the three tests that describe the old shape

- **`products.rs:1093`** — `assert_eq!(find_calls.load(..), 2, "two ids, two
  lookups, not four")` becomes one batch call for two ids. The assertion's
  *intent* is "the cache collapsed the repeat", so keep that claim and move it to
  the batch counter: two requests, one batch, not two. The
  `a_repeated_batch_is_served_from_the_detail_cache` name stays accurate.
- **`products.rs:1012-1031`** (`a_batch_resolves_products_and_names_the_ones_that_are_gone`)
  needs no change — it asserts the response, which is unchanged. That is the
  test that proves the refactor was behaviour-preserving.
- Add one handler test: a cold batch of *n* ids issues **one** store call. This
  is the assertion that does not exist today and that makes the claim in
  `useProductLookup.ts:53-56` checkable rather than aspirational.

### 5. Correct the documentation that overstated it

`useProductLookup.ts:53-56` currently says "**One query, not N**". After this
change that is accurate at both layers, so the wording can stand — but it should
say *query*, not just "one query" contrasted with "N requests", because the
distinction it draws is HTTP-level while the guarantee is store-level. One line,
and it is the line an agent changing the transport will read.

`products.rs:233-239`'s "bounds the request at 50 indexed primary-key lookups"
becomes accurate in the stronger sense: one statement over at most 50 ids. Keep
the cap; it is still the right bound on the input.

## Impact

**Performance.** The main gain. A cold batch of *n* ids goes from *n* sequential
acquisitions + *n* sequential statements to one of each. For the shapes this
endpoint actually sees — a 10-line cart, a 10-item recently-viewed rail, a
wishlist that has grown past 20 — that is a 10–50× reduction in round trips on
the slowest read path in the service, and it is the difference between a cart
that renders promptly and one that renders in series. It also removes the
per-id pool-acquire histogram spam: 50 acquisitions today produce 50
`sqlx_pool_acquire_seconds` observations for one request, which makes that
histogram's percentiles harder to read rather than easier.

**Testability.** Two gains. The query count becomes assertable, so the batch
shape can no longer be lost silently — that is the property the existing test at
`:1093` asserts about the cache while accidentally leaving the store
unconstrained. And a batch read joins the store contract suite, so the in-memory
double and Postgres are held to the same answer for it, which is the guarantee
the other seven assertions there exist to provide.

**Consistency.** The handler stops being the only place that knows how to
resolve several ids. `seed.rs:195` already uses `= ANY($1)`; `store/contract.rs`
already runs one suite against two implementations; the cache already treats each
id as its own entry. The batch read is the one seam in the read path that is
still spelled per-id.

**AI-developer experience.** The current shape invites the wrong edit. An agent
adding an id-resolution feature reads `useProductLookup.ts:53-56`, concludes the
server already batches, and writes a new call site that fans out — reintroducing
exactly what the endpoint was built to prevent, in a codebase whose own tests
would not catch it. Making the store method match the documented contract means
the shortest correct path and the documented path are the same path.

**What does not improve.** Nothing about correctness, the wire contract, the
cache-hit path, or the cold-vs-warm story. A warm batch already issues zero
queries and still will. The response body is byte-identical before and after, so
the committed goldens in `tests/fixtures/products-by-ids.json` do not change, and
neither does anything in `components-library`, `web-application` or
`mobile-application`. `MAX_LOOKUP_IDS` stays at 50.

## Risks / trade-offs

- **A batch statement is not N single-key lookups in Postgres.** `= ANY($1)`
  over a text primary key is an index scan either way, but the planner sees one
  predicate instead of N, so the plan for a large `ANY` list is not identical to
  N plan lookups. At 50 ids the difference is not worth measuring first; if it
  ever is, `products.rs:238-239` already documents 50 as the bound, and the cap
  is where the trade would be made. Worth stating so it is a decision rather than
  a surprise.
- **Row order is unspecified.** `ANY` does not preserve argument order, so the
  handler must reconstruct first-seen order itself. The response contract depends
  on that order (`products.rs:996-998`), so getting it wrong is a silent
  reordering, not an error. This is the main thing to get right, and step 2's
  "reconstruct from `missed`, do not trust row order" is the instruction.
- **`InMemoryStore` gains a method, so `StoreOp` may need a decision.** The
  failure switches are one-per-surface (`memory.rs:16-32`), and
  `StoreOp::Product` already covers `find_by_id`. `find_by_ids` belongs to that
  same surface; if it does not, `fail_once(StoreOp::Product)` stops being able to
  make a batch read fail, and the `handlers/health.rs` and degraded-read tests
  that lean on those switches would need a new one. Small, but it must be
  decided rather than discovered by a test that stops failing.
- **`CountingStore` in `handlers/products.rs:631` counts `find_by_id`.** If the
  handler stops calling it for batches, that counter goes quiet for batch tests.
  The new "one store call" assertion needs a counter that actually moves, so the
  spy either counts `find_by_ids` too or the assertion is on something else
  (timing, or a store whose batch method is instrumented). Naming it here because
  it is the step most likely to be got wrong.
- **It touches four files and a trait.** `ProductStore` gaining a method is a
  compile error at every implementation, which is the point — but it means the
  change cannot be a single-file patch and should be reviewed as one unit.
- **Nothing about this reopens the endpoint's existence.** Option (a) beat (b)
  and (c) for good reasons and those reasons are untouched.

## Validation

1. **The store contract, both implementations.** `pnpm --filter @rnw/api-rs test`
   — the new `a_batch_read_is_the_singular_read_repeated` assertion in
   `contract.rs` runs under `--lib` against `InMemoryStore`. It must fail if
   `find_by_ids` returns a row for an id that does not exist, drops a row that
   does, or disagrees with three `find_by_id` calls.
2. **The same assertion against Postgres.** `pnpm --filter @rnw/api-rs test:e2e`
   (Docker required) — `tests/e2e_products.rs:16` runs the same suite against
   `SqlProductStore`. This is the half that cannot be checked without a
   database, and it is where a `= ANY` binding mistake would surface.
3. **The query count, asserted.** Add and run the handler test from step 4: a
   cold batch of *n* ids reaches the store exactly once. Before the change this
   test fails at *n*; after, it passes at 1. State the before/after numbers in
   the pull request — they are the whole justification.
4. **Byte-identical responses.** `pnpm --filter @rnw/api-rs test:e2e` —
   `tests/parity.rs:104-106` byte-compares `/products/by-ids` against
   `tests/fixtures/products-by-ids.json`, and `tests/e2e_my_store.rs:591-599`
   covers the `missing` half against a real deletion. If either golden changes,
   the refactor altered the contract and must be reverted, not regenerated.
5. **Order is preserved.** Extend `a_batch_resolves_products_and_names_the_ones_that_are_gone`
   (`products.rs:1012-1031`) with a query whose argument order differs from
   insertion order, so an `ANY`-shuffled result cannot pass. It already asserts
   `items[0]` is `prod-1` and `items[1]` is `prod-2` for
   `ids=prod-1,deleted-1,prod-2`; add the reversed-ids case
   (`ids=prod-2,deleted-1,prod-1`) and assert the same reversal in the response.
6. **The cache path is unchanged.** The existing
   `a_repeated_batch_is_served_from_the_detail_cache` (`products.rs:1080`) must
   still show the second request issuing no store call, now measured in batches
   rather than singular lookups.
7. **Everything else.** `pnpm lint`, `pnpm typecheck`,
   `pnpm --filter @rnw/components-library test` (no client change, so this is a
   regression guard), and `pnpm --filter @rnw/api-rs test` for the rest of the
   suite. Not `pnpm build` — this touches no app code.

## Related proposals

- **`implemented/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
  — related, and this proposal completes one of its decisions rather than
  re-opening it.** That document chose option (a), `GET /products/by-ids`, over
  (b) `fetchQuery` per id and (c) `GET /products/{id}` per id, and wrote "the
  whole point is that one lookup is one query" (`:338`). What landed satisfies
  the HTTP half of that sentence and not the query half: one request, up to 50
  queries. This proposal does not revisit the choice of endpoint, the `missing`
  result, the three persisted shapes, or the price-staleness fix — all of those
  are implemented and correct. It fixes the one place the chosen option was
  under-delivered. If the team would rather revert to option (b) than add a store
  method, that is a legitimate disagreement with this document and belongs in
  review; what is not legitimate is leaving the doc comment at
  `useProductLookup.ts:53-56` claiming a guarantee the code does not provide.
- **`implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md` —
  related, not superseded, and not re-proposed.** It unified the two *list* read
  paths (`GET /products` and `GET /stores/{id}/products`) onto shared helpers and
  explicitly did not touch `by_ids`. That is still correct: `by_ids` is a detail
  read, not a list read, and it has its own cache kind and key. The one thing
  this proposal borrows from that document is its method: put the shared helper
  in one place rather than reimplementing per route. Here there is nothing to
  share — one handler, one store method — so the change is smaller than it was
  there.
- **`implemented/2026-10-04-03-05-32`'s sibling findings on the three persisted
  stores** (`useCartStore`, `useWishlistStore`, `useRecentlyViewedStore`) are
  untouched. This proposal changes no client store, no screen and no type. The
  only client-side edit is one doc comment.
- **Not related, and deliberately untouched:** the five-minute catalogue
  `staleTime` (`providers.tsx:12-14`, `queryClient.ts:6-8`), the load-shedder
  work in `implemented/2026-10-04-06-16-26` and
  `implemented/2026-10-04-08-20-32`, and the metrics contract in
  `implemented/2026-10-04-22-05-57`. The `sqlx_pool_acquire_seconds` histogram
  gets *quieter* here (one observation per batch instead of one per id), which is
  a side effect on that metrics work rather than a change to it — if the
  dashboard depends on per-request acquisition counts, say so in review.

## Implementation record

Written when the proposal was applied. The Risks section's four open questions
had no reviewer — this run was unattended — so each answer is recorded here with
its evidence.

### Step 1 — the store method, and the four Risk items

`ProductStore::find_by_ids` added beside `find_by_id`, with `DETAIL_BATCH_QUERY`
(`= ANY($1)`, same projection, same `LEFT JOIN`) beside `DETAIL_QUERY`.
Implemented in `SqlProductStore` (reusing `Self::acquire` and the same
`reads()`/`read_role()` pair, so the pool decision and the
`sqlx_pool_acquire_seconds` label are unchanged), `InMemoryStore` (one lock
acquisition, filtering under it rather than re-locking per id), `DelegatingStore`
(a forward) and the two `CountingStore` spies in `handlers/products.rs` and
`handlers/stores.rs`.

- **`StoreOp::Product` covers it, and no new switch was needed.** A batch read is
  a product read, so it sits on the same surface as `find_by_id` and
  `fail_once(StoreOp::Product)` still makes a cart's lookup fail. The switch is
  otherwise unused today — `handlers/products.rs:964` sets `StoreOp::Count`, not
  `Product` — so nothing that leaned on it changed behaviour.
- **The empty case never touches the pool.** Guarded in the handler (an empty
  `wanted` skips the call) *and* in `SqlProductStore`, so the guarantee holds for
  any future caller rather than resting on one call site.
- **`= ANY` over a text primary key is an index scan**, so the 50-id plan is not
  a sequential scan the cap was chosen to avoid. Not benchmarked: the Risks
  section is explicit that the difference is not worth measuring first, and the
  cap is unchanged at 50, so the trade-off has not actually been spent.

### Step 2 — the handler, and one thing the proposal did not anticipate

The two-pass split went in as written. First-seen order is rebuilt by indexing
`resolved` by position rather than by iterating the returned rows, so `= ANY`
row order cannot reach the response; `missing` is the set difference, never the
database's answer about which ids existed.

**The singleflight needed a new method, and this is the part worth reviewing.**
`Flight::lock` returns a guard borrowed from the `Flight` that handed it out,
which is right for filling one key and releasing it. This route now holds every
missed id's fill open across one batched statement, and a borrowed guard per key
cannot be collected: the `Flight`s would have to outlive the guards, and the
borrow would pin them. `Flight::owned_lock` returns an `OwnedMutexGuard` on the
same `Arc<Mutex<()>>` — same mutex, so an owned guard and a borrowed one exclude
each other exactly as two of either do, and the
`cache_singleflight_wait_seconds` observation is unchanged. It is pinned by
`an_owned_guard_excludes_a_borrowed_one` and `many_owned_guards_can_be_held_at_once`
in `cache/singleflight.rs`.

Holding several guards at once is safe here only because `parse_lookup_ids`
de-duplicates: every guard in the vector is a distinct key, so a request never
waits on itself. That is stated at the declaration, because it is a precondition
rather than a coincidence.

### Step 3 — the contract assertion

`a_batch_read_is_the_singular_read_repeated` added to the sequence in
`store/contract.rs`, so it runs against `InMemoryStore` under `--lib` and against
`SqlProductStore` under `test:e2e` from one body. It creates three rows under its
own fourth seller, batches those three plus an id that does not exist, and
compares against three `find_by_id` calls.

Two details the proposal's wording left open, decided here:

- **It compares rows, not ids.** An id-only comparison would pass against a batch
  query that dropped the `LEFT JOIN "User"` — right ids, null `storeName`. The
  joined seller name and `price` are compared field by field as well.
- **It does not assert order.** `= ANY` promises none and the double has no reason
  to; rebuilding first-seen order is the handler's job and is asserted there
  instead. Asserting an order in this suite would pin one implementation's
  accident against the other.

### Step 4 — the tests, and the before/after numbers

`a_repeated_batch_is_served_from_the_detail_cache` kept its name and its claim,
moved onto the batch counter: two requests, one batch, and `find_by_id` at zero.
`a_batch_resolves_products_and_names_the_ones_that_are_gone` needed no change and
still passes, which is the evidence the refactor was behaviour-preserving.

New: `a_cold_batch_of_n_ids_is_one_store_call` and
`a_batch_answers_in_the_order_the_caller_asked` (the reversed-ids case from
validation step 5, so an `ANY`-shuffled result cannot pass), plus
`a_warm_batch_queries_only_the_ids_it_is_missing` — the partly-warm shape a real
second screen of a cart has, and the one that would regress silently into a query
per remaining id.

`CountingStore` gained a `batch_calls` counter separate from `find_calls`, which
is what the Risks section said was the step most likely to be got wrong: a single
counter could not distinguish "one batch" from "one lookup per id".

**Query count, measured.** 12 cold ids:

| | batch calls | `find_by_id` calls |
| --- | --- | --- |
| before (`5375d4f^`) | 0 | 12 |
| after | 1 | 0 |

The "before" row is the regression check: the new test was run against the
per-id loop it replaces and failed at `left: 0, right: 1` on the batch assertion.

### Step 5 — the documentation

`useProductLookup.ts` now says the server resolves the set in one query *as well
as* one request, and states that the guarantee is the store's rather than the
transport's — the line an agent changing the transport will read.
`MAX_LOOKUP_IDS`'s comment now reads "one statement over at most 50 indexed
primary-key lookups". The cap is unchanged.

### Negative checks, four mutations

Each was made, the suite confirmed to fail on the predicted assertion, and the
mutation reverted:

| mutation | assertion that failed |
| --- | --- |
| handler's batch call reverted to a per-id loop | `a_cold_batch_of_n_ids_is_one_store_call` (batch 0, expected 1) |
| batch returns a row for an id never requested | `a_batch_read_is_the_singular_read_repeated` (len 4, expected 3) |
| batch drops the joined seller row | `a_batch_read_is_the_singular_read_repeated` (store name mismatch) |
| results placed in store row order instead of caller order | `a_batch_answers_in_the_order_the_caller_asked` (`prod-1` first) |

### Not done, stated plainly

- **No mobile simulator.** Nothing in `mobile-application` was touched; the one
  client-side edit is a doc comment in `components-library`, covered by
  typecheck, lint and the components-library suite.
- **`pnpm format:check` fails on 80 pre-existing diagnostics**, none in a file this
  change touches. Counted before and after the change: 80 both times. It is not
  part of the repo's `lint` gate, which is `biome lint` per workspace. Not fixed
  here; not this proposal's business.
- **The goldens are byte-identical** — `tests/parity.rs` passed against
  `tests/fixtures/products-by-ids.json` unmodified, and
  `git status` on `tests/fixtures/` is empty. They were not regenerated, per the
  instruction to revert rather than regenerate.
- **No timing measurement.** The round-trip reduction is structural (n
  acquisitions and n statements become one of each) and is asserted through call
  counts; wall-clock on a real database was not measured, and the load-shedder's
  thresholds were left alone.
