# Active nav item and uniform nav buttons

## Problem
The main nav (`MainNavItem`, shared by `BottomNav`, `DesktopHeader` and the mobile tab bar) never shows which section the user is in. Its only colour change is the transient `pressed` state. Items also size to their label (`min-w-14` + `px-3`), so "Cart" and "My Store" render at different widths. Label type is `text-sm font-medium` with no `leading-*`, and inactive items use `text-muted`, which is weaker than the product card text it sits beside.

## Why the existing set fails
Visual Manual §9 already requires "active nav + `text-brand` + fill", and §8 puts the desktop nav in the same shared `MainNav` row, but no route passes an active state and the item has no fill. §2 bans `font-medium` and requires `leading-*`.

## Change
- `MainNavItem`: new `active` prop. Active = `text-brand` icon and label on `bg-brand/10`. Inactive = `text-muted` icon and label (same colour as the product-card description), regular weight.
- Every item is `h-16 w-16 shrink-0` (64×64px square), fills the bar's full height (bar drops its vertical padding), has no border on any platform, and `px-0.5` (2px) horizontal inner padding, the most a 56px-wide tile can spare while "My Store" still fits at 320px. Label `text-xs leading-4`, `numberOfLines={1}`. Items sit edge to edge with no gap between them. Alignment is unchanged: the bar slots still set left/right placement.
- Motion: the active fill cross-fades over 150ms (opacity, the manual's hover/opacity duration) and is instant under reduced motion (`utils/useReducedMotion`). Icon and label colour snap; animating colour is not an allowed mechanic.
- Hover (web only) fades a `surface-muted` layer in over 150ms, the same way as the active fill; press stays an instant `active:bg-surface-muted`. Web focus uses `focus-visible:ring-2 ring-brand` in `MainNav.web.tsx` only, since the shared item's ring rendered as a stray outline on native.
- A11y via adapters: web `aria-current="page"` on linked items; native `accessibilityState.selected`.
- `isNavPathActive(pathname, href)`: pure helper. Home covers `/`, `/product/*`, `/stores/*`. Other items match exact path or child route.
- Wiring: `usePathname()` in `nav-header.tsx`, `desktop-header.tsx`, and mobile `(tabs)/_layout.tsx`. Settings is active while its sheet is open.

## Conversion / accessibility cost
- Contrast: inactive icons and labels stay `text-muted`, as in product-card descriptions. Active uses brand text, fill and the full-height highlight, so colour is not the only signal. The `border` outline clears 3:1 in both schemes.
- Touch targets: 64×64px, above the 44px floor.
- Narrow screens: 64px squares fit at 360px but overlap Settings at 320px (measured: Cart starts 28px inside Settings). Needs a decision before merge.
- Long translations truncate rather than widen. Confirm on device.

## Follow-up (not this change)
- Dark-mode contrast of `text-brand` on `surface` is inherited from the brand token; a token change needs its own proposal.
