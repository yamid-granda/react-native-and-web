import { Text, View } from "react-native"
import { Button } from "../../common/Button/Button"
import { useCounterStore } from "./useCounterStore"

export function HomeScreen() {
  const { count, increment } = useCounterStore()

  return (
    <View
      testID="home-screen"
      className="min-h-screen flex-1 items-center justify-center gap-6 bg-zinc-50 p-8"
    >
      <Text className="text-3xl font-semibold text-zinc-900">react-native-and-web</Text>
      <Text className="max-w-xs text-center text-zinc-600">
        This screen is the exact same @rnw/components-library component, rendered by the Next.js web
        app (via react-native-web) and the Expo app.
      </Text>
      <Button label={`Pressed ${count} times`} onPress={increment} />
    </View>
  )
}
