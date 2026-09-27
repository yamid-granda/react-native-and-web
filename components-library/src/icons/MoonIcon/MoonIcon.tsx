import { Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type MoonIconProps = IconProps

export function MoonIcon(props: MoonIconProps) {
  return (
    <IconBase {...props}>
      <Path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </IconBase>
  )
}
