# The design tokens have no owner, so the palette is written out five times and four documents disagree about dark mode

## Problem / opportunity

`tailwind-preset.cjs` is the closest thing this repo has to a design system, and
it is explicit about its own limits. It claims "single source of truth" for the
control-height token and nothing else:

```js
// components-library/tailwind-preset.cjs:10-13
// Single source of truth for the size of every button and input in the
// repo. `h-control` is applied by components-library's Button/Input and
// nothing anywhere else may hardcode a control height, so web and native
// stay on one value without either app restating it.
```

```js
// components-library/tailwind-preset.cjs:27-29
// Values come from each app's --color-* custom properties (see
// README "Architecture boundaries"), which flip for dark mode —
// components use these instead of dark: variants.
```

"Each app's" is the finding. The preset *names* five semantic colors
(`:30-34`) and maps each to `rgb(var(--color-x) / <alpha-value>)`, but the
values those variables resolve to are not in the preset, not in any Tailwind
config, and not owned by anyone — so every consumer writes them out itself.
`grep -rn "global.css"` over the repo returns four lines: the three stylesheets'
consumers (`mobile-application/metro.config.js:11`,
`mobile-application/src/app/_layout.tsx:1`,
`components-library/.storybook/preview.tsx:2`) plus one comment that asserts a
copy is a mirror (`mobile-application/src/navHeaderTheme.ts:5`). That last file
restates three of the same values a fourth time, in a different color notation.

### 1. The same ten declarations are written three times, and they match today

Stripping comments and blank lines:

| file | code lines | `--color-*` declarations |
| --- | --- | --- |
| `components-library/global.css` | 17 | 10 |
| `mobile-application/global.css` | 19 | 10 |
| `web-application/app/globals.css` | 31 | 15 |

Five tokens, light and dark, is ten declarations. `web-application/app/globals.css`
carries fifteen because it needs a second copy of the dark five under a media
query (§2) — the duplication inside that one file is why its count is odd.

The declarations themselves are not drifted. Sorting the `--color-*` lines out of
`components-library/global.css` and out of `mobile-application/global.css` and
diffing the two gives **no output**: the two files hold byte-identical
declaration sets. Nor do the two JS restatements disagree today — I checked each
hex against the channel values it claims to mirror:

| restated as hex | declared as channels (`components-library/global.css`) | token |
| --- | --- | --- |
| `#18181b` (`navHeaderTheme.ts:9`) | `24 24 27` (`:21`) | `--color-surface` dark |
| `#ffffff` (`navHeaderTheme.ts:9`) | `255 255 255` (`:15`) | `--color-surface` light |
| `#fafafa` (`navHeaderTheme.ts:10`) | `250 250 250` (`:12`) | `--color-background` light |
| `#09090b` (`preview.tsx:5`) | `9 9 11` (`:20`) | `--color-background` dark |

**This is duplication and a missing check, not a live visual bug.** That is
stated up front because it changes what the fix is for, and it is also what makes
the duplication dangerous: five copies that agree today do not agree *about how
they are allowed to differ*, which is §2.

### 2. The three stylesheets implement three different dark-mode strategies, and the difference is load-bearing

```css
/* components-library/global.css:18 */          :root.dark          { …5 tokens… }
/* web-application/app/globals.css:16-17 */     @media (prefers-color-scheme: dark) { :root:not(.light) { … } }
/* web-application/app/globals.css:28 */        :root.dark          { …5 tokens… }
/* mobile-application/global.css:14-15 */       @media (prefers-color-scheme: dark) { :root { … } }
```

| stylesheet | media query | `:root.dark` | `:root.light` |
| --- | --- | --- | --- |
| `components-library/global.css` | no | **yes** | no |
| `mobile-application/global.css` | **yes** | no | no |
| `web-application/app/globals.css` | yes (`:not(.light)`) | yes | no |

Three consumers, three answers to "what makes this stylesheet dark":

- **web** needs both, and says why. `README.md:313-325` records that NativeWind
  only ever *adds* a `.dark` class and never a `.light` one, so an explicit light
  pick cannot outrank an OS-dark `@media` block — hence the `:not(.light)`
  guard on the media query plus a separate `:root.dark` for the reverse case.
  That is a real three-way precedence: OS default, explicit light, explicit dark.
- **mobile** has the media query and nothing else. There is no `.dark`/`.light`
  selector in the file for a class to match.
- **components-library** — imported by exactly one consumer,
  `.storybook/preview.tsx:2` — has `:root.dark` and no media query, so Storybook
  never follows the OS. Its own header comment says exactly that, and correctly
  (`global.css:7-9`: "Storybook **alone** toggles via a `.dark` class … instead
  of the OS media query"). So two of the three stylesheets are honestly labelled
  and the third (`mobile-application/global.css`) is not.

The structural consequence is the one that costs: **the file inside the shared
UI package is the copy that is wrong in the direction that matters least, and it
is the copy a developer editing the design system would open first.** Editing
`components-library/global.css` changes Storybook and neither app. Editing
`tailwind-preset.cjs` — the file whose own header says it keeps design tokens
"in sync across web and native" (`:2-5`) — changes no color at all.

### 3. Four documents assert mutually contradictory things about which strategy is in force

| source | claim |
| --- | --- |
| `README.md:283-287` | "All four (`web-application`, `mobile-application`, `components-library`'s Storybook, `mobile-application`'s tab bar toggle) now use `darkMode: \"class\"` — the nav bar's Theme button toggles a `.dark`/`.light` class rather than relying on the OS alone." |
| `components-library/tailwind.config.cjs:8-9` | "**web/mobile stay `\"media\"`** (OS-driven, see preview.tsx) so the backgrounds-addon toolbar can toggle dark mode independently of the OS." |
| `web-application/tailwind.config.ts:10`, `mobile-application/tailwind.config.js:5` | both literally `darkMode: "class"` |
| `.storybook/preview.tsx:16` | `initialGlobals: { backgrounds: "light" }` — Storybook boots light regardless of OS |

`components-library/tailwind.config.cjs:8-9` is wrong about both apps it names:
both set `darkMode: "class"` on the line the comment is attached to. The README
is right about the two `darkMode` settings and overreaches about the *mobile tab
bar toggle*: that toggle is `toggleColorScheme` from NativeWind
(`mobile-application/src/app/(tabs)/_layout.tsx:48`, wired at `:74-77`), and on
native `colorScheme.set` calls `Appearance.setColorScheme` and toggles no class
at all (`node_modules/react-native-css-interop/src/runtime/native/appearance-observables.ts:24-40`).
There is no DOM on native for a `.dark` class to live on, and
`mobile-application/global.css` has no class selector to match regardless.

So the mobile Theme button is wired to a mechanism the mobile stylesheet does not
implement, while the mobile *chrome* around it does react: the nav item's icon
swaps (`(tabs)/_layout.tsx:75`, `SunIcon`/`MoonIcon`) and the native stack header
repaints via `getHeaderScreenOptions(colorScheme === "dark")`, which cannot read
a CSS variable and so restates the palette as hex. Whether the shared tokens
follow is a third-party-plumbing question this repository has not answered in
writing, and **there is no check that could answer it.** That is the expensive
kind of knowledge: it is spread across three stylesheets, two JS files, three
Tailwind configs and a README bullet, and nothing fails when any of it stops
being true.

### 4. Two files restate palette values in hex, each with a comment asserting it matches the tokens

```ts
// mobile-application/src/navHeaderTheme.ts:1-5 (comment), :9-10 (the hexes)
// @react-navigation/native's own ThemeProvider/DarkTheme can't be used here:
// … Colors match components-library/global.css's
// --color-surface/--color-foreground tokens.
export function getHeaderScreenOptions(isDark: boolean) {
  return {
    headerStyle: { backgroundColor: isDark ? "#18181b" : "#ffffff" },
    headerTintColor: isDark ? "#fafafa" : "#18181b",
  }
}
```

```tsx
// components-library/.storybook/preview.tsx:4-5
// Matches --color-background in global.css (zinc-50 / zinc-950).
const APP_LIGHT_BACKGROUND = "#fafafa"
const APP_DARK_BACKGROUND = "#09090b"
```

Both comments are the repo's own assertion that a second copy is a mirror. Both
are currently true, and neither is checkable. `navHeaderTheme.ts`'s duplication
is forced — React Navigation's `screenOptions` takes a plain object and there is
no CSS-variable read available — so the answer is not "delete it" but "make the
claim testable". Note that it hardcodes three of the five tokens and drops
`--color-muted` and `--color-surface-muted` entirely, so a header can already
drift from the surface behind it without any of the five being wrong.

### 5. The enforcement mechanism this repo needs already exists, applied to buttons only

`components-library/src/common/Button/Button.centralization.test.ts` is the
precedent for exactly this shape of check: one test, a cross-cutting invariant
about UI, an allowlist where every entry carries its reason (`:15-24`), and a
second test asserting no entry has gone stale (`:63-70`). `README.md:306-307`
describes it as the reason "a hand-rolled button can't come back".

No test in the repo mentions `--color-`, `global.css`, `navHeaderTheme`, or
`h-control`. Verified:

```bash
grep -rln "h-control\|w-control\|--color-\|global\.css\|navHeaderTheme\|APP_DARK_BACKGROUND" \
  --include='*.test.ts' --include='*.test.tsx' . | grep -v node_modules
# no output
```

`README.md:297-298` also states a rule with no enforcement — "`w-control` …
which no component may restate as a literal `h-*`/`py-*`". I checked, and no
component violates it today (the `h-*`/`py-*` literals in the tree are image
heights, badge heights and nav padding, not control heights). So that rule is
latent rather than broken, which is the same state every other claim in this
document is in, and is why a check is the deliverable rather than another comment.

## Proposed approach

Keep the preset, keep `brand` where it is, keep all three Tailwind configs and
all three stylesheets as files. Change two things: who owns the palette values,
and whether the dark-mode strategy is one decision or three.

### 1. One stylesheet, imported by all three consumers

`components-library` is already the package every consumer imports from — all
three Tailwind configs `require` `tailwind-preset.cjs`
(`web-application/tailwind.config.ts:2`, `mobile-application/tailwind.config.js:1`,
`components-library/tailwind.config.cjs:1`). Put the palette next to it, as
`components-library/tokens.css`, holding the ten declarations in **one** dark-mode
selector strategy, and have each stylesheet import it rather than restate it:

```css
/* web-application/app/globals.css */
/* …tailwind directives… */
@import "../../components-library/tokens.css";
```

```css
/* mobile-application/global.css */
@import "../components-library/tokens.css";
```

```css
/* components-library/global.css */
@import "./tokens.css";
```

Two decisions belong in review, not in the diff:

- **Which strategy wins.** `:root.dark` + `:root:not(.light)`-guarded media
  query is the web one (`globals.css:16-34`) and is the only one of the three
  that supports all three states, so it is the recommended target — but on
  native the media query has no evaluator, so the native stylesheet may want the
  class rule alone. **Decide this before writing the file**, and if the two
  consumers genuinely need different strategies, that is the finding confirmed
  rather than solved: give `tokens.css` a `:root` light block plus a `.dark`
  block, and let each consumer add only the selector *it* needs around them.
- **Metro must be able to resolve the import.** `mobile-application/metro.config.js:11`
  already points NativeWind at a single input (`./global.css`), and
  `mobile-application/src/app/_layout.tsx:1` imports it. A cross-package
  `@import` inside a Tailwind input file is the one part of this that could fail
  to build rather than fail a test. **Check this first, in its own commit**, and
  if Metro will not follow it, fall back to a `postcss-import` plugin or to a
  `scripts/sync-tokens.mjs` generator that writes the block into each file — a
  generator is worse than an import because it can drift silently, so say which
  one it is and why.

`brand` stays in the preset (`:22-26`). It is the one token with a real owner,
because it is a Tailwind color and needs no CSS variable.

### 2. One generated module for the hex restatements

The hex copies exist because a CSS variable cannot be read from
`screenOptions` or from a Storybook `backgrounds` option. Give them one owner
too, beside the palette:

```ts
// components-library/src/tokens.ts — new
/**
 * The palette as hex, for the two places a CSS variable cannot be read:
 * React Navigation's `screenOptions` and Storybook's `backgrounds` option.
 *
 * Generated from `tokens.css` by the same step that writes the stylesheet, so
 * `#18181b` and `--color-surface: 24 24 27` cannot disagree. If you are adding
 * a token, add it to the source the generator reads, not here.
 */
export const surfaceHex = { light: "#ffffff", dark: "#18181b" } as const
export const backgroundHex = { light: "#fafafa", dark: "#09090b" } as const
```

`mobile-application/src/navHeaderTheme.ts:9-10` and
`components-library/.storybook/preview.tsx:4-5` both consume it and lose their
"Colors match…" comments — the generator is the comment now. `tokens.ts` is
inside `components-library/src`, so it is typechecked and is importable from both
apps; unlike the resolution-contract lists, nothing here is a bundler config, so
there is no "must stay dependency-free" constraint.

### 3. The check — one test, in the file `Button.centralization.test.ts` already models

New `components-library/src/tokens.parity.test.ts` (the `utils` Vitest project
at `vitest.config.utils.ts:8-10` is the right home: it is node-only and needs no
DOM, unlike the `web` project). Four assertions, each of which is unwritable
today:

1. **Every `--color-*` declaration in every stylesheet equals the one in
   `tokens.css`** — the three files' declaration sets are provably identical
   (measured in §1; this makes it an invariant instead of an observation).
2. **Every `darkMode` setting is `"class"`**, read from all three Tailwind
   configs. This pins the value that `components-library/tailwind.config.cjs:8-9`
   denies in prose ("web/mobile stay `\"media\"`"), so the next reader of that
   comment finds a test rather than a belief. It cannot check the comment itself —
   which is why §4 exists — but it makes the three settings one asserted fact.
3. **Every stylesheet's dark-mode selector set is one of the recorded
   strategies**, from an allowlist in the style of
   `Button.centralization.test.ts:15-24`, where each entry names why that
   consumer needs it. A fourth selector shape is then a deliberate edit, not an
   accident. Add the companion assertion from `:63-70`: every allowlist entry
   must still be present.
4. **Every hex literal in `navHeaderTheme.ts` and `preview.tsx` equals its
   token.** After step 2 this is asserted by types, so it reduces to "no hex
   literal remains in either file" — cheap, and it stops the mirror-comment
   pattern from growing a third copy.

A companion assertion that no component restates a control height as a literal
`h-*`/`py-*` belongs in the same file, because it is the rule
`README.md:297-298` already states and the preset already claims
(`tailwind-preset.cjs:10-13`) with nothing behind it. Today it passes; that is
the value of a check with no current failure.

### 4. Fix the two comments that are wrong, in the same commits

- `components-library/tailwind.config.cjs:8-9` — delete or correct "web/mobile
  stay `\"media\"`". Both set `"class"` on the next line.
- `README.md:283-287` — state one strategy, not four consumers each with their
  own, and say plainly what the mobile Theme button does (it calls
  `Appearance.setColorScheme`; there is no class on native).
- `README.md:275-288` — replace "Each app's global stylesheet … declares the
  actual `--color-*` values" with the real owner once step 1 lands. The
  `h-control` paragraph is already the right shape and is what the colors should
  read like.

## Impact

**Consistency.** Ten declarations stop being written three times and five values
stop being written twice in a second notation. One stylesheet decides what "dark"
means; the other two import it.

**Maintainability / AI-developer cost — the reason this is worth doing.** Today
the answer to "where do I change the brand's dark background?" is *five files,
and one of them is Storybook's*. An agent that greps `--color-background`, finds
`components-library/global.css:12`, edits it, and reports the change has four
verifiable wrong outcomes: the apps are untouched, `preview.tsx`'s hex is now
stale, `navHeaderTheme.ts`'s hex is unaffected, and no test fails. That is the
failure class this repo already has one instance of and one documented instance
of — `stores.rs:90-92`'s comment that contradicts its own code in
`2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`, and the three
descriptions of a reaper that does not exist in
`2026-10-04-04-06-14-the-session-table-has-no-reaper.md`. Here it is four
descriptions of a dark-mode contract and no implementation of it.

**Testability.** Four assertions that cannot be written today become a
`pnpm --filter @rnw/components-library test` result. The mechanism is not new —
`Button.centralization.test.ts` is the same shape, in the same package, with the
allowlist discipline already established — so this is an instance of a pattern
the repo chose, not a new convention.

**Performance.** None, and none is claimed. One extra `@import` per stylesheet at
build time; no runtime cost, no bundle-size change, no render-path work.

**What does not improve.** `brand` stays a hardcoded hex in the preset
(`:22-26`) — deliberately, since one-off colors that don't change with the scheme
are `README.md:287-288`'s stated exception, and it has an owner. `main-nav`'s
`shrink`/`overflow-hidden` divergence is untouched (it is
`2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`'s step 2, not a
token question). `mobile-application` still has no unit test runner, so this
proposal's checks live in `components-library` only — which is also where the
tokens live, so nothing is lost. And if step 1's Metro import fails, this becomes
a generator script, which is a strictly weaker guarantee than an import and
should be recorded as such in the README rather than presented as equivalent.

## Risks / trade-offs

- **It touches the build for all three packages.** A Tailwind input file that
  cannot resolve its `@import` fails the build, not a test. Land the Metro
  feasibility check as its own commit before anything else, and do not combine it
  with the web change.
- **Choosing one dark-mode strategy is a product decision, not a refactor.** If
  Storybook genuinely must ignore the OS (`tailwind.config.cjs:8-9`'s reason for
  `:root.dark` there) *and* native genuinely cannot evaluate a media query, then
  three strategies are correct and the honest deliverable is the allowlist in
  step 3's assertion 3, not a unified file. Do not force uniformity that costs a
  real capability; force the *record*.
- **`tokens.ts` as a hand-written module re-creates the problem it fixes.** It is
  only better than `navHeaderTheme.ts` if it is generated. If generation is not
  landing in the same change, keep the hex literals where they are and ship only
  assertion 4 — a test that catches the drift, with no new owner to drift.
- **A cross-package `@import` adds a build edge that did not exist.**
  `tailwind-preset.cjs` is already shared three ways, so this is not new
  coupling, but it is a different *kind* — a bundler config consuming it is
  inert, whereas Metro resolving a stylesheet import is not. Say so in
  `tokens.css`'s header comment.
- **This is a visual change with no visual test.** Collapsing three strategies
  into one can change what Storybook shows and what native shows. That needs a
  human to look at both, which is why the checks below stop at "the declaration
  sets are identical" and do not claim the rendering is unchanged.
- **Scope.** The `vitest.setup.web.ts` / `vitest.setup.ts` pair and the shared
  Vitest config duplication are
  `2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`'s and
  `2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`'s. The three
  Tailwind configs' differing `content` globs and `important` are noted in §2 and
  left alone — `important: "html"` is meaningless on native and that is correct.
  `Product.tsx`'s platform split is a separate proposal. None of them belong here.

## Validation

1. **The premise, before any change.** Reproduce §1's measurement — it is what
   makes "identical today" a fact rather than an assertion:
   ```bash
   for f in components-library/global.css web-application/app/globals.css \
            mobile-application/global.css; do
     printf '%-40s %s\n' "$f" "$(grep -c '^\s*--color-' "$f")"
   done
   grep -h '^\s*--color-' components-library/global.css   | sed 's/^ *//' | sort > /tmp/a
   grep -h '^\s*--color-' mobile-application/global.css    | sed 's/^ *//' | sort > /tmp/c
   diff /tmp/a /tmp/c && echo "identical"
   ```
   Before: `10`, `15`, `10`, and `identical`. After: the two apps' counts drop to
   whatever `tokens.css` needs, `grep -c '^\s*--color-'` returns the same number
   for all three, and the diff is still empty.
2. **Metro feasibility, first and alone.** Add the `@import` to
   `mobile-application/global.css`, run `pnpm --filter @rnw/mobile-application
   typecheck` and a Metro bundle, and confirm `bg-surface` still resolves. If it
   does not, stop and take the generator route; do not ship a broken native
   build to keep the diff tidy.
3. `pnpm --filter @rnw/components-library test` — the new `tokens.parity.test.ts`
   plus the existing 39 files (31 `.web.test.tsx` + 8 `.test.ts`) must pass. Write
   assertion 2 first and run it before step 1 of the approach, so the three
   `darkMode` settings are a pinned fact before §4 rewrites the comment that
   denies them. Then add the other three and re-run.
4. **Negative check**, in a scratch branch: change `--color-muted`'s dark value in
   one app's stylesheet and confirm assertion 1 fails. If it passes, the test is
   not reading the files it claims to.
5. **Negative check for the hex mirror**, in a scratch branch: change
   `#18181b` in `navHeaderTheme.ts` and confirm the suite fails. If it passes,
   the mirror is still unverified.
6. `pnpm typecheck && pnpm lint` — `tokens.ts` is a new module inside
   `components-library/src`, so `tsconfig.json`'s `include: ["src"]` covers it,
   and both apps gain an import from the library barrel path.
7. **The check no automated test replaces.** Capture Storybook's light and dark
   renders on `main` before touching anything
   (`pnpm --filter @rnw/components-library build-storybook`, then flip the
   backgrounds toolbar), and compare after. Then run the native app on a
   simulator, tap the Theme item, and record what actually changes — the README's
   claim at `:283-287` says the whole UI follows, and the point of this proposal
   is that nothing currently knows whether that is true. **Record the observed
   answer in the README either way**, including "it does not" if that is what the
   simulator shows.
8. `pnpm --filter @rnw/web-application test` — 7 files, unchanged. The token work
   touches no component and no query key; a failure here means a class name moved.
9. **Not required, and honestly so:** nothing here touches `api-rs`, so no Rust
   check applies. `pnpm --filter @rnw/mobile-application test:e2e` (Detox, needs
   Xcode and a simulator) is the only automated check that could observe native
   dark mode, and step 7 is its manual stand-in — this is not done until one of
   them runs green.

## Related proposals

- **None is superseded, and none claims this.** `grep -rin "global\.css\|--color-\|dark mode\|darkMode\|design token\|navHeaderTheme\|tailwind-preset"` across both proposal folders returns nothing. The single adjacent line is
  `2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`'s closing
  "What does not improve": *"this does not address the storefront's missing
  pagination, the absent sign-out, or **the design-token duplication**; all three
  are separate and none is claimed here."* That is a deferral with no evidence
  behind it — no file, no line, no count — and this document is the first analysis
  of it. If both are ever taken up, this one is upstream: the mutation proposal's
  `productWriteKeys` work is independent, but its step 3 hoists `MyStoreApi` into
  each app's api module, and the app-module boundary is the same boundary this
  proposal crosses from the other side.
- **`2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md` —
  related, not superseded, and the closest structural precedent.** It solves the
  identical problem — "four tools answer the same two questions and they do not
  give the same answer" — for the bundler/test resolution lists, and lands the
  solution in a single owner (`web-resolution.ts`) plus one parity test
  (`svgWebEntryParity.web.test.tsx`). This proposal reaches for the same two
  moves on a different seam: one owner (`tokens.css`) plus one parity test
  (`tokens.parity.test.ts`). **Neither blocks the other**; if that one lands
  first, its "one dependency-free module of strings and arrays that bundler
  configs import" pattern is the template for step 1 here, and its §"Risks"
  warning about a shared module dragging a framework into a config's module graph
  does **not** apply to `tokens.css` — a stylesheet has no module graph.
- **`2026-10-03-23-50-00-one-body-behind-the-platform-splits.md` — related, not
  superseded; a step-2 conflict worth naming.** Its step 2 hoists
  `MainNav.web.tsx:44`'s `shrink overflow-hidden` and notes `BottomNav.tsx:71-77`
  exists only to point at the divergence. That is a layout question, not a token
  one, and this proposal does not touch either file. Its own scope note already
  separates "the duplicated per-file test harness" from this; the token layer is a
  third thing neither covers.
- **`2026-10-04-04-06-14-the-session-table-has-no-reaper.md` — unrelated surface,
  cited only as precedent for the failure class.** Its Impact section calls out
  "three separate files describe a reaper that does not exist" and why that is
  the expensive kind of knowledge for an agent. This document finds the same shape
  in the design-token layer — four descriptions of a dark-mode contract, and no
  single implementation of it — and reaches for the same remedy: make the
  contradiction a test failure instead of a comment.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md`** — unrelated
  surface (per-app API clients and routes). Its §7 credential-storage and §6
  shared-UI material are untouched here.
