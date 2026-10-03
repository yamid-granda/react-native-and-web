import { createJSONStorage, type StateStorage } from "zustand/middleware"

// react-native-web's MainNav renders a plain <a href>, which Next.js doesn't
// intercept for client-side routing — navigating to /cart is a full page reload,
// which would otherwise wipe an in-memory-only store. Persist to localStorage on
// web; React Native has no localStorage, but its navigation never reloads the JS
// runtime, so an in-memory fallback there is enough.
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

const webStorage: StateStorage = {
  getItem: (name) => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage.getItem(name)
    } catch {
      // Safari in private mode, and any browser with storage blocked by policy.
      // A cart is worth an in-memory copy; failing to read it must not throw
      // during the first render.
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // A full quota must degrade to in-memory, not crash a click handler.
      memoryStorage.set(name, value)
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // Same reasoning as setItem.
    }
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