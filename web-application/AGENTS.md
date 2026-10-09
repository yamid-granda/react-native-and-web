<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI is governed by the Visual Manual (read first)

Before creating or changing any screen, layout, class, or style in this app, read `docs/system-design/index.md` at the repository root. It is binding for this app and overrides intuition and existing code.

- Do not restate the manual's values. Get colors from `components-library/tokens.css` (already imported by `app/globals.css`) and names from `tailwind-preset.cjs`.
- Breakpoint classes (`md:`, `lg:`, `xl:`) belong in `app/**` wrappers and in the shared list screens' web splits only — never in a `components-library` component.
- Content is centred by the container ladder in §8 of the manual (`max-w-3xl` / `max-w-6xl` / `max-w-7xl`); no route defines its own container today, so add one only as the manual describes.
- Follow §12 of the manual before reporting UI work complete.

## Desktop (web-only, mobile-first)

- Phone first: every screen must work at 320px/360px with `BottomNav` before any `lg:` work.
- Desktop nav is `app/desktop-header.tsx` (`hidden lg:flex sticky top-0 z-40 border-b bg-surface`); `app/nav-header.tsx` stays phone/tablet (`lg:hidden`). Exactly one visible per viewport.
- Containment lives once in `app/layout.tsx` (`mx-auto max-w-3xl lg:max-w-6xl xl:max-w-7xl`); routes do not add their own. Content keeps `pb-20 lg:pb-8`.
- Catalogue columns/rail live in the `ProductListScreen.web.tsx` list-screen split (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`, rail `lg:w-60 lg:sticky lg:top-20`). Never put breakpoints in shared `*.tsx`.
- Never import `desktop-header` (or any `lg:`/`xl:` class) from `mobile-application/`.
