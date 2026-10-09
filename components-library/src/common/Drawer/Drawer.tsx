import type { ComponentType, ReactNode } from "react"
import { Modal, Pressable, View, type PressableProps, type ViewProps } from "react-native"
import { CloseIcon } from "../../icons/CloseIcon/CloseIcon"
import { Button } from "../Button/Button"
import { useT } from "../../i18n/LocaleContext"

// see Button.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export type DrawerProps = {
  visible: boolean
  onClose: () => void
  children: ReactNode
}

// RN's own Modal (aliased to react-native-web's on web, same as every other
// RN primitive here) already portals above everything, animates "slide" per
// platform, and wires Escape/back-button via onRequestClose — no bespoke
// z-index/fixed-position scheme needed, unlike BottomNav.
export function Drawer({ visible, onClose, children }: DrawerProps) {
  const t = useT()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Overlay and content are siblings: the overlay <button> must never wrap
          content, otherwise any Button inside becomes a <button> descendant of
          a <button> on web (react-native-web maps accessibilityRole="button"
          to a <button> element) and Next.js throws a hydration error. */}
      <ClassNameView className="relative flex-1 justify-end">
        <ClassNamePressable
          testID="drawer-overlay"
          accessibilityRole="button"
          accessibilityLabel={t("drawerCloseLabel")}
          onPress={onClose}
          className="absolute inset-0 bg-black/50"
        />
        <ClassNameView
          testID="drawer-content"
          className="relative max-h-[50%] gap-4 rounded-t-2xl bg-surface p-6"
        >
          <Button
            label={t("drawerClose")}
            testId="drawer-close"
            variant="secondary"
            onPress={onClose}
            className="absolute right-4 top-4"
          >
            <CloseIcon size={20} className="text-muted" />
          </Button>
          {children}
        </ClassNameView>
      </ClassNameView>
    </Modal>
  )
}
