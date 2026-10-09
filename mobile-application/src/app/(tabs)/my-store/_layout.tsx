import { Stack } from "expo-router"

// Nested inside the My Store tab so the bottom nav stays visible on the login,
// new-product and edit screens too, not just the list — see (home)/_layout.tsx
// for why these have to sit inside the tab rather than beside it.
export default function MyStoreLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="new" />
      <Stack.Screen name="[id]/edit" />
    </Stack>
  )
}
