import { Circle, Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type CartIconProps = IconProps

export function CartIcon(props: CartIconProps) {
  return (
    <IconBase {...props}>
      <Path d="M3 4h2l2.4 12.4a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L20 8H6" />
      <Circle cx="9" cy="20" r="1" />
      <Circle cx="17" cy="20" r="1" />
    </IconBase>
  )
}
