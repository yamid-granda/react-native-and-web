import { Stack } from "expo-router"

/**
 * The Home tab is a Stack, not a bare route, so the product detail can live
 * inside it (`product/[id]` below) instead of beside it.
 *
 * This is what keeps the detail screen reachable: expo-router/ui's `Tabs`
 * only builds a screen per `TabTrigger` (`triggersToScreens`), so a route
 * directory that is a *sibling* of the tab it belongs to is never mounted —
 * `router.push("/product/[id]")` then resolves against a screen that does
 * not exist and the marketplace never navigates. Nesting the detail under
 * the tab's own layout puts it in the subtree `Tabs` mounts, and the
 * floating tab bar keeps rendering because `TabSlot` still owns the bar.
 *
 * The `(home)` group is what keeps the URLs unchanged: a group contributes
 * nothing to a path, so this still resolves to `/` and `/product/[id]`. A
 * directory literally named `index` would not — it adds an `index` segment
 * and breaks both hrefs.
 */
export default function HomeTabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      {/* Header/appearance is the product Stack's own concern — see
          product/_layout.tsx, which wraps the detail screen. */}
      <Stack.Screen name="product" />
    </Stack>
  )
}