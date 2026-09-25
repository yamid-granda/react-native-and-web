import { Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type HomeIconProps = IconProps

export function HomeIcon(props: HomeIconProps) {
  return (
    <IconBase {...props}>
      <Path d="M3 10.5 12 3l9 7.5" />
      <Path d="M5 9.5V20a1 1 0 0 0 1 1h4v-5a2 2 0 1 1 4 0v5h4a1 1 0 0 0 1-1V9.5" />
    </IconBase>
  )
}
