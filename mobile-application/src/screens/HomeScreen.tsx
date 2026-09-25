import { Text, View } from "react-native";
import { Button } from "@rnw/components-library";
import { useCounterStore } from "../store/useCounterStore";

export function HomeScreen() {
  const { count, increment } = useCounterStore();

  return (
    <View
      testID="home-screen"
      className="flex-1 items-center justify-center gap-6 bg-zinc-50 p-8"
    >
      <Text className="text-3xl font-semibold text-zinc-900">react-native-and-web</Text>
      <Text className="max-w-xs text-center text-zinc-600">
        This is the exact same @rnw/components-library Button rendered by the Next.js web app.
      </Text>
      <Button label={`Pressed ${count} times`} onPress={increment} />
    </View>
  );
}
