import { Path } from "react-native-svg"
import { IconBase } from "../IconBase"
import type { IconProps } from "../types"

export type MarketplaceIconProps = IconProps

export function MarketplaceIcon(props: MarketplaceIconProps) {
  return (
    <IconBase {...props}>
      <Path d="M3 10 4 4h16l1 6" />
      <Path d="M3 10q2.25 3 4.5 0t4.5 0t4.5 0t4.5 0" />
      <Path d="M5 10v10a1 1 0 0 0 1 1h3v-5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5h3a1 1 0 0 0 1-1V10" />
    </IconBase>
  )
}
