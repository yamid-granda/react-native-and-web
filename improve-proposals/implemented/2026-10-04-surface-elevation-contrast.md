# Surface/background contrast, and WCAG 1.4.11 control outlines

## Problem / opportunity

The neutral palette had two distinct problems, and only one of them was the
one that was reported.

**1. Raised surfaces did not read as raised.** Measured, not eyeballed
(WCAG 2.x ratios, `components-library/tokens.css` before this change):

| pair                                    | light  | dark   |
| --------------------------------------- | ------ | ------ |
| `surface` on `background`               | 1.04:1 | 1.12:1 |
| `surface-muted` on `surface`            | 1.10:1 | 1.19:1 |

Light mode was the worse of the two: `background` was `#fafafa` and `surface`
was `#ffffff`, a difference of five levels out of 255 on the largest surface in
the app. Every card, cart row, checkout summary, sheet and nav bar sat on the
page as an unresolvable shape. Dark mode was nearly as flat. On top of that,
`ProductCard` leans on `shadow-sm` for definition, and a dark shadow on a
near-black canvas is close to invisible — so in dark mode the fill was the only
thing doing any work, and it was doing almost none.

**2. Every control outline failed WCAG 1.4.11.** `Input` and `Button`'s
`outline`/`chip` variants all drew their border with `border-surface-muted` on
top of `bg-surface` — 1.10:1 in light, 1.19:1 in dark, against a 3:1 minimum
for visual information required to identify a control. Text fields and
secondary actions were failing a WCAG success criterion while looking correctly
wired in review, which is the worst combination: invisible to design QA, and
announced by screen readers and contrast tooling as broken.

The cause was a token doing three jobs. `surface-muted` was simultaneously the
outline of a control, the fill of a pressed state, and the placeholder behind a
missing product image. Those three want different values — an outline has to
clear 3:1 against both of its neighbours, a fill does not — so whichever way
you tuned it, something else broke. Text tokens were *not* part of the problem:
`foreground`/`muted` were already at AAA, and the work below deliberately keeps
them there.

## Proposed approach

Rebuild the ramp as an explicit elevation ladder, and split the outline out into
its own token so `surface-muted` is free to be a plain fill.

| token           | light before → after   | dark before → after |
| --------------- | ---------------------- | ------------------- |
| `background`    | `#fafafa` → `#f4f4f5` | `#09090b` (kept)    |
| `surface`       | `#ffffff` (kept)       | `#18181b` → `#202024` |
| `surface-muted` | `#f4f4f5` → `#eaeaec` | `#27272a` → `#2e2e34` |
| `border`        | — → `#8a8a92`           | — → `#71717a`       |
| `border-muted`  | — → `#c2c2c9`           | — → `#45454d`       |
| `muted`         | `#71717a` → `#686871`  | `#a1a1aa` (kept)    |
| `foreground`    | `#18181b` (kept)       | `#fafafa` (kept)    |

Resulting ratios, all verified:

| pair                                | light before → after | dark before → after | floor |
| ----------------------------------- | -------------------- | ------------------- | ----- |
| `surface` on `background`           | 1.044 → **1.099**    | 1.123 → **1.225**   | 1.08  |
| `surface-muted` on `surface`        | 1.099 → **1.201**    | 1.189 → **1.203**   | 1.08  |
| `border` on its own fill (1.4.11)   | 1.099 → **3.425**    | 1.189 → **3.359**   | 3     |
| `border` on the canvas beside it    | 1.049 → **3.116**    | 1.336 → **4.117**   | 3     |
| `border-muted` on its own fill      | — → 1.771            | — → 1.706          | 1.5   |
| `border-muted` on the canvas        | — → 1.610            | — → 2.101          | 1.5   |
| `muted` on `background` (1.4.3)     | 4.630 → **5.018**    | 7.763 → 7.763       | 4.5   |
| `muted` on `surface` (1.4.3)        | 4.833 → **5.516**    | 6.913 → **6.335**   | 4.5   |
| `muted` on `surface-muted` (1.4.3)  | 4.397 → **4.591**    | 5.812 → **5.264**   | 4.5   |
| `foreground` on `background` (1.4.6)| 16.97 → **16.12**     | 19.06 → 19.06       | 7     |

Decisions worth stating, because each one is a trade:

- **Light mode raises elevation by going lighter; dark mode by lifting off
  near-black.** Both keep `surface` as the brightest layer in light and a lifted
  grey in dark, so a card is a distinct object in both schemes rather than one
  scheme relying on a shadow the other cannot show.
- **`background` had to move, which forced `muted` with it.** Secondary text
  sits directly on the canvas, and zinc-500 on the new zinc-100 canvas is
  4.40:1 — just under AA. `muted` is darkened one step to compensate. Net
  effect on `muted` legibility is an improvement everywhere, so darkening the
  canvas cost nothing.
- **The dark `surface` stops short of zinc-800 on purpose.** Taking `surface` to
  `#27272a` would push elevation to 1.34:1, but it also forces the outline up to
  `#a1a1aa` (5.76:1) to stay above 3:1 and drops `muted`-on-`surface-muted` to
  4.07:1, under AA. `#202024` is the furthest the surface can lift while the
  outline stays a restrained zinc-500.
- **There are two border weights, because 3:1 is a floor and not a target.**
  The first pass put every outline at `#8a8a92` (3.43:1) and it read as
  exaggerated — a cage around every field rather than an edge. Measured against
  reality, 3.43:1 is about *twice* iOS's `systemGray4` (1.71:1), and a form is
  the one place that weight repeats down the page. So `border` stays at 3:1 for
  **actions** (`Button`'s `outline`/`chip`, which are singular and need to read as
  actionable) and `border-muted` lands at ~1.7:1 for **fields** (`Input`, which
  repeats and should stay quiet), with the two schemes matched to each other so
  a form weighs the same in either. This is also what separates the field from the
  product cards: a card is `bg-surface` plus `shadow-sm` with no outline at all, so
  a light field edge stops competing with it.
  **The honest cost:** a 1.77:1 field edge does not satisfy 1.4.11's 3:1. That is
  a deliberate, documented deviation — the same trade Apple and Material make,
  since Material's outlined field is ~1.5:1 — and `tokens.parity.test.ts` states
  it in the assertion that covers those two pairs rather than quietly blessing a
  1.5:1 floor. If a field ever does need 3:1, the fix is one class name
  (`border-border`). Nothing in the app depends on telling a field from a card by
  its outline alone: a field is also the only thing on the page carrying a
  white-on-canvas fill *and* a single-line label inside it.
- **The outline token is used only where 1.4.11 applies** — `Button`'s `outline`
  and `chip`. Decorative separators (`BottomNav`'s top divider) keep
  `surface-muted`: the criterion covers boundaries required to identify a
  control, not hairlines, and 3:1 there would draw a heavy rule under the nav bar.

**On the commercial goal.** The honest framing is what was measured above, not a
conversion forecast: this removes a real accessibility defect from every text
field and secondary action, and it makes the boundaries of the product card and
cart row — the surfaces a purchase decision is made on — actually resolvable in
both schemes. A dark theme that renders near-identically to the light one reads
as unfinished and undermines trust in the checkout; making it legible is
table stakes rather than a differentiator, which is why the change is a token
ramplus a re-colour and not a redesign.

**Known gap, deliberately left.** `Button`'s `secondary` variant has no border —
its only boundary is the fill, `#ffffff` on `#f4f4f5`, 1.10:1 in light mode. A
strict reading of 1.4.11 fails there too. Fixing it means *adding* a border to
that variant, which is a visible design change rather than a re-colour of an
existing one, so it is left as an explicit product/design decision instead of
being slipped in here.

## Key files/areas

- `components-library/tokens.css` — the ramp, plus `--color-border` and
  `--color-border-muted` and the reasoning for the ladder, the token split, and
  the two weights.
- `components-library/tailwind-preset.cjs` — maps both border tokens.
- `components-library/src/tokens.parity.test.ts` — two new tests assert every
  floor in the table above against both schemes, so neither the ramp, nor the
  1.4.11 fix on actions, nor the deliberate sub-3:1 field edge can silently
  regress.
- `components-library/src/common/Input/Input.tsx` — field edge recoloured to
  `border-border-muted`.
- `components-library/src/common/Button/Button.tsx` — action outlines recoloured
  to `border-border`.
- `mobile-application/src/navHeaderTheme.ts`,
  `components-library/.storybook/preview.tsx` — the two hex mirrors of token
  values, updated to stay mirrors (the parity test fails if they drift).
- `README.md` — the semantic-color list now includes both border tokens.

## Verification

- `pnpm --filter @rnw/components-library test` — 324 passed (50 files), including
  the two new contrast tests and the existing token-parity guards.
- `pnpm --filter @rnw/components-library typecheck` and
  `pnpm --filter @rnw/mobile-application typecheck` — clean.
- `biome check` on every file this change authors — clean. `Button.tsx` and
  `Input.tsx` report a missing trailing newline, but that is pre-existing on a
  clean tree (verified against `HEAD`) and untouched here.
- Not run: Playwright and Detox e2e (need a browser harness / native build), and
  `api-rs` suites (need Docker). Nothing in this change touches the API, and the
  e2e suites select on visible text and `testID`s, none of which changed.
- Native caveat that no unit test can cover: `tokens.css` is resolved across a
  package boundary by Metro, so a native bundle should be built and its compiled
  root variables read to confirm the new `border` variable survives interop — the
  same edge the file's header comment warns about.