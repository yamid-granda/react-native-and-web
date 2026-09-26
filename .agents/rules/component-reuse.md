# Shared components

This project's entire point is sharing UI between `web-application` and
`mobile-application`. Any component both platforms need — not just similar,
the *same* one — must have exactly one implementation, in
`components-library`, imported as-is by both apps.

Never build a parallel per-platform version of a shared piece of UI (e.g. a
web-specific nav bar and a separately hand-built mobile nav bar that just
happen to look alike). If a component needs different wiring per platform
(web `href`/routing vs. native `onPress`/React Navigation), keep that
difference in a thin per-app wrapper that supplies props/callbacks to the
shared component — the shared component itself stays platform-agnostic
beyond genuinely unavoidable cases (e.g. `Platform.OS` branching for a real
platform-API gap, like CSS's `currentColor` not existing on native).

Before adding a UI element used by both apps, check whether an existing
`components-library` component already covers it, and extend that one
rather than writing a second version.
