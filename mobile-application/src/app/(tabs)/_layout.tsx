import { useState, type ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import type { Href } from "expo-router"
import { TabList, Tabs, TabSlot, TabTrigger } from "expo-router/ui"
import { useColorScheme } from "nativewind"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  BOTTOM_NAV_BAR_CLASSNAME,
  CartIcon,
  getCartTotalCount,
  getFloatingNavStyle,
  getWishlistTotalCount,
  HeartIcon,
  HomeIcon,
  MainNav,
  MarketplaceIcon,
  SettingsIcon,
  SettingsSheet,
  useCartStore,
  useLocale,
  useT,
  useWishlistStore,
  type IconProps,
} from "@rnw/components-library"

// see Button.tsx (components-library) / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

// expo-router/ui's TabList only discovers TabTriggers among its own direct,
// unwrapped children (see README "Architecture boundaries") — so unlike
// BottomNav's web usage, the items can't sit inside their own wrapping View;
// the leading/spacer Views are fine since neither contains a TabTrigger.
//
// Mobile order: settings flush left, the rest flush right in reverse
// (left-to-right: cart, wishlist, my-store, home) with a flex-1 spacer
// between them — the flat TabTriggers can't share a justify-end wrapper.
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
  const { colorScheme, setColorScheme } = useColorScheme()
  const t = useT()
  const { locale, setLocale } = useLocale()
  const [settingsVisible, setSettingsVisible] = useState(false)
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))
  const wishlistCount = useWishlistStore((state) => getWishlistTotalCount(state.ids))

  const TAB_ITEMS: { key: string; title: string; icon: ComponentType<IconProps>; href: Href }[] = [
    { key: "index", title: t("navHome"), icon: HomeIcon, href: "/" },
    { key: "my-store", title: t("homeMyStore"), icon: MarketplaceIcon, href: "/my-store" },
    { key: "wishlist", title: t("navWishlist"), icon: HeartIcon, href: "/wishlist" },
    { key: "cart", title: t("navCart"), icon: CartIcon, href: "/cart" },
  ]

  // Reversed for the right-aligned cluster: left-to-right cart, wishlist,
  // my-store, home (Home first from the right).
  const REVERSED_TAB_ITEMS = [...TAB_ITEMS].reverse()

  return (
    <>
      <Tabs>
        <TabSlot />
        <TabList asChild>
          <ClassNameView
            className={`${BOTTOM_NAV_BAR_CLASSNAME} gap-1`}
            style={{ ...getFloatingNavStyle(insets.bottom), justifyContent: "flex-start" }}
          >
            <ClassNameView className="min-w-14 flex-row justify-start">
              <MainNav
                title={t("navSettings")}
                icon={SettingsIcon}
                onPress={() => setSettingsVisible(true)}
              />
            </ClassNameView>
            <ClassNameView className="flex-1" />
            {REVERSED_TAB_ITEMS.map((item) => (
              <TabTrigger key={item.key} name={item.key} href={item.href} asChild>
                <MainNav
                  title={item.title}
                  icon={item.icon}
                  badgeCount={
                    item.key === "cart" ? cartCount : item.key === "wishlist" ? wishlistCount : undefined
                  }
                />
              </TabTrigger>
            ))}
          </ClassNameView>
        </TabList>
      </Tabs>
      {/* Outside Tabs on purpose: Tabs renders its children inside the
          navigator host, and a Modal-hosting subtree there disturbs tab
          navigation (product detail stopped opening). Drawer portals above
          everything on its own, so this placement changes nothing visually. */}
      <SettingsSheet
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        theme={colorScheme === "dark" ? "dark" : "light"}
        onThemeChange={setColorScheme}
        locale={locale}
        onLocaleChange={setLocale}
      />
    </>
  )
}
