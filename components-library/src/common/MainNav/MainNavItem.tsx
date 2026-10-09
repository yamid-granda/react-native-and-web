import {
  forwardRef,
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
  type RefAttributes,
} from "react"
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type TextProps,
  type ViewProps,
} from "react-native"
import { cn } from "../../utils/cn"
import { useReducedMotion } from "../../utils/useReducedMotion"
import type { IconProps } from "../../icons/types"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally.
// `href` is here because the web adapter's navProps carries one and
// react-native-web's View (which Pressable wraps) turns it into a real <a>.
// `hovered` is react-native-web's pointer state; RN's types don't declare it.
type NavPressableState = PressableStateCallbackType & { hovered?: boolean }
const ClassNamePressable = Pressable as ComponentType<
  Omit<PressableProps, "children"> & {
    href?: string
    className?: string
    "aria-current"?: "page"
    children?: ReactNode | ((state: NavPressableState) => ReactNode)
  } & RefAttributes<View>
>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type MainNavProps = {
  href?: string
  onPress?: () => void
  icon: ComponentType<IconProps>
  title: string
  badgeCount?: number
  /** Section the user is in. Drives the brand fill + text; a11y is the adapter's job. */
  active?: boolean
}

/**
 * Platform-resolved press behaviour. Only this differs between the two
 * `MainNav` adapters, so it is the only thing they compute.
 */
export type MainNavItemNavProps = PressableProps & { href?: string; "aria-current"?: "page" }

export type MainNavItemProps = Omit<MainNavProps, "href" | "onPress"> & {
  navProps: MainNavItemNavProps
  /** Platform-only additions to the item's own layout classes. */
  className?: string
}

// h-16 w-16 gives every item the same 64×64px square regardless of its title, so
// the bar's columns don't shift with translation length, and fills the bar's
// full height so the active fill spans it. The title truncates
// (numberOfLines={1}) instead of widening the item. No outline on any item;
// the focus ring is web-only and lives in MainNav.web.tsx.
// The manual's opacity/hover duration (§3). Fills fade with opacity rather
// than animating colour, so they stay on the allowed motion mechanics.
const FILL_FADE_MS = 150

const MAIN_NAV_ITEM_CLASSNAME =
  "h-16 w-16 shrink-0 items-center justify-center gap-1 px-0.5 active:bg-surface-muted"

// A full-bleed colour layer whose opacity follows `visible`. Hover and active
// both use it so they share one fade, one duration and one reduced-motion path.
function FadeFill({ visible, className }: { visible: boolean; className: string }) {
  const reduceMotion = useReducedMotion()
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current

  useEffect(() => {
    // Reduced motion gets the end state instantly (duration 0), per §3.
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : FILL_FADE_MS,
      useNativeDriver: false,
    }).start()
  }, [visible, reduceMotion, opacity])

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity, pointerEvents: "none" }]}>
      <ClassNameView className={`flex-1 ${className}`} />
    </Animated.View>
  )
}

/**
 * The nav item both platforms render — the icon, its badge, and the title
 * below it. `MainNav.tsx` and `MainNav.web.tsx` are thin adapters over this:
 * they resolve how a press turns into navigation and nothing else, which is
 * what keeps the native file free of any `solito/navigation` import.
 */
export const MainNavItem = forwardRef<View, MainNavItemProps>(function MainNavItem(
  { navProps, className, icon: Icon, title, badgeCount, active = false },
  ref,
) {
  // Inactive matches product-card description (text-muted); active is the brand accent.
  const tone = active ? "text-brand" : "text-muted"
  return (
    <ClassNamePressable ref={ref} {...navProps} className={cn(MAIN_NAV_ITEM_CLASSNAME, className)}>
      {({ hovered }) => (
        <>
          {/* Hover is web-only: react-native-web reports `hovered`, native never does. */}
          <FadeFill visible={Boolean(hovered)} className="bg-surface-muted" />
          <FadeFill visible={active} className="bg-brand/10" />
          <ClassNameView className="relative">
            <Icon size={22} className={tone} />
            {badgeCount ? (
              <ClassNameView className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1">
                <ClassNameText className="text-xs font-bold text-white" numberOfLines={1}>
                  {badgeCount > 99 ? "99+" : badgeCount}
                </ClassNameText>
              </ClassNameView>
            ) : null}
          </ClassNameView>
          <ClassNameText className={`text-xs leading-4 ${tone}`} numberOfLines={1}>
            {title}
          </ClassNameText>
        </>
      )}
    </ClassNamePressable>
  )
})
