import type { ComponentType } from "react"
import { Pressable, Text, useColorScheme, type PressableProps, type TextProps } from "react-native"
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { HomeScreen } from "@rnw/components-library"
import { MarketplaceScreen } from "../screens/MarketplaceScreen"
import { ProductDetailScreen } from "../screens/ProductDetailScreen"
import { CartScreen } from "../screens/CartScreen"

// see components-library's Button.tsx / README "Architecture boundaries"
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type RootStackParamList = {
  Home: undefined
  Marketplace: undefined
  ProductDetail: { productId: string }
  Cart: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

type NavigateTo<T extends keyof RootStackParamList> = { navigate: (screen: T) => void }

function MarketplaceHeaderButton({ navigation }: { navigation: NavigateTo<"Marketplace"> }) {
  return (
    <ClassNamePressable
      accessibilityRole="button"
      onPress={() => navigation.navigate("Marketplace")}
    >
      <ClassNameText className="font-semibold text-brand">Marketplace</ClassNameText>
    </ClassNamePressable>
  )
}

function CartHeaderButton({ navigation }: { navigation: NavigateTo<"Cart"> }) {
  return (
    <ClassNamePressable accessibilityRole="button" onPress={() => navigation.navigate("Cart")}>
      <ClassNameText className="font-semibold text-brand">Cart</ClassNameText>
    </ClassNamePressable>
  )
}

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
            headerRight: () => <MarketplaceHeaderButton navigation={navigation} />,
          })}
        />
        <Stack.Screen
          name="Marketplace"
          component={MarketplaceScreen}
          options={({ navigation }) => ({
            title: "Marketplace",
            headerRight: () => <CartHeaderButton navigation={navigation} />,
          })}
        />
        <Stack.Screen
          name="ProductDetail"
          component={ProductDetailScreen}
          options={({ navigation }) => ({
            title: "Product",
            headerRight: () => <CartHeaderButton navigation={navigation} />,
          })}
        />
        <Stack.Screen name="Cart" component={CartScreen} options={{ title: "Cart" }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
