import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import type { ProductData } from "../../types/Product"

type WishlistState = {
  items: Record<string, ProductData>
  toggleItem: (product: ProductData) => void
  removeItem: (id: string) => void
}

// see useCartStore.ts for why persistence is split this way
const memoryStorage = new Map<string, string>()
const inMemoryFallback: StateStorage = {
  getItem: (name) => memoryStorage.get(name) ?? null,
  setItem: (name, value) => {
    memoryStorage.set(name, value)
  },
  removeItem: (name) => {
    memoryStorage.delete(name)
  },
}

const storage = createJSONStorage<WishlistState>(() =>
  typeof localStorage !== "undefined" ? localStorage : inMemoryFallback,
)

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
    { name: "wishlist-storage", storage },
  ),
)

export function isWishlisted(items: Record<string, ProductData>, id: string) {
  return id in items
}

export function getWishlistTotalCount(items: Record<string, ProductData>) {
  return Object.keys(items).length
}
