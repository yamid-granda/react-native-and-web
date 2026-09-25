const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")

// Expo SDK 52+ auto-detects pnpm/yarn/npm workspaces (watches the monorepo
// root, resolves `@rnw/components-library` via the workspace symlink) —
// no manual watchFolders/nodeModulesPaths needed for this standard layout.
// If native builds ever fail to resolve the workspace package, the fallback
// is to set `nodeLinker: hoisted` in pnpm-workspace.yaml.
const config = getDefaultConfig(__dirname)

module.exports = withNativeWind(config, { input: "./global.css" })
