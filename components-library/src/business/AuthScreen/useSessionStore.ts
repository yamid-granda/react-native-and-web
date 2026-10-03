import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "../../utils/persistStorage"
import type { AuthSession, StoreUser } from "../../types/Store"

/**
 * Whether the persisted token has been checked yet.
 *
 * `"loading"` is the reason this field exists. A token in storage is a *claim*
 * that the caller is signed in, not proof: it may have expired, or been signed
 * out from another tab. Anything that renders behind a session has to wait for
 * `GET /auth/me` before it can trust it, and a boolean cannot say "not yet".
 */
export type SessionStatus = "loading" | "authenticated" | "anonymous"

type SessionState = {
  token: string | null
  user: StoreUser | null
  status: SessionStatus
  setSession: (session: AuthSession) => void
  clear: () => void
}

/**
 * The seller session, and the only place a bearer token is kept.
 *
 * **This is a credential, and it is stored the way a cart is.** On web it lands
 * in `localStorage`, which any script on the page can read; on native the
 * fallback is an in-memory `Map`, so the session is dropped on any JS reload and
 * the seller is silently signed out.
 *
 * Both are acceptable for a basic login on a demo marketplace and neither is
 * acceptable for a real credential. The right fixes are `expo-secure-store` for
 * native and an `httpOnly` cookie for web — deliberately out of scope here,
 * because a native module means Expo Go stops being enough for the whole mobile
 * app (see `mobile-application/AGENTS.md`) and a cookie session is a different
 * API design. Recorded here rather than left to be discovered.
 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      // "loading" until something validates the token: see the type doc.
      token: null,
      user: null,
      status: "loading",

      setSession: (session) =>
        set({ token: session.token, user: session.user, status: "authenticated" }),

      clear: () => set({ token: null, user: null, status: "anonymous" }),
    }),
    {
      name: "session-storage",
      storage: createPersistStorage<SessionState>(),
      // Only the token and the user are persisted. `status` is deliberately
      // excluded: rehydrating it as "authenticated" on a stale token is the exact
      // bug the field exists to prevent, so a reload starts back at "loading".
      partialize: (state) => ({ token: state.token, user: state.user }) as SessionState,
    },
  ),
)

/** The raw token for the api layer's `Authorization` header. */
export function getSessionToken() {
  return useSessionStore.getState().token
}

export function getSignedInUser() {
  const { user, status } = useSessionStore.getState()
  return status === "authenticated" ? user : null
}