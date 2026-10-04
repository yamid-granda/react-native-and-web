import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "../../utils/persistStorage"
import type { ProductData } from "../../types/Product"

/**
 * One cart line: an id and how many of it.
 *
 * No `ProductData`. The cart used to persist a whole product per line and total
 * the stored `price`, which meant a price a seller changed last month was the
 * price the shopper was charged — and no write could ever correct it, because
 * nothing re-read the product. The id is the durable part; the price comes from
 * `useProductLookup`, so the line item and the total agree with the catalogue.
 */
export type CartItem = {
  id: string
  quantity: number
}

/** A cart line joined to the product the server currently returns for it. */
export type ResolvedCartLine = { product: ProductData; quantity: number }

type CartState = {
  items: Record<string, CartItem>
  /**
   * Takes an id, not a product, and that is the point: the only field worth
   * persisting is the id, so a caller cannot hand over a hand-built snapshot
   * that quietly disagrees with the catalogue.
   */
  addItem: (id: string) => void
  removeItem: (id: string) => void
  incrementQuantity: (id: string) => void
  decrementQuantity: (id: string) => void
  clear: () => void
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: {},

      addItem: (id) =>
        set((state) => {
          const existing = state.items[id]
          return {
            items: {
              ...state.items,
              [id]: { id, quantity: (existing?.quantity ?? 0) + 1 },
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
    {
      name: "cart-storage",
      version: 2,
      storage: createPersistStorage<CartState>(),
      // v1 stored `{ product, quantity }` per line. The product is dropped, not
      // migrated: it is exactly the stale snapshot this change exists to stop
      // persisting, and re-resolving it is the lookup's job, not the store's.
      //
      // The cast is to the whole state because that is zustand's declared return
      // type, while the value returned is only the persisted slice: `persist`
      // merges this over `get()`, which already holds the actions. Same cast and
      // same reasoning in `useWishlistStore` and `useRecentlyViewedStore`.
      migrate: (persisted): CartState => {
        const items: Record<string, CartItem> = {}
        for (const [id, value] of Object.entries((persisted as CartState | undefined)?.items ?? {})) {
          const quantity = (value as { quantity?: unknown } | undefined)?.quantity
          // A line with no readable quantity is not a line at all: carrying it
          // forward would render `undefined` in the quantity slot.
          if (typeof quantity === "number") items[id] = { id, quantity }
        }
        return { items } as CartState
      },
    },
  ),
)

export function getCartTotalCount(items: Record<string, CartItem>) {
  return Object.values(items).reduce((total, item) => total + item.quantity, 0)
}

/**
 * The cart subtotal, over products the server has just returned.
 *
 * Takes resolved lines rather than the store's `items` on purpose: this used to
 * read `item.product.price` straight out of persistence, which made "what does
 * the shopper pay" a function of when they last added the thing. There is now
 * exactly one place that multiplies a price and it is downstream of the lookup,
 * so a snapshot cannot reach it.
 */
export function getCartTotalPrice(lines: ResolvedCartLine[]) {
  return lines.reduce((total, line) => total + line.product.price * line.quantity, 0)
}
