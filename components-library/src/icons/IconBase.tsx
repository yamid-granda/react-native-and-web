import { Children, cloneElement, isValidElement, type ReactNode } from "react"
import { cssInterop } from "nativewind"
import Svg from "react-native-svg"
import type { IconProps } from "./types"

export type IconBaseProps = IconProps & {
  children: ReactNode
  // Fills shapes with `color` instead of leaving them hollow — e.g. a
  // wishlist heart toggling filled/outline. `color` is threaded through
  // rather than a literal "currentColor" fill, since react-native-svg
  // doesn't resolve that CSS keyword on native (see README "Architecture
  // boundaries").
  filled?: boolean
}

const FRAME_SIZE = 24
const STROKE_WIDTH = 2

// Every icon's shapes share the same stroke styling, so IconBase applies
// it to each child by default — a child that sets its own stroke* prop
// keeps it.
function withDefaultStroke(
  children: ReactNode,
  color: NonNullable<IconProps["color"]>,
  filled?: boolean,
) {
  return Children.map(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return child
    return cloneElement(child, {
      stroke: color,
      strokeWidth: STROKE_WIDTH,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      fill: filled ? color : "none",
      ...child.props,
    })
  })
}

function IconBaseImpl({
  size = FRAME_SIZE,
  color = "currentColor",
  filled,
  children,
  ...props
}: IconBaseProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${FRAME_SIZE} ${FRAME_SIZE}`}
      fill="none"
      {...props}
    >
      {withDefaultStroke(children, color, filled)}
    </Svg>
  )
}

// see README "Architecture boundaries" for why this registration exists
export const IconBase = cssInterop(IconBaseImpl, {
  className: { target: "style", nativeStyleToProp: { color: true } },
})
