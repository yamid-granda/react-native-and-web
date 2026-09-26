import { Children, cloneElement, isValidElement, type ReactNode } from "react"
import { cssInterop } from "nativewind"
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

function IconBaseImpl({
  size = FRAME_SIZE,
  color = "currentColor",
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
      {withDefaultStroke(children, color)}
    </Svg>
  )
}

// Registers className support the same way NativeWind registers its own
// core components for a color that arrives via a plain prop rather than a
// style object (see react-native-css-interop's own ActivityIndicator
// registration). Without this, a className/currentColor has no meaning to
// react-native-svg on native — only real CSS (web) resolves it (README).
export const IconBase = cssInterop(IconBaseImpl, {
  className: { target: "style", nativeStyleToProp: { color: true } },
})
