import { Circle, Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type SearchIconProps = IconProps

export function SearchIcon(props: SearchIconProps) {
  return (
    <IconBase {...props}>
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </IconBase>
  )
}
