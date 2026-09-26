import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import { MainNav } from "../MainNav/MainNav"
import type { IconProps } from "../../icons/types"

// see Button.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export type BottomNavItem = {
  key: string
  title: string
  icon: ComponentType<IconProps>
  // web wires href, native wires onPress (see MainNav) — a given item
  // normally sets only the one its platform uses.
  href?: string
  onPress?: () => void
}

export type BottomNavProps = {
  items: BottomNavItem[]
}

// The single bottom-nav bar shared by web-application (rendered directly in
// the layout) and mobile-application (rendered as a custom React Navigation
// tabBar) — see README "Architecture boundaries" on component reuse.
export function BottomNav({ items }: BottomNavProps) {
  return (
    <ClassNameView className="fixed inset-x-0 bottom-0 z-50 flex-row justify-center gap-1 border-t border-surface-muted bg-surface p-2">
      {items.map((item) => (
        <MainNav
          key={item.key}
          title={item.title}
          icon={item.icon}
          href={item.href}
          onPress={item.onPress}
        />
      ))}
    </ClassNameView>
  )
}
