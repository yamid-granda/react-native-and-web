import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useSessionStore } from "@rnw/components-library"
import Home from "../app/page"

// solito/navigation's useRouter() calls next/navigation's useRouter, which
// throws outside a real Next.js app router (see MainNav.web.test.tsx).
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))

const user = { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" }

describe("Home page", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
    push.mockClear()
  })

  it("renders the shared Button and reacts to presses", () => {
    render(<Home />)

    expect(screen.getByText("Pressed 0 times")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Pressed 0 times"))

    expect(screen.getByText("Pressed 1 times")).toBeInTheDocument()
  })

  it("routes the My Store entry to sign-in when anonymous", () => {
    render(<Home />)
    expect(screen.getByText("Sign in to sell")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("My Store"))
    expect(push.mock.calls.map((call) => call[0])).toContain("/login")
  })

  it("routes the My Store entry to the store when signed in", () => {
    useSessionStore.getState().setSession({ token: "a-token", user })
    render(<Home />)
    expect(screen.getByText("Riverbend Vintage")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("My Store"))
    expect(push.mock.calls.map((call) => call[0])).toContain("/my-store")
  })
})