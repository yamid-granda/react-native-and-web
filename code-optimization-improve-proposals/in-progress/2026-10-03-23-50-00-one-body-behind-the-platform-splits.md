# One body behind the platform splits, so `MainNav` and `Product` stop existing twice

## Problem / opportunity

`components-library` has exactly three platform-split components: `ProductListScreen`,
`MainNav` and `Product`. The first is legitimately two implementations.
The other two are two implementations each where only a handful of lines
actually differ — and the repo's own written rule already prescribes the fix.

Normalized (drop blank lines and `//` comments, trim indentation), the two
copies of each:

| component | native code lines | web code lines | byte-identical lines | identical share |
| --- | --- | --- | --- | --- |
| `common/Product/Product.tsx` / `Product.web.tsx` | 82 | 80 | **74** | 92% of native |
| `common/MainNav/MainNav.tsx` / `MainNav.web.tsx` | 49 | 53 | **41** | 84% of native |

(Reproduce with the one-liner in **Validation** step 5.)

The differences are smaller than the line counts suggest, because they are
confined to one element and one props object.

**1. `Product.web.tsx:38-89` is `Product.tsx:43-96` with one JSX element
swapped.** A span-to-span diff of those two ranges produces exactly two
hunks, both inside the image:

```
$ diff <(sed -n '43,96p' Product/Product.tsx) <(sed -n '38,89p' Product.web.tsx)
13,14c13,14
<             <Image
<               source={imageUrl}
---
>             <ClassNameImage
>               source={{ uri: imageUrl }}
16,19c16,17
<               contentFit="cover"
<               cachePolicy="memory-disk"
<               transition={150}
<               style={{ width: "100%", height: "100%" }}
---
>               resizeMode="cover"
>               className="h-32 w-full rounded-md bg-surface-muted"
```

46 of those 54 lines are character-for-character identical, including the
out-of-stock badge that appears twice (`Product.tsx:63-67` and `:70-74` ==
`Product.web.tsx:56-60` and `:63-67`), the title/description/price block,
every className, the `product-card-${id}` testID, and both wishlist store
selectors (`Product.tsx:34-35` == `Product.web.tsx:29-30`). The 8 lines that
differ are all `expo-image` vs react-native-web `Image` prop spellings.

**2. `MainNav.web.tsx:46-66` is `MainNav.tsx:34-54` with one closing tag
renamed.** The whole 21-line pressable body — the `pressed` render-prop, the
`relative` icon wrapper, the `absolute -right-1.5 -top-1.5` badge and its
`99+` cap, the label's `pressed ? "text-brand" : "text-muted"` — differs by
exactly one line:

```
$ diff <(sed -n '34,54p' MainNav.tsx) <(sed -n '46,66p' MainNav.web.tsx)
21c21
<     </ClassNamePressable>
---
>     </LinkPressable>
```

Everything above the body is the same shape too: `MainNavProps`
(`MainNav.tsx:11-17` == `MainNav.web.tsx:16-22`, 7 lines), the `forwardRef`
wrapper, and the two `ClassName*` casts.

### The splits are the problem, and they violate the rule the repo wrote down

`.agents/rules/component-reuse.md:10-15` is explicit:

> "If a component needs different wiring per platform (web `href`/routing vs.
> native `onPress`/Expo Router), keep that difference in a thin per-app
> wrapper that supplies props/callbacks to the shared component — the shared
> component itself stays platform-agnostic beyond genuinely unavoidable cases"

That is a description of *thin adapter files supplying props to one shared
body*. What shipped instead is *two complete components*. The rule's letter
is satisfied (the difference is not in a per-app wrapper, but the shared
component is not platform-agnostic either — it is platform-agnostic *twice*).

For `MainNav` the duplication is **documented and still wrong-footed**.
`README.md:157-171` establishes a real constraint — Solito's native
`useLink` cannot work with Expo Router — and `README.md:336-338` concludes:

> "`MainNav` is platform-split (`MainNav.tsx` native, `MainNav.web.tsx`
> web), not one file with internal branching — see the Solito bullet above
> for why (native must never import `solito/navigation` at all)."

The constraint is about **one import**. It is satisfied by two thin adapters
that call a shared body exactly as well as by two full components, and the
README's own framing ("Both cast `Pressable` locally", "Both are also
wrapped in `forwardRef`") is a list of things that are now stated twice
because they live in two files.

For `Product` the split has **no documented reason at all**. `grep -n '\.web\.tsx'`
over `README.md` returns only `MainNav` (lines 169, 329, 336). `Product.web.tsx`
appears in no README section, no `AGENTS.md`, and no proposal. `expo-image` is
a plain dependency of the package (`components-library/package.json:19`) and
is not `cssInterop`-registered anywhere — the exact reason given at
`Product.tsx:20-21` — which is a reason that applies identically on web.

### Three costs that are already visible in the tree

**1. The copies have already drifted, and a third file is holding the
reconciliation.** `MainNav.web.tsx:44` adds `shrink` and `overflow-hidden`
to the nav item's className, with a 5-line comment at `:38-43` explaining that
without them the item "stops one item's label from truncating". `MainNav.tsx:32`
does not have them, and cannot — the reasoning is CSS flexbox min-content
sizing, which has no native meaning. So the two nav items are genuinely
different components, and `BottomNav.tsx:71-77` now carries a **third**
comment whose only job is to point at the divergence:

> "…so without an explicit min-width here this box gets squeezed by flex-1's
> 50/50 split … — see `MainNav.web.tsx`'s matching shrink/overflow-hidden."

A shared component should not need a third file to explain why its two
implementations disagree.

The `Product` pair has drifted the same way, more quietly: the web copy
re-states the image wrapper's own layout tokens on the image
(`Product.web.tsx:49` `relative h-32 w-full overflow-hidden rounded-md
bg-surface-muted` vs `:54` `h-32 w-full rounded-md bg-surface-muted`) — four
of six tokens maintained twice in one file — while the native copy expresses
the same size as `style={{ width: "100%", height: "100%" }}` (`:61`).

**2. A whole implementation of each component is outside every check
`pnpm test` runs.** `components-library/vitest.config.ts:3-5` states the
position — "No native project — see README" — and `README.md:226-236`
explains why (`vitest-native` hit a dual-`test-renderer`-instance bug). So
every component test resolves the platform-suffixed file: `vitest.config.web.ts:26-37`
lists `.web.tsx` **first** in `resolve.extensions`, and `:44` globs only
`src/**/*.web.test.tsx`.

The consequence is not stated anywhere: for a platform-split component, the
native implementation is structurally unreachable from `pnpm test`. That is
74 untested lines for `Product` and 41 for `MainNav`. The web twins are well
covered — `Product.web.test.tsx` is 64 lines / 8 assertions and
`MainNav.web.test.tsx` is 52 lines / 7 — and both components are among the
most-rendered in the product: `Product` renders in five places
(`ProductListScreen.tsx:84`, `:140`, `ProductListScreen.web.tsx:46`, `:87`,
`PublicStoreScreen.tsx:71`) and `MainNav` is the tab bar on both platforms
(`BottomNav.tsx:61`, `:80`, `mobile-application/src/app/(tabs)/_layout.tsx:63`,
`:73`).

On native the copies are reached only by Detox
(`mobile-application/e2e/marketplace.e2e.ts:16`, `cart.e2e.ts:14`,
`checkout.e2e.ts:14` all tap `product-card-prod-1`), which per the root
`README.md` and `mobile-application/AGENTS.md` needs a real native build and
a simulator and is therefore not part of `turbo run test`. `pnpm typecheck`
does cover the native files (`components-library/tsconfig.json` `include: ["src"]`),
so the types are checked; nothing about their rendered output, their
classNames, or their image props is.

**3. The duplication has already leaked into an unrelated test.**
`Button.centralization.test.ts:15-24` is the repo's own guard that only
`Button` marks something as a button. Four of its seven allowlist entries
exist *only* because these components are duplicated:

```ts
"common/MainNav/MainNav.tsx":       "nav item (icon + label + badge)",
"common/MainNav/MainNav.web.tsx":   "nav item (icon + label + badge), web wiring",
"common/Product/Product.tsx":       "the product card itself, which navigates",
"common/Product/Product.web.tsx":   "the product card itself, which navigates",
```

The second test in that file (`:63-70`) asserts every allowlist entry still
really contains a button role, so each duplicated file is a second thing to
keep in sync whenever a component grows a platform pair. A third platform
split in `common/` would need two more entries before it renders once.

## Proposed approach

Keep both splits' *module graph* exactly as it is — no bundler-visible change,
no new platform branching — and move the duplicated bodies into plain
(non-`.web`-suffixed) files that both sides import. That last detail is what
makes the shared body reachable from the existing web Vitest project, which is
the point.

### 1. `Product` — the image is the only platform fact

New `components-library/src/common/Product/ProductCard.tsx`, holding
`Product.tsx:43-96` verbatim, with the `<Image>` element replaced by a slot:

```tsx
export type ProductCardProps = ProductProps & {
  /** The already-constructed image for this product, or `null` when it has none. */
  image?: ReactNode
}

export const ProductCard = memo(function ProductCard({ image, ...props }: ProductCardProps) {
  // …Product.tsx:43-96 unchanged, with:
  //   Product.tsx:55-62  <Image …/>  →  {image}
})
```

The wrapper `View` (`:54`) and the out-of-stock badge inside it (`:63-67`) stay
in the shared body — they are identical in both copies today. Only the element
at `:55-62` moves out.

The two adapters become the platform fact and nothing else:

```tsx
// Product.tsx — native. ~12 lines.
const FILL = { width: "100%", height: "100%" } as const

export function Product({ imageUrl, ...props }: ProductProps) {
  return (
    <ProductCard
      {...props}
      image={
        imageUrl ? (
          <Image source={imageUrl} contentFit="cover" cachePolicy="memory-disk"
                 transition={150} style={FILL} accessibilityLabel={props.title} />
        ) : null
      }
    />
  )
}
```

```tsx
// Product.web.tsx — web. ~10 lines.
export function Product({ imageUrl, ...props }: ProductProps) {
  return (
    <ProductCard
      {...props}
      image={
        imageUrl ? (
          <ClassNameImage source={{ uri: imageUrl }} resizeMode="cover"
                          accessibilityLabel={props.title}
                          className="h-32 w-full rounded-md bg-surface-muted" />
        ) : null
      }
    />
  )
}
```

`ProductProps` moves to `ProductCard.tsx` and is re-exported, so
`src/index.ts:5` (`export type { ProductProps } from "./common/Product/Product"`)
keeps working. The `expo-image` rationale comment (`:17-21`) moves onto the
native adapter, where the choice it explains now actually lives — which is the
documentation gap this closes.

Note the `className`/`style` difference between the two image elements is
**preserved, not unified**. That is a real platform prop difference
(`expo-image` takes `style` and no `className`; RN's `Image` under
react-native-web takes the reverse), and collapsing it would be a behaviour
change dressed as a cleanup. The duplication that *is* worth removing — the
wrapper's tokens being restated on the web image — is a separate one-token
question and is left alone.

### 2. `MainNav` — the press props are the only platform fact

New `components-library/src/common/MainNav/MainNavItem.tsx`, holding
`MainNav.tsx:27-55` with the pressable's props as a parameter:

```tsx
export type MainNavItemProps = Omit<MainNavProps, "href"> & {
  /** Platform-resolved press behaviour. The adapters supply this. */
  navProps: PressableProps
}

export const MainNavItem = forwardRef<View, MainNavItemProps>(function MainNavItem(
  { navProps, icon: Icon, title, badgeCount }, ref,
) {
  return (
    <ClassNamePressable ref={ref} {...navProps} className={MAIN_NAV_ITEM_CLASSNAME}>
      {({ pressed }) => (/* MainNav.tsx:34-54, verbatim */)}
    </ClassNamePressable>
  )
})
```

`MainNav.tsx` and `MainNav.web.tsx` keep their existing press resolution —
`onPress` + `accessibilityRole="button"` at `MainNav.tsx:28-32`, and
`useLink` + `navProps` at `MainNav.web.tsx:28-32` — and each becomes a
`forwardRef` wrapper that resolves its props and delegates. This is the shape
`.agents/rules/component-reuse.md:10-15` asks for, and it is the *only* change
`README.md:157-171` actually requires.

`MainNavItem.tsx` does not name an `accessibilityRole`, so it needs no
allowlist entry; the two adapters keep theirs. `Product`'s two entries become
one (`ProductCard.tsx`). **`Button.centralization.test.ts`'s allowlist goes
from 7 entries to 6** — a small number, but it is the repo's own metric for
"how many files are copies of each other", and it moves in the right
direction.

**The `shrink overflow-hidden` divergence gets one decision, in one place.**
Hoisting `MainNav.web.tsx:44`'s class into `MAIN_NAV_ITEM_CLASSNAME` is the
preferred target — `shrink`/`overflow-hidden` are meaningful to Yoga, so the
web fix is not obviously wrong on native — but it is a native layout change
and must be verified by `mobile-application/e2e/tab-bar-position.e2e.ts` plus a
visual check of a 5-item tab bar at a narrow width. If it regresses native, keep
the classes in the web adapter and pass them through a `className` prop on
`MainNavItem`; either way `BottomNav.tsx:71-77` collapses from a
cross-reference between two implementations to a comment about one.

### 3. Tests, in the file the code now lives in

Because `ProductCard.tsx` and `MainNavItem.tsx` have no `.web` suffix, the
existing `vitest.config.web.ts` picks them up with no config change.

- `ProductCard.web.test.tsx` — move the eight assertions of
  `Product.web.test.tsx:13-63` here unchanged, rendering `ProductCard`
  directly with an injected `image` node. These are the assertions that today
  only ever exercise the web copy; after this they cover the body both
  platforms render.
- `Product.web.test.tsx` keeps one test per adapter, asserting the seam and
  nothing else: native renders `image` when `imageUrl` is set and `null`
  otherwise; web renders an `<img>` with `alt={title}`. This is the honest
  boundary — the adapters cannot be rendered under Vitest (`README.md:226`),
  so what they get is a type check plus a Detox run.
- `MainNavItem.web.test.tsx` — the five body assertions from
  `MainNav.web.test.tsx:17-26` and `:36-51` (title, icon, badge, `99+` cap,
  no badge at 0), rendered with a stub `navProps`.
- `MainNav.web.test.tsx` keeps the two wiring assertions it already has
  (`:12-15` link href, `:28-34` onPress fallback).

Both `Product.web.test.tsx` and `MainNav.web.test.tsx` must pass **before** the
move, and the body assertions must pass **after** it, or the extraction changed
behaviour. That is the whole proof and it is cheap.

## Impact

**Reuse.** 115 duplicated code lines (74 + 41) across the two most-rendered
shared components in the product stop existing twice. Line count across the
four files goes *up* — two new shared files and two ~10-line adapters instead
of two full components — and that is the correct trade: the win is that the
substantial part exists once, not that fewer characters are typed.

**Consistency.** The `Button` centralization allowlist drops from 7 to 6, and
the `MainNav` `shrink`/`overflow-hidden` divergence stops needing a comment in
`BottomNav.tsx` to explain. The `expo-image` rationale ends up on the file that
makes the `expo-image` choice instead of on the file that happens to be first.

**Testability.** This is the real gain. 74 lines of `Product` and 41 of
`MainNav` move from "reachable only by Detox on a machine with Xcode" into the
one Vitest project the repo already runs. The eight `Product.web.test.tsx`
assertions and seven `MainNav.web.test.tsx` assertions stop being assertions
about one platform's copy of a shared component and become assertions about
the component.

**Scalability and performance.** None, and none is claimed. No render-path work,
no memoisation change, no bundle-size change: each platform still imports
exactly one adapter and the same modules as before, and `ProductCard` adds one
component boundary where there was none.

**What does not improve.** `ProductListScreen` stays split — `FlatList`
virtualization versus a CSS grid with an `IntersectionObserver`
(`ProductListScreen.web.tsx:51-65`) is a genuine implementation difference, and
this proposal does not touch it. The two `fetch` wrappers stay duplicated
(`web-application/lib/api.ts`, `mobile-application/src/api/client.ts`); that is
settled at `improve-proposals/2026-10-03-seller-storefronts-my-store.md:172`.
The two adapters per component are still not rendered by any Vitest project —
`README.md:226` settles that — so the *props each adapter computes* remain
verified only by `tsc` and by Detox. And this does not give `mobile-application`
a unit test runner; the problem it removes is that most of the shared UI now has
one implementation to test rather than two.

## Risks / trade-offs

- **This contradicts a line in `README.md` and needs the argument, not the
  diff.** `README.md:336-338` reads as "platform-split, not one file with
  internal branching", and a reviewer may take the proposal as undoing that.
  It does not: both `MainNav.tsx` and `MainNav.web.tsx` survive as separate
  files, and neither imports `solito/navigation`. What changes is that they stop
  containing the component. The `README.md` bullet should be amended in the same
  commit to say the split is two thin adapters over one body, not two
  components.
- **`Product`'s split has no stated reason, so this proposal has to supply
  one.** If the real reason is something not visible in the tree — an
  `expo-image`-on-web bundle or runtime problem that was hit and not written
  down — then extracting `ProductCard` still works (the adapter still owns the
  `expo-image` import), but the *rationale comment* belongs in `README.md`, not
  only on the adapter. Ask before landing; do not invent a justification.
- **Hoisting `shrink overflow-hidden` into the shared body is a native layout
  change.** Treat it as a separate commit from the extraction, gated on
  `tab-bar-position.e2e.ts` plus a visual check. If it regresses, use the
  `className` passthrough; do not re-split the body.
- **A shared body is a third module per component.** Three files where there
  were two is a real cost in navigability. It is worth it here because the body
  is 46 and 21 lines respectively and the adapters are ~10; it would not be for
  a component whose two copies genuinely differ. The rule of thumb to write into
  the README bullet: split the file, not the component — and only when the
  difference is an import or a platform prop, not a rendering strategy.
- **`ProductCard` gains a `ReactNode` prop that callers can misuse** (passing a
  string, passing two nodes). It is internal to `common/Product/`, not exported
  from `src/index.ts`, which bounds it.
- **Scope.** The `vitest.config.ts` / `vitest.config.web.ts` pair in
  `components-library` and its near-clone in `web-application/vitest.config.ts`
  are a separate duplication; the `store_name` snapshot in `InMemoryStore` is
  claimed by `…-make-the-store-contract-executable.md`; the 13-line
  `expect(...).not.toThrow()` icon tests are a test-quality question, not a
  duplication one. None of them belong here.

## Validation

1. `pnpm --filter @rnw/components-library test` — the cheapest gate. The two
   existing suites (`Product.web.test.tsx`, `MainNav.web.test.tsx`) must pass
   **unchanged** before the extraction; the moved body assertions must pass
   **unchanged** after it. `Button.centralization.test.ts` must pass with the
   allowlist edited to the predicted 6 entries — and its second test
   (`:63-70`) is what proves the entries were not just deleted.
2. `pnpm typecheck && pnpm lint` — `src/index.ts:4-8` re-exports from the
   adapters, so both surfaces still resolve; Biome will flag the adapter files
   if they end up importing something they should not.
3. `pnpm --filter @rnw/components-library test` — the utils project must still
   run (8 files). It is a separate Vitest project (`vitest.config.utils.ts:7`)
   and is the canary for a broken root `vitest.config.ts:8` `projects` array.
4. `pnpm --filter @rnw/web-application test` — `tests/marketplace.test.tsx`
   renders the card transitively (`app/marketplace/page.tsx` →
   `ProductListScreen.web.tsx:46`), so it is the regression net for the card and
   must pass without edits. In `components-library`, the other two suites that
   render it are `ProductListScreen.web.test.tsx` and
   `PublicStoreScreen.web.test.tsx`; both are in step 1's gate. Note that
   `tests/marketplace-detail.test.tsx`, `tests/my-store.test.tsx` and
   `StoreScreen.tsx` do **not** render `Product` — `StoreScreen` takes
   `ProductData[]` and maps them itself (`StoreScreen.tsx:21`) — so they are not
   evidence either way and should not be cited as cover.
5. Line-count check — the same mechanical measurement that produced the table
   at the top:
   ```bash
   cd components-library/src/common
   norm() { grep -v '^[[:space:]]*$' "$1" | grep -v '^[[:space:]]*//' \
            | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }
   for f in Product/Product.tsx Product/Product.web.tsx \
            MainNav/MainNav.tsx MainNav/MainNav.web.tsx; do
     printf '%s %s\n' "$f" "$(norm "$f" | wc -l)"
   done
   ```
   Success is not "0 identical lines" — it is that each adapter is under ~15
   code lines and each shared body holds the markup. `Button.centralization.test.ts`'s
   allowlist length is the second, independent check.
6. `pnpm --filter @rnw/web-application test:e2e` — `e2e/marketplace.spec.ts:9`
   clicks `product-card-prod-1` and `e2e/cart.spec.ts:9` clicks "Add to Cart",
   so the card and the wishlist toggle are exercised against a real
   react-native-web build. Needs api-rs running and seeded.
7. `pnpm --filter @rnw/mobile-application test:e2e` — **not runnable without
   Xcode and a simulator**, and said so plainly: `marketplace.e2e.ts:16`,
   `cart.e2e.ts:14` and `checkout.e2e.ts:14` are the only checks that render the
   *native* `Product`, and `tab-bar-position.e2e.ts` is the regression gate for
   step 2's `shrink overflow-hidden` hoist. This proposal is not done until one
   of those runs green on a machine with a native build.
8. `pnpm --filter @rnw/components-library build-storybook` — `Product.stories.tsx`
   and `MainNav.stories.tsx` both import the bare `./Product` / `./MainNav`
   specifier and run through Vite, so they resolve the web adapter exactly as
   the tests do. A Storybook build is the check that nothing in the extraction
   depends on `.web` resolution the bundlers do not share.
9. Not required, and honestly so: nothing here touches `api-rs`, so no Rust
   check applies.

## Related proposals

- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — related, not superseded, and its single largest "what does not improve"
  clause is the thing this proposal acts on.** Its Impact section ends:
  "`ProductListScreen.tsx` / `.web.tsx` (which are legitimately different:
  `FlatList` virtualization vs a CSS grid with an `IntersectionObserver`) are
  untouched." That exclusion is correct and is honoured here — this proposal
  touches neither file. What that proposal did not examine is the two splits
  *inside* `components-library/src/common/`, which are not implementation
  differences but one-element differences. Different surface, no file overlap.
- **`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  — unrelated surface (`api-rs` handlers and cache).** No overlap.
- **`code-optimization-improve-proposals/2026-10-03-22-37-46-make-the-store-contract-executable.md`
  — unrelated surface (`api-rs` store traits).** No overlap.
- **`improve-proposals/implemented/2026-09-29-sort-and-price-filter.md`** —
  **related precedent, and the closest thing to a counter-argument.** Its §2
  adds `ProductFilterControls` and states at line 40 that it is small enough
  "to sit inline next to `SearchInput` in both `ProductListScreen.tsx` and
  `ProductListScreen.web.tsx` — no new platform-specific component needed."
  That is the repo already deciding, case by case, whether a platform pair is
  warranted — and the correct call each time. This proposal does not reverse
  that judgement; it applies it to `Product` and `MainNav`, where the answer
  turns out to be no.
- **`improve-proposals/implemented/2026-09-29-recently-viewed-products.md`** —
  edited both `ProductListScreen` copies by design (lines 48, 67) and is a clean
  example of duplication that is *earned* rather than accidental. Untouched
  here.
- **`improve-proposals/2026-09-29-12-22-server-side-product-search.md`** — the
  largest queued change to `ProductListScreen.web.tsx` (`:59`, `:85`) and the
  biggest upcoming test-authoring cost on that screen. Orthogonal: this change
  makes `Product`'s body testable once instead of twice, which lowers rather
  than raises the cost of the screen tests that proposal will need.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md`** — settled the
  duplicated `fetch` wrappers at line 172. Unchanged by this proposal, and the
  same reasoning (two adapters, one shared body, no shared transport) is what
  makes the api layer's duplication acceptable here too.