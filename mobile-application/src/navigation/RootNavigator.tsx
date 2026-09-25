import { useColorScheme } from "react-native"
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { HomeScreen } from "@rnw/components-library"

export type RootStackParamList = {
  Home: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

// Navigation lives only here; web routing is Next.js App Router's job (README).
export function RootNavigator() {
  const colorScheme = useColorScheme()

  return (
    <NavigationContainer theme={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "react-native-and-web" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
