import { Stack } from "expo-router"
import { useColorScheme } from "nativewind"
import { getHeaderScreenOptions } from "../../../navHeaderTheme"

// Nested inside the Home tab's product route so the bottom nav stays visible
// on the product detail screen too, not just the list.
export default function ProductLayout() {
  const { colorScheme } = useColorScheme()

  return (
    <Stack screenOptions={getHeaderScreenOptions(colorScheme === "dark")}>
      <Stack.Screen name="[id]" options={{ title: "Product" }} />
    </Stack>
  )
}
