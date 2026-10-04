import { WishlistScreen } from "@rnw/components-library"
import { fetchProductsByIds } from "../../../api/client"

export default function WishlistRoute() {
  return <WishlistScreen fetchProductsByIds={fetchProductsByIds} />
}
