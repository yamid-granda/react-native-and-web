import type { SvgProps } from "react-native-svg"

// Shared by every icon in this folder so they stay interchangeable
// (same 24x24 frame/viewBox, same size/color props).
export type IconProps = Omit<SvgProps, "width" | "height" | "viewBox"> & {
  size?: number
  className?: string
}
