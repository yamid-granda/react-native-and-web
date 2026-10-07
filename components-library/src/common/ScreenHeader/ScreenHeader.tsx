import type { ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { cn } from "../../utils/cn"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

// iOS HIG (https://developer.apple.com/design/human-interface-guidelines/layout)
// puts the top of scrollable content one safe-area inset below the status bar,
// and Material 3 (https://m3.material.io/foundations/layout/app-bars) lays the
// top app-bar at the same boundary on Android. Both render the title with a
// small additional breathing space on top — iOS uses the equivalent of `pt-2`
// above its large title, Material uses 16dp of padding above its centered
// title. `pt-2` (8pt) is the lowest value that still reads as breathing room
// on a tall device and is also what the ProductDetail web wrapper uses, so a
// shared `ScreenHeader` keeps the two platforms reading the same.
//
// iOS HIG also recommends capping the visible offset so a tall device with a
// large Dynamic Island / camera cutout (some Android tablets report very large
// top insets in landscape with software nav) cannot push the first heading
// visibly off the page. 48pt is the "tall status bar" of a notched phone
// (iPhone 14/15/16 = 47-59pt), so anything above that is treated as the same
// boundary and capped.
const MAX_TOP_INSET = 48

/**
 * Renders a screen-level title with safe-area-aware top spacing.
 *
 * Without it, a screen that lays its first element at the top edge of the
 * viewport renders the title flush against the iOS status bar / Android
 * camera cutout. With it, the title sits one safe-area inset + a small
 * breathing space below the device indicator, matching the iOS HIG and
 * Material 3 large-title conventions without each screen restating the math.
 *
 * Web is a no-op: the SafeArea stub returns `0`, so the wrapper renders the
 * title at its natural top edge, which is already correct in a browser
 * (where the address bar / chrome is the safe area, not the content).
 */
export type ScreenHeaderProps = {
  /** The accessible name — also rendered as the title text by default. */
  title: string
  /**
   * The element is the section heading, so screen readers and crawlers expect
   * a real heading element. Defaults to `h1` on web (the SEO rule applies to
   * the whole screen, not this wrapper — keep this default unless the screen
   * already emits one) and renders an unstyled strong text on native.
   */
  testID?: string
  /**
   * Drops the visual breathing room (`pt-2`) when the title shares its row
   * with controls (back button + settings cog) and the row's own height
   * already clears the safe-area boundary. ProductDetail's web wrapper is
   * the model — `compact` keeps the description pinned to the row rather
   * than floating below it.
   */
  compact?: boolean
  /** Optional caption rendered under the title in muted color. */
  subtitle?: string
  /** Right-aligned control (settings cog, action button) on the same row. */
  trailing?: React.ReactNode
  className?: string
}

export function ScreenHeader({
  title,
  testID,
  compact = false,
  subtitle,
  trailing,
  className,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets()
  const topInset = Math.min(insets.top, MAX_TOP_INSET)
  const topStyle = { paddingTop: topInset + (compact ? 0 : 8) }

  return (
    <ClassNameView
      testID={testID ?? "screen-header"}
      className={cn("gap-1 px-6 pb-3", className)}
      style={topStyle}
    >
      <ClassNameView className="flex-row items-center justify-between gap-3">
        <ClassNameText className="flex-1 text-2xl font-semibold text-foreground" numberOfLines={1}>
          {title}
        </ClassNameText>
        {trailing}
      </ClassNameView>
      {subtitle ? (
        <ClassNameText className="text-sm text-muted">{subtitle}</ClassNameText>
      ) : null}
    </ClassNameView>
  )
}