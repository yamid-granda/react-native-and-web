import type { ComponentType, ReactNode } from "react"
import { Modal, Pressable, type PressableProps } from "react-native"
import { CloseIcon } from "../../icons/CloseIcon/CloseIcon"

// see Button.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ClassNamePressable
        testID="drawer-overlay"
        accessibilityRole="button"
        accessibilityLabel="Close drawer"
        onPress={onClose}
        className="flex-1 justify-end bg-black/50"
      >
        {/* stops the press reaching the overlay's onPress via DOM click
            bubbling on web; native already scopes it via the responder
            system, so this is a no-op there, not a workaround. */}
        <ClassNamePressable
          testID="drawer-content"
          onPress={(e) => e.stopPropagation()}
          className="relative max-h-[50%] gap-4 rounded-t-2xl bg-surface p-6"
        >
          <ClassNamePressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            className="absolute right-4 top-4 h-8 w-8 items-center justify-center rounded-full active:bg-surface-muted"
          >
            <CloseIcon size={20} className="text-muted" />
          </ClassNamePressable>
          {children}
        </ClassNamePressable>
      </ClassNamePressable>
    </Modal>
  )
}
