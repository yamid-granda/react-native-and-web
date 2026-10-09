# Visual Manual — the UI standard for this marketplace

> **Binding for every agent and developer.** Read before touching any UI in `components-library/`, `web-application/`, `mobile-application/`, or any future interface. If this doc and nearby code disagree, **this doc wins — fix the code.** No new value may be invented in a component.
>
> Source of truth for values: `components-library/tokens.css` (palette) + `tailwind-preset.cjs` (token names). This file restates the *rules*, never the raw values. Automated guards: `tokens.parity.test.ts`, `Button.centralization.test.ts`.
>
> **See it rendered:** the `Design System` section in Storybook (`pnpm --filter @rnw/components-library storybook`) is this manual's specimen — one story per section, every sample printing the class string it was built from. Use it to check a rule; use this file to read it.

---

## 0. Principles (decide with these, in order)

1. **Recognition over recall.** Price, stock, primary action, and image answer the buyer's question without a tap.
2. **One primary action per screen.** If two things are equally loud, the screen has no CTA.
3. **Shared view.** Phone, web-mobile, tablet, and desktop render the *same* component tree. Breakpoints add columns, containment, and rails **only in app wrappers and list screens** — never fork internals.
4. **Accessible by default.** Contrast, 44px targets, heading order, focus, reduced motion, and color-never-alone are part of "done", not a follow-up.
5. **Honest urgency.** Real stock, real prices, real seller names. No invented countdowns, no fake viewers. Faked urgency is the fastest way to lose a marketplace.
6. **Kill patterns more than you add.** A new variant, radius, or color needs an `improve-proposals/` entry with a reason, agreed before implementation.

---

## 1. Color (closed set)

Six neutrals form an **elevation ramp** — each step must be visible against the one below it. Light mode raises by going lighter; dark mode raises by going lighter off near-black, which is why elevation there is carried by fill, not shadow.

| Token | Light | Dark | Use for |
| --- | --- | --- | --- |
| `bg-background` | `#f4f4f5` | `#09090b` | App canvas only — never a card |
| `bg-surface` | `#ffffff` | `#202024` | Cards, sheets, nav bars, fields |
| `bg-surface-muted` | `#eaeaec` | `#2e2e34` | Image placeholder, skeleton, pressed fill, decorative |
| `text-foreground` | zinc-900 | zinc-50 | Titles, body, non-price numbers |
| `text-muted` | `#686871` | zinc-400 | Descriptions, helpers, placeholders, prepend icons, inactive nav icons + labels |
| `bg-brand` / `active:bg-brand-dark` | `#2563eb` | `#1d4ed8` | **Only**: price, primary CTA, active nav icon + label, badge |
| `text-success` / `bg-success` | `#166534` | `#4ade80` | In stock, order confirmed, save/delete confirmations |
| `text-warning` / `bg-warning` | `#b45309` | `#fbbf24` | Low stock only (`stock ≤ 5`), pending states |
| `text-danger` / `bg-danger` | `#b91c1c` | `#f87171` | Out of stock, validation + server errors, destructive confirm |
| `border` | `#8a8a92` | `#71717a` | Standalone action outlines (must clear 3:1) |
| `border-muted` | `#c2c2c9` | `#45454d` | Field + secondary-button edge (quiet ~1.7:1, documented deviation) |
| `border-control-border` / `bg-control-bg` / `text-control-text` | aliases `border-muted` / `surface` / `foreground` | same | `Input` + `secondary` `Button` finish — always all three, never mixed |

Hard rules:

- **No `dark:` classes.** Dark mode flips through CSS vars in `tokens.css`; web toggles `.light`/`.dark`, native follows `Appearance`.
- **No hardcoded hex/rgb/gray** anywhere outside `tokens.css` and `brand` in the preset — including native theme files and Storybook decorators.
- Only allowed literals: `bg-black/50` (scrim), `bg-foreground/80` (image badge), `text-white` on a brand fill, and `opacity-*` de-emphasis.
- No new color, no color ramp, no opacity variants of a status color. Adding one needs a proposal.
- **Brand is rationed.** A screen with brand on more than the price + one CTA has lost its accent. Status colors never appear as decoration.
- Interactive surfaces get **both** `hover:` (web pointer) and `active:` (every platform): `bg-brand hover:bg-brand-dark active:bg-brand-dark`, `active:bg-surface-muted`, `active:opacity-80`.

---

## 2. Typography (closed scale, one family)

**One family: the system UI stack.** No font files, no `expo-font`, no webfont — identical rendering and zero layout shift on both platforms, and it is the fastest-loading option for a marketplace.

```
font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

Set it once via the preset's `fontFamily.sans`; `<body>`/`Stack` must not restate a family. Hierarchy comes from **size + weight only**. `font-mono` (the default mono stack) is reserved for codes, SKUs, and IDs.

| Role | Classes | Line height | Use for |
| --- | --- | --- | --- |
| Display | `text-3xl font-bold tracking-tight leading-9` | `leading-9` | Home hero only — one per app |
| H1 | `text-2xl font-bold leading-8` | `leading-8` | Screen title, product/store name — exactly one per screen |
| H2 | `text-xl font-semibold leading-7` | `leading-7` | Section title, drawer title |
| Price large | `text-lg font-bold leading-7 text-brand` | `leading-7` | Cart/checkout total only |
| Body | `text-base font-normal leading-6` | `leading-6` | Product description, paragraphs |
| Body strong | `text-base font-semibold leading-6` | `leading-6` | Button labels |
| Title | `text-sm font-semibold leading-5` | `leading-5` | Card and row titles, input text |
| Meta | `text-sm font-normal leading-5 text-muted` | `leading-5` | Subtitles, row descriptions, section counts |
| Label | `text-xs font-semibold uppercase tracking-wide leading-4 text-muted` | `leading-4` | Field labels, badges, overlines |

- **Always set an explicit `leading-*` with a size.** Android's default leading differs from iOS and web; an unset leading is the #1 cross-platform type bug.
- No `text-[Npx]`, no `font-medium`, no `font-black`, no inline `fontSize`.
- Sizes are fixed per **role**, not per screen — do not "bump" a title on tablet.
- Card titles clamp to 2 lines (`numberOfLines={2}`); the CTA row never wraps.

---

## 3. Spacing, shape, elevation, motion (closed sets)

**Spacing — 4px base, six values only:** `gap-1`=4 (tight text stacks) · `gap-2`=8 (card internals, steppers) · `gap-3`=12 (rows, filter groups) · `gap-4`=16 (sections, grid gap) · `gap-6`=24 (hero, sheet padding) · `gap-8`=32 (hero). No `gap-5`, no `gap-10`, no `[Npx]` margins.

**Screen rhythm:**

| Concern | Classes |
| --- | --- |
| Shell | `flex-1 bg-background` (`min-h-screen` on web pages) |
| Content | `gap-4 px-6 pb-6 md:px-8` — plus `pb-20` when a floating nav is present |
| Row | `flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3` |
| Card | `w-full gap-2 rounded-lg bg-surface p-3` |
| Container | see §6 |

Use the exported constants — `SCREEN_SHELL_CLASSNAME`, `SCREEN_CONTENT_CLASSNAME`, `SCREEN_CONTENT_TABBED_CLASSNAME`, `SCREEN_CARD_CLASSNAME`, `SCREEN_ROW_CLASSNAME` — instead of restating these strings. A new `ScreenShell` component is preferred over either.

**Shape:** `rounded-md`=6 images/icons · `rounded-lg`=8 cards, inputs, buttons, rows, sheets' corners · `rounded-xl`=12 chips (nav items are square, no radius) · `rounded-2xl`=16 dialogs/bottom sheets (`rounded-t-2xl`) · `rounded-full` badges, pills, avatars. Never `rounded-none`, never a pill button, no custom `borderRadius`.

**Controls:** one height, `h-control` (44px), for every `Button` and `Input`. `w-control` is its square counterpart. No other control height, ever; 44px is also the minimum touch target — icons and checkboxes need padding or a hit-slop to reach it.

**Elevation:** two steps only. `shadow-sm` on resting cards; `shadow-md` on overlays (drawer sheet, sticky buy box, dropdown). Overlays also carry `border-surface-muted`, which is what carries elevation in dark mode.

**Motion:** three durations — `100ms` press feedback, `150ms` image cross-fade and hover/opacity transitions, `250ms` sheet/modal slide (`animationType="slide"`). Allowed mechanics only: `active:opacity-*`, `transition-opacity duration-150`, image fade, `LayoutAnimation` on list mutation, skeleton pulse. Banned: bounce/elastic, parallax, auto-playing loops, anything over 250ms. All motion must be gated on `prefers-reduced-motion` (web) and `AccessibilityInfo.isReduceMotionEnabled` (native) — reduced motion means the end state, instantly.

---

## 4. States (loading, empty, error — never bare text)

Async screens have four states, always in this order: **error → skeleton → empty → content**. A bare `text-muted` string is a bug.

| State | Pattern |
| --- | --- |
| Loading | Skeleton blocks that match the final layout's exact dimensions (`bg-surface-muted rounded-md`; pulse only on web, `motion-safe:animate-pulse`). Reserve the grid's height so nothing jumps. |
| Empty | `StatePanel`: `items-center gap-2 rounded-lg bg-surface p-6`, optional 24px icon in `text-muted`, `text-base font-semibold text-foreground` title, `text-sm text-muted` body, one `secondary` `Button` that names the next step ("Add your first product", "Clear filters"). |
| Error | Same panel, `text-danger` title, message in `text-sm text-muted`, one `secondary` "Try again" `Button`. Must be discoverable — never a string alone. |
| Unavailable item | `text-sm text-warning` notice + `secondary` "Remove unavailable items" button, above the summary. |

Every async result change announces itself: `accessibilityLiveRegion="polite"` on the result count and pagination status, `accessibilityRole="alert"` on errors.

---

## 5. Controls (closed set)

- **`Button` is the only button.** `primary` (`bg-brand text-white`) or `secondary` (`border border-control-border bg-control-bg text-control-text`). No third variant, no size variant — see `.agents/rules/button-variants.md`. `loading` swaps the label for `…` and sets `aria-busy`.
- **Selection** (sort chips, filters, tabs, quantity chips): selected = `primary`, unselected = `secondary`. Never a filled/outlined mix of your own.
- **`Input`:** `gap-2 rounded-lg border border-control-border bg-control-bg px-3` + `h-control flex-row items-center`; inner `flex-1 text-sm leading-5 text-control-text outline-none placeholder:text-muted`. Multiline: `items-start py-2 min-h-20 text-left`. Always wrapped in `FormField` (`gap-1`, `Label` above). Errors go through `FormField`/`Label` in `text-danger` — not an ad-hoc red string.
- **`SearchInput`** = `Input` + prepend icon. Placeholder and label are `Search products…` (with ellipsis, everywhere).
- **Icon-only controls:** `w-control` square, `h-control`, `rounded-lg`, icon 20–22px, `accessibilityLabel` required, state shown by color **and** fill (`filled` prop) — never color alone.
- **kebab-case screen-scoped `testId`** on every `Button`/`Input`, never derived from the label.
- Destructive confirmation is `secondary` + `text-danger` label; a destructive *filled* button is not allowed.

---

## 6. The product card — the conversion unit

Identical everywhere. Never reorder, never restyle per screen, never fork per platform beyond the link/image adapter.

```
card      w-full overflow-hidden rounded-lg bg-surface shadow-sm  (+ active:opacity-80)
image     w-full aspect-[4/3] bg-surface-muted, cover, full-bleed (no inset, no rounding — the card clips it)
text      w-full gap-2 p-4 (= gap-4 grid gutter)
badge     absolute left-4 top-4 rounded-full bg-foreground/80 px-2 py-1
          text-xs font-semibold uppercase tracking-wide text-white
title     text-sm font-semibold leading-5  (clamp 2 lines)
desc      text-xs leading-4 text-muted    (clamp 2 lines, ≤ ~60 chars)
price     text-base font-bold leading-6 text-brand
cta row   one primary Button (label varies by surface) + icon-only wishlist
```

Image rules: the image is the product — full-bleed to the card edges (no inset, no rounding; the card's `overflow-hidden` clips it), always present or filled with `bg-surface-muted`, never a broken-icon placeholder; always `accessibilityLabel` (= `alt`) from the title; web adapter passes explicit `width`/`height` matching the 4:3 ratio to hold CLS; native uses `expo-image` (`memory-disk`, 150ms fade).

---

## 7. Marketplace rules that make money

- **Price first, always visible.** Price never requires a scroll and is never muted or smaller than the title. Show currency with the number, not in a corner. When genuinely discounted: `original line-through text-muted` + `sale price text-brand` + "Save 30%". Never a price the buyer has to compute ("3 for $24" is wrong; "$8 each" is right).
- **One primary CTA, named for the action.** `Add to cart` for considered purchases and multi-item orders. On the card, on the detail buy box, and in the buy box it is the same label for the same action.
- **Confirm instantly.** Adding to cart increments the nav badge and returns the label within 1s. Silent success is a lost sale.
- **Stock is honest and legible.** `In stock` (success) · `Only N left` (warning, only when `N ≤ 5` and true) · `Out of stock` (danger + the primary CTA disabled and relabeled "Out of stock" — never a mystery dead button). Never a fake countdown or "12 people viewing".
- **Trust where money changes hands, and only 1–3 signals.** Detail order is fixed: **seller name → rating (when real) → stock state**. Returns/shipping reassurance sits next to the price; security reassurance next to the checkout CTA. Seven badges convert worse than two.
- **Wishlist is secondary.** Icon-only, `HeartIcon`, `filled` + `text-brand` when on; never competes with the CTA in size or color.
- **Fixed flow order.** Cart and checkout read: unavailable notice → line items → summary → total (`text-lg font-bold text-brand`) → primary CTA. The total is the last thing before the CTA.
- **Zero friction.** Quantity starts at 1, checkout is ≤3 steps, no forced account, no hidden fees surfaced at the last step.
- **Result count above the grid** (`text-sm text-muted`) and a no-match state that offers `Clear filters`.
- Detail title is the `<h1>` on web (`ProductDetailScreenWithSemantics`, `<article>`), description is `text-base` body — never truncated on the detail page.

---

## 8. Layout & responsive — shared view, expanding not forking

Breakpoints: **phone `<640`** · **tablet `640–1024` (`md:`)** · **desktop `1024–1280` (`lg:`)** · **wide `≥1280` (`xl:`)**.

| | Phone | Tablet | Desktop | Wide |
| --- | --- | --- | --- | --- |
| Container | `px-6`, full bleed | `max-w-3xl mx-auto` (768) | `max-w-6xl mx-auto` (1152) | `max-w-7xl mx-auto` (1280) |
| Catalogue columns | **exactly 2** | 3 | 4 | 5 |
| Filters | `Drawer` bottom sheet | inline row, `flex-row flex-wrap gap-2` | left rail `w-60 flex-shrink-0` sticky `top-6` | left rail `w-60` sticky |
| Detail | 1 column + sticky bottom buy bar | 2 column: media + buy box | 2 column: media `1fr` + buy box `w-80 lg:w-96` sticky | same, wider media |
| Navigation | floating `BottomNav` | floating `BottomNav` | top sticky header nav (`MainNav` row, `border-b bg-surface`) | same |

Catalogue mechanism: one shared constant, `CATALOGUE_MIN_CARD_WIDTH = 168`, with **2 as the hard minimum column count** — web uses `grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4`, native uses `FlatList numColumns` derived from the same constant and clamped to `≥2`. Never `flex-wrap` + `ScrollView` for a catalogue (it is not virtualized and breaks on resize); never let a 360px phone fall to 1 column.

Non-negotiables:

- **Nav item (`MainNavItem`):** every item is the same `h-16 w-16` (64×64px) square whatever its label, so bar columns never shift with translation length, and it fills the bar's full height so the active fill spans it. Items have no border and `px-0.5` (2px) horizontal inner padding, the most a 56px-wide tile could spare while "My Store" still fits at 320px. Label `text-xs leading-4` regular weight, same colour as a product-card description (`text-muted`). Active icon + label `text-brand` on a `bg-brand/10` fill that cross-fades in and out over 150ms (opacity; instant under reduced motion, via `useReducedMotion`), marked `aria-current="page"` (web links) or `accessibilityState.selected` (native). Hover and active fills cross-fade over 150ms (opacity) on the same `useReducedMotion` path; press is `active:bg-surface-muted`. Keyboard focus ring (`focus-visible:ring-2 ring-brand`) is web-only. Left/right placement is set by the bar's slots, never by item width. Items sit edge to edge with no gap between them.
- Breakpoint classes appear **only** in app wrappers and list screens. A shared component that receives `md:`/`lg:` classes is a bug.
- Prose column `max-w-[72ch]`; rails never wider than 288px; nothing stretches full-bleed on desktop.
- Catalogue lists virtualize: native `FlatList` (`columnWrapperStyle={{ gap: 16 }}`, `onEndReachedThreshold 0.5`, `key={numColumns}`), web CSS grid + `IntersectionObserver` sentinel.
- Horizontal rails: `flex-row gap-4 overflow-x-auto pb-2`, items `w-36 flex-shrink-0`.
- `BottomNav` bar: `fixed inset-x-0 bottom-0 z-50 flex-row items-center border-t border-surface-muted bg-surface px-2` (no vertical padding, so nav items fill its height), offset `insets.bottom + 12` (`getFloatingNavStyle`); native `absolute` via `nativeOverlayStyle`. Every screen under it reserves `pb-20` — **on mobile too**, not only web.
- `ScreenHeader`: `gap-1 px-6 pb-3 md:px-8`, `paddingTop = min(insets.top, 48) + 8`, title `text-2xl font-bold`. Detail screens use `p-6` without `ScreenHeader` — the web wrapper supplies the `<h1>`.
- Test at **320px and 360px** before 1280px. If a layout only works on a phone, it is broken.

---

## 9. Accessibility (done, not deferred)

- Text ≥ **4.5:1** on its actual background; UI boundaries ≥ **3:1**; each neutral step ≥ **1.08:1** off the one below it. Both floors are asserted by `tokens.parity.test.ts` — they fail on the values, not on judgement.
- Touch target ≥ **44×44**, including icon buttons.
- Exactly one `h1` per screen; sections use `h2`/H2 role. `ProductDetailScreenWithSemantics` and the ScreenHeader web wrapper must render them.
- Visible focus: `focus-visible:ring-2 ring-brand` on every interactive element. Never `outline-none` without a replacement.
- Color is never the only signal — badge + text, error + message, active nav + `text-brand` + fill.
- Images: `accessibilityLabel` always; decorative images `accessibilityElementsHidden` + `importantForAccessibility="no"`.
- Accessibility names come from `accessibilityLabel`, never from `testId`. Drawers trap focus on web, close on `Escape`, and mark the scrim `importantForAccessibility="no-hide-descendants"`.
- 200% zoom and 320px reflow must not clip or overlap. Test with the OS text scale at max on native.

---

## 10. Platform splits (only when behavior requires it)

Shared UI lives in `components-library`; apps hold thin wrappers for routing, data, and semantics.

Split a file (`.tsx` + `.web.tsx`) **only** for: `<Link>` vs `Pressable` (crawlers need `<a href>`), `FlatList` vs CSS grid + `IntersectionObserver`, `<article>`/`<h1>` semantics, `expo-image` vs web `Image` with explicit `width`/`height`, `Modal` vs web dialog behaviour, and positioning adapter (`absolute` vs `fixed`).

Never split for styling alone — `className` runs on both through NativeWind. Never merge a split back into a single `Pressable`. Never remove `<Link>`, `<article>`, `<h1>`, `width`/`height`, JSON-LD, `canonical`, or OG/Twitter metadata from a public page; SEO rules live in the root `AGENTS.md`.

---

## 11. Adding to the system

1. Does an existing token/component cover it? **Use it.**
2. Otherwise: proposal in `improve-proposals/` with the problem, the reason the existing set fails, and the conversion or accessibility cost — agreed before code.
3. Then, in order: `tokens.css` → `tailwind-preset.cjs` → component in `components-library` → Storybook story → test → both apps. Never a component-local value.

---

## 12. Verify before you call it done

- [ ] Every color is a token from §1; no `dark:`; no new hex; no `text-[Npx]`/`[Npx]` arbitrary values; every text size has an explicit `leading-*`.
- [ ] Only `Button primary|secondary`, `h-control` everywhere, `secondary` finished with all three control tokens, kebab-case `testId`.
- [ ] Screen is `SCREEN_SHELL` + `SCREEN_CONTENT`; cards `bg-surface rounded-lg shadow-sm` (generic `p-3`; product card `overflow-hidden` with text `gap-2 p-4` = `gap-4` gutter); image 4:3 full-bleed with `surface-muted` fallback, `alt`, and web `width`/`height`.
- [ ] Price is `text-brand font-bold` with currency, visible without scroll; stock uses the honest wording; exactly one primary CTA per screen.
- [ ] Loading/empty/error use §4 — skeleton matches final dimensions, error is `text-danger` with a retry, count is a live region.
- [ ] 2 columns at 320px and 360px; tablet/desktop only add columns, containment, rails — no shared component gained a breakpoint class.
- [ ] Contrast, 44px targets, heading order, focus ring, reduced motion all satisfied.
- [ ] Web: cards navigate via `<Link>`, detail is `<article>` + `<h1>`, JSON-LD/canonical/OG/Twitter present; mobile: `pb-20` under the floating nav.
