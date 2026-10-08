# components-library

Shared React Native + NativeWind UI for both `web-application/` (Next.js) and `mobile-application/` (Expo). Every component here must render identically on both platforms except where a documented platform split exists.

## Read the Visual Manual first

`docs/system-design/index.md` at the repository root is binding for this package and for anything that consumes it. Read it before adding, changing, or reviewing a component. If a component disagrees with the manual, follow the manual and fix the component in the same change.

- Values live in `tokens.css` (palette) and `tailwind-preset.cjs` (token names). **Never** restate a hex, a size, or a radius in a component, a story, or a decorator here.
- Type sizes are fixed per role and always carry an explicit `leading-*`. Colors come only from §1 of the manual.
- `Button` has exactly two variants and one height (`h-control`); it is the only component allowed to set `accessibilityRole="button"` (see `src/common/Button/Button.centralization.test.ts`).
- The product card, screen shells, and row classes come from the exported `SCREEN_*_CLASSNAME` constants — extend those rather than repeating the strings.
- Shared components never take breakpoint classes. Columns, containment, and rails are added by the apps.
- Every new or changed component ships with a Storybook story and a test, and keeps the two guard tests green: `src/tokens.parity.test.ts` and `src/common/Button/Button.centralization.test.ts`.
- `.storybook/design-system/` is the specimen of `docs/system-design/index.md` — one story file per manual section, each sample printing the exact class string it was built from. It documents tokens, so it must never restate one. When a manual rule changes, its specimen changes with it; when a planned rule ships, its badge flips from `planned` to `shipped`.
