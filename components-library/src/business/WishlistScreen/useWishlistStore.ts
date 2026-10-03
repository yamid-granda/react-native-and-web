import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "../../utils/persistStorage"
import type { ProductData } from "../../types/Product"

type WishlistState = {
  items: Record<string, ProductData>
  toggleItem: (product: ProductData) => void
  removeItem: (id: string) => void
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      items: {},

      toggleItem: (product) =>
        set((state) => {
          if (state.items[product.id]) {
            const { [product.id]: _removed, ...rest } = state.items
            return { items: rest }
          }
          return { items: { ...state.items, [product.id]: product } }
        }),

      removeItem: (id) =>
        set((state) => {
          const { [id]: _removed, ...rest } = state.items
          return { items: rest }
        }),
    }),
    { name: "wishlist-storage", storage: createPersistStorage<WishlistState>() },
  ),
)

export function isWishlisted(items: Record<string, ProductData>, id: string) {
  return id in items
}

export function getWishlistTotalCount(items: Record<string, ProductData>) {
  return Object.keys(items).length
}
