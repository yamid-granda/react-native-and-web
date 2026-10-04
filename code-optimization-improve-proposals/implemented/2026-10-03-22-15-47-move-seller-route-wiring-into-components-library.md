# Move the seller route containers out of the per-app route files

## Problem / opportunity

The repo's stated architecture is that route files are *thin* per-app wrappers and
everything with behaviour lives in `components-library`
(`.agents/rules/component-reuse.md:10-15`, root `AGENTS.md` "Keep route
definitions in each app's existing router"). The three seller routes stopped being
thin when My Store landed, and the duplication is now measurable rather than
impressionistic.

Normalizing whitespace and dropping comments, the web/mobile route pairs for the
three seller screens are 83%, 80% and 89% line-for-line identical:

| web | mobile | code lines (web/mobile) | identical |
| --- | --- | --- | --- |
| `web-application/app/my-store/page.tsx` | `mobile-application/src/app/my-store/index.tsx` | 54 / 52 | 45 |
| `web-application/app/my-store/new/page.tsx` | `mobile-application/src/app/my-store/new.tsx` | 35 / 34 | 28 |
| `web-application/app/my-store/[id]/edit/page.tsx` | `mobile-application/src/app/my-store/[id]/edit.tsx` | 83 / 82 | 74 |

147 duplicated code lines across three screens. Two of the duplicated regions are
not "similar", they are **byte-identical**, and neither touches a single platform
API:

- `web-application/app/my-store/[id]/edit/page.tsx:61-103` and
  `mobile-application/src/app/my-store/[id]/edit.tsx:56-98` — the whole `Editor`
  component (41 lines) hashes to `6ee3ee044985ede8e06220fad5ca142d` on both
  sides. It reads a product through `useQuery`, calls `updateMyProduct`, and
  renders `ProductFormScreen`. Grepping that block for `router|Platform|window|
  solito|expo` returns nothing.
- `web-application/app/my-store/page.tsx:41-56` and
  `mobile-application/src/app/my-store/index.tsx:38-53` — the
  `useSessionStore` selector, the `storeId` comment, and the entire `useMemo`
  `MyStoreApi` adapter are identical, including the comment explaining why the
  key is the id and not the user object.

The per-app delta in all three files is only the three genuinely
platform-specific things: how the route param is read (`use(params)` vs
`useLocalSearchParams`), how `onSignIn` is spelled, and how a path is pushed
(`router.push("/my-store/new")` vs
`router.push({ pathname: "/my-store/[id]/edit", params: { id } })`).

Three concrete costs follow from this.

**1. The guard is copy-pasted six times.** `session.status === "loading"` →
`<Text className="p-6 text-muted">Checking your session…</Text>` and
`session.status === "anonymous"` → `null` appears at
`web-application/app/my-store/page.tsx:31-34`,
`web-application/app/my-store/new/page.tsx:16-19`,
`web-application/app/my-store/[id]/edit/page.tsx:40-43`, and at the three
mobile mirrors. The copy-paste rule that caused it is spelled out three times:
each route file's own doc comment says *"Split in two because of the rule of
hooks"* and repeats the `useRequireSession` doc's reasoning
(`components-library/src/business/AuthScreen/useRequireSession.ts:18-19` — the
hook deliberately returns a discriminated result "rather than rendering, so the
caller decides"). Nobody decided differently; they all decided the same thing six
times. `useRequireSession` stops at the boundary one step too early.

**2. The duplicated surface is the untested surface.**
`web-application/tests/my-store.test.tsx` covers `MyStorePage` and
`NewProductPage` (lines 6-7) but nothing anywhere references the edit route —
`grep -rn "EditProduct" web-application/tests web-application/e2e
mobile-application/e2e` returns no matches. So the one region that is
byte-identical across two apps (41 lines, including the save-error branch at
`web-application/app/my-store/[id]/edit/page.tsx:82-95`) is the one region with
no test on either platform. The unit test that would catch it is a
components-library test by construction — it needs no router, only an injected
`update` function — but there is nothing in components-library to point it at,
because the logic does not live there.

**3. `mobile-application` has no unit test runner at all.**
`pnpm turbo run test --dry-run` reports
`@rnw/mobile-application#test | <NONEXISTENT>`: `mobile-application/package.json`
has `lint`, `typecheck` and `test:e2e` but no `test`. Every line of mobile-only
code is therefore either e2e-only (Detox, which needs a native build per the
repo README) or unverified. That is a pre-existing gap and this proposal does not
try to close it, but it is the reason duplication on the mobile side is free
today: nothing would notice if the two copies drifted.

Nothing in `improve-proposals/` or `improve-proposals/implemented/` covers this.
`improve-proposals/2026-10-03-seller-storefronts-my-store.md` is the closest, and
it is explicit that it considered and *accepted* only the **transport**
duplication: line 172 says the two `request<T>` wrappers "land twice because
`components-library` deliberately has no api layer (fetchers are injected), so
the duplication is the existing architecture, not a shortcut." That reasoning is
correct and this proposal does not touch it — both api clients stay exactly where
they are. What the seller proposal did not address is the layer *above* the
transport: the session gate, the react-query wiring and the mutation adapter,
none of which need an api layer and none of which are routing. It specified that
screens go in components-library (§6) and that fetchers are injected (§6,
`useMyStoreProducts`), but left the composition between the two in the route
files. This proposal moves only that composition.

## Proposed approach

Keep the routes where they are and keep both api clients untouched. Move the
*containers* into `components-library/src/business/`, alongside the screens and
hooks they already sit next to. Three small additions, in dependency order.

### 1. A `SessionGate` component for the six-way-copied guard

New `components-library/src/business/AuthScreen/SessionGate.tsx`, following the
`SessionGuard` union already exported from `useRequireSession.ts:21-27`:

```tsx
export function SessionGate({
  onSignIn,
  children,
}: {
  onSignIn: () => void
  children: ReactNode
}) {
  const session = useRequireSession({ onSignIn })
  if (session.status === "loading") {
    return <Text className="p-6 text-muted">Checking your session…</Text>
  }
  return session.status === "anonymous" ? null : <>{children}</>
}
```

The loading markup is the part that had to be identical: `web-application/tests/my-store.test.tsx:87`
already asserts on the exact string `"Checking your session…"`, so one copy keeps
that selector working for both platforms. Export it from
`components-library/src/index.ts` next to `useRequireSession`.

`useRequireSession` stays exported and unchanged — `AuthScreen`'s story and the
tests that need the raw union still use it. `SessionGate` is the rendering
wrapper over it, which is exactly the split the hook's own doc comment was
reaching for.

Note the `children`-as-a-function question: it does not arise, because the guard
is always the outermost thing in a route file and the child is a sibling
component, not more hooks in the same function body. That is the same reason the
current routes already split into `MyStorePage` + `SignedInStore`.

### 2. A `useMyStoreRoute` hook for the adapter + query wiring

New `components-library/src/business/StoreScreen/useMyStoreRoute.ts`, holding
`web-application/app/my-store/page.tsx:40-56` verbatim and moving the two
navigation props to parameters:

```ts
export function useMyStoreRoute(api: MyStoreApi, onCreate: () => void, onEdit: (id: string) => void)
```

It owns `useSessionStore((state) => state.user)`, the `storeId` key, and
`useMyStoreProducts(storeId, api)`. Callers keep their own `useMemo` for `api`
(it references their app's four functions), so the hook takes it as an argument
rather than importing anything.

After this, `SignedInStore` in both route files becomes the four lines it was
always meant to be: `useMyStoreRoute(api, onCreate, onEdit)` returning props to
`<StoreScreen>`. The duplicated `useMemo` adapter goes too — but note it is
*already* duplicated for a reason this proposal does not change: it stays in the
route files, since it names app-specific functions.

### 3. A `ProductEditorScreen` for the byte-identical `Editor`

The 41-line block at
`web-application/app/my-store/[id]/edit/page.tsx:61-103` moves as-is to
`components-library/src/business/ProductFormScreen/ProductEditorScreen.tsx`,
taking the same four inputs the route already threads through
(`web-application/app/my-store/[id]/edit/page.tsx:37-55`): the fetched
`product`, `isLoading`, `error`, `isSubmitting`; plus `update`, `onDone`,
`onCancel`. It renders the existing `ProductFormScreen` unchanged.

The `useQuery` that loads the product stays in the route file, because its
`queryFn` is `() => fetchProduct(id)` — an app-specific function, and
`enabled: session.status === "authenticated"` needs the guard's status. The
query *key* (`["product", id]`) is currently written out in three places
(`web-application/app/marketplace/[id]/page.tsx:13`,
`web-application/app/my-store/[id]/edit/page.tsx:36`, and the mobile mirrors);
give it a `productQueryKey(id)` export next to the existing
`myStoreKey(storeId)` (`useMyStoreProducts.ts:27-29`) so the edit screen and the
detail screen cannot disagree about it. That is a real hazard, not a hypothetical
one: the detail screen's `useQuery` has no `enabled` gate and the edit screen's
does, so today they are already different queries that happen to share a key.

### What each route file becomes

`web-application/app/my-store/[id]/edit/page.tsx`, 103 lines → roughly 35:
`"use client"`, the `use(params)` read, `useQuery` with `productQueryKey`, the
`useState` pair, `<SessionGate>`, and `<ProductEditorScreen>`. The mobile twin,
98 → about 35, with `useLocalSearchParams` and `router.replace` in place of the
web spellings. Same shape for the other two routes.

### Tests, in components-library where the code now is

New `components-library/src/business/ProductFormScreen/ProductEditorScreen.web.test.tsx`
covers the branches that currently have no test on either platform: the loading
line, `Product not found.` for a `404` (which is also what "not yours" answers,
`web-application/app/my-store/[id]/edit/page.tsx:44-46`), the save error surfacing
through `error`, and `onDone` firing only after `update` resolves. It needs a
`QueryClientProvider` and a stub `update`, no router — which is the whole point of
the move. A `SessionGate.web.test.tsx` covers the three statuses, including that
`onSignIn` fires exactly once for `anonymous`.

The existing `web-application/tests/my-store.test.tsx` keeps its current
assertions against the route components; they should still pass unchanged, which
is the cheapest proof the extraction was behaviour-preserving. Its
`"Checking your session…"` assertion
(`web-application/tests/my-store.test.tsx:87`) is the one to watch — it now
asserts through `SessionGate` rather than through the route's own copy.

## Impact

**Reuse.** 147 duplicated code lines across three screens collapse to roughly 30
platform-specific ones, and the `Editor` block stops existing twice. That number
grows with the queue: `improve-proposals/` still holds server-side search, order
history, coupons, ratings and a shipping form, every one of which needs a screen
on both platforms and would otherwise copy the guard and the mutation wiring a
sixth and seventh time.

**Consistency.** One loading string, one query-key helper, one save-error branch.
The `["product", id]` key stops being written out in four places with two
different `enabled` behaviours.

**Testability.** This is the real gain. The edit screen's save/loading/not-found
branches become reachable from a plain Vitest test with an injected `update`,
instead of sitting in a route file that needs a router on both platforms — which
is why they have no test today. `components-library` already has the right
harness for it: `vitest.config.web.ts` runs `src/**/*.web.test.tsx` in jsdom
through react-native-web, and `AuthScreen.web.test.tsx` /
`ProductFormScreen.web.test.tsx` already use it this way.

**Performance.** No change, and none expected. Nothing here runs per-item or per
render in a hot path; `SessionGate` adds one component boundary to three route
mounts.

**What does not improve.** The transport duplication stays: both
`web-application/lib/api.ts` and `mobile-application/src/api/client.ts` remain,
95 of ~100 code lines identical between them, because
`improve-proposals/2026-10-03-seller-storefronts-my-store.md:172` settled that
and the reasoning still holds. `mobile-application` still has no unit test runner,
so this proposal does not make mobile-only code verifiable — it makes less
mobile-only code exist. And `ProductListScreen.tsx` / `.web.tsx` (which are
legitimately different: `FlatList` virtualization vs a CSS grid with an
`IntersectionObserver`) are untouched.

## Risks / trade-offs

- **This contradicts a documented decision, so it needs the argument, not just the
  diff.** The seller proposal accepted duplication on the grounds that
  components-library has no api layer. That argument does not apply to the guard,
  the query wiring or the mutation adapter — none of them reach for `fetch`, and
  all three already take injected functions. If a reviewer reads "another
  extraction" rather than "a different layer", the proposal dies on framing. The
  diff should make the boundary obvious: nothing in `components-library/src`
  gains an import of `lib/api` or `api/client`.
- **Route files stop being self-explanatory.** Today `app/my-store/page.tsx`
  reads top-to-bottom as the whole screen. After this, reading it tells you the
  routing and not the behaviour. Mitigation is that the extracted names
  (`SessionGate`, `useMyStoreRoute`, `ProductEditorScreen`) say what they do, and
  that the shared equivalents (`StoreScreen`, `ProductFormScreen`,
  `useMyStoreProducts`) already established the props-in-no-fetching convention
  — `StoreScreen.tsx:31-38` and `ProductFormScreen.tsx:41-51` both document it.
- **`SessionGate` renders `<>…</>` around children**, which adds a fragment to
  the tree. Harmless for a route root, but it does mean `SessionGate` is not a
  drop-in for a screen that must be the sole root of a `<Stack.Screen>`.
- **The `productQueryKey` extraction touches the marketplace detail route**, which
  is outside the seller feature. It is a two-line change in each of four files and
  it is the one part of this that could regress a screen with existing tests
  (`web-application/tests/marketplace-detail.test.tsx`) — worth running those
  first, before the seller changes.
- **Scope creep risk.** The obvious "while we're here" moves — merging the two api
  clients, adding a Vitest project to `mobile-application`, splitting
  `ProductListScreen` — are all out of scope and each is a separate proposal.

## Validation

Targeted, in this order:

1. `pnpm --filter @rnw/components-library test` — the two new suites plus the
   existing 40 files must pass; in particular
   `ProductFormScreen.web.test.tsx` and `AuthScreen.web.test.tsx`, which are the
   nearest neighbours.
2. `pnpm --filter @rnw/web-application test` — `tests/my-store.test.tsx` must pass
   **unchanged**, including the `"Checking your session…"` assertion at line 87
   and the create-flow assertions at lines 156-193. If any needed editing, the
   extraction changed behaviour. Run `tests/marketplace-detail.test.tsx` here too,
   since `productQueryKey` touches that route.
3. `pnpm typecheck && pnpm lint` — the cross-package surface changes
   (`components-library/src/index.ts` gains three exports; six route files lose
   imports of `useRequireSession`, `StoreScreen`, `ProductFormScreen`,
   `useMyStoreProducts`, `useSessionStore`), so both are the cheap check that no
   route file kept a dangling import.
4. Line-count check, the same measurement that produced the table above: re-run
   the normalized diff over the three route pairs. Success is *not* "0 identical
   lines" — it is that every remaining identical line is either a comment or a
   genuinely shared value (`storeId` derivation, `updateMyProduct` call shape).
   `Editor` should no longer appear in either route file.
5. `pnpm --filter @rnw/web-application test:e2e` — `e2e/my-store.spec.ts`
   exercises the full seller journey including the edit screen
   (`/my-store/.+/edit` → save → back to the list), so it is the real check that
   the navigation props landed on the right callbacks. It mutates the dev
   database and needs api-rs running.
6. Not runnable here, and honestly so: `pnpm --filter @rnw/mobile-application
   test:e2e` needs a native build and a simulator, per the README. The Detox
   `e2e/my-store.e2e.ts` edit leg is the check that would cover the mobile route
   files, and it must be run on a machine with Xcode before this is called done.

## Related proposals

- `improve-proposals/2026-10-03-seller-storefronts-my-store.md` — the proposal
  that created these three routes. **Related, not superseded.** Line 172 of that
  document explicitly accepts duplication of the *transport* and says so; this
  proposal accepts that decision and moves only the layer above it. If both are
  accepted, that document's §6/§8 stand as written and its §8 gains a note
  pointing here for the container half.
- `improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`
  and `improve-proposals/implemented/2026-10-01-marketplace-api-high-traffic-performance.md`
  — api-rs only, no overlap.
- `improve-proposals/implemented/2026-09-29-*.md` — feature work on search,
  sorting, wishlist, recently-viewed and stock. No overlap; if the sort/price
  filter proposal is taken up next, its `useProductSearch` work is unaffected by
  this change.