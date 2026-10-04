// @react-navigation/native's own ThemeProvider/DarkTheme can't be used here:
// Expo Router (SDK 57) vendors its own internal React Navigation fork and
// doesn't list @react-navigation/native as an installable dependency at all
// (see README "Architecture boundaries"), so screenOptions is the only
// theming hook available. Colors match components-library/tokens.css's
// --color-surface/--color-foreground tokens.
export function getHeaderScreenOptions(isDark: boolean) {
  return {
    headerStyle: { backgroundColor: isDark ? "#18181b" : "#ffffff" },
    headerTintColor: isDark ? "#fafafa" : "#18181b",
  }
}
