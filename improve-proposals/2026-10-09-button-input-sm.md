# Button + Input `size="sm"` for marketplace filters

## Problem / opportunity

`ProductFilterControls` (`components-library/src/common/ProductFilterControls/ProductFilterControls.tsx`)
renders three sort `Button`s in a `flex-row flex-wrap gap-2` row plus two price
`FormField`/`Input`s side by side. At 320–360px every control is the default
`md` density (`h-control` height, `text-base` label, `px-4`/`px-3` gutters), so the
sort row wraps aggressively and the two price fields crowd the dash separator.
Filters need a visibly compact control — shorter height and smaller type as
well as tighter padding — while `secondary` buttons and fields keep reading
as one control finish.

Neither existing `Button` variant fits: `primary`/`secondary` describe fill, not
density. A call-site `className="px-2"` would scatter the compact value across
screens and could restate the height/radius that `h-control` and the variant own
(see `README.md` "Architecture boundaries"). This is the sizes proposal
`.agents/rules/button-variants.md` anticipates.

## Proposed approach

Add `size?: "md" | "sm"` (default `"md"`) to `Button` (`Button.tsx`) and `Input`
(`Input.tsx`). `FormField` needs no change: it already extends
`Omit<InputProps, "className">` and spreads `...inputProps` into `Input`, so
`size` flows through to the price fields.

Kept identical across `md`/`sm` (the point of the proposal):

- Gutter: `gap-2` on the `Input` wrapper; `rounded-lg` + control tokens
  (`border-control-border`/`bg-control-bg`/`text-control-text`) unchanged.
- Icon-only `Button` stays square (`w-control px-0` at `md`, `h-8 w-8 px-0`
  at `sm`). Multiline `Input` keeps `min-h-20 py-2`.

Compact at `sm` (both components together, so a filter-row button beside a
field still reads as one control):

| Control | `md` (current) | `sm` (new) |
| --- | --- | --- |
| Height | `h-control` (44px) | `h-8` (32px) |
| Type | `text-base leading-6` | `text-sm leading-5` |
| `Button` primary `px` | `px-4` | `px-3` |
| `Button` secondary `px` | `px-3` | `px-2` |
| `Input` wrapper `px` | `px-3` | `px-2` |

`secondary` still mirrors `Input` at each size. Implemented via `tailwind-merge`
(`cn`) ordering so the size class wins deterministically; no new token, no new
color, no breakpoint class, no `dark:`.

Accessibility note: `sm` at 32px clears WCAG 2.2 SC 2.5.8's 24px minimum but
sits below the manual's 44px touch-target guidance (§9) — hence filters-only.
`tokens.parity.test.ts` gains two documented `CONTROL_HEIGHT_EXCEPTIONS`
entries (`Button.tsx h-8`, `Input.tsx h-8`) so the one-height guard still pins
everything else.

Pressed/disabled/loading: unchanged (`active:bg-brand-dark` /
`active:bg-surface-muted`, `opacity-50`, `…` + `aria-busy`). Contrast: unchanged
surfaces, so `tokens.parity.test.ts` floors still hold. `selected` still only
announces; the visible selection stays the variant choice in
`ProductFilterControls`.

Call sites moving to `sm`: sort `Button`s + both price `FormField`s in
`ProductFilterControls` only. Every other caller keeps the `"md"` default —
no visual change outside filters.

## Key files/areas

- Edit: `components-library/src/common/Button/Button.tsx` (+ `BUTTON_SIZES`)
- Edit: `components-library/src/common/Input/Input.tsx`
- Edit: `components-library/src/common/ProductFilterControls/ProductFilterControls.tsx`
  (pass `size="sm"`)
- No change: `tailwind-preset.cjs` (reuses `h-control`), `tokens.css`,
  `FormField.tsx` (passthrough)
- Stories: `Button.stories.tsx`, `Input.stories.tsx` (`Small` + sm height-parity)
- Tests: `Button.variants.web.test.tsx` (pin approved sizes), `Button.web.test.tsx`,
  `Input.web.test.tsx` (sm keeps `h-control`/`text-base`, padding switches)

## Verification

- `pnpm --filter @rnw/components-library test` (guards
  `tokens.parity.test.ts` + `Button.centralization.test.ts` stay green)
- Storybook: `Small` stories beside `md`; `HeightMatchesInput` at `sm`
- Manual: 320px + 360px filter rail — three sort chips + min/dash/max fit
  without crowding; screen-reader names and `aria-selected` unchanged
