import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import type { ProductData } from "../../types/Product"

export type CartItem = {
  product: ProductData
  quantity: number
}

type CartState = {
  items: Record<string, CartItem>
  addItem: (product: ProductData) => void
  removeItem: (id: string) => void
  incrementQuantity: (id: string) => void
  decrementQuantity: (id: string) => void
  clear: () => void
}

// react-native-web's MainNav renders a plain <a href>, which Next.js doesn't
// intercept for client-side routing — navigating to /cart is a full page
// reload, which would otherwise wipe an in-memory-only store. Persist to
// localStorage on web; React Native has no localStorage, but its navigation
// never reloads the JS runtime, so an in-memory fallback there is enough.
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

const storage = createJSONStorage<CartState>(() =>
  typeof localStorage !== "undefined" ? localStorage : inMemoryFallback,
)

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: {},

      addItem: (product) =>
        set((state) => {
          const existing = state.items[product.id]
          return {
            items: {
              ...state.items,
              [product.id]: { product, quantity: (existing?.quantity ?? 0) + 1 },
            },
          }
        }),

      removeItem: (id) =>
        set((state) => {
          const { [id]: _removed, ...rest } = state.items
          return { items: rest }
        }),

      incrementQuantity: (id) =>
        set((state) => {
          const existing = state.items[id]
          if (!existing) return state
          return {
            items: { ...state.items, [id]: { ...existing, quantity: existing.quantity + 1 } },
          }
        }),

      decrementQuantity: (id) =>
        set((state) => {
          const existing = state.items[id]
          if (!existing) return state
          if (existing.quantity <= 1) {
            const { [id]: _removed, ...rest } = state.items
            return { items: rest }
          }
          return {
            items: { ...state.items, [id]: { ...existing, quantity: existing.quantity - 1 } },
          }
        }),

      clear: () => set({ items: {} }),
    }),
    { name: "cart-storage", storage },
  ),
)

export function getCartTotalCount(items: Record<string, CartItem>) {
  return Object.values(items).reduce((total, item) => total + item.quantity, 0)
}

export function getCartTotalPrice(items: Record<string, CartItem>) {
  return Object.values(items).reduce((total, item) => total + item.product.price * item.quantity, 0)
}
