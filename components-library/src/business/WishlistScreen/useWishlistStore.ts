import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "../../utils/persistStorage"

type WishlistState = {
  /**
   * Ids only, most-recently-added last.
   *
   * This store used to persist a whole `ProductData` per entry and render it
   * straight back, so a wishlist showed the price at the moment of wishing and
   * nothing could ever move it. The id is what the wishlist actually means; the
   * product comes from `useProductLookup`.
   */
  ids: string[]
  /** Takes an id, not a product: the id is the only field worth persisting. */
  toggleItem: (id: string) => void
  removeItem: (id: string) => void
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set) => ({
      ids: [],

      toggleItem: (id) =>
        set((state) => ({
          ids: state.ids.includes(id)
            ? state.ids.filter((saved) => saved !== id)
            : [...state.ids, id],
        })),

      removeItem: (id) =>
        set((state) => ({ ids: state.ids.filter((saved) => saved !== id) })),
    }),
    {
      name: "wishlist-storage",
      version: 2,
      storage: createPersistStorage<WishlistState>(),
      // v1 stored `Record<string, ProductData>`. The map's keys *were* the ids
      // all along, so nothing is lost by keeping them and dropping the values.
      // The cast is to the whole state because that is zustand's declared return
      // type, while the value returned is only the persisted slice — see
      // `useCartStore`'s migration.
      migrate: (persisted): WishlistState => {
        const items = (persisted as { items?: Record<string, unknown> } | undefined)?.items ?? {}
        return { ids: Object.keys(items) } as WishlistState
      },
    },
  ),
)

/** A list, not a map: the wishlist is a handful of ids, and this is the check
 * every product card runs on render. */
export function isWishlisted(ids: string[], id: string) {
  return ids.includes(id)
}

export function getWishlistTotalCount(ids: string[]) {
  return ids.length
}
