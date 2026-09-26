import type { ComponentType } from "react"
import { useColorScheme } from "react-native"
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from "@react-navigation/bottom-tabs"
import {
  CartIcon,
  HomeIcon,
  HomeScreen,
  MainNav,
  MarketplaceIcon,
  type IconProps,
} from "@rnw/components-library"
import { MarketplaceScreen } from "../screens/MarketplaceScreen"
import { ProductDetailScreen } from "../screens/ProductDetailScreen"
import { CartScreen } from "../screens/CartScreen"

export type MarketplaceStackParamList = {
  List: undefined
  ProductDetail: { productId: string }
}

export type RootTabParamList = {
  Home: undefined
  Marketplace: undefined
  Cart: undefined
}

const MarketplaceStackNavigator = createNativeStackNavigator<MarketplaceStackParamList>()

// Nested inside the Marketplace tab so the bottom nav stays visible on the
// product detail screen too, not just the list.
function MarketplaceStack() {
  return (
    <MarketplaceStackNavigator.Navigator>
      <MarketplaceStackNavigator.Screen
        name="List"
        component={MarketplaceScreen}
        options={{ headerShown: false }}
      />
      <MarketplaceStackNavigator.Screen
        name="ProductDetail"
        component={ProductDetailScreen}
        options={{ title: "Product" }}
      />
    </MarketplaceStackNavigator.Navigator>
  )
}

const Tab = createBottomTabNavigator<RootTabParamList>()

// icon/title are fixed per tab; MainNav already renders both, so the
// built-in tab bar icon/label are turned off (tabBarShowLabel: false below,
// tabBarIcon left unset) to avoid rendering them twice.
function tabBarButton(icon: ComponentType<IconProps>, title: string) {
  return function TabBarButton({ onPress }: BottomTabBarButtonProps) {
    const handlePress = onPress as (() => void) | undefined
    return <MainNav icon={icon} title={title} onPress={handlePress} />
  }
}

// Navigation lives only here; web routing is Next.js App Router's job (README).
export function RootNavigator() {
  const colorScheme = useColorScheme()

  return (
    <NavigationContainer theme={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: { flexDirection: "row", justifyContent: "center", gap: 4 },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{ tabBarButton: tabBarButton(HomeIcon, "Home") }}
        />
        <Tab.Screen
          name="Marketplace"
          component={MarketplaceStack}
          options={{ tabBarButton: tabBarButton(MarketplaceIcon, "Marketplace") }}
        />
        <Tab.Screen
          name="Cart"
          component={CartScreen}
          options={{ tabBarButton: tabBarButton(CartIcon, "Cart") }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
