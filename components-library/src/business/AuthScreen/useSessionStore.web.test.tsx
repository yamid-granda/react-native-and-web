import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useSessionStore } from "./useSessionStore"
import { useRequireSession } from "./useRequireSession"
import { useSessionBootstrap } from "./useSessionBootstrap"

const user = { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" }

// `.web.test.tsx` rather than `.test.ts` on purpose: this store persists through
// `localStorage`, and the `utils` vitest project is node-only — no DOM, so the
// in-memory fallback would be exercised instead of the real web path.
describe("useSessionStore (web, via react-native-web)", () => {
  beforeEach(async () => {
    localStorage.clear()
    await useSessionStore.persist.rehydrate()
    useSessionStore.setState({ token: null, user: null, status: "loading" })
  })

  it("starts in the loading state, not anonymous", () => {
    // "loading" is the whole reason the field exists: a persisted token is a
    // claim, not a proof, and anything that trusts it before `/auth/me` has
    // answered is trusting a string.
    expect(useSessionStore.getState().status).toBe("loading")
  })

  it("moves to authenticated through setSession", () => {
    useSessionStore.getState().setSession({ token: "a-token", user })
    expect(useSessionStore.getState()).toMatchObject({
      token: "a-token",
      user,
      status: "authenticated",
    })
  })

  it("clears back to anonymous", () => {
    useSessionStore.getState().setSession({ token: "a-token", user })
    useSessionStore.getState().clear()
    // toMatchObject, not toEqual: the store object also carries its own actions.
    expect(useSessionStore.getState()).toMatchObject({
      token: null,
      user: null,
      status: "anonymous",
    })
  })

  it("persists the token and user across a rehydrate, but not the status", async () => {
    useSessionStore.getState().setSession({ token: "a-token", user })
    await waitFor(() => expect(localStorage.getItem("session-storage")).not.toBeNull())

    // A fresh store over the same storage: the token comes back…
    const stored = JSON.parse(localStorage.getItem("session-storage") ?? "{}")
    expect(stored.state.token).toBe("a-token")
    expect(stored.state.user).toEqual(user)
    // …but `status` does not, so a reload starts back at "loading" instead of
    // trusting a token that may have expired or been revoked.
    expect(stored.state.status).toBeUndefined()
  })

  it("round-trips the whole session through storage", async () => {
    useSessionStore.getState().setSession({ token: "a-token", user })
    await useSessionStore.persist.rehydrate()
    expect(useSessionStore.getState().token).toBe("a-token")
    expect(useSessionStore.getState().user).toEqual(user)
  })

  describe("useRequireSession", () => {
    it("reports loading until the session resolves", () => {
      const { result } = renderHook(() => useRequireSession({ onSignIn: () => {} }))
      expect(result.current).toEqual({ status: "loading" })
    })

    it("sends an anonymous visitor to sign in, and reports anonymous", async () => {
      let sent = 0
      useSessionStore.setState({ token: null, user: null, status: "anonymous" })
      const { result } = renderHook(() => useRequireSession({ onSignIn: () => sent++ }))
      await waitFor(() => expect(sent).toBeGreaterThan(0))
      expect(result.current).toEqual({ status: "anonymous" })
    })

    it("hands back the token once authenticated", async () => {
      useSessionStore.getState().setSession({ token: "a-token", user })
      const { result } = renderHook(() => useRequireSession({ onSignIn: () => {} }))
      await waitFor(() => {
        expect(result.current).toEqual({ status: "authenticated", token: "a-token" })
      })
    })

    it("treats a missing token behind an 'authenticated' status as anonymous", async () => {
      // What a sign-out in another tab leaves behind: the flag says signed in, the
      // token is gone. Sending an empty bearer header would be worse than
      // treating it as signed out.
      useSessionStore.setState({ token: null, user, status: "authenticated" })
      let sent = 0
      const { result } = renderHook(() => useRequireSession({ onSignIn: () => sent++ }))
      await waitFor(() => expect(sent).toBeGreaterThan(0))
      expect(result.current).toEqual({ status: "anonymous" })
    })
  })

  describe("useSessionBootstrap", () => {
    beforeEach(async () => {
      await useSessionStore.persist.rehydrate()
      useSessionStore.setState({ token: null, user: null, status: "loading" })
    })

    /// The bug this guards: persistence rehydrates asynchronously, so a token read
    /// on the first pass is null — and treating that as "signed out" signs every
    /// seller out on every page reload.
    it("does not clear a store whose persistence has not rehydrated yet", () => {
      // A cold store mid-rehydration: no token in memory *yet*, and hydration not
      // finished. Signing out here is the reload bug.
      const hasHydrated = vi.spyOn(useSessionStore.persist, "hasHydrated").mockReturnValue(false)
      const validate = vi.fn()
      renderHook(() => useSessionBootstrap({ validate }))

      expect(validate).not.toHaveBeenCalled()
      expect(useSessionStore.getState().status).toBe("loading")
      hasHydrated.mockRestore()
    })

    it("validates the persisted token once hydration has landed", async () => {
      localStorage.setItem(
        "session-storage",
        JSON.stringify({ state: { token: "a-token", user }, version: 0 })
      )
      // Rehydration restores the token (and not `status`, which `partialize`
      // excludes), so this is the state a page load settles into: a token in
      // hand, nothing yet decided about it.
      await useSessionStore.persist.rehydrate()
      useSessionStore.setState({ status: "loading" })

      const validate = vi.fn().mockResolvedValue(user)
      renderHook(() => useSessionBootstrap({ validate }))

      await waitFor(() => {
        expect(useSessionStore.getState().status).toBe("authenticated")
      })
      expect(validate).toHaveBeenCalledWith("a-token")
      expect(useSessionStore.getState().user).toEqual(user)
    })

    it("settles to anonymous when there is no token at all", async () => {
      const validate = vi.fn()
      renderHook(() => useSessionBootstrap({ validate }))

      await waitFor(() => {
        expect(useSessionStore.getState().status).toBe("anonymous")
      })
      expect(validate).not.toHaveBeenCalled()
    })

    /// A 401 for a stale token is the expected path, not an error to surface.
    it("settles to anonymous when validation rejects", async () => {
      useSessionStore.getState().setSession({ token: "stale", user })
      useSessionStore.setState({ token: "stale", user: null, status: "loading" })
      const validate = vi.fn().mockRejectedValue(new Error("Unauthorized"))
      renderHook(() => useSessionBootstrap({ validate }))

      await waitFor(() => {
        expect(useSessionStore.getState().status).toBe("anonymous")
      })
      expect(useSessionStore.getState().token).toBeNull()
    })

    it("runs once, not on every render", async () => {
      useSessionStore.getState().setSession({ token: "a-token", user })
      useSessionStore.setState({ token: "a-token", user: null, status: "loading" })
      const validate = vi.fn().mockResolvedValue(user)
      const { rerender } = renderHook(() => useSessionBootstrap({ validate }))
      rerender()
      rerender()

      await waitFor(() => {
        expect(useSessionStore.getState().status).toBe("authenticated")
      })
      expect(validate).toHaveBeenCalledTimes(1)
    })
  })
})