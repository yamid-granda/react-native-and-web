import { Children, cloneElement, isValidElement, type ReactNode } from "react"
import { Platform, useColorScheme } from "react-native"
import Svg from "react-native-svg"
import type { IconProps } from "./types"

export type IconBaseProps = IconProps & {
  children: ReactNode
}

const FRAME_SIZE = 24
const STROKE_WIDTH = 2

// Matches --color-foreground in globals.css (web-application/mobile-application).
const FOREGROUND_LIGHT = "rgb(24 24 27)"
const FOREGROUND_DARK = "rgb(250 250 250)"

// Every icon's shapes share the same stroke styling, so IconBase applies
// it to each child by default — a child that sets its own stroke* prop
// keeps it.
function withDefaultStroke(children: ReactNode, color: NonNullable<IconProps["color"]>) {
  return Children.map(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return child
    return cloneElement(child, {
      stroke: color,
      strokeWidth: STROKE_WIDTH,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ...child.props,
    })
  })
}

export function IconBase({ size = FRAME_SIZE, color, children, ...props }: IconBaseProps) {
  const colorScheme = useColorScheme()
  // "currentColor" resolves via real CSS inheritance on web (react-native-web
  // renders a DOM <svg>), but react-native-svg has no such cascade on native
  // — it falls back to SVG's spec default of black, ignoring dark mode
  // entirely. Resolve an explicit color there instead.
  const resolvedColor =
    color ??
    (Platform.OS === "web"
      ? "currentColor"
      : colorScheme === "dark"
        ? FOREGROUND_DARK
        : FOREGROUND_LIGHT)

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${FRAME_SIZE} ${FRAME_SIZE}`}
      fill="none"
      {...props}
    >
      {withDefaultStroke(children, resolvedColor)}
    </Svg>
  )
}
