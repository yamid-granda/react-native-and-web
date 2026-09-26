import type { ComponentType } from "react"
import { Pressable, Text, useColorScheme, type PressableProps, type TextProps } from "react-native"
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { HomeScreen } from "@rnw/components-library"
import { MarketplaceScreen } from "../screens/MarketplaceScreen"
import { ProductDetailScreen } from "../screens/ProductDetailScreen"

// see components-library's Button.tsx / README "Architecture boundaries"
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type RootStackParamList = {
  Home: undefined
  Marketplace: undefined
  ProductDetail: { productId: string }
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
          options={({ navigation }) => ({
            title: "react-native-and-web",
            headerRight: () => (
              <ClassNamePressable
                accessibilityRole="button"
                onPress={() => navigation.navigate("Marketplace")}
              >
                <ClassNameText className="font-semibold text-brand">Marketplace</ClassNameText>
              </ClassNamePressable>
            ),
          })}
        />
        <Stack.Screen
          name="Marketplace"
          component={MarketplaceScreen}
          options={{ title: "Marketplace" }}
        />
        <Stack.Screen
          name="ProductDetail"
          component={ProductDetailScreen}
          options={{ title: "Product" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
