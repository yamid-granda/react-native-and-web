import { Stack } from "expo-router"

// Nested inside the Marketplace tab so the bottom nav stays visible on the
// product detail screen too, not just the list.
export default function MarketplaceLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: "Product" }} />
    </Stack>
  )
}
