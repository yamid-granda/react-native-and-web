import { Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type CloseIconProps = IconProps

export function CloseIcon(props: CloseIconProps) {
  return (
    <IconBase {...props}>
      <Path d="M6 6L18 18" />
      <Path d="M18 6L6 18" />
    </IconBase>
  )
}
