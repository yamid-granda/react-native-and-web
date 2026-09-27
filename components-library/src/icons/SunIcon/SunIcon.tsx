import { Circle, Line } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type SunIconProps = IconProps

export function SunIcon(props: SunIconProps) {
  return (
    <IconBase {...props}>
      <Circle cx="12" cy="12" r="4" />
      <Line x1="12" y1="2" x2="12" y2="4" />
      <Line x1="12" y1="20" x2="12" y2="22" />
      <Line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
      <Line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
      <Line x1="2" y1="12" x2="4" y2="12" />
      <Line x1="20" y1="12" x2="22" y2="12" />
      <Line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
      <Line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
    </IconBase>
  )
}
