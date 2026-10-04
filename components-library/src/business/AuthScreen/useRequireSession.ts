import { useEffect } from "react"
import { useSessionStore } from "./useSessionStore"

export type UseRequireSessionOptions = {
  /** Called when there is no session. Route to the login screen from here. */
  onSignIn: () => void
}

/**
 * The client-side guard in front of an authenticated screen.
 *
 * **UX, not security.** The API's 401 is the boundary; this only stops an
 * anonymous visitor from being shown an empty list that is about to fail. That is
 * also why it takes `onSignIn` rather than owning a route: there is no router in
 * this package, and a caller supplies its own.
 *
 * Returns a discriminated result rather than rendering, so the caller decides what
 * "loading" and "signed out" look like on its own platform.
 */
export type SessionGuard =
  /** The persisted token has not been validated yet. Render a loading state. */
  | { status: "loading" }
  /** There is no usable session; `onSignIn` has been called. Render nothing. */
  | { status: "anonymous" }
  /** Signed in. `token` is safe to put in an `Authorization` header. */
  | { status: "authenticated"; token: string }

export function useRequireSession({ onSignIn }: UseRequireSessionOptions): SessionGuard {
  const status = useSessionStore((state) => state.status)
  const token = useSessionStore((state) => state.token)

  // A token that vanished without `clear()` running — a sign-out in another tab,
  // say — is the same situation as never having signed in, and must not be sent to
  // an api layer as an empty bearer header. Resolving it here rather than at each
  // call site is what keeps that from being forgotten.
  const guard: SessionGuard =
    status === "authenticated"
      ? token
        ? { status: "authenticated", token }
        : { status: "anonymous" }
      : { status }

  useEffect(() => {
    if (guard.status === "anonymous") onSignIn()
  }, [guard.status, onSignIn])

  return guard
}
