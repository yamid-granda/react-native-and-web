# The HTTP boundary is duplicated across both apps and tested by neither, and the reason recorded for it no longer describes the code

## Problem / opportunity

Two files are the entire HTTP boundary of this repository:

| file | lines | normalized code lines |
| --- | --- | --- |
| `web-application/lib/api.ts` | 150 | 122 |
| `mobile-application/src/api/client.ts` | 176 | 143 |

**114 of those normalized lines are identical** (drop blank lines and `//` comments,
trim indentation, then intersect the two sorted line multisets — reproduce with
step 1 in **Validation**). Only one function differs, and it is eight lines long:
`resolveApiUrl` (`mobile-application/src/api/client.ts:16-25`), which derives the
API host from `Constants.expoConfig.hostUri` because on a phone `localhost` is the
phone. Everything else — `ApiError`, `request`, `errorMessage`, `json`,
`authedRequest`, and all thirteen endpoint functions — is the same code twice.

That duplication was a decision, taken once, on the record. The reason is written
down in the one file whose doc comment explains the boundary:

> `components-library/src/business/StoreScreen/useMyStoreProducts.ts:5-12`
> ```
>  * The api surface this hook needs, injected by the app that owns the transport.
>  *
>  * components-library deliberately has no api layer: each app has its own `fetch`
>  * wrapper (different base-URL resolution, different navigation) and a shared one
>  * would have to grow a platform switch. Passing the three functions in is what
>  * keeps the *state* pattern shared without sharing the *transport*.
> ```

**One of the two differences that justification names does not exist in the code
it describes.** There is no navigation in either client. I read both files end to
end: neither imports `next/navigation`, `solito/navigation`, or `expo-router`,
and neither takes a router, a link, or a path-builder. Navigation lives in the
route files — `web-application/app/marketplace/page.tsx`,
`mobile-application/src/app/(tabs)/marketplace/index.tsx` — which import the
*endpoint functions* and route for themselves. A shared transport would not need
a platform switch for navigation, because there is nothing in it to switch.

The other named difference is real but is eight lines and is what a function
parameter exists for: `resolveApiUrl` differs only in *where the string comes
from* — `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"`
(`web-application/lib/api.ts:4`) versus an env override, then
`Constants.expoConfig?.hostUri?.split(":")[0]`, then the same localhost fallback
(`mobile-application/src/api/client.ts:16-25`). Neither copy contains a branch on
platform, a `Platform.OS`, or a per-platform code path of any kind. A shared
transport parameterized by `baseUrl` has no platform switch in it at all.

### 1. The boundary the decision drew has already been crossed, in the direction that matters

"`components-library` deliberately has no api layer" is not true of the import
graph today. Both clients already reach into the shared library for the two
things that make them clients rather than fetchers:

```ts
// web-application/lib/api.ts:1-2
import type { AuthSession, ProductData, ProductsPage, StoreProfile, StoreUser } from "@rnw/components-library"
import { getSessionToken } from "@rnw/components-library"
```
```ts
// mobile-application/src/api/client.ts:2-9
import type {
  AuthSession,
  ProductData,
  ProductsPage,
  StoreProfile,
  StoreUser,
} from "@rnw/components-library"
import { getSessionToken } from "@rnw/components-library"
```

The credential is owned by the library, not by the app:
`components-library/src/business/AuthScreen/useSessionStore.ts:63-66` defines
`getSessionToken`, exported from the barrel at
`components-library/src/index.ts:63-67`, and
`mobile-application/src/api/client.ts:87-97` / `web-application/lib/api.ts:67-77`
call it on every authenticated request. So the transport layer already depends on
the shared library for its auth model and for every wire type it speaks. What it
does not share is the 114 lines that turn those types into HTTP.

### 2. `ApiError` exists twice, and the field it was built for has no readers

Both copies document the same justification:

> `web-application/lib/api.ts:9-11` (and `mobile-application/src/api/client.ts:30-32`)
> ```
>  * `ApiError` rather than a bare `Error` because callers branch on 401: the My
>  * Store screens need to tell "your session expired, sign in again" apart from
>  * "the server is down", and a message string cannot carry that.
> ```

**Nothing branches on 401.** A grep for `ApiError` across `components-library/src`,
`web-application` and `mobile-application/src` returns eight hits, and every one is
a definition, a doc comment, or a construction site:

```
web-application/lib/api.ts:9    * `ApiError` rather than a bare `Error` because callers branch on 401: …
web-application/lib/api.ts:13   export class ApiError extends Error {
web-application/lib/api.ts:18       this.name = "ApiError"
web-application/lib/api.ts:35       throw new ApiError(path, response.status, await errorMessage(response))
mobile-application/src/api/client.ts:30,34,39,55   (the same four)
```

No file imports the name. `status` — the only member that distinguishes it from
`Error` — is written at five sites and read at zero. The My Store screens that the
comment says need the distinction render `error.message`
(`web-application/app/my-store/page.tsx`, its mobile twin, and the edit route)
and branch on nothing.

The two definitions are also not the same code, though they are currently
equivalent: web calls `super(message)` and then reassigns `this.message`
(`api.ts:20-22`), mobile composes the string into `super` (`client.ts:38`). Same
output. That matters for the argument below, and I want to be precise about it —
**the two copies are not drifting today.**

### 3. Neither copy is tested, and one of them cannot be

This is the half that is not a style question.

- **`web-application/lib/api.ts` is outside its own test glob.**
  `web-application/vitest.config.ts:43` is `include: ["tests/**/*.test.tsx"]`, so
  the file can only be reached from `tests/`. It has no test there. The four test
  files that import it replace the entire module with an automock —
  `tests/marketplace.test.tsx:8`, `tests/marketplace-detail.test.tsx:8`,
  `tests/my-store.test.tsx:17`, `tests/login.test.tsx:7`, all `vi.mock("../lib/api")`.
  A module that is always mocked is never executed by any test in the repository.
- **`mobile-application` has no unit test runner at all.** Its `package.json`
  `scripts` are `dev`, `start`, `android`, `ios`, `web`, `lint`, `typecheck`,
  `prebuild`, `test:e2e`, `test:e2e:build` — there is no `test`, so the
  repository-wide `turbo run test` task (`turbo.json`, `"test"`) executes nothing
  for this workspace. The 176-line client, including the eight lines of
  `resolveApiUrl` that decide whether a physical phone can reach the dev machine
  at all, are verified only by the seven Detox specs, which per the root
  `README.md:217-225` need a generated native build and were never runnable in the
  environment this was built in.

So the consequences are concrete, and they are all in code that both platforms
share and neither tests:

| what | where | why it is load-bearing |
| --- | --- | --- |
| header merge order in `authedRequest` | `api.ts:70-75`, `client.ts:90-95` | `...(init?.body ? { "content-type": … } : {})` is spread *before* `...init?.headers`, so a caller-supplied header wins and `deleteMyProduct`/`logout` get no `content-type`. Reordering those two lines silently breaks writes. |
| the 204 short-circuit | `api.ts:37`, `client.ts:57` | `if (response.status === 204) return undefined as T` — `logout` and `deleteMyProduct` are typed `Promise<void>`. Remove it and both parse an empty body as JSON. |
| the non-JSON error fallback | `api.ts:42-51`, `client.ts:62-71` | A proxy's HTML 502 must degrade to `Request failed with status 502`, not throw a second parse error from inside the error path. |
| `validateSession` bypassing `authedRequest` | `api.ts:115-117`, `client.ts:135-137` | Hand-sets `authorization` against a token argument instead of reading the store, on purpose (bootstrap runs before the store settles). It is the one place that spells the header out by hand, and it is duplicated. |

Any of these changing on one platform only is invisible: no test executes the
module, and the one suite that runs both platforms end to end
(`pnpm --filter @rnw/web-application test:e2e`) needs a live, seeded api-rs.

### 4. Why this is expensive for an agent, which is the point of the exercise

The four behaviours above are four small, local, high-confidence edits — exactly
the kind of task an agent is asked to do ("add a request timeout", "send
`Accept-Language`", "retry once on 502"). Each one currently requires locating two
near-identical 150-line files in two different workspaces, deciding whether both
need the change, editing both, and then having **no way to check the work** —
because nothing in the repository can observe whether the two copies still agree.
The verification cost is a Playwright run against a seeded database, which is the
most expensive check in the repo to run and does not localise the failure when it
goes wrong.

## Proposed approach

One transport module in `components-library`, with the two genuinely per-app
inputs injected. Nothing else about the boundary moves.

### 1. New `components-library/src/api/transport.ts`

It must stay **dependency-free**: no `fetch` wrapper of its own beyond the one it
owns, and — critically — **no import of `useSessionStore`**. That is what makes it
testable in the existing node-only `utils` project, and it is not a stylistic
preference: `useSessionStore.web.test.tsx:9-11` records that the store persists
through `localStorage` and therefore cannot be loaded under
`vitest.config.utils.ts` (`environment: "node"`). A transport that imported the
store would be forced into the jsdom `web` project and would drag
`react-native-web` into a module that has no UI in it.

```ts
/**
 * The HTTP boundary, owned once.
 *
 * `baseUrl` and `getToken` are the only two things that differ between the web
 * and mobile apps, and both are single values — see the note on `resolveApiUrl`
 * in each app's api module. Everything else (error shape, header merge, the 204
 * short-circuit, the endpoint set) is one implementation so a change to the
 * request pipeline cannot land on one platform and miss the other.
 *
 * Deliberately does not import `useSessionStore`: this module is plain fetch
 * logic with no DOM and no react-native in it, which is what lets it be tested
 * in the node `utils` project. Apps pass `getSessionToken` in.
 */
export type ApiConfig = {
  baseUrl: string
  getToken: () => string | null
  /** Injected so tests never reach `fetch` directly. Defaults to the global. */
  fetchImpl?: typeof fetch
}

export class ApiError extends Error { readonly status: number; … }

export function createApi(config: ApiConfig) {
  // request / errorMessage / json / authedRequest, moved verbatim, plus:
  return { fetchProducts, fetchProduct, fetchStore, fetchStoreProducts,
           register, login, logout, fetchMe, validateSession,
           fetchMyProducts, createMyProduct, updateMyProduct, deleteMyProduct }
}
```

`ApiError` is exported from the module, not returned by the factory, so there is
exactly one class identity in the process. That is the point of
`components-library/src/index.ts:87-89`, which already exports non-component
helpers (`createPersistStorage`, `cn`) through the barrel for exactly this reason.

Move `request`, `errorMessage`, `json`, `authedRequest` and the thirteen endpoint
functions across **verbatim** — no behaviour change, no renaming, no reordering.
The one edit inside `authedRequest` is mechanical: `getSessionToken()` becomes
`config.getToken()`.

### 2. Both apps become a base URL and a re-export

```ts
// web-application/lib/api.ts — the whole file, after this change
import { createApi, getSessionToken } from "@rnw/components-library"

const api = createApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  getToken: getSessionToken,
})
export const { fetchProducts, fetchProduct, …, deleteMyProduct } = api
export { ApiError } from "@rnw/components-library"
```

`mobile-application/src/api/client.ts` keeps `resolveApiUrl` (it is the one real
platform difference and it is worth its comment at `:11-15`), then the same three
lines with `baseUrl: resolveApiUrl()`.

The 15 call sites do not change — they already import by name from
`web-application/lib/api` or `mobile-application/src/api/client`
(`web-application/app/**`, `mobile-application/src/app/**`, and the four
`web-application/tests/*` automocks, whose `vi.mock("../lib/api")` target is
unchanged because the module path and its export names are).

### 3. `ApiError` gets its first reader, or it does not ship

Do not carry a documented-but-unused abstraction across the boundary change.
Either the My Store screens branch on `status` (the error message already carries
the path, `api.ts:20-22`, so a 401 can render "Your session expired" and route to
`/login` through the existing `useRequireSession` guard), or the `status` field
and its doc comment come out and `ApiError` collapses to a plain `Error` subclass
carrying the composed message. The first is better and is roughly six lines in
one shared place — but it is a product decision, not a refactor, so it should be
made explicitly in the same commit rather than inherited silently.

I recommend the first, because a single `ApiError` identity is what makes the
branch possible at all: today no shared code *can* write `instanceof ApiError`
against a client it did not create.

### 4. `components-library/src/api/transport.test.ts` — the missing seam

Plain `.test.ts` under `src/api/`, so it runs in the existing `utils` project
(`vitest.config.utils.ts:10` globs `src/**/*.test.ts`, `environment: "node"`).
No DOM, no `react-native` alias, no react-native-web in the module graph — the
`utils` project declares no `resolve` key at all, which is fine because there is
nothing to alias. `fetch` is stubbed per test with `vi.stubGlobal("fetch", …)` /
`vi.unstubAllGlobals()`, the pattern already used at
`components-library/src/business/ProductListScreen/ProductListScreen.web.test.tsx:17-30`.

Cover, in order of how expensive the bug would be:

1. `authedRequest` sets `authorization` when a token exists and omits the header
   entirely when it does not.
2. `authedRequest` sends `content-type: application/json` only when there is a
   body — and a caller-supplied header still wins, pinning the spread order.
3. `request` returns `undefined` for a 204 rather than throwing on `response.json()`.
4. a non-2xx throws an `ApiError` carrying `status`, and its `message` is the
   server's `message` when the body has one.
5. a non-2xx with a non-JSON body (an HTML proxy page) degrades to
   `Request failed with status <n>` instead of throwing a parse error.
6. `getToken` is called per request, not captured — the "signed out in another tab
   is reflected immediately" property both copies document at `api.ts:64-66`.
7. `validateSession` sends the token it is given, not the store's.

That is seven tests for 114 duplicated lines and one 176-line file that currently
has none.

### 5. What deliberately stays per-app

`resolveApiUrl` (`mobile-application/src/api/client.ts:16-25`) and the
`NEXT_PUBLIC_API_URL` constant (`web-application/lib/api.ts:4`). Eight lines,
genuinely different, and already documented. After this change they are the *only*
place the two api modules differ, which is the property that makes the next
divergence visible by reading two short files instead of two long ones.

## Impact

**Reuse.** 114 duplicated normalized lines collapse to one implementation plus
about six lines per app. The endpoint surface stops being "two files that must
agree" and becomes "one file".

**Consistency.** One `ApiError` identity in the process, one header-merge order,
one 204 rule, one error-message fallback. Today each of those is stated twice and
enforced by nothing.

**Testability.** This is the real gain, and it is the half nothing else in the
repository delivers. The HTTP boundary of both apps goes from *never executed by
any test* to seven assertions, in the cheapest harness the repo already has (a
node-env Vitest project with a stubbed global). The seam is the reason to do this,
not the line count.

**Maintainability / AI-developer cost.** A change to the request pipeline becomes
one edit in one file with a fast, local check, instead of two edits in two
workspaces verified by a Playwright run against a seeded database. That is
directly less time, money and token spend on every future change to auth, errors,
retries or headers — which is the stated goal of this routine.

**Performance.** None, and none is claimed. No extra module is loaded at runtime:
the apps import the same code they do today, from one place instead of two. No
change to request counts, payloads, or the api-rs side.

**What does not improve.** `mobile-application` still has no unit test runner, so
`resolveApiUrl` — the eight lines that decide whether a physical phone reaches the
dev machine — remains untested. That is a separate proposal about adding a
Vitest project to that workspace, and it is not this one; this proposal does not
make `mobile-application` verifiable, it makes 176 of its lines shared with a
workspace that is. The api-rs side is untouched, as are all thirteen existing
proposals' surfaces.

## Risks / trade-offs

- **It reopens a documented decision, so it has to win the argument, not just
  apply the diff.** `improve-proposals/2026-10-03-seller-storefronts-my-store.md:172`
  settled this ("`components-library` deliberately has no api layer (fetchers are
  injected), so the duplication is the existing architecture, not a shortcut") and
  `code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md:233-234`
  says "the reasoning still holds". This proposal's whole argument is that half of
  that reasoning (`useMyStoreProducts.ts:9`, "different navigation") describes
  code that has no navigation in it, and that the other half is a parameter. If a
  reviewer disagrees, the correct outcome is to reject this and leave both files —
  not to weaken it into "extract the error class".
- **`components-library` gains a module that is not a component.** Correct, and the
  precedent exists: `createPersistStorage` and `cn` are already exported that way
  (`components-library/src/index.ts:87-89`), and proposal
  `2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md` proposes a
  second one. The new directory is `src/api/`, not `src/common/`, because nothing
  in it renders.
- **Import direction.** `transport.ts` importing `getSessionToken` would have been
  the smaller diff and the wrong one — it would make the module un-loadable in the
  node `utils` project (see `useSessionStore.web.test.tsx:9-11`) and re-create the
  coupling this is meant to remove. Keeping `getToken` injected costs one
  argument per app and is what makes step 4 possible at all.
- **`vi.mock("../lib/api")` in four web tests automocks the module.** After this
  change those mocks still work — the module path and export names are unchanged —
  but they will be mocking a re-export rather than the implementation. That is
  worth a comment in each, because a future reader will reasonably wonder whether
  the automock is still intercepting anything.
- **Scope.** The per-file test-harness duplication (a router mock in 9 files, a
  `QueryClient` in 4, a product fixture in 16) is real, named as out of scope by
  `2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md:324-330`, and
  deliberately not touched here. Measured during this run, it is mostly idiomatic
  per-file setup rather than byte-identical blocks, so it is a weaker finding than
  it looks and belongs in its own analysis, not in this diff.
- **`ApiError`'s first reader is a product decision** (step 3). Shipping the merge
  while leaving `status` unread reproduces the dead abstraction in a new location.
  Decide it in the same commit.

## Validation

1. Reproduce the 114-line measurement, before and after:
   ```bash
   norm() { sed -e 's://.*::' "$1" | grep -v '^\s*$' \
     | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }
   norm web-application/lib/api.ts > /tmp/w.txt
   norm mobile-application/src/api/client.ts > /tmp/m.txt
   wc -l /tmp/w.txt /tmp/m.txt
   comm -12 <(sort /tmp/w.txt) <(sort /tmp/m.txt) | wc -l
   ```
   Before: `122`, `143`, `114`. After: the count is **not** expected to be zero —
   success is that every remaining identical line is a comment or the `export
   const { … } = api` destructuring, not a second implementation of `request`.
2. `pnpm --filter @rnw/components-library test` — the seven new tests in the
   `utils` project, plus the existing suites, all unchanged. The `utils` project
   count goes from 8 files to 9.
3. **Negative check for the new suite**, in a scratch branch: delete the
   `if (response.status === 204)` short-circuit in `transport.ts` and confirm a
   test fails. Then restore it. If it passes, the test is not asserting anything.
4. `pnpm --filter @rnw/web-application test` — 7 files in `tests/`, must pass
   **unchanged**, including all four `vi.mock("../lib/api")` automocks
   (`tests/marketplace.test.tsx`, `tests/marketplace-detail.test.tsx`,
   `tests/my-store.test.tsx`, `tests/login.test.tsx`). This is the gate that the
   re-export kept the call sites and the mocks intact.
5. `pnpm typecheck && pnpm lint`. The cross-package surface changes: both apps
   lose their `ApiError` class and their `request`/`json`/`authedRequest`
   definitions, `components-library/src/index.ts` gains the new exports, and
   Biome will reformat the mobile copy's now-single-line import block.
6. `pnpm --filter @rnw/web-application test:e2e` — needs api-rs running and
   seeded. Not run during this analysis run. It is the only check that exercises
   the merged transport through a real Next build, and `e2e/my-store.spec.ts`
   covers the authenticated write path end to end.
7. Not runnable here, and honestly so: `pnpm --filter @rnw/mobile-application
   test:e2e` needs a native build and a simulator (root `README.md:217-225`). The
   Detox specs are the check that would cover the mobile `baseUrl`, and it must be
   run on a machine with Xcode before this is called done.
8. Mechanical check that the transport exists in exactly one place:
   ```bash
   grep -rn "fetch(" --include='*.ts' --include='*.tsx' \
     components-library/src web-application mobile-application/src | grep -v node_modules
   ```
   Success is one hit inside `components-library/src/api/transport.ts` plus the
   two base-URL constants — no `fetch(` left in either app.

## Related proposals

- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md:170-172` — the
  proposal that created both clients and settled the duplication. This document
  revisits that decision, so it is the one that must be answered.** It does not
  supersede the document: §8's shape (per-app clients, injected fetchers) stands,
  and the sentence at `:172` that carries the rationale becomes the doc comment on
  `createApi`. What this proposal disputes is the *stated reason* — "different
  base-URL resolution, different navigation" — because one of those two
  differences is not present in the files that reason was written about.
- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — related, and this is the proposal that named the gap.** Its scope-creep
  bullet (`:265-267`) lists "merging the two api clients" as out of scope and "a
  separate proposal"; this document is that proposal. It **disagrees** with that
  document's "What does not improve" (`:230-238`), which says the transport
  duplication stays "because … the reasoning still holds". It does not supersede
  it, and the two compose: if that extraction lands first there is less duplicated
  route code and this one has fewer call sites to re-point, but nothing in this
  proposal depends on it. This document also adds the test-coverage half that
  `:230-238` does not mention at all.
- **`code-optimization-improve-proposals/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`
  — different surface (bundler and test-runner resolution) and a precedent worth
  copying: it also proposes a dependency-free module in `components-library` that
  exists only to be imported by configs, and lands its test in the cheapest project
  that can host it. Its scope note (`:324-330`) names the duplicated per-file test
  harness as out of scope; that is untouched here.
- **`code-optimization-improve-proposals/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`
  — adjacent, and mutually reinforcing.** It moves the four seller writes onto
  `useMyStoreProducts`. This proposal makes the transport those writes call a
  single tested implementation. If that one lands first, the `create`/`update`/
  `delete` functions it wires up are the ones this proposal's tests cover.
- **`code-optimization-improve-proposals/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`,
  `2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`,
  `2026-10-03-22-37-46-make-the-store-contract-executable.md`,
  `2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`'s
  siblings, and the four `2026-10-04-*` api-rs proposals — all api-rs or
  shared-component surfaces. No file this proposal touches appears in any of them.
- **No existing proposal has proposed this.** Two have named it as deferred —
  `2026-10-03-22-15-47-…:266` ("merging the two api clients") and
  `2026-10-04-01-10-39-…:324-330` (the surrounding test-harness duplication) — and
  neither puts it forward. This document is not a rewording or a part two of any
  of them; the duplication analysis, the dead `status` field, and the absent test
  seam are new claims with new evidence.
