import "server-only"

import { ApiError, createApi } from "@rnw/components-library/src/api/transport"
import type { ProductData, ProductsPage } from "@rnw/components-library/src/types/Product"
import type { StoreProfile } from "@rnw/components-library/src/types/Store"
import {
  CATALOGUE_REVALIDATE,
  DETAIL_REVALIDATE,
  PRODUCTS_TAG,
  productTag,
  storeProductsTag,
  storeTag,
} from "./catalogue"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

/**
 * Map a catalogue read path to Next's data-cache lifetime and tags.
 *
 * The path is the transport's own contract (`/products`, `/products/{id}`,
 * `/stores/{id}`, `/stores/{id}/products`), so this is the one place where the
 * URL shape and the cache tags are tied together.
 */
function cacheFor(pathname: string): NextFetchRequestConfig | undefined {
  const [resource, rawId, sub] = pathname.split("/").filter(Boolean)
  const id = rawId ? decodeURIComponent(rawId) : undefined

  if (resource === "products" && id) {
    return { revalidate: DETAIL_REVALIDATE, tags: [PRODUCTS_TAG, productTag(id)] }
  }
  if (resource === "products") {
    return { revalidate: CATALOGUE_REVALIDATE, tags: [PRODUCTS_TAG] }
  }
  if (resource === "stores" && id && sub === "products") {
    return { revalidate: CATALOGUE_REVALIDATE, tags: [PRODUCTS_TAG, storeProductsTag(id)] }
  }
  if (resource === "stores" && id) {
    return { revalidate: DETAIL_REVALIDATE, tags: [storeTag(id)] }
  }
  return undefined
}

/**
 * The server read client.
 *
 * `fetchImpl` is the shared transport's documented seam
 * (`components-library/src/api/transport.ts`), so the server client is the same
 * implementation as the browser one with Next's cache directives attached per
 * request — one transport, not a second fetch path.
 */
const serverFetch: typeof fetch = (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  const cache = cacheFor(new URL(href).pathname)
  return fetch(input, cache ? { ...init, next: cache } : init)
}

const api = createApi({ baseUrl: API_URL, getToken: () => null, fetchImpl: serverFetch })

/** `null` means the product does not exist (404); anything else throws. */
export async function getProduct(id: string): Promise<ProductData | null> {
  try {
    return await api.fetchProduct(id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export function getProductsPage(page = 1): Promise<ProductsPage> {
  return api.fetchProducts(page)
}

/** `null` means the store does not exist (404); anything else throws. */
export async function getStore(id: string): Promise<StoreProfile | null> {
  try {
    return await api.fetchStore(id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** `null` means the store does not exist (404); anything else throws. */
export async function getStoreProducts(id: string, page = 1): Promise<ProductsPage | null> {
  try {
    return await api.fetchStoreProducts(id, page)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}
