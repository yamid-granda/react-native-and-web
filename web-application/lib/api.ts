import type { ProductData, ProductsPage } from "@rnw/components-library"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchProducts(page = 1) {
  return request<ProductsPage>(`/products?page=${page}`)
}

export function fetchProduct(id: string) {
  return request<ProductData>(`/products/${id}`)
}
