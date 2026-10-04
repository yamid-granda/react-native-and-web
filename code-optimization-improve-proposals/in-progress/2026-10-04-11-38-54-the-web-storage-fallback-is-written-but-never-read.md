# The web storage fallback is written but never read, so a blocked browser loses the cart and the seller's session

## Problem / opportunity

`components-library/src/utils/persistStorage.ts` is 67 lines and is the
**persistence policy for the whole shared UI package**. Four stores use it, and
the fourth holds a credential:

| store | call site | storage key | what is persisted |
| --- | --- | --- | --- |
| `useCartStore` | `useCartStore.ts:3`, `:66` | `cart-storage` | `Record<string, { product: ProductData, quantity }>` |
| `useWishlistStore` | `useWishlistStore.ts:3`, `:32` | `wishlist-storage` | `Record<string, ProductData>` |
| `useRecentlyViewedStore` | `useRecentlyViewedStore.ts:3`, `:26` | `recently-viewed-storage` | `ProductData[]`, capped at 10 |
| **`useSessionStore`** | `useSessionStore.ts:3`, `:54` | `session-storage` | **the seller's bearer token** (`useSessionStore.ts:25`) |

It exports one factory with two adapters and a `typeof` probe:

```ts
// components-library/src/utils/persistStorage.ts:63-67
export function createPersistStorage<T>() {
  return createJSONStorage<T>(() =>
    typeof localStorage !== "undefined" ? webStorage : inMemoryFallback
  )
}
```

`inMemoryFallback` (`:14-22`) is coherent: all three methods use `memoryStorage`.
`webStorage` (`:24-51`) is not, and that is the finding.

### 1. `webStorage`'s three methods have three different fallback policies

```ts
// components-library/src/utils/persistStorage.ts:25-34
getItem: (name) => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(name)
  } catch {
    // Safari in private mode, and any browser with storage blocked by policy.
    // A cart is worth an in-memory copy; failing to read it must not throw
    // during the first render.
    return null
  }
},
```

```ts
// components-library/src/utils/persistStorage.ts:35-42
setItem: (name, value) => {
  try {
    localStorage.setItem(name, value)
  } catch {
    // A full quota must degrade to in-memory, not crash a click handler.
    memoryStorage.set(name, value)
  }
},
```

```ts
// components-library/src/utils/persistStorage.ts:43-50
removeItem: (name) => {
  try {
    localStorage.removeItem(name)
  } catch {
    // Same reasoning as setItem.
  }
  memoryStorage.delete(name)
},
```

Read the three together and the policy is incoherent:

- **`setItem` writes `memoryStorage` on failure** (`:40`).
- **`getItem` never reads it.** Its `catch` returns `null` (`:32`), and the
  success path is `localStorage.getItem` alone. `memoryStorage` appears nowhere
  in the read path.
- **`removeItem` treats it as live, unconditionally** (`:49`) — outside the
  `try`, so it runs whether or not `localStorage` succeeded. It is the *only*
  one of the three that does.

So a value written through the fallback lands in a `Map` that no read path
consults, and the one method that knows the `Map` exists is the one that deletes
from it.

### 2. What that costs, precisely

When `localStorage.setItem` throws, **every write for all four stores lands
where nothing will read it.** On the next hydration each store's `getItem`
returns whatever `localStorage` holds — the pre-failure value, or `null` — and
the `Map` copy is orphaned, never read and never reclaimed until a `removeItem`
happens to clear it.

For three stores that is a lost cart. For `useSessionStore` it is a lost
credential, and that store's own doc comment already names the outcome:

> `components-library/src/business/AuthScreen/useSessionStore.ts:29-30`
> ```
>  * fallback is an in-memory `Map`, so the session is dropped on any JS reload and
>  * the seller is silently signed out.
> ```

**That sentence is written about native.** It is scoped by the sentence before it
(`:28-29`, "on native the fallback is an in-memory `Map`"). But on web the same
outcome occurs for a different reason — a storage API that is *present and
failing* rather than absent — and nothing anywhere says so. A seller in a browser
whose `localStorage.setItem` throws appears signed in until the next reload, then
is silently signed out, with no log and no test.

### 3. Three comments state the intent the code does not deliver

```
// persistStorage.ts:30-31
// A cart is worth an in-memory copy; failing to read it must not throw
// during the first render.
```

An in-memory copy that no read path ever consults is not a copy of anything.
This comment is attached to the one method that fails to read it.

```
// persistStorage.ts:39
// A full quota must degrade to in-memory, not crash a click handler.
```

Literally true and functionally void: it degrades into a dead store. The
click handler survives, which is the half that was easy and the half that is not
what the sentence is for.

```
// persistStorage.ts:9-11
// One module, because this block was duplicated verbatim in three stores and a
// fourth copy is what "follow the existing pattern" produces.
```

The consolidation is correct and should stay. What it consolidated is a policy
with three answers, and the comment reads as though one module means one policy.

### 4. The module's on-web justification was fixed by a later change and never revisited

```
// components-library/src/utils/persistStorage.ts:3-7
// react-native-web's MainNav renders a plain <a href>, which Next.js doesn't
// intercept for client-side routing — navigating to /cart is a full page reload,
// which would otherwise wipe an in-memory-only store. Persist to localStorage on
// web; React Native has no localStorage, but its navigation never reloads the JS
// runtime, so an in-memory fallback there is enough.
```

`MainNav.web.tsx:6-9` says the opposite, and is the current code:

```
// components-library/src/common/MainNav/MainNav.web.tsx:6-9
// react-native-web-only `href` (README) — solito/navigation's useLink drives
// it now so a left-click becomes a real Next.js client-side transition
// instead of a full page reload, while still rendering a real <a href> for
// modifier-clicks/middle-clicks/right-click-copy-link to keep working.
```

The bug that motivated persisting on web was fixed. The fallback that grew up
around it was not, which is how a working module ends up carrying a rationale
that no longer describes it and a code path that does not work.

### 5. The adapter that runs in production on both apps has no test

`createPersistStorage` selects the adapter by `typeof localStorage` (`:65`), so
the two existing Vitest projects exercise **different** adapters:

| project | environment | `localStorage` | adapter reached |
| --- | --- | --- | --- |
| `utils` — `vitest.config.utils.ts:8`, `:10` globs `src/**/*.test.ts` | `"node"` | undefined | `inMemoryFallback` |
| `web` — `vitest.config.web.ts:41`, `:44` globs `src/**/*.web.test.tsx` | `"jsdom"` | defined | **`webStorage`** |

So `useCartStore.test.ts`, `useWishlistStore.test.ts` and
`useRecentlyViewedStore.test.ts` all run the **native** adapter — a fact
`2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md:158-160`
already records. The only test that reaches `webStorage` is
`useSessionStore.web.test.tsx`, and it exercises the **happy path only**, where
jsdom's `setItem` succeeds (`:46-57`). Its rehydration fixture at `:122-125`
writes `localStorage.setItem(...)` **directly**, bypassing the adapter's own
write path entirely.

**Nothing anywhere stubs a throwing `localStorage`.** The complete set of test
sites mentioning it is `useSessionStore.web.test.tsx:10`, `:14`, `:48`, `:51`,
`:122` — five hits, all on the succeeding path.

And `src/utils/` has no test for `persistStorage.ts` at all: the directory is
`cn.ts` + `cn.test.ts`, `formatPrice.ts` + `formatPrice.test.ts`,
`persistStorage.ts`.

The three fallback branches — the only reason this module is 67 lines instead of
20 — have zero coverage. This is the same shape of finding as
`2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md` §3: an
adapter that exists precisely to handle a failure, with no test that can reach
the failure.

### Stated honestly, the trigger is not the common case

This requires the storage API to be **present and failing**: Safari Private
Browsing past its quota, an origin at its ~5 MB quota, storage blocked by policy
or in a sandboxed frame. It is not "this happens to every shopper", and I am not
claiming that. The point is narrower and is the reason it is worth writing down:
**the degradation path was written on purpose, its own comments say what it is
supposed to do, it does not do it, and no test in the repository can see that.**
The repo has already accepted that these catch paths are reachable —
`persistStorage.ts:29` names them.

### Why this is the expensive kind of knowledge

An agent asked to *"make the cart survive a Safari private-mode session"* or
*"stop losing the seller session"* reads `persistStorage.ts:35-42`, sees
`memoryStorage.set(name, value)`, and concludes the job is done. Discovering
otherwise requires reading a second, non-adjacent method — and then a third at
`:43-50` — to establish that the `Map` is write-only. The two files it would also
want (`useSessionStore.ts:27-37`, `MainNav.web.tsx:6-9`) both contain statements
that point the opposite way.

This is the sixth instance in this repository of the same failure class, and the
other five each have a proposal: a comment that outran its implementation
(`stores.rs:90-92`), three descriptions of a reaper that does not exist
(`2026-10-04-04-06-14-the-session-table-has-no-reaper.md`), four descriptions of a
dark-mode contract with no implementation
(`2026-10-04-05-04-58-the-design-tokens-have-no-owner.md`), a documented
resolution order five tools do not share
(`2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`), and a
documented navigation difference that no longer exists
(`2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md` §1). The
common remedy is the same in all of them: make the contradiction a test failure
instead of a comment.

## Proposed approach

Keep `createPersistStorage`, keep its name, keep its export through
`components-library/src/index.ts:96`, keep both storage keys and all four
stores, and keep `inMemoryFallback` byte-for-byte — it is correct. Change two
things: give `webStorage` one fallback rule instead of three, and put a test
where the branches are.

### 1. One fallback decision, taken once

The shape of the fix depends on a product decision the reviewer should make
explicitly rather than inherit. Both endings are defensible.

**(a) Preferred — make the `Map` a real session-lifetime overlay.**

```ts
/**
 * `localStorage` is the durable store; `memoryStorage` is the copy that
 * survives the page's lifetime when the durable one refuses a write.
 *
 * Read through, write through, clear both. The asymmetry this replaces was:
 * writes fell back to the Map, reads never looked there, and only `removeItem`
 * knew it existed — so a quota-exceeded write was written and never read back.
 */
```

Concretely: `getItem` returns `localStorage.getItem(name)` and falls back to
`memoryStorage.get(name) ?? null`; `setItem` writes `memoryStorage` **always**
and `localStorage` best-effort; `removeItem` clears both. One rule, stated once:
*the Map is authoritative within the session, `localStorage` is authoritative
across sessions, and neither is allowed to disagree.*

This is recommended because it is what the module already claims to do
(`:30-31`, `:39`), what native already gets, and what a storage-blocked browser
needs most: with it, such a browser behaves like native — signed in from the
`Map` for the page's lifetime, rather than losing the session on every reload.

Note that `removeItem`'s unconditional `memoryStorage.delete(name)` (`:49`) is
already the correct behaviour under (a) and becomes the one piece of the current
code that was right.

**(b) Minimal — drop the fallback from `webStorage` and say so.**

A failed `setItem` becomes a no-op; `webStorage` is a thin, honest pass-through
and `inMemoryFallback` stays native-only. Fewer lines and a true statement, but
it is a decision to **stop** degrading gracefully, which changes behaviour for
exactly the browsers `:29` names. That is a product call, not a refactor, and it
should not be reached by default.

Whichever is chosen, the three methods must agree, and the rule belongs in one
comment rather than in three separate justifications.

### 2. Correct the rationale in the same commit

`persistStorage.ts:3-7` is contradicted by `MainNav.web.tsx:6-9`. Either drop
the paragraph or replace it with the current reason web persistence exists. Do
not leave it: it is the paragraph a reader trusts when deciding whether the
fallback matters.

The honest replacement is one sentence: *web persists so a browser reload does
not drop the cart or the session; native gets an in-memory `Map` because it has
no `localStorage`.* Note what that sentence does **not** need to claim — it does
not need to name a navigation bug that is fixed.

### 3. `src/utils/persistStorage.web.test.tsx` — the missing seam

New file, in the `web` project, matched by the existing glob
(`vitest.config.web.ts:44` globs `src/**/*.web.test.tsx`; `src/utils/` is inside
`src/`). **No production change is needed to make it testable** — `webStorage` is
not exported (`:24`), and it does not need to be: the test drives
`createPersistStorage` and stubs the `localStorage` global, which is the real
interface. Exporting `webStorage` would be the alternative and is not preferred,
because it widens the module's surface for a test that does not need it.

Stub with `vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
  throw new DOMException("quota", "QuotaExceededError")
})`, restore in `afterEach`. The pattern for a stubbed global already exists at
`ProductListScreen.web.test.tsx:17-30`.

Four assertions, each unwritable today:

1. **A write that `localStorage` refuses is still readable.** This is the whole
   finding, and it fails before the fix.
2. **A write that succeeds is readable after a fresh store reads the same key** —
   the happy path, so the fix cannot be "always use the `Map`".
3. **`removeItem` clears both.** Assert that a subsequent read is empty. If only
   `localStorage` is cleared, this fails — which is the third method's half of
   the incoherence.
4. **A `getItem` that throws returns the `Map`'s value, not `null`** — the
   storage-blocked-by-policy case `:28-33` was written for.

Assert through `createPersistStorage` and a fresh store instance per case, so
the test exercises the same hydrate-after-write shape a real reload produces. The
existing "a fresh store over the same storage" intent is at
`useSessionStore.web.test.tsx:50-51`.

### What this deliberately does not do

- **No change to `inMemoryFallback`.** It is already coherent, and
  `useCartStore.test.ts` / `useWishlistStore.test.ts` /
  `useRecentlyViewedStore.test.ts` depend on it being untouched.
- **No change to what is persisted.** The `ProductData` snapshots, their
  unbounded staleness and the `storeId` dropped at `Product.tsx:90` are
  `2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`'s and are
  untouched here. This proposal is about *where* a value goes when the browser
  refuses it, not *what* the value is.
- **No change to `useSessionStore`'s credential-storage decision.**
  `useSessionStore.ts:27-37` records that `localStorage` is the wrong home for a
  bearer token and that `expo-secure-store` / an `httpOnly` cookie are the real
  fixes. That reasoning is correct and unaffected; this only makes the chosen
  mitigation behave as its own comment describes.
- **No change to native behaviour.** A native reload still drops the session —
  that is a platform fact, not a defect.
- **No change to `partialize` / `version` / rehydration timing.**
  `useSessionStore.ts:55-58`'s "a reload starts back at `loading`" design is
  correct and stays.

## Impact

**Correctness — the reason this is worth doing.** A shopper and a seller in a
storage-blocked or quota-exceeded browser stop losing the cart, the wishlist, the
recently-viewed rail and the session token on every page reload. For the session
that means the "silently signed out" outcome at `useSessionStore.ts:29-30` stops
happening on web for a reason nobody had written down.

**Consistency.** One fallback rule, in one file, shared by three methods —
instead of three rules, each with its own justification comment and each
believing it is the whole policy.

**Testability.** The module's only reason to be 67 lines instead of 20 is three
fallback branches, and they go from zero coverage to four assertions in the
cheapest harness the repo already has (the jsdom `web` project, a stubbed
global, no new dependency, no new config file). This is the structural gain, and
it is the same remedy shape as
`2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md` step 4 and
`2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md` step 3.

**Maintainability / AI-developer cost.** The next agent asked to touch
persistence reads one file, and the file now says one true thing about where a
value goes. Today it says three, and the two most reassuring sentences point at
the branch that is broken.

**Performance.** Negligible, and only under option (a): one extra `Map::get` per
store hydration (four stores, once per page load) and one extra `Map::set` per
store write. Both are in-process and unbounded-free; neither is on a request
path, and no I/O is added on the happy path.

**What does not improve.** The persisted snapshots remain arbitrarily stale and
remain ownerless — `2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
and nothing here. A seller session still lives in `localStorage`, which is the
wrong home for a credential no matter how well the fallback behaves. Native still
signs a seller out on reload. The `Map` is process-local and per-tab, so two
tabs still do not see each other's fallbacks — a property worth stating rather
than fixing. And this does not change the fact that
`mobile-application`'s storage adapter path has no test runner at all, which is
`2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`'s stated
residual, not this one's problem.

## Risks / trade-offs

- **Option (b) is a behaviour regression dressed as a simplification.** Dropping
  the fallback makes a storage-blocked browser lose the session on every reload,
  where today it also loses it — but for a reason nobody chose. If a reviewer
  prefers (b), it should be chosen as a product decision with the consequence
  written into the comment, not as tidying.
- **Option (a) makes the `Map` authoritative within a session, which is a
  stronger claim than today.** Today a successful `localStorage` write is the
  only durable record; under (a) the `Map` shadows it in-session. That is what
  makes the fallback readable, and it is why assertion 2 exists — to stop (a)
  from degenerating into "always use the `Map`". If the two can ever disagree,
  (a) has to say which wins, and the comment must say it too.
- **The trigger is uncommon, and the reviewer should weigh that.** This is not a
  bug every shopper hits. It is a purpose-built degradation path that does not
  work, in the module that decides where a bearer token is kept. Judge it on that,
  not on incidence.
- **Ordering with `2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
  is a real decision, not a preference.** That proposal's approach says "Keep all
  three stores, their storage keys, and `persistStorage.ts` exactly as they are"
  (`:180`). This one changes that file. They do not conflict in substance — that
  one narrows *what* is persisted, this one fixes *where it goes* — but they
  cannot both be applied to the same checkout. **Land this first**: it is roughly
  fifteen lines in one file with no store-shape change, and it leaves the other
  proposal's diff untouched. If the other lands first, apply this fix on that
  branch rather than opening a second change to the same adapter.
- **`webStorage` is private, and the test drives the public factory.** That is
  deliberate and cheaper than exporting it, but it does mean the test asserts
  through zustand's JSON layer rather than calling the adapter directly. A
  reviewer who prefers direct calls can export `webStorage` without adding it to
  `src/index.ts`; say which was done.
- **Scope.** The snapshot-staleness problem, the credential-storage decision,
  zustand's `partialize`/`version`/`migrate` surface, the three stores' shapes,
  and the `formatPrice`/`cn` siblings are all real and all separate. None of them
  belongs in this diff.

## Validation

1. **The premise, first and alone.** Before changing anything, reproduce the
   defect in a scratch branch: in the `web` project, stub `setItem` to throw,
   drive one write through `createPersistStorage`, then read the key back with a
   fresh store. **Before the fix: the value is absent.** If it comes back, the
   premise is wrong and this proposal should be rejected rather than reworked.
2. `pnpm --filter @rnw/components-library test` — the new
   `persistStorage.web.test.tsx` is green, **and** `useSessionStore.web.test.tsx`
   (179 lines, the only existing test that reaches `webStorage`) passes
   **unchanged**. That file is the regression net: if the fix needed an edit
   there, it changed the happy path.
3. `pnpm --filter @rnw/components-library test` again for the `utils` project —
   `useCartStore.test.ts`, `useWishlistStore.test.ts` and
   `useRecentlyViewedStore.test.ts` must pass **unchanged**, since
   `inMemoryFallback` is not touched. File count goes from 8 to 9 in the `web`
   project.
4. **Negative checks, in a scratch branch**, because a test that cannot fail is
   worse than no test:
   - restore `getItem`'s `catch` to `return null` and confirm assertion 1 fails;
   - delete `memoryStorage.delete(name)` from `removeItem` and confirm assertion 3
     fails;
   - make `setItem` skip the `memoryStorage` write and confirm assertion 1 fails.
   If any passes, the suite is not asserting the thing this proposal is about.
5. `pnpm --filter @rnw/web-application test` — 7 files in `tests/`, unchanged.
   The cheap gate that a `components-library` storage change did not disturb the
   web app's own route suites, including all four `vi.mock("../lib/api")`
   automocks.
6. `pnpm typecheck && pnpm lint`. `src/utils/` is inside
   `components-library/tsconfig.json`'s `include: ["src"]`, so the new test file is
   typechecked; Biome will format it.
7. Mechanical, before and after, the same shape as the evidence above:
   ```bash
   grep -n 'memoryStorage\|catch' components-library/src/utils/persistStorage.ts
   ```
   Success is **not** "fewer hits". It is that `getItem`, `setItem` and
   `removeItem` each mention `memoryStorage`, i.e. all three agree on the same
   rule — and that the one comment describing the rule is in one place rather
   than three.
8. Not required, and honestly so: nothing here touches `api-rs`, so no Rust check
   applies. `pnpm --filter @rnw/mobile-application test:e2e` needs a native build
   and a simulator and is **not** a gate here — this proposal does not change
   native behaviour, and `inMemoryFallback` is byte-for-byte untouched. The three
   native-side store suites in step 3 are the real evidence that the native path
   is unaffected.

## Related proposals

- **`code-optimization-improve-proposals/todo/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
  — related, not superseded, and it explicitly preserves this file.** Its §6
  (`:156-165`) already observes that the three store tests "run in the node-only
  `utils` Vitest project and assert the reducer against `persistStorage.ts`'s
  in-memory branch" — it treats that as a limitation of those *tests* and leaves
  the adapter alone, and its approach (`:180`) says "Keep all three stores, their
  storage keys, and `persistStorage.ts` exactly as they are." **This proposal
  finds the adapter's own web path defective and unowned, which that document
  does not claim and would not fix.** Neither supersedes the other: that one is
  about *what* is persisted (a `ProductData` snapshot with no owner, no TTL and
  no revalidation seam); this one is about *where a value goes when the browser
  refuses to store it*. Sequence them as described in Risks — this one first.
- **`code-optimization-improve-proposals/todo/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  — related, adjacent, different file.** Its §3 (`:118-137`) is the same argument
  one layer out: the HTTP boundary is "never executed by any test" because
  `web-application/vitest.config.ts:43` globs only `tests/**/*.test.tsx` and four
  tests automock `../lib/api`, and its step 4 lands its tests in the node `utils`
  project. This proposal's coverage gap is the mirror image — the storage adapter
  *is* reachable from a test project, four stores use it, and the branch that
  matters has no test. It cites `createPersistStorage` twice (`:215`, `:344`),
  both times only as a precedent for exporting a non-component through the
  barrel, which this proposal does not change. No file overlap.
- **`code-optimization-improve-proposals/in-progress/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`
  — unrelated surface** (bundler and test-runner resolution). It was in `todo/`
  when this document was written and was claimed into `in-progress/` by
  `bb22918` while this run was in flight; it is read in full and there is no
  conflict. Its scope note at `:328` mentions "`persistStorage.ts`'s in-memory
  branch" once, as an example of a test-harness asymmetry it is explicitly not
  claiming. No overlap.
- **`code-optimization-improve-proposals/todo/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`
  — unrelated surface.** Its subject is the managed react-query cache and its
  invalidation policy; this is the unmanaged persisted stores. Its "What does not
  improve" (`:396-399`) does not mention persistence.
- **The four `in-progress/` proposals — none claims this file.**
  `2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md` was
  moved to `implemented/` by `bada402` during this run and is closed; it moved
  seller route containers. `2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  and `2026-10-03-22-37-46-make-the-store-contract-executable.md` are both
  `api-rs`; `2026-10-03-23-50-00-one-body-behind-the-platform-splits.md` is the
  `Product`/`MainNav` platform splits. That last one is the only file overlap by
  citation: it proposes `MainNav.web.tsx` keep its existing press resolution and
  become a thin adapter over a shared `MainNavItem` body, and does not touch the
  `:6-9` doc comment cited in §4 above. No ordering dependency.
- **Nothing in `rejected/`** (it is empty, README only), and the one entry now in
  `implemented/` is the closed seller-route proposal named above. Verified there
  is no prior or closed proposal about this file: `persistStorage` appears in
  five places across three documents, and in the only one that proposes changing
  it, the instruction is to keep it as it is.
- **`improve-proposals/implemented/2026-09-29-recently-viewed-products.md` — the
  origin of the third store, and the reason this module exists at all.** It
  created `useRecentlyViewedStore` by mirroring "the cart/wishlist pattern
  already established in this repo" (quoted at
  `2026-10-04-03-05-32-…:169-170`), and the module's own `:9-11` records that it
  was extracted precisely because "this block was duplicated verbatim in three
  stores". So the consolidation that stops a fourth copy has already happened.
  What is left is the one policy inside it, which is what this proposal is about.