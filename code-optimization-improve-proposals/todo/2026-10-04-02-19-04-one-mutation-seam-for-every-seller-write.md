# Every seller write goes through one mutation seam, so the catalog stops serving rows the seller already changed

## Problem / opportunity

`useMyStoreProducts` is documented as the repository's model for writing anything:

> `components-library/src/business/StoreScreen/useMyStoreProducts.ts:31-40`
> ```
>  * The repo's first mutation, and therefore the pattern the rest will follow:
>  * `useMutation` for the write, then invalidate the query that read it. Nothing
>  * optimistic — the lists are small and the server is the source of truth, so an
>  * optimistic row would only ever be a thing to roll back.
>  *
>  * Every write invalidates the same key, including a delete: after a delete the
>  * cached page is wrong in two ways at once (the row is still there, and `total`
>  * is off by one).
> ```

Four of the five write call sites in the repository do not use it. They call the
app's api function directly, inside a hand-written `try`/`catch` in a route
file. The consequences are not stylistic.

### 1. Two thirds of the shared hook is unreachable

`create` and `update` are returned by the hook (`useMyStoreProducts.ts:80-81`)
and are called from nowhere. The only mutation either app invokes is `remove`:

```tsx
// web-application/app/my-store/page.tsx:67
onDelete={(id) => store.remove.mutate(id)}
```
```tsx
// mobile-application/src/app/my-store/index.tsx:64
onDelete={(id) => store.remove.mutate(id)}
```

Reproduce with the command in **Validation** step 5: `create.mutate`,
`update.mutate`, `store.create` and `store.update` have zero hits outside the
hook's own definition.

`MyStoreApi` (`useMyStoreProducts.ts:13-18`) still declares `create` and
`update`, so both apps keep constructing a ten-line adapter whose only purpose
is to satisfy a type for two members nobody calls:

```tsx
// web-application/app/my-store/page.tsx:46-55  (mobile-application/src/app/my-store/index.tsx:43-52 is the same)
const api = useMemo(
  () => ({
    list: fetchMyProducts,
    create: createMyProduct,
    update: (id: string, values: Parameters<typeof updateMyProduct>[1]) =>
      updateMyProduct(id, values),
    remove: deleteMyProduct,
  }),
  [],
)
```

### 2. The four bypasses, and two comments that assert the opposite

```tsx
// web-application/app/my-store/new/page.tsx:30-34
await createMyProduct(values)
// Back to the list rather than the new product's page: the list is what
// a seller came here to see, and it is already invalidated by the
// mutation.
router.replace("/my-store")
```

```tsx
// mobile-application/src/app/my-store/new.tsx:28-32
await createMyProduct(values)
// Back to the list rather than the new product's own screen: the list is
// what a seller came here to see, and the mutation already invalidated
// it.
router.replace("/my-store")
```

```tsx
// web-application/app/my-store/[id]/edit/page.tsx:87
await updateMyProduct(product.id, values)
```
```tsx
// mobile-application/src/app/my-store/[id]/edit.tsx:82
await updateMyProduct(product.id, values)
```

There is no mutation in any of those four scopes, so nothing is invalidated.
The two comments are not describing an optimisation that happens elsewhere —
they are the only statement of why the redirect is safe, and it is false.

**The create flow is accidentally correct about its own list and wrong about
everything else.** `useMyStoreProducts` overrides `staleTime: 0`
(`useMyStoreProducts.ts:48-51`), so `router.replace("/my-store")` remounting
`SignedInStore` does refetch the seller's catalogue. That is why the bug has
survived: the one thing the comment is about does get refetched, for a reason
that has nothing to do with the mutation.

### 3. No seller write ever retires the catalog caches — including the one that goes through the hook

`invalidateQueries` appears exactly once in the repository:

```ts
// useMyStoreProducts.ts:55
const refresh = () => queryClient.invalidateQueries({ queryKey: key })
```

`key` is `myStoreKey(storeId)` — `["my-store", storeId]`
(`useMyStoreProducts.ts:27-29`). Five other key families hold this seller's
products and are never retired by any write:

| key | read by |
| --- | --- |
| `["products"]` | `useInfiniteProducts.ts:6`, consumed by `web-application/app/marketplace/page.tsx:10` and `mobile-application/src/app/(tabs)/marketplace/index.tsx:7` |
| `["product", id]` | `web-application/app/marketplace/[id]/page.tsx:13`, `mobile-application/src/app/(tabs)/marketplace/[id].tsx:9`, and the edit route's own read at `web-application/app/my-store/[id]/edit/page.tsx:35` / `mobile-application/src/app/my-store/[id]/edit.tsx:30` |
| `["store", id]` | `web-application/app/stores/[id]/page.tsx:22`, `mobile-application/src/app/stores/[id].tsx:15` |
| `["store-products", id]` | `web-application/app/stores/[id]/page.tsx:24`, `mobile-application/src/app/stores/[id].tsx:17` |

Every one of them inherits the same five-minute freshness window, in both apps:

```tsx
// web-application/app/providers.tsx:12-14
const [queryClient] = useState(
  () => new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } } }),
)
```
```ts
// mobile-application/src/query/queryClient.ts:6-8
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
})
```

So the concrete sequence is: a seller edits a product's price on
`/my-store/[id]/edit`, lands back on `/my-store` (fresh, `staleTime: 0`), taps
the **Marketplace** tab, and sees the old price. `["products"]` is younger than
five minutes, so react-query serves it from cache and does not refetch on mount.
Same for the public storefront, and same for the detail page — including from
the edit screen's own `["product", id"]` entry.

**This is not the client disagreeing with a stale server. The server is always
correct.** Every seller write bumps the cache generation:

```rust
// api-rs/src/handlers/my_store.rs:137-139
async fn invalidate_after_write(state: &AppState, id: &str) {
    state.cache.invalidate_detail(id).await;
    state.cache.bump_list_generation().await;
```
called at `:116` (update) and `:130` (delete), with create bumping directly at
`:91`. The two halves of the system are therefore guaranteed to disagree for up
to five minutes after every seller write, and the direction of the disagreement
is always "the seller sees their change, a buyer does not".

### 4. Even the correct path retires too little

`remove` does go through the hook, and it is still wrong in the same way:
`refresh` retires `["my-store", storeId]` only. After a delete the marketplace
list keeps the deleted row *and* its `total` for up to five minutes — which is
precisely the failure `useMyStoreProducts.ts:37-39` describes, one key short.

### 5. `isMutating` can only ever mean "a delete is in flight"

`isMutating` is `create.isPending || update.isPending || remove.isPending`
(`useMyStoreProducts.ts:84`) and it is wired to real UI:
`StoreScreen.tsx:96` and `:104` disable the row actions and the "Add product"
button on it, asserted by `StoreScreen.web.test.tsx:77-81`. With `create` and
`update` unreachable, the flag is a partial truth that reads like a guarantee.

### 6. The seam that carries this policy has no test at all

`ls components-library/src/business/StoreScreen/` returns four files —
`StoreScreen.tsx`, `StoreScreen.web.test.tsx`, `StoreScreen.stories.tsx` and
`useMyStoreProducts.ts`. **The hook has no test file.** The nearest precedent for
one already exists: `useInfiniteProducts.web.test.tsx:17-22` is a `renderHook`
plus a `QueryClientProvider` wrapper and is picked up by the same Vitest project.

At the app level the coverage points the other way — the repo *knows* the
pattern, and tests it for exactly one of the three mutations:

```tsx
// web-application/tests/my-store.test.tsx:116
it("deletes through the shared mutation, which invalidates the list", async () => {
```
```tsx
// web-application/tests/my-store.test.tsx:168-177  (the create test)
await waitFor(() => {
  expect(createMyProduct).toHaveBeenCalledWith({ /* … */ })
})
expect(replacedWith()).toContain("/my-store")
```

The create test asserts the call and the redirect and nothing about
invalidation. Two further facts close the gap between "untested" and
"untestable as written":

- The harness pins `staleTime: 0` (`my-store.test.tsx:43-45`), so a refetch
  cannot distinguish "invalidated" from "always stale". The delete assertion at
  `:128-131` counts `fetchMyProducts` calls, which works only because that key
  is `staleTime: 0` anyway.
- The edit route is imported by no test at all. `my-store.test.tsx:6-8` imports
  `MyStorePage`, `NewProductPage` and `StorePage`; the one screen that performs
  an update is untested on both platforms.

### Why this is the most expensive kind of finding

Five queued feature proposals build on this surface, and three of them add
writes: `improve-proposals/implemented/2026-09-29-product-ratings-and-reviews.md:53-57`
("this proposal turns api-rs into a write path … the review aggregates must be
invalidated on write"), `improve-proposals/2026-09-29-15-22-coupon-discount-codes.md`
(redeem) and `improve-proposals/2026-09-29-order-history.md` (`POST /orders`).
An agent picking any of them up will read
`useMyStoreProducts.ts:31-40`, be told in prose that the pattern is
"`useMutation` for the write, then invalidate the query that read it", copy that
shape — and reproduce a policy that is already wrong in five places, in code that
looks correct and carries a comment agreeing with it. The knowledge is
distributed across four route files, a hook, two api clients and two QueryClient
configurations, and nothing fails when it stops being true.

## Proposed approach

Keep the hook, keep both api clients, keep every route file where it is and keep
the `props-in-no-fetching` convention. Change two things: which keys a write
retires, and whether the four bypasses go through the seam at all.

### 1. One invalidation policy, in the module that already owns the key

`useMyStoreProducts.ts` already owns `myStoreKey` (`:27-29`) and is already the
exported home for the policy (`src/index.ts:78-79`). Put the rest of the key
family and the retire list next to it:

```ts
/** Every cache entry a seller write to `productId` can make wrong.
 *
 *  `["my-store", storeId]` is the seller's own list; `["products"]` and
 *  `["product", id]` are the catalog the edit screen itself read; the two store
 *  keys are the public storefront, which shows the same rows. `invalidateQueries`
 *  prefix-matches, so one call per family is enough. */
export function productWriteKeys(storeId: string, productId: string) {
  return [
    myStoreKey(storeId),
    PRODUCTS_KEY,
    productKey(productId),
    storeKey(storeId),
    storeProductsKey(storeId),
  ] as const
}
```

with `PRODUCTS_KEY`, `productKey(id)`, `storeKey(id)` and `storeProductsKey(id)`
exported beside `myStoreKey`, and the five raw key literals listed in finding 3
replaced by those builders. That is a strict improvement on its own: today the
key strings are written out at ten sites and nothing says they are a family.

### 2. Split the mutations out so a form route can reach them

The reason the bypass exists is structural and worth stating plainly: the hook
that owns the mutations is only mounted by the *list* route
(`web-application/app/my-store/page.tsx:56`,
`mobile-application/src/app/my-store/index.tsx:53`), and the forms live in two
other routes. A seller id is available app-wide via `useSessionStore`, so the
mutations do not need the list route — they need to be a hook of their own:

```ts
export function useMyStoreMutations(storeId: string, api: MyStoreApi) {
  const queryClient = useQueryClient()
  const retire = (productId: string) =>
    Promise.all(
      productWriteKeys(storeId, productId).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )

  const create = useMutation({
    mutationFn: (values: ProductFormValues) => api.create(values),
    onSuccess: (created) => retire(created.id),
  })
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ProductFormValues> }) =>
      api.update(id, values),
    onSuccess: (_, { id }) => retire(id),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: (_, id) => retire(id),
  })

  return { create, update, remove, isMutating: /* … */ }
}
```

`useMyStoreProducts` keeps the query and stops returning mutations. `isMutating`
(`:84`) is derived from all three in one place instead of in a route prop, so
finding 5 closes with it.

`MyStoreApi` shrinks to `list`/`remove` for the query hook's half, which is the
point: the type stops carrying members no caller uses.

### 3. Hoist the adapter into each app's api module — and flag the conflict

Once the form routes call the mutations, each of them needs a `MyStoreApi`. Left
alone that is four copies of the ten-line `useMemo` at
`web-application/app/my-store/page.tsx:46-55`. The adapter names app-specific
functions, so it belongs in the app's api module, where a module-level constant
is already stable and needs no `useMemo` at all:

```ts
// web-application/lib/api.ts  (and mobile-application/src/api/client.ts)
export const myStoreApi = {
  list: fetchMyProducts,
  create: createMyProduct,
  update: updateMyProduct,
  remove: deleteMyProduct,
} as const
```

**This contradicts `code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md:147-155`,
which keeps the adapter "in the route files, since it names app-specific
functions".** Both cannot land. The argument for moving it is that the stated
reason ("it names app-specific functions") is a statement about *which package*
the code lives in, not about which file — and the whole point of this change is
that four files now need it. If a reviewer prefers the route-file placement,
the honest cost is a `useMemo` block in each of the four routes, which is the
duplication this section exists to remove. Decide the two together; do not land
both independently.

### 4. The four routes call the seam, and the state machines disappear with it

```tsx
// web-application/app/my-store/new/page.tsx, after
onSubmit={async (values) => {
  try {
    await create.mutateAsync(values)
    router.replace("/my-store")
  } catch {
    // `create.error` is what ProductFormScreen renders; no local error state,
    // and no `cause instanceof Error` normalisation.
  }
}}
```

`isSubmitting` and `error` come from the mutation (`create.isPending`,
`create.error`), so the duplicated lifecycle at
`web-application/app/my-store/new/page.tsx:11-12, 26-39`,
`mobile-application/src/app/my-store/new.tsx:8-9, 24-37`,
`web-application/app/my-store/[id]/edit/page.tsx:29-30, 83-93` and
`mobile-application/src/app/my-store/[id]/edit.tsx:23-24, 78-88` — including
both copies of the non-`Error` fallback string — is deleted rather than
extracted. Note this is deliberately **not** a proposal to extract that state
machine into a shared hook; it stops existing.

The two comments at `web-application/app/my-store/new/page.tsx:31-34` and
`mobile-application/src/app/my-store/new.tsx:29-32` become true, which is the
cheapest possible proof the extraction was behaviour-preserving.

`Editor` in both edit routes stays exactly as it is. Its `isLoading`/
`!product` early returns (`:80-81`) sit above the submit handler, so a mutation
hook called from inside `Editor` is legal; this proposal does not touch that
component's shape.

## Impact

**Consistency.** One policy retires five key families instead of one. The
comments at `web-application/app/my-store/new/page.tsx:31-34` and
`mobile-application/src/app/my-store/new.tsx:29-32` stop contradicting the code,
and the ten raw key literals become five exported builders with one owner.

**Correctness — the reason this is worth doing.** After a seller write, the
marketplace list, the product detail page and the public storefront all refetch.
The five-minute window in which a buyer sees a price the seller has already
changed, and in which the client's `total` is wrong, closes. The server half is
already correct (`my_store.rs:137-139`); this makes the client agree with it.

**Testability.** The seam moves from zero direct tests to a `renderHook` suite in
the Vitest project that already runs (`vitest.config.web.ts:44` globs
`src/**/*.web.test.tsx`), modelled on `useInfiniteProducts.web.test.tsx:17-22`.
The invalidation policy becomes an assertion over five keys rather than a
comment, which is the seam the next write path (ratings, coupons, orders) will
be built against.

**Reuse.** Two of the hook's three mutations stop being dead code, four
hand-written submit state machines stop existing, and the adapter stops being
duplicated per route.

**Performance.** One thing gets deliberately worse and it should be said out
loud: a seller write now retires up to five query families instead of one, so
the seller's own next catalog visit costs a refetch it previously skipped. That
is the correct trade — the alternative is serving a buyer a price that does not
exist — but it is a real change in request volume on the write path, and
`staleTime` means each of those refetches happens at most once per key per
write.

**What does not improve.** The two per-app api clients stay duplicated (settled
at `improve-proposals/2026-10-03-seller-storefronts-my-store.md:172`, and this
proposal does not touch transport). `mobile-application` still has no unit test
runner, so the mobile half of finding 2 is verified by `tsc` and by Detox only.
The four route files keep their own transport calls — they are now the *only*
place a seller write touches the network, which is progress, not parity.
Nothing in `api-rs` changes. And this does not address the storefront's missing
pagination, the absent sign-out, or the design-token duplication; all three are
separate and none is claimed here.

## Risks / trade-offs

- **It touches the file a different proposal is already rewriting.**
  `web-application/app/my-store/page.tsx` and its three siblings are the subject
  of `…-move-seller-route-wiring-into-components-library.md`. If that lands
  first, this proposal shrinks: its `useMyStoreRoute(api, onCreate, onEdit)`
  composes `useMyStoreProducts(storeId, api)` and hands `onCreate`/`onEdit` to
  the routes, and the mutations hook slots in beside it. Land this first and that
  proposal's step 2 gets the invalidation for free. Do not land both touching
  the same 20 lines without deciding the order.
- **Hoisting the adapter contradicts that proposal's stated placement** (see
  step 3). It is called out rather than buried, but it is a real disagreement and
  a reviewer may reasonably land the `useMemo` in all four routes instead.
- **Invalidating `["products"]` on delete is a behaviour change a seller will
  notice**: the marketplace list refetches after they delete something. It is
  the same behaviour the hook's own doc comment already promises
  (`useMyStoreProducts.ts:37-39`).
- **The edit route writes the key it reads.** `web-application/app/my-store/[id]/edit/page.tsx:35`
  reads `["product", id]` and `:87` writes that product, so after this change
  `onDone()`'s redirect lands on a screen that must refetch. It already does,
  because `["my-store", storeId]` is `staleTime: 0`; this only extends the
  guarantee to the keys that were not stale.
- **Scope.** Extracting `Editor`, unifying the two api clients, adding a
  `useMutation`-per-form hook for screens that do not exist yet, and the
  `useProductFormSubmit` shape that finding 8 of the survey would suggest are all
  out of scope. The submit state machine goes away because the mutation replaces
  it, not because it was extracted.
- **A reviewer may reasonably ask for `refetchType: "all"` or an active-flag
  check** on the invalidations. Default `invalidateQueries` refetches active
  queries and marks inactive ones stale, which is the desired behaviour here:
  the marketplace list is not mounted while the seller is on `/my-store/new`, so
  it is marked stale and refetches on arrival. State that rather than leaving it
  implicit.

## Validation

1. `pnpm --filter @rnw/components-library test` — the new hook suite must pass,
   and `StoreScreen.web.test.tsx:77-81` (the `isMutating` test) must pass
   **unchanged**. That is the gate that splitting `isMutating` out of the route
   prop did not change what the screen does.
2. Negative check for the policy, in a scratch branch: drop
   `PRODUCTS_KEY` from `productWriteKeys` and confirm the new suite fails. If it
   passes, the suite is not asserting the thing this proposal is about.
3. The behavioural regression test, also in a scratch branch: with a
   `QueryClient` at the **production** `staleTime` (`providers.tsx:13`), render
   a component that reads `useInfiniteProducts`, then fire
   `useMyStoreMutations(...).create.mutate`, then re-render the reader and assert
   `fetchProducts` was called twice. This is the test that fails before the
   change and passes after, and it is the only way to see the five-minute window
   — the existing harness forces `staleTime: 0`
   (`web-application/tests/my-store.test.tsx:43-45`), which hides it.
4. `pnpm --filter @rnw/web-application test` — 7 files. `my-store.test.tsx` must
   pass with **no edits**, in particular the delete assertion at `:116-132`.
   Then extend it: assert invalidation (not refetch count) after create, because
   refetch count cannot distinguish the two under `staleTime: 0`. Success is not
   "0 refetches" — it is that every remaining refetch assertion is a `staleTime:
   0` one or an explicit `isInvalidated` check.
5. Mechanical check of finding 1, the same shape as the evidence above:
   ```bash
   grep -rn '\.create\.mutate\|\.update\.mutate\|store\.create\|store\.update\|store\.remove' \
     --include='*.ts' --include='*.tsx' . | grep -v node_modules
   grep -rn 'invalidateQueries' --include='*.ts' --include='*.tsx' . | grep -v node_modules
   grep -rn 'createMyProduct\|updateMyProduct\|deleteMyProduct' \
     --include='*.tsx' web-application/app mobile-application/src/app
   ```
   After: the first shows four `create`/`update` call sites plus the two
   `remove` ones; the second shows one implementation and its tests; the third
   shows the api module and nothing inside an `onSubmit` or a `save`.
6. `pnpm typecheck && pnpm lint` — `src/index.ts:78-79` changes shape (two hook
   exports, a wider key-builder export list) and four route files lose their
   `useState` error plumbing, so this is the cheap check that no route kept a
   dangling import and no app still names a member that no longer exists.
7. `pnpm --filter @rnw/web-application test:e2e` — `e2e/my-store.spec.ts`
   exercises create and the edit journey against a live api-rs, which is the
   check that the seam change did not alter what is sent. Needs api-rs running
   and seeded. It does **not** assert cache freshness, so step 3 is the real
   proof.
8. `pnpm --filter @rnw/mobile-application test:e2e` — **not runnable without
   Xcode and a simulator**, and said so plainly. `e2e/my-store.e2e.ts`'s edit
   leg is the only check that reaches the mobile `Editor`'s new call, and this is
   not done until it runs green on a machine with a native build.
9. Not required, and honestly so: nothing in `api-rs` changes.
   `pnpm --filter @rnw/api-rs test` and `test:e2e` (the latter needs Docker) are
   unaffected, and `a_write_retires_every_cached_list_page`
   (`tests/e2e_my_store.rs:271-321`) is the server-side counterpart that proves
   the half that was already correct.

## Related proposals

- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md` — the proposal
  that created this code, and the decision this one enforces rather than
  reopens.** Line 158 states the intent verbatim: *"This is also the first
  mutation code in the repo — there is no `useMutation` or `invalidateQueries`
  anywhere yet — so `StoreScreen` establishes the pattern: `useMutation` for the
  write, then invalidate the owner's list query."* The hook implements that
  intent and all four write paths route around it, so the recorded decision and
  the shipped code disagree. This proposal makes the code match the decision
  that document already made. It does not reopen anything else in it: transport
  duplication stays (`:172`), `ownerId` stays off `ProductData` (`:149`), the
  generation counter stays (`:128`).
- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — related, not superseded, and the two must be ordered.** Overlap: both touch
  the same four route files, and this proposal's step 3 contradicts its step 2 on
  where the `MyStoreApi` adapter lives (see Risks). It does not touch the
  session gate, the `["product", id]` query read, the `Editor` block, or
  `ProductFormScreen`. Its `productQueryKey(id)` step overlaps with this
  proposal's `productKey(id)`: if it lands first, use that name and this one
  shrinks to the invalidation call sites; do not ship two builders for
  `["product", id]`. Its central claim — that the duplicated surface is the
  untested surface — is reinforced here rather than contradicted: the edit route
  it moves into `components-library` is the one screen with no test on either
  platform.
- **`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  and `improve-proposals/2026-10-03-21-51-50-storefront-read-path-pool-routing.md`
  — unrelated surface, and the reason the two halves disagree.** Both are
  entirely `api-rs` read paths (cache key builders, headers, pool routing,
  `catalog_total`). This proposal is entirely the client react-query cache. The
  relationship worth stating is that api-rs's server-side generation bump and
  bump-on-write (`my_store.rs:137-139`) is correct and tested, so those two
  proposals' work is not at risk — and neither of them can observe this bug,
  because the stale copy never leaves the browser.
- **`code-optimization-improve-proposals/2026-10-03-22-37-46-make-the-store-contract-executable.md`
  — unrelated surface (`api-rs` store traits).** No overlap.
- **`code-optimization-improve-proposals/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`
  and `…-2026-10-03-23-50-00-one-body-behind-the-platform-splits.md` —
  unrelated surfaces** (bundler/test config; the `Product`/`MainNav` platform
  pairs). Neither touches a query key, a mutation, or a route's data wiring.