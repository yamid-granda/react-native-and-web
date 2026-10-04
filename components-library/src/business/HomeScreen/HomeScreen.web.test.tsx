import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeScreen } from "./HomeScreen"
import { useCounterStore } from "./useCounterStore"
import { useSessionStore } from "../AuthScreen/useSessionStore"

const user = { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" }

describe("HomeScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCounterStore.setState({ count: 0 })
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  })

  it("renders the title and the shared Button", () => {
    render(<HomeScreen />)
    expect(screen.getByText("react-native-and-web")).toBeInTheDocument()
    expect(screen.getByText("Pressed 0 times")).toBeInTheDocument()
  })

  it("increments the counter when the button is pressed", () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByText("Pressed 0 times"))
    expect(screen.getByText("Pressed 1 times")).toBeInTheDocument()
  })

  describe("the My Store entry", () => {
    it("sends an anonymous visitor to sign in", () => {
      const onSignIn = vi.fn()
      const onOpenStore = vi.fn()
      render(<HomeScreen onSignIn={onSignIn} onOpenStore={onOpenStore} />)

      expect(screen.getByText("Sign in to sell")).toBeInTheDocument()
      fireEvent.click(screen.getByLabelText("My Store"))
      expect(onSignIn).toHaveBeenCalledTimes(1)
      expect(onOpenStore).not.toHaveBeenCalled()
    })

    it("sends a signed-in seller to their store and names it", () => {
      const onSignIn = vi.fn()
      const onOpenStore = vi.fn()
      useSessionStore.getState().setSession({ token: "a-token", user })
      render(<HomeScreen onSignIn={onSignIn} onOpenStore={onOpenStore} />)

      expect(screen.getByText("Riverbend Vintage")).toBeInTheDocument()
      expect(screen.getByText("Manage your products")).toBeInTheDocument()
      fireEvent.click(screen.getByLabelText("My Store"))
      expect(onOpenStore).toHaveBeenCalledTimes(1)
      expect(onSignIn).not.toHaveBeenCalled()
    })

    /// The status is only trusted once it says "authenticated": a persisted token
    /// that has not been validated yet must still read as signed out, or the
    /// entry would point at a store the visitor cannot load.
    it("treats a session that is still loading as signed out", () => {
      const onSignIn = vi.fn()
      useSessionStore.setState({ token: "stale", user, status: "loading" })
      render(<HomeScreen onSignIn={onSignIn} />)
      expect(screen.getByText("Sign in to sell")).toBeInTheDocument()
    })

    it("survives a HomeScreen with no handlers wired", () => {
      render(<HomeScreen />)
      fireEvent.click(screen.getByLabelText("My Store"))
      expect(screen.getByLabelText("My Store")).toBeInTheDocument()
    })
  })
})