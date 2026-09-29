import { Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type HeartIconProps = IconProps & { filled?: boolean }

export function HeartIcon({ filled, ...props }: HeartIconProps) {
  return (
    <IconBase {...props} filled={filled}>
      <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </IconBase>
  )
}
