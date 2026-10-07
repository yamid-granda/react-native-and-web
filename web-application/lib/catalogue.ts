/**
 * The catalogue's cache tags and lifetimes, in one place.
 *
 * The server read client (`lib/api-server.ts`) tags every catalogue fetch with
 * these, and the seller write path (`app/actions.ts`) revalidates the same tags,
 * so the two halves of "a write retires the public cache" cannot drift apart.
 */
export const PRODUCTS_TAG = "products"

/** One product's detail page and any list that names it. */
export function productTag(id: string) {
  return `product:${id}`
}

/** One seller's public storefront profile. */
export function storeTag(id: string) {
  return `store:${id}`
}

/** One seller's public product list. */
export function storeProductsTag(id: string) {
  return `store-products:${id}`
}

/** Lists turn over often; a detail page is stable enough to hold for longer. */
export const CATALOGUE_REVALIDATE = 60
export const DETAIL_REVALIDATE = 300
