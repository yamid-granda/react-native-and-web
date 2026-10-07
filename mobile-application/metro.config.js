const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")
const path = require("node:path")

// Expo SDK 52+ auto-detects pnpm/yarn/npm workspaces (watches the monorepo
// root, resolves `@rnw/components-library` via the workspace symlink) —
// no manual watchFolders/nodeModulesPaths needed for this standard layout.
// If native builds ever fail to resolve the workspace package, the fallback
// is to set `nodeLinker: hoisted` in pnpm-workspace.yaml.
const config = getDefaultConfig(__dirname)

// pnpm installs one peer-hash variant of nativewind/react-native-css-interop
// per importer (mobile-application vs components-library), and Metro follows
// both realpaths, so the bundle ends up with TWO live runtimes: auto-wrapped
// JSX resolves to one copy while IconBase's manual cssInterop() resolves to
// the other. The runtime keeps module-local caches (seenStylesForHotReload,
// rules, colorScheme) next to shared globals, so the copies interleave
// first-seen classNames and dispatch updates to each other's components
// mid-render — "Cannot update a component (CssInterop.IconBaseImpl) while
// rendering a different component (CssInterop.Text)" on theme toggle/first
// press. Resolve both packages from the project root so every importer
// shares the app's single copy (both are 4.2.7/0.2.7, satisfying the
// library's ^4.2.0 peer range).
const SINGLETON_PACKAGES = ["nativewind", "react-native-css-interop"]
const previousResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETON_PACKAGES.some((name) => moduleName === name || moduleName.startsWith(`${name}/`))) {
    return (previousResolveRequest ?? context.resolveRequest)(
      { ...context, originModulePath: path.join(__dirname, "package.json") },
      moduleName,
      platform,
    )
  }
  return (previousResolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = withNativeWind(config, { input: "./global.css" })
