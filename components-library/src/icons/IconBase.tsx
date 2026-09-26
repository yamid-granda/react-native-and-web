import { Children, cloneElement, isValidElement, type ReactNode } from "react"
import Svg from "react-native-svg"
import type { IconProps } from "./types"

export type IconBaseProps = IconProps & {
  children: ReactNode
}

const FRAME_SIZE = 24
const STROKE_WIDTH = 2

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

// unlike currentColor, doesn't need an ancestor to set a CSS `color`
const DEFAULT_COLOR = "rgb(var(--color-foreground))"

export function IconBase({ size = FRAME_SIZE, color = DEFAULT_COLOR, children, ...props }: IconBaseProps) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${FRAME_SIZE} ${FRAME_SIZE}`} fill="none" {...props}>
      {withDefaultStroke(children, color)}
    </Svg>
  )
}
