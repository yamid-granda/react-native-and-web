import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "../../utils/persistStorage"
import type { ProductData } from "../../types/Product"

const MAX_ITEMS = 10

type RecentlyViewedState = {
  items: ProductData[]
  recordView: (product: ProductData) => void
}

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
    { name: "recently-viewed-storage", storage: createPersistStorage<RecentlyViewedState>() },
  ),
)
