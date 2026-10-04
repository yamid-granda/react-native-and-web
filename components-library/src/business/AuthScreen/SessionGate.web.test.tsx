import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Text } from "react-native"
import { SessionGate } from "./SessionGate"
import { useSessionStore } from "./useSessionStore"

const user = { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" }

/** The screen being guarded: a testID is the only marker a `Text` needs. */
const child = <Text testID="guarded-screen">the screen</Text>

describe("SessionGate (web, via react-native-web)", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  })

  it("waits while the persisted token is still being validated", () => {
    const onSignIn = vi.fn()
    useSessionStore.setState({ token: "a-token", user, status: "loading" })

    render(
      <SessionGate onSignIn={onSignIn}>{child}</SessionGate>,
    )

    expect(screen.getByText("Checking your session…")).toBeInTheDocument()
    expect(screen.queryByTestId("guarded-screen")).not.toBeInTheDocument()
    expect(onSignIn).not.toHaveBeenCalled()
  })

  it("renders nothing and sends an anonymous visitor to sign in, once", () => {
    const onSignIn = vi.fn()

    const { container } = render(
      <SessionGate onSignIn={onSignIn}>{child}</SessionGate>,
    )

    expect(container).toBeEmptyDOMElement()
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it("treats an authenticated session with no token as signed out", () => {
    const onSignIn = vi.fn()
    useSessionStore.setState({ token: null, user, status: "authenticated" })

    render(
      <SessionGate onSignIn={onSignIn}>{child}</SessionGate>,
    )

    expect(screen.queryByTestId("guarded-screen")).not.toBeInTheDocument()
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it("renders the screen once there is a session", () => {
    const onSignIn = vi.fn()
    useSessionStore.setState({ token: "a-token", user, status: "authenticated" })

    render(
      <SessionGate onSignIn={onSignIn}>{child}</SessionGate>,
    )

    expect(screen.getByTestId("guarded-screen")).toBeInTheDocument()
    expect(screen.queryByText("Checking your session…")).not.toBeInTheDocument()
    expect(onSignIn).not.toHaveBeenCalled()
  })

  it("does not re-send on every render", () => {
    const onSignIn = vi.fn()
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })

    const { rerender } = render(
      <SessionGate onSignIn={onSignIn}>{child}</SessionGate>,
    )
    rerender(
      <SessionGate onSignIn={onSignIn}>{child}</SessionGate>,
    )

    expect(onSignIn).toHaveBeenCalledTimes(1)
  })
})