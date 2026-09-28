import { Stack } from "expo-router"

// Nested inside the Cart tab so the bottom nav stays visible on the
// checkout screen too, not just the cart list — see marketplace/_layout.tsx.
export default function CartLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
    </Stack>
  )
}
