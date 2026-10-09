import type { ComponentType, ReactNode } from "react"
import { Modal, Pressable, type PressableProps } from "react-native"
import { CloseIcon } from "../../icons/CloseIcon/CloseIcon"
import { Button } from "../Button/Button"
import { useT } from "../../i18n/LocaleContext"

// see Button.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

export type DrawerProps = {
  visible: boolean
  onClose: () => void
  children: ReactNode
}

// The web half of the platform split: base is the same bottom sheet as
// Drawer.tsx (phone/tablet web), `lg:` turns it into a right-side panel
// docked to the viewport edge (desktop `>=1024`, §8). Breakpoint classes
// live here because shared `*.tsx` internals must stay breakpoint-free —
// this file is the only `lg:` allowed for the drawer.
//
// Entry animation comes from `components-library/drawer.css` (imported by
// both web stylesheets), not from Modal: `animationType="slide"` only moves
// bottom-up, the wrong axis for a panel docked to the right edge. The CSS
// slides bottom-up below `lg` and right-to-left at `lg`+, both in the 250ms
// sheet budget (§3), gated on `prefers-reduced-motion`.
export function Drawer({ visible, onClose, children }: DrawerProps) {
  const t = useT()
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <ClassNamePressable
        testID="drawer-overlay"
        accessibilityRole="button"
        accessibilityLabel={t("drawerCloseLabel")}
        onPress={onClose}
        className="drawer-fade flex-1 justify-end bg-black/50 lg:flex-row lg:justify-end"
      >
        {/* stops the press reaching the overlay's onPress via DOM click
            bubbling on web; native already scopes it via the responder
            system, so this is a no-op there, not a workaround. */}
        <ClassNamePressable
          testID="drawer-content"
          onPress={(e) => e.stopPropagation()}
          className="drawer-panel relative max-h-[50%] gap-4 rounded-t-2xl bg-surface p-6 lg:ml-auto lg:h-full lg:max-h-none lg:w-96 lg:max-w-full lg:rounded-l-2xl lg:rounded-r-none lg:border lg:border-surface-muted lg:shadow-md"
        >
          <Button
            label={t("drawerClose")}
            testId="drawer-close"
            variant="secondary"
            onPress={onClose}
            // Above the content, not just after it: the button is the first
            // child and the title stretches full-width beneath it, so without
            // a z-index the title paints over the button on web (native Text
            // never claims touches, which is why this only bites on web) and
            // swallows every tap meant for the X.
            className="absolute right-4 top-4 z-10"
          >
            <CloseIcon size={20} className="text-muted" />
          </Button>
          {children}
        </ClassNamePressable>
      </ClassNamePressable>
    </Modal>
  )
}
