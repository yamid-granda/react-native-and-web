import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { WEB_RESOLVE_EXTENSIONS, webResolveAlias } from "../components-library/web-resolution"

// Same contract as web-application/vitest.config.ts: RN primitives render
// through react-native-web into jsdom. Covers this app's route wiring
// (marketplace → product detail, tab layout) — distinct from
// components-library's own suites. jsxImportSource forced to "react" for the
// same reason as components-library/vitest.config.web.ts.
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    alias: {
      ...webResolveAlias({
        safeAreaContext: path.resolve(
          __dirname,
          "../components-library/stubs/react-native-safe-area-context.js",
        ),
        svg: "react-native-svg/lib/module/ReactNativeSVG.web.js",
      }),
      // The mobile app never installs solito (only MainNav.web imports it)
      // and the real useLink needs a mounted Next.js router — stub it like
      // the safe-area context above. See tests/stubs/solito-navigation.js.
      "solito/navigation": path.resolve(__dirname, "./tests/stubs/solito-navigation.js"),
      // The real nativewind entry executes dev checks that pull
      // react-native-css-interop into plain Node require(), which resolves
      // the real (Flow-typed) react-native ("Unexpected token 'typeof'").
      // Tests asserting on the scheme override this with their own
      // `vi.mock("nativewind")` factory. See tests/stubs/nativewind.js.
      nativewind: path.resolve(__dirname, "./tests/stubs/nativewind.js"),
    },
    extensions: [...WEB_RESOLVE_EXTENSIONS],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.tsx"],
    server: {
      deps: {
        inline: true,
      },
    },
  },
})
