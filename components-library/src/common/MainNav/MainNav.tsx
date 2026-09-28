import { forwardRef, type ComponentType, type RefAttributes } from "react"
import { Pressable, Text, View, type PressableProps, type TextProps, type ViewProps } from "react-native"
import type { IconProps } from "../../icons/types"

const ClassNamePressable = Pressable as ComponentType<
  PressableProps & { className?: string } & RefAttributes<View>
>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type MainNavProps = {
  href?: string
  onPress?: () => void
  icon: ComponentType<IconProps>
  title: string
  badgeCount?: number
}

// Native: navigation happens entirely via onPress (there's no RN concept of
// href) — a Tabs.Screen link injects it via expo-router/ui's TabTrigger
// asChild, the same mechanism the Theme toggle's plain onPress already
// relies on. See MainNav.web.tsx for the web implementation.
export const MainNav = forwardRef<View, MainNavProps>(function MainNav(
  { onPress, icon: Icon, title, badgeCount },
  ref,
) {
  return (
    <ClassNamePressable
      ref={ref}
      accessibilityRole="button"
      onPress={onPress}
      className="min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2 active:bg-brand/10"
    >
      {({ pressed }) => (
        <>
          <ClassNameView className="relative">
            <Icon size={22} className={pressed ? "text-brand" : "text-muted"} />
            {badgeCount ? (
              <ClassNameView className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1">
                <ClassNameText className="text-xs font-bold text-white" numberOfLines={1}>
                  {badgeCount > 99 ? "99+" : badgeCount}
                </ClassNameText>
              </ClassNameView>
            ) : null}
          </ClassNameView>
          <ClassNameText
            className={`text-sm font-medium ${pressed ? "text-brand" : "text-muted"}`}
            numberOfLines={1}
          >
            {title}
          </ClassNameText>
        </>
      )}
    </ClassNamePressable>
  )
})
