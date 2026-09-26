import Constants from "expo-constants"
import type { ProductData } from "@rnw/components-library"

// "localhost" means the phone itself on a physical device via Expo Go, not
// the dev machine — there's no EXPO_PUBLIC_API_URL override, derive the api
// host from the same address Metro's own dev server was reached at
// (Constants.expoConfig.hostUri, e.g. "192.168.1.21:8081"), which is
// guaranteed reachable since that's how the JS bundle itself just loaded.
function resolveApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL
  }

  const host = Constants.expoConfig?.hostUri?.split(":")[0]
  return host ? `http://${host}:3001` : "http://localhost:3001"
}

const API_URL = resolveApiUrl()

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchProducts() {
  return request<ProductData[]>("/products")
}

export function fetchProduct(id: string) {
  return request<ProductData>(`/products/${id}`)
}
