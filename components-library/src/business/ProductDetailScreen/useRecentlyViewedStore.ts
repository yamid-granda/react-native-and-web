import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "../../utils/persistStorage"

const MAX_ITEMS = 10

type RecentlyViewedState = {
  /**
   * Ids only, most-recent first, de-duplicated, capped at [`MAX_ITEMS`].
   *
   * This is the store that put the bug in plain sight: it persists a whole
   * `ProductData` per entry, and the marketplace renders that rail directly above
   * a react-query-fetched grid — so ten cards priced whenever the shopper last
   * opened them sat above this month's catalogue. The rail's *position* is right;
   * what it reads was not. The ids keep the ordering, the de-duplication and the
   * cap, which are still this store's job and still tested here; the products
   * come from `useProductLookup`, so the rail is as fresh as the grid below it.
   */
  ids: string[]
  /** Takes an id, not a product: the id is the only field worth persisting. */
  recordView: (id: string) => void
}

export const useRecentlyViewedStore = create<RecentlyViewedState>()(
  persist(
    (set) => ({
      ids: [],

      recordView: (id) =>
        set((state) => ({
          ids: [id, ...state.ids.filter((seen) => seen !== id)].slice(0, MAX_ITEMS),
        })),
    }),
    {
      name: "recently-viewed-storage",
      version: 2,
      storage: createPersistStorage<RecentlyViewedState>(),
      // v1 stored `ProductData[]` in this same order. The ids are the array's
      // identity, so the ordering and the cap survive the upgrade untouched. The
      // cast is to the whole state because that is zustand's declared return
      // type, while the value returned is only the persisted slice — see
      // `useCartStore`'s migration.
      migrate: (persisted): RecentlyViewedState => {
        const items = (persisted as { items?: { id?: unknown }[] } | undefined)?.items ?? []
        return {
          ids: items
            .map((item) => item?.id)
            .filter((id): id is string => typeof id === "string")
            .slice(0, MAX_ITEMS),
        } as RecentlyViewedState
      },
    },
  ),
)
