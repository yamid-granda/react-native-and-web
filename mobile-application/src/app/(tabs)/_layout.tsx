import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import type { Href } from "expo-router"
import { TabList, Tabs, TabSlot, TabTrigger } from "expo-router/ui"
import { useColorScheme } from "nativewind"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  BOTTOM_NAV_BAR_CLASSNAME,
  CartIcon,
  getFloatingNavStyle,
  HomeIcon,
  MainNav,
  MarketplaceIcon,
  MoonIcon,
  SunIcon,
  type IconProps,
} from "@rnw/components-library"

// see Button.tsx (components-library) / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

const TAB_ITEMS: { key: string; title: string; icon: ComponentType<IconProps>; href: Href }[] = [
  { key: "index", title: "Home", icon: HomeIcon, href: "/" },
  { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
  { key: "cart", title: "Cart", icon: CartIcon, href: "/cart" },
]

// expo-router/ui's TabList only discovers TabTriggers among its own direct,
// unwrapped children (see README "Architecture boundaries") — so unlike
// BottomNav's web usage, the items can't sit inside their own wrapping View;
// the spacer/trailing Views are fine since neither contains a TabTrigger.
//
// TabList must be asChild-wrapped around a real ClassNameView, not given a
// className itself — TabList isn't cssInterop-registered, and (being
// pre-compiled library code) its own internal View never runs through
// NativeWind's JSX wrapper either, so className on it is a silent no-op —
// see README "Architecture boundaries". Without it, the bar had no
// bottom/left/right, and an absolutely-positioned view with no insets
// defaults to the top-left.
export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  const { colorScheme, toggleColorScheme } = useColorScheme()

  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <ClassNameView
          className={`${BOTTOM_NAV_BAR_CLASSNAME} gap-1`}
          style={{ ...getFloatingNavStyle(insets.bottom), justifyContent: "flex-start" }}
        >
          <ClassNameView className="flex-1" />
          {TAB_ITEMS.map((item) => (
            <TabTrigger key={item.key} name={item.key} href={item.href} asChild>
              <MainNav title={item.title} icon={item.icon} />
            </TabTrigger>
          ))}
          <ClassNameView className="flex-1 flex-row justify-end">
            <MainNav
              title="Theme"
              icon={colorScheme === "dark" ? SunIcon : MoonIcon}
              onPress={toggleColorScheme}
            />
          </ClassNameView>
        </ClassNameView>
      </TabList>
    </Tabs>
  )
}
