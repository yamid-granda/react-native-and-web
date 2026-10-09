This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## UI is governed by the Visual Manual (read first)

Before creating or changing any screen, layout, class, or style in this app, read `docs/system-design/index.md` at the repository root. It is binding for this app and overrides intuition and existing code.

- Do not restate the manual's values. Colors come from `components-library/tokens.css` (already imported by `src/global.css`); names come from `tailwind-preset.cjs`.
- Native theme files must reference `tokens.css` values, never re-declare hex (this applies to `src/navHeaderTheme.ts`).
- Breakpoint classes belong in app wrappers and list screens only, never in a shared `components-library` component.
- Every screen under the floating tab bar reserves `pb-20` (§8 of the manual), not only the web app.
- Follow §12 of the manual before reporting UI work complete.

## Desktop ban (this app stays phone-first)

- Never add `md:`/`lg:`/`xl:` classes, desktop-only components, or imports from `web-application/` (e.g. `desktop-header`) here. Desktop enhancement lives only in `web-application/app/**` + `components-library/*.web.tsx`.
- Keep `FlatList numColumns` derived from window width and `pb-20` under the floating tab bar. Verify a change with `grep -r "lg:\|xl:\|md:" src` returning nothing.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
