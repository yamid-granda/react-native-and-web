import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { Text } from "react-native"
import { SessionGate } from "./SessionGate"
import { useSessionStore } from "./useSessionStore"

const user = { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" }

describe("SessionGate (web, via react-native-web)", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  })

  it("shows the session-loading line and none of the children while the token is unvalidated", () => {
    useSessionStore.setState({ token: "a-token", user, status: "loading" })

    render(
      <SessionGate onSignIn={vi.fn()}>
        <Text>the seller's catalogue</Text>
      </SessionGate>,
    )

    expect(screen.getByText("Checking your session…")).toBeInTheDocument()
    expect(screen.queryByText("the seller's catalogue")).not.toBeInTheDocument()
  })

  it("renders the children once there is a session", () => {
    useSessionStore.setState({ token: "a-token", user, status: "authenticated" })

    render(
      <SessionGate onSignIn={vi.fn()}>
        <Text>the seller's catalogue</Text>
      </SessionGate>,
    )

    expect(screen.getByText("the seller's catalogue")).toBeInTheDocument()
    expect(screen.queryByText("Checking your session…")).not.toBeInTheDocument()
  })

  it("renders nothing and asks for a sign-in exactly once when there is no session", async () => {
    const onSignIn = vi.fn()
    const { container } = render(
      <SessionGate onSignIn={onSignIn}>
        <Text>the seller's catalogue</Text>
      </SessionGate>,
    )

    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledTimes(1)
    })
    expect(container).toBeEmptyDOMElement()
  })

  // A stale token that survived without `clear()` running is reported as
  // anonymous by `useRequireSession` rather than as an empty bearer header.
  it("treats an authenticated status with no token as no session", async () => {
    useSessionStore.setState({ token: null, user, status: "authenticated" })
    const onSignIn = vi.fn()

    const { container } = render(
      <SessionGate onSignIn={onSignIn}>
        <Text>the seller's catalogue</Text>
      </SessionGate>,
    )

    await waitFor(() => {
      expect(onSignIn).toHaveBeenCalledTimes(1)
    })
    expect(container).toBeEmptyDOMElement()
  })
})
