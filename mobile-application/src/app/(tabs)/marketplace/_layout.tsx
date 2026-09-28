import { Stack } from "expo-router"
import { useColorScheme } from "nativewind"
import { getHeaderScreenOptions } from "../../../navHeaderTheme"

// Nested inside the Marketplace tab so the bottom nav stays visible on the
// product detail screen too, not just the list.
export default function MarketplaceLayout() {
  const { colorScheme } = useColorScheme()

  return (
    <Stack screenOptions={getHeaderScreenOptions(colorScheme === "dark")}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: "Product" }} />
    </Stack>
  )
}
