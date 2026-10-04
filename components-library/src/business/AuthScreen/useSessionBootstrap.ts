import { useEffect } from "react"
import { useSessionStore } from "./useSessionStore"
import type { StoreUser } from "../../types/Store"

export type SessionBootstrapOptions = {
  /**
   * `GET /auth/me`. Injected because components-library has no api layer.
   *
   * Rejecting is the normal path for an expired or revoked token, and it means
   * "anonymous" — not an error the user needs to see.
   */
  validate: (token: string) => Promise<StoreUser>
}

/**
 * Validates the persisted token once per app launch.
 *
 * This is what makes `status` worth having. A token in `localStorage` is a claim
 * that the visitor is signed in, not proof: it may have expired in the seven days
 * since it was written, or been signed out from another tab. Until this has run,
 * `status` stays `"loading"` and every guarded screen shows a loading state
 * instead of either an empty list or a wall of 401s.
 *
 * Mount it once per app — the web `Providers` wrapper and the mobile root layout.
 * It is idempotent: once the status leaves `"loading"` it never runs again.
 */
export function useSessionBootstrap({ validate }: SessionBootstrapOptions) {
  const status = useSessionStore((state) => state.status)

  useEffect(() => {
    if (status !== "loading") return

    // Read the store imperatively rather than from the closure: persistence
    // rehydrates *asynchronously*, so a token captured at render time is null on
    // the first pass.
    const settle = () => {
      const { token, status: current, setSession, clear } = useSessionStore.getState()
      // Another tab, or an earlier pass, already settled it.
      if (current !== "loading") return

      if (!token) {
        // …but "no token yet" and "no token" are different states. Persistence
        // rehydrates asynchronously, so before it has landed an absent token only
        // means "not read yet" — clearing on that would sign every seller out on
        // every page reload. Wait for hydration instead.
        if (!useSessionStore.persist.hasHydrated()) return
        clear()
        return
      }

      let cancelled = false
      validate(token)
        .then((user) => {
          if (!cancelled) setSession({ token, user })
        })
        .catch(() => {
          // A 401 is the expected outcome for a stale token; anything else lands
          // here too, and treating an unreachable api as "signed out" beats a
          // screen stuck on a spinner.
          if (!cancelled) clear()
        })
      return () => {
        cancelled = true
      }
    }

    const unsubscribe = settle()
    // Late hydration: run again once the stored value has landed. A no-op if it
    // already has.
    const offHydration = useSessionStore.persist.onFinishHydration(settle)
    return () => {
      offHydration()
      unsubscribe?.()
    }
  }, [status, validate])
}