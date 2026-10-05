import { createJSONStorage, type StateStorage } from "zustand/middleware"

// Web persists so a browser reload does not drop the cart, the wishlist, the
// recently-viewed rail or the seller's session. React Native has no
// `localStorage`, so native persists to an in-memory `Map` and accepts that a JS
// reload drops it.
//
// One module, because this block was duplicated verbatim in three stores and a
// fourth copy is what "follow the existing pattern" produces. See
// `useSessionStore.ts` for the case where that trade-off stops being good enough.
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

/**
 * `localStorage` is the durable store; `memoryStorage` is the copy that
 * survives the page's lifetime when the durable one refuses a write.
 *
 * Read through, write through, clear both — one rule for all three methods. The
 * asymmetry this replaces was: writes fell back to the `Map`, reads never looked
 * there, and `removeItem` was the only method that knew the `Map` existed. So a
 * refused write was stored somewhere nothing read back, and a storage-blocked
 * browser lost the cart and the session on every reload.
 *
 * The `Map` is bounded by the number of persisted stores, and neither copy is
 * authoritative on its own: `localStorage` decides across sessions, the `Map`
 * decides within one.
 */
const webStorage: StateStorage = {
  getItem: (name) => {
    try {
      return typeof localStorage === "undefined"
        ? (memoryStorage.get(name) ?? null)
        : (localStorage.getItem(name) ?? memoryStorage.get(name) ?? null)
    } catch {
      // Safari in private mode, and any browser with storage blocked by policy.
      // Reads can be refused outright, so the in-memory copy is the only place
      // left to look — and failing to read must not throw during first render.
      return memoryStorage.get(name) ?? null
    }
  },
  setItem: (name, value) => {
    // The `Map` is written unconditionally, so a value that `localStorage`
    // refuses is still readable for the page's lifetime instead of being
    // dropped until something overwrites the key.
    memoryStorage.set(name, value)
    try {
      localStorage.setItem(name, value)
    } catch {
      // A full quota degrades to the in-memory copy rather than crashing a
      // click handler. `getItem` reads that copy, so this is a demotion to
      // session-lifetime storage, not a silent loss.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // Same reasoning as setItem.
    }
    // Unconditional, and deliberately outside the `try`: a removal has to clear
    // both copies, so that neither can resurrect the value afterwards.
    memoryStorage.delete(name)
  },
}

/**
 * The zustand `StateStorage` every persisted store in this library uses.
 *
 * `localStorage` on web, an in-memory `Map` on native. Pass the owning store's
 * state type so the JSON layer stays typed:
 *
 * ```ts
 * persist((set) => …, { name: "cart-storage", storage: createPersistStorage<CartState>() })
 * ```
 */
export function createPersistStorage<T>() {
  return createJSONStorage<T>(() =>
    typeof localStorage !== "undefined" ? webStorage : inMemoryFallback
  )
}