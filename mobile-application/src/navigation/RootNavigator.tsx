import type { ComponentType } from "react"
import { useColorScheme } from "react-native"
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { createBottomTabNavigator, type BottomTabBarProps } from "@react-navigation/bottom-tabs"
import {
  BottomNav,
  CartIcon,
  HomeIcon,
  HomeScreen,
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

const TAB_ICONS: Record<keyof RootTabParamList, ComponentType<IconProps>> = {
  Home: HomeIcon,
  Marketplace: MarketplaceIcon,
  Cart: CartIcon,
}

// see root README "Architecture boundaries" for why this reimplements
// React Navigation's own default tab-press handling
function TabBar({ state, navigation }: BottomTabBarProps) {
  const items = state.routes.map((route, index) => ({
    key: route.key,
    title: route.name,
    icon: TAB_ICONS[route.name as keyof RootTabParamList],
    onPress: () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      })
      if (state.index !== index && !event.defaultPrevented) {
        navigation.navigate(route.name)
      }
    },
  }))

  return <BottomNav items={items} />
}

// Navigation lives only here; web routing is Next.js App Router's job (README).
export function RootNavigator() {
  const colorScheme = useColorScheme()

  return (
    <NavigationContainer theme={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <TabBar {...props} />}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Marketplace" component={MarketplaceStack} />
        <Tab.Screen name="Cart" component={CartScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
