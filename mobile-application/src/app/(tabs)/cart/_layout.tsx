import { Stack } from "expo-router"
import { useColorScheme } from "nativewind"
import { getHeaderScreenOptions } from "../../../navHeaderTheme"

// Nested inside the Cart tab so the bottom nav stays visible on the
// checkout screen too, not just the cart list — see product/_layout.tsx.
export default function CartLayout() {
  const { colorScheme } = useColorScheme()

  return (
    <Stack screenOptions={getHeaderScreenOptions(colorScheme === "dark")}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
    </Stack>
  )
}
