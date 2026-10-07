"use server"

import { revalidateTag } from "next/cache"
import { PRODUCTS_TAG, productTag, storeProductsTag } from "../lib/catalogue"

/**
 * Retire the public cache after a seller writes a product.
 *
 * The client-side mutation already invalidates React Query, so the seller's own
 * screens are fresh; this is the other half — the ISR pages other visitors get
 * (`/marketplace`, `/marketplace/{id}`, `/stores/{id}`) are tagged in
 * `lib/api-server.ts` and are marked stale here. The `"max"` profile means the
 * next visitor is served the stale page while the fresh one regenerates.
 *
 * Fire-and-forget from the write path: revalidation happens on the next request,
 * so it does not need to race the mutation's own commit.
 */
export async function revalidateCatalogue(productId: string, storeId: string) {
  revalidateTag(PRODUCTS_TAG, "max")
  revalidateTag(productTag(productId), "max")
  revalidateTag(storeProductsTag(storeId), "max")
}
