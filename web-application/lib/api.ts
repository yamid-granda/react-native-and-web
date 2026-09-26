import type { ProductData } from "@rnw/components-library"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

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
