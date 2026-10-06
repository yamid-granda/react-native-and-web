# The 401 sign-out reaches two of the six seller routes, because the hook that owns it is not the hook the other four call

## Problem / opportunity

The repository has exactly one implementation of "an expired session signs the seller
out". It is correct, it is tested, and it is **unreachable from four of the six My
Store route files** — including every route that performs a write. There is no
sign-out button anywhere in either app, so on those four routes nothing else can
perform the sign-out either: the seller is left holding a dead token, re-reading
the same failure on every retry, with no way back to the login screen.

The cause is an ownership decision, not a missing feature. The policy lives
*inside* `useMyStoreRoute`, which is the list route's composition hook. The four
form routes compose `useMyStoreMutations` directly, and the helper is
module-private, so they cannot reach it even if they wanted to.

### 1. There is one implementation, and it is private

```ts
// components-library/src/business/StoreScreen/useMyStoreRoute.ts:8-10
function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401
}
```

```ts
// components-library/src/business/StoreScreen/useMyStoreRoute.ts:21-28
function useSignOutOnUnauthorized(...errors: Array<unknown>) {
  const clear = useSessionStore((state) => state.clear)
  const unauthorized = errors.some(isUnauthorized)

  useEffect(() => {
    if (unauthorized) clear()
  }, [unauthorized, clear])
}
```

No `export` on either, and `src/index.ts` exports `useMyStoreRoute`,
`useMyStoreMutations` and `useMyStoreProducts` (`:100-101`, `:90-98`) but no
sign-out helper — verified: `grep -c "useSignOut" components-library/src/index.ts`
returns `0`. The repository's entire 401-sign-out surface is therefore two
call sites in one file:

```
$ grep -rn "useSignOutOnUnauthorized" --include="*.ts" --include="*.tsx" \
    components-library web-application mobile-application
components-library/src/business/StoreScreen/useMyStoreRoute.ts:21:function useSignOutOnUnauthorized(...errors: Array<unknown>) {
components-library/src/business/StoreScreen/useMyStoreRoute.ts:52:  useSignOutOnUnauthorized(
```

`ApiError.status` — the field `transport.ts:32-38` says exists *because*
"callers branch on 401" — has exactly one reader in the whole client, and it is
in that unreachable-from-elsewhere function.

### 2. Two of six seller routes get it; the four that write do not

`useMyStoreRoute` is called from two files, both list routes:

```
$ grep -rn "useMyStoreRoute(" --include="*.tsx" web-application/app mobile-application/src
web-application/app/my-store/page.tsx:30:  const store = useMyStoreRoute(
mobile-application/src/app/my-store/index.tsx:26:  const store = useMyStoreRoute(
```

The four form routes call the other hook:

```
$ grep -rn "useMyStoreMutations(" --include="*.tsx" web-application/app mobile-application/src
web-application/app/my-store/new/page.tsx:20:  const store = useMyStoreMutations(storeId, myStoreApi)
web-application/app/my-store/[id]/edit/page.tsx:49:  const store = useMyStoreMutations(storeId, myStoreApi)
mobile-application/src/app/my-store/new.tsx:17:  const store = useMyStoreMutations(storeId, myStoreApi)
mobile-application/src/app/my-store/[id]/edit.tsx:42:  const store = useMyStoreMutations(storeId, myStoreApi)
```

That split is not a cosmetic detail — it maps exactly onto who can 401:

| Route | Call | Sign-out on 401? |
| --- | --- | --- |
| `my-store` (web + mobile) | `useMyStoreRoute` → `useSignOutOnUnauthorized` | **yes** |
| `my-store/new` (web + mobile) | `useMyStoreMutations` | **no** |
| `my-store/[id]/edit` (web + mobile) | `useMyStoreMutations` | **no** |

`SessionGate` does not save them. It reads `useSessionStore`'s `status`
(`SessionGate.tsx:28-33`) and only redirects on `"anonymous"`, a state nothing
sets on those routes — the token is still in storage and still says
`"authenticated"`. `useSessionBootstrap` cannot save them either: it returns
immediately unless `status === "loading"` (`useSessionBootstrap.ts:32`), and after
one successful validation the status is permanently `"authenticated"`.

So on `/my-store/new` an expired seller submits the form, `createMyProduct`
(`transport.ts:183-194`) throws `ApiError` with `status: 401`, and
`ProductFormScreen` renders it:

```tsx
// components-library/src/business/ProductFormScreen/ProductFormScreen.tsx:143-145
{error ? (
  <ClassNameText className="text-sm text-foreground">Error: {error.message}</ClassNameText>
) : null}
```

which, given `ApiError`'s message format (`transport.ts:43-48`, `` `${path}: ${message}` ``),
is the string `Error: /my-store/products: Unauthorized`. Pressing "Create
product" again repeats it. So does navigating back to `/my-store` — except that
route *is* covered, so it signs the seller out on the list read and lands them on
the login screen. The recovery exists, and it is one route away and not
discoverable from the screen showing the error.

The edit route is the same with one extra step: it reads the product through the
**public** `GET /products/{id}` (`app.rs:83` — no `AuthUser` extractor, unlike the
four `my_store.rs` handlers at `:55`, `:72`, `:95`, `:120`), so the form loads
normally, `loadError` stays undefined, and only the write fails.

### 3. There is no other way for a seller to sign out

```
$ grep -rni "sign out\|log out\|signout\|logout" --include="*.tsx" --include="*.ts" \
    components-library/src web-application mobile-application
components-library/src/api/transport.ts:164:  function logout() {
components-library/src/api/transport.ts:241:    logout,
web-application/lib/api.ts:31:    logout,
mobile-application/src/api/client.ts:44:    logout,
```

`logout()` exists in the transport (`transport.ts:164-166`), is re-exported by both
app clients, and has **zero call sites**. Nor is there any other control: the only
affordances on a seller screen are Edit / Delete / Add product
(`StoreScreen.tsx`), the tab bar's Theme button
(`mobile-application/src/app/(tabs)/_layout.tsx:73-77`) and the cart/wishlist
badges. A seller who notices their session died has no button to press. This was
already known and explicitly deferred — `implemented/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md:400`
lists "the absent sign-out" among what it does not address. That deferral was about
the *button*. It is not the same thing as the *automatic* sign-out silently not
reaching four routes, which is what this proposal is about.

### 4. A shipped test asserts the coverage that does not exist

```tsx
// components-library/src/business/StoreScreen/useMyStoreRoute.web.test.tsx:83-85
it("signs the seller out when a write comes back 401", async () => {
  // `onDelete` is the only write this route exposes; it stands in for the
  // create/edit routes, which run the same hook against their own forms.
```

**"run the same hook" is false.** They run `useMyStoreMutations`
(`new/page.tsx:20`, `[id]/edit/page.tsx:49` and their two mobile twins), and
`useSignOutOnUnauthorized` is called only from `useMyStoreRoute:52`. The test is
green, it is the *only* test of this policy, and its comment tells the next reader
the four uncovered routes are covered. This is the same failure shape the pending
`todo/` proposal documents at length for `DelegatingStore` — a comment asserting
coverage that a line number contradicts.

## Proposed approach

Two steps. The first moves the policy to the hook every seller write already
calls; the second makes the test say what it actually proves. No route wiring
changes, because the fix is that routes stop needing any.

**1. Move the policy into `useMyStoreMutations`, beside the writes it watches.**
`api-rs/src/store/…` is irrelevant here; the relevant fact is that all six seller
routes reach `useMyStoreMutations` — `useMyStoreRoute.ts:50` calls it, and the four
form routes call it directly. Put `isUnauthorized` and the `clear()` effect in
`components-library/src/business/StoreScreen/useMyStoreMutations.ts`, applied to
`create.error`, `update.error` and `remove.error`, then reduce
`useMyStoreRoute.ts:52-57` to the one thing it alone owns — the **list read**'s
401, `store.error`. That keeps the behaviour the current tests pin (a 401 on
`onDelete` still signs out, `useMyStoreRoute.web.test.tsx:83-98`) and adds the four
routes that had nothing.

Moving it rather than exporting it is deliberate: `useMyStoreMutations` is already
imported by every affected route, and an exported hook that each caller must
remember to call is exactly the failure being fixed.

**2. Correct the claim, and make it falsifiable.** Replace
`useMyStoreRoute.web.test.tsx:84-85` with the true statement — that `onDelete`
exercises the list route's *own* delete write, and that create/update reach the
policy through `useMyStoreMutations` instead — and move the policy's tests to
`useMyStoreMutations.web.test.tsx`, which already has the `renderHook` +
`QueryClientProvider` harness (`:61-68`). One case per mutation rejecting with
`new ApiError(path, 401, "Unauthorized")`, asserting
`useSessionStore.getState().status === "anonymous"`, is the whole regression net
and is three short tests.

Keep the existing "a 500 must not sign the seller out" case
(`useMyStoreRoute.web.test.tsx:100-109`) and its reasoning: a transient fault must
not discard a valid token. That guard is why the policy checks `status === 401`
and not merely `error != null`, and it must survive the move.

**Deliberately not in this change: a sign-out button.** That is the deferred item
at `implemented/…-one-mutation-seam…:400` and a feature, not a correctness fix. It
is also not blocked by this proposal — once the policy reaches the form routes, a
button is a call to `useSessionStore`'s `clear` plus `logout()`, and the wiring
this proposal removes is what a button would otherwise have to duplicate.

## Impact

**Correctness.** Four route files across two apps stop stranding a seller on a dead
token. Today `/my-store/new` and `/my-store/[id]/edit` render
`Error: /my-store/products: Unauthorized` indefinitely; after this they redirect to
the login screen through the `SessionGate` they are already wrapped in
(`new/page.tsx:21`, `[id]/edit/page.tsx:31`, `new.tsx:20`, `[id]/edit.tsx:29`) —
no new wrapper, no new route.

**Reuse and consistency.** One policy, owned by the hook all six routes already
call, instead of one private helper reachable from two. `useMyStoreRoute` keeps
exactly what is uniquely its own.

**Testability.** The policy stops being one test whose comment overstates it, and
becomes three tests that pin it. It also gains a home whose subject is the policy
rather than the list route.

**For an agent — the part that matters.** The cheapest wrong move here is to read
`useMyStoreRoute.web.test.tsx:83-85`, believe the four form routes are covered, and
add a fifth My Store route calling `useMyStoreMutations` with no further thought.
That route would silently inherit the gap. After this, "what happens when a
session expires?" has one answer in one file, and it is true.

**What does *not* improve, stated plainly.** Nothing changes for a seller whose
session is valid, and nothing about latency, request volume or rendering. This does
not give either app a sign-out control — the deferral above stands. It does not
change the server's 401 contract, which `middleware/session.rs:39-45` already
enforces and `error.rs:125-133` already pins. And on the list route the observable
behaviour is unchanged, so no existing test should need editing — only its comment.

## Risks / trade-offs

- **A test that must not change is adjacent to a comment that must.**
  `useMyStoreRoute.web.test.tsx:83-98` asserts `onDelete`'s 401 signs out; that
  assertion stays true and should pass unmodified. Only the comment changes. If it
  fails, step 1 moved too much — the list route's own read/write handling is still
  correct and should not have moved with the write half.
- **It puts a session concern inside a react-query hook.** `useMyStoreMutations`
  currently imports only react-query (`useMyStoreMutations.ts:1-3`) and is a pure
  cache-policy module; adding `useSessionStore` gives it a second reason to exist.
  The alternative — a sibling `useSignOutOn401(errors)` exported from `index.ts` —
  keeps the modules single-purpose but reintroduces the failure mode this fixes,
  since a caller must remember to call it. Choose deliberately; the argument above
  is that a policy which is easy to forget has already failed once.
- **The false comment may not be the only place the belief was recorded.** Grep for
  it (`grep -rn "stands in for the" components-library`) before landing, and treat
  any second hit as part of step 2 rather than as new work.
- **Touching a file another proposal may be editing.** `useMyStoreMutations.ts` is
  read by `todo/2026-10-05-23-55-37-one-owner-for-the-store-test-double.md`, but
  only to cite it — that proposal's edits are `api-rs/src/store/delegating.rs`, the
  `#[cfg(test)]` modules of `handlers/products.rs` and `handlers/stores.rs`, and two
  markdown files. No overlap in files under edit.

## Validation

1. **The suite passes and the protected behaviour is unchanged.**
   `pnpm --filter @rnw/components-library test`, then confirm
   `useMyStoreRoute.web.test.tsx` passes **with only its comment edited** — the
   `onDelete` 401 case, the 500 case, and the read-succeeds case.
2. **The new tests fail without the fix** (scratch branch). Add the three
   `useMyStoreMutations` cases, revert step 1, confirm they fail; re-apply, confirm
   they pass. A test that cannot be shown to fail is not a test — the same
   requirement the pending `todo/` proposal states for its own new test.
3. **The false claim is gone.** `grep -rn "runs the same hook" components-library`
   returns nothing, and `grep -rn "useSignOutOnUnauthorized" components-library/src`
   shows the policy reached from `useMyStoreMutations.ts` rather than only from
   `useMyStoreRoute.ts`.
4. **Reach is measured, not asserted.** After the change,
   `grep -rn "useMyStoreMutations(" --include="*.tsx" web-application/app mobile-application/src`
   lists four files and each of them is covered by the moved policy — that mapping
   is the finding, so it is the thing to re-check.
5. **Typecheck and lint.** `pnpm typecheck && pnpm lint`; `useMyStoreMutations.ts`
   gains an import and a `useEffect`, and `useMyStoreRoute.ts` loses a private
   helper.
6. **Manual pass, both platforms.** Register, let the session lapse (or point
   `SESSION_TTL_SECS` at a few seconds — `config.rs:61`), then submit the create
   form. Expect the login screen, not `Error: /my-store/products: Unauthorized`.
   Repeat on `/my-store/[id]/edit`. `pnpm --filter @rnw/mobile-application test:e2e`
   is **not runnable without Xcode and a simulator** and is not required here; the
   change is platform-agnostic TypeScript in `components-library`, and step 2's
   tests are the real check on the mobile half.
7. **No regression on the write path.** `pnpm --filter @rnw/web-application test`
   (`my-store.test.tsx` covers create and delete through the seam) and
   `pnpm --filter @rnw/web-application test:e2e` for the seller journey.
   `pnpm --filter @rnw/api-rs test` is unaffected — nothing in `api-rs` changes.

## Relationship to existing proposals

**Not a duplicate of any of them, and adjacent to two.** Verified: `grep -rn "useSignOut\|ApiError.status\|isUnauthorized\|sign out on" code-optimization-improve-proposals/` returns nothing, and no proposal in any folder mentions a 401-clears-session policy on the client.

- **`implemented/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`
  — the direct parent, and the proposal whose split created the gap.** Its step 2
  extracted `useMyStoreMutations` *so the form routes could reach the mutations*
  (`:264-290`), and its Risks section predicted exactly the interaction that then
  happened: a shared hook reached by more routes than the one that owns the
  surrounding policy. It also lists "the absent sign-out" at `:400` among what it
  does not address — that is the missing *button*, a deferred feature. This
  proposal is not a restatement of that deferral; it is the automatic sign-out
  that already exists and reaches only the list route. Complementary, not
  superseded.
- **`implemented/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — created `useMyStoreRoute`** (`:136-160`) and is where the private helper was
  placed. This proposal keeps the hook and narrows its responsibility to the list
  read; it does not reverse the composition that proposal landed.
- **`todo/2026-10-05-23-55-37-one-owner-for-the-store-test-double.md`** — cites
  `useMyStoreRoute.ts:278-280` as one of three places naming the single-store-
  handle cause. Its own findings are about `api-rs/src/store/delegating.rs` and two
  handler test modules. It reaches this file only as a citation; no file overlap
  under edit.
- **`in-progress/2026-10-05-22-36-04-cached-payload-size-is-unowned.md`** —
  concerns cache entry sizing and uncapped `description` / `imageUrl` in
  `api-rs/src/cache/` and `handlers/my_store.rs`. Untouched by this proposal;
  nothing in `api-rs` changes here.

**Nothing in `in-progress/` claims this area** — its single entry is the cache
payload sizing above, which touches `api-rs` only and shares no file with this one.