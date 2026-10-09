import { Stack } from "expo-router"
import { useColorScheme } from "nativewind"
import { getHeaderScreenOptions } from "../../../../navHeaderTheme"

// Nested inside the Home tab (`(tabs)/(home)/_layout.tsx`) so the bottom nav
// stays visible on the product detail screen too, not just the list. This
// directory has to sit *inside* the tab for the reason documented there:
// `Tabs` mounts only triggered routes, so a sibling `product/` directory
// would leave the detail screen unreachable.
export default function ProductLayout() {
  const { colorScheme } = useColorScheme()

  return (
    <Stack screenOptions={getHeaderScreenOptions(colorScheme === "dark")}>
      <Stack.Screen name="[id]" options={{ title: "Product" }} />
    </Stack>
  )
}
