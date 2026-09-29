import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import type { ProductData } from "../../types/Product"

const MAX_ITEMS = 10

type RecentlyViewedState = {
  items: ProductData[]
  recordView: (product: ProductData) => void
}

// see useCartStore.ts for why web persists to localStorage and native falls
// back to an in-memory store
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

const storage = createJSONStorage<RecentlyViewedState>(() =>
  typeof localStorage !== "undefined" ? localStorage : inMemoryFallback,
)

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  persist(
    (set) => ({
      items: [],

      recordView: (product) =>
        set((state) => ({
          items: [product, ...state.items.filter((item) => item.id !== product.id)].slice(
            0,
            MAX_ITEMS,
          ),
        })),
    }),
    { name: "recently-viewed-storage", storage },
  ),
)
