import { Stack } from "expo-router"
import { useColorScheme } from "nativewind"
import { getHeaderScreenOptions } from "../../../navHeaderTheme"

export default function WishlistLayout() {
  const { colorScheme } = useColorScheme()

  return (
    <Stack screenOptions={getHeaderScreenOptions(colorScheme === "dark")}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  )
}
