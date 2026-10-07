// Pure icon-color default resolution (no React Native imports, so the
// node-env utils test project can cover it directly).
//
// react-native-svg has no CSS `currentColor` cascade on native — an
// unresolved "currentColor" stroke falls back to SVG's spec default of
// black, ignoring dark mode entirely — so a bare icon (no className color,
// or a class whose vars fail to resolve) needs an explicit default there.
// Web keeps "currentColor" (real DOM inheritance resolves it).

// Mirrors --color-foreground in tokens.css (zinc-900 light / zinc-50 dark).
// Hex, not space-separated rgb(): native color parsers predate CSS Color 4
// and can misread "rgb(250 250 250)", rendering an off-white next to the
// exact token white that className-driven icons resolve to.
export const ICON_FOREGROUND_LIGHT = "#18181b"
export const ICON_FOREGROUND_DARK = "#fafafa"

export function resolveIconColor(
  color: string | undefined,
  platformOS: string,
  colorScheme: string | null | undefined,
): string {
  if (color != null) return color
  if (platformOS === "web") return "currentColor"
  return colorScheme === "dark" ? ICON_FOREGROUND_DARK : ICON_FOREGROUND_LIGHT
}
