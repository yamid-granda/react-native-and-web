export type ProductData = {
  id: string
  title: string
  description?: string
  price: number
  currency?: string
  imageUrl?: string
  stock: number
  /**
   * The seller, when the product has one.
   *
   * Optional and nullable rather than required: seeded and imported products have
   * no seller and the wire sends `null` for them, while the ~30 inline fixture
   * objects in stories and tests predate this field entirely.
   *
   * `ownerId` is deliberately absent. It would be redundant — My Store only ever
   * lists your own products — and it is not in the public payload. `storeId` is
   * the same value under the name a shopper-facing surface wants.
   */
  storeId?: string | null
  storeName?: string | null
}

export type ProductsPage = {
  items: ProductData[]
  page: number
  limit: number
  total: number
  hasNextPage: boolean
}