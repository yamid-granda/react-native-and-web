import type { ProductData, ProductsPage } from "@rnw/components-library"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchProducts(page = 1, q?: string) {
  const params = new URLSearchParams({ page: String(page) })
  if (q) params.set("q", q)
  return request<ProductsPage>(`/products?${params.toString()}`)
}

export function fetchProduct(id: string) {
  return request<ProductData>(`/products/${id}`)
}
