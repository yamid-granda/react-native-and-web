# Visual Manual — mandatory for all UI work

> All agents, web and mobile developers: read this before touching any UI in `components-library/`, `web-application/`, `mobile-application/`, or any future interface. It overrides intuition. If this doc and nearby code disagree, follow this doc and fix the code.

Source of truth: `components-library/tokens.css` (values) + `components-library/tailwind-preset.cjs` (names). Never restate colors/heights elsewhere.

## 1. Tokens (do not invent new ones)

| Token | Light | Dark | Use for |
| --- | --- | --- | --- |
| `bg-background` | `#f4f4f5` | `#09090b` | App canvas only |
| `bg-surface` | `#ffffff` | `#202024` | Cards, sheets, nav bar, fields |
| `bg-surface-muted` | `#eaeaec` | `#2e2e34` | Image placeholder, pressed state, decorative fill |
| `text-foreground` | zinc-900 | zinc-50 | Titles, prices (non-accent), body |
| `text-muted` | `#686871` | zinc-400 | Descriptions, subtitles, placeholders, icons-prepend |
| `bg-brand` / `active:bg-brand-dark` | `#2563eb` | `#1d4ed8` | Primary CTA, price, active nav icon, badge |
| `border` | `#8a8a92` | `#71717a` | Standalone action outlines only (must clear 3:1) |
| `border-muted` / `border-control-border` | `#c2c2c9` | `#45454d` | Field + secondary-button edge (quiet, ~1.7:1 by design) |
| `bg-control-bg` / `text-control-text` | = surface / foreground | same | Input + secondary Button fill/label — always together |

Rules:

- No `dark:` classes. Dark mode flips via CSS vars (`tokens.css`); web toggles `.light`/`.dark`, native follows OS.
- No `text-current`, no hardcoded hex/gray outside `tokens.css` + `brand`. Only exceptions: `bg-black/50` (drawer scrim), `bg-foreground/80` (image badge), `text-white` on brand fills.
- No new color, no `shadow` except `shadow-sm` on product cards (dark mode carries elevation via fill, not shadow).

## 2. Type scale (fixed mapping)

- `text-xs font-semibold uppercase tracking-wide text-muted` — labels, card desc, badges.
- `text-sm font-semibold text-foreground` — card/row titles, inputs (`text-sm` + `text-control-text`).
- `text-sm text-muted` — subtitles, row descriptions.
- `text-base font-semibold` — buttons; `text-base font-bold text-brand` — card price.
- `text-xl font-bold` — detail price; `text-2xl font-semibold text-foreground` — screen title (`ScreenHeader`), detail title.
- Detail title on web must render as `<h1>` inside `<article>` (see `ProductDetailScreenWithSemantics`). Shared screen uses `<Text>`; `.web.tsx` wrapper adds semantics — never remove.
- One `text-3xl` allowed: home hero only.

## 3. Spacing + shape

- Control height: `h-control` (44px) for every Button/Input. No other heights. Touch target floor 44×44.
- Screen shell: `flex-1 bg-background` → inner `gap-4 px-6 pb-6` (list/detail). Home hero: `gap-6 p-8`, centered.
- Grid constants: `GAP=16` (`gap-4`), `HORIZONTAL_PADDING=24` (`px-6`), bottom `pb-6` / `pb-20` under floating nav.
- Stack rhythm: `gap-1` text stack, `gap-2` card internals / steppers, `gap-3` rows + filter groups, `gap-4` sections.
- Radius: `rounded-lg` cards/inputs/buttons, `rounded-md` card image, `rounded-full` badges, `rounded-xl` nav item, `rounded-t-2xl` bottom sheet. No pills for buttons, no `rounded-none`.
- Rows: `flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3`.

## 4. Controls (closed set)

- `Button` is the only button. Variants: `primary` (`bg-brand text-white`) / `secondary` (`border-control-border bg-control-bg text-control-text`). No sizes, no third variant without `improve-proposals/` sign-off.
- Selection (sort chips, filters): selected = `primary`, unselected = `secondary`.
- `Input`: `h-control flex-row items-center rounded-lg border-control-border bg-control-bg px-3`, inner `flex-1 text-sm outline-none placeholder:text-muted`. Multiline: `items-start py-2` + `min-h-20`. Always wrap in `FormField` (label above, `gap-1`).
- `SearchInput` = `Input` + icon, placeholder/label `Search products…`.
- kebab-case screen-scoped `testId` on every Button/Input (never derived from label).

## 5. Product card (conversion unit — keep identical everywhere)

Card: `w-full gap-2 rounded-lg bg-surface p-3 shadow-sm`. Image: `h-32 w-full rounded-md bg-surface-muted`, `cover`, always `accessibilityLabel` (= `alt`, explicit `width`/`height` on web to avoid CLS). Missing image = `surface-muted` fill, never broken icon.

Order inside card (never reorder): image (badge top-left `absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-1 text-xs font-semibold text-white`) → title `text-sm font-semibold` (1–2 lines clamp) → desc `text-xs text-muted` → price `text-base font-bold text-brand` + CTA/accessory row.

Marketplace rules that make money:

- Price is always `text-brand font-bold`, never muted, never smaller than title. Currency + availability must match JSON-LD `Offer`.
- One primary action per card/screen above the fold (Add to cart / Buy). Wishlist is icon-only secondary, never competes in color or size.
- Image first, price second glance, CTA third — no description longer than ~60 chars on cards; full text lives on detail page.
- Trust row on detail page: seller name → rating → stock state (`opacity-70` + badge when out of stock). No fake urgency (no invented countdowns).
- Cart/wishlist counts always badged on nav (`h-5 min-w-5 rounded-full bg-brand text-xs font-bold text-white`).

## 6. Layout + responsive (shared view expands, never forks)

Shared components render phone and web-mobile identically. Breakpoints only change columns/containment in app wrappers, never card internals.

| Range | Width | Grid | Shell |
| --- | --- | --- | --- |
| Phone | <640px | 2-col cards (`CARD_MIN_WIDTH=150`, native `FlatList numColumns`, web `repeat(auto-fill,minmax(192px,1fr))`) | `px-6`, filters in `Drawer` (bottom sheet `max-h-[50%] rounded-t-2xl bg-surface p-6`), single-column detail |
| Tablet | 640–1024px | 3-col cards, 2-col detail (gallery left, buy box right, sticky buy box) | `max-w-3xl mx-auto`, `md:grid-cols-3`, filter bar inline `flex-row flex-wrap gap-2` |
| Desktop | >1024px | 4–5-col catalogue, `max-w-7xl mx-auto`, left filter rail (`w-64 flex-shrink-0`, sticky) + grid; detail 2-col with sticky buy panel | Centered content, rails never wider than 288px, text column never wider than 72ch |

Rules:

- Native list = `FlatList` (`numColumns`, `columnWrapperStyle={{gap:16}}`, `onEndReached`); web list = CSS grid + IntersectionObserver sentinel. Never `flex-wrap ScrollView` for catalogues (use `PublicStoreScreen` fix as reference of what not to copy).
- Horizontal rails: `flex-row gap-4 overflow-x-auto pb-2`, items `w-36 flex-shrink-0`.
- Floating `BottomNav`: `fixed inset-x-0 bottom-0 z-50 flex-row border-t bg-surface p-2` + safe-area offset (`insets.bottom + 12`); content gets `pb-20`. Native uses `absolute` via `nativeOverlayStyle`; web uses `fixed`. Same class constant, style adapter only.
- `ScreenHeader`: `gap-1 px-6 pb-3`, `paddingTop = min(insets.top,48)+8`, title `text-2xl font-semibold`. Detail screens use `p-6` without `ScreenHeader` (web wrapper supplies `<h1>`).

## 7. Platform splits (only when behavior requires it)

- Put shared UI in `components-library`. Apps hold thin wrappers: routing, data fetching, SEO/semantics.
- Split file (`.web.tsx` + `.tsx`) only for: `<Link>` vs `Pressable` (cards/nav — crawlers need `<a href>`), `FlatList` vs CSS grid, `<article>/<h1>` semantics, `expo-image` vs Next `Image`. Never split for styling alone — `className` runs on both via NativeWind.
- Do not merge splits back into one `Pressable`. Do not add `noindex` to catalogue routes. Every public page: `canonical` + OG (`url`, `site_name`) + Twitter card + JSON-LD (`Product`/`Offer`, `Store`/`Place`) + sitemap entry.

## 8. Agent checklist (verify before done)

- [ ] Colors only from §1, no `dark:`, no new hex, `h-control` on all controls?
- [ ] Screen uses `bg-background` + `gap-4 px-6 pb-6`, cards `bg-surface rounded-lg p-3 shadow-sm`?
- [ ] Price `text-brand font-bold`, badge `rounded-full`, image `h-32 rounded-md bg-surface-muted` + alt/width/height?
- [ ] Phone layout works at 360px; tablet/desktop only add columns/containment (§6), card internals untouched?
- [ ] Web card navigates via `<Link>`, detail wrapped in `<article>` + `<h1>`, JSON-LD/canonical/OG present?
- [ ] `Button` primary/secondary only, `testId` kebab-case, `BottomNav` offset + `pb-20` content clearance?
