export type ProductData = {
  id: string
  title: string
  description?: string
  price: number
  currency?: string
  imageUrl?: string
}

export type ProductsPage = {
  items: ProductData[]
  page: number
  limit: number
  total: number
  hasNextPage: boolean
}
