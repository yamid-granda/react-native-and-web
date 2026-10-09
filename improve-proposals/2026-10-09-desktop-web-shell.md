# Desktop web shell

## Problem
`web-application/` renders the phone shell at every viewport: floating `BottomNav`, no top header, no container ladder, catalogue filters stacked above a narrow grid. At `lg`/`xl` this wastes width and hides navigation behind a thumb-optimized bar.

## Why the existing set fails
The Visual Manual (§8) already specifies the desktop ladder (container `max-w-6xl`/`max-w-7xl`, catalogue 4/5 columns, filters left rail `w-60 sticky`, top sticky header nav, detail media + buy box) but no route implements it: `layout.tsx` has no container and renders only `BottomNav`.

## Change (mobile-first, web-only)
- `web-application/app/desktop-header.tsx` (new): `hidden lg:flex sticky top-0 z-40 border-b bg-surface` header with brand + `MainNav` row + theme toggle.
- `web-application/app/nav-header.tsx`: wrap `BottomNav` in `lg:hidden` (phone/tablet only).
- `web-application/app/layout.tsx`: container `mx-auto w-full max-w-3xl lg:max-w-6xl xl:max-w-7xl`, content `pb-20 lg:pb-8`.
- `ProductListScreen.web.tsx` (list-screen web split only): explicit grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`, filters in `lg:w-60 lg:sticky lg:top-20` left rail, `md:px-8` content padding.
- Non-list screens (detail/cart/checkout/home): containment from the layout container only; no internal forks.
- No `lg:`/`xl:` in shared `*.tsx` or in `mobile-application/` (verified by grep + tests).

## Conversion / accessibility cost
Top nav keeps `<a href>` items (SEO, keyboard, focus ring unchanged); one `h1` per screen unchanged; badge counts shared with `BottomNav`; reduced-motion and contrast rules untouched. Risk: two navs in DOM — mitigated with `lg:hidden` / `hidden lg:flex` so exactly one is visible per viewport.

## Follow-up (not this change)
True detail media + sticky buy-box split needs `ProductDetailScreenBase` refactored into Media/BuyBox subcomponents so the web wrapper can place them without forking internals. Cart/checkout 2-column summary rail likewise.
