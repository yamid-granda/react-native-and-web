"use client"

import { WishlistScreen } from "@rnw/components-library"
import { fetchProductsByIds } from "../../lib/api"

export default function WishlistPage() {
  return <WishlistScreen fetchProductsByIds={fetchProductsByIds} />
}
