import type { ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ScreenHeaderProps = {
  title: string
  /** Optional caption under the title, e.g. the auth screen's hint. */
  subtitle?: string
  testID?: string
}

/**
 * The title block every screen used to restate: a 2xl title with the screen's
 * top padding, plus an optional muted caption underneath.
 *
 * One place rather than one copy per screen, so the safe-area-aware top
 * padding (`pt-6`) and the title style cannot drift between screens. Callers
 * render their body in a sibling `px-6 pb-6` view — the header carries its own
 * horizontal padding, so neither side has to know about the other.
 */
export function ScreenHeader({ title, subtitle, testID }: ScreenHeaderProps) {
  return (
    <ClassNameView className="gap-1 px-6 pt-6">
      <ClassNameText testID={testID} className="text-2xl font-semibold text-foreground">
        {title}
      </ClassNameText>
      {subtitle ? <ClassNameText className="text-sm text-muted">{subtitle}</ClassNameText> : null}
    </ClassNameView>
  )
}
