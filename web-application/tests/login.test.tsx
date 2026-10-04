import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useSessionStore } from "@rnw/components-library"
import LoginPage from "../app/login/page"
import { login, register } from "../lib/api"

// `lib/api` is a re-export of the shared client (`createApi` in
// `@rnw/components-library`/api/transport), but the module path and every export
// name are unchanged, so this automock still intercepts all the call sites. The
// transport behind it is covered in components-library/src/api/transport.test.ts.
vi.mock("../lib/api")
// solito/navigation's useRouter() calls next/navigation's useRouter, which
// throws outside a real Next.js app router (see MainNav.web.test.tsx).
const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }))

const session = {
  token: "a-token",
  user: { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" },
}

/** The URL, ignoring solito's extra options argument. */
const replacedWith = () => replace.mock.calls.map((call) => call[0])

function fill(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

describe("LoginPage", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
    push.mockClear()
    replace.mockClear()
  })

  it("signs in and lands on My Store", async () => {
    vi.mocked(login).mockResolvedValue(session)
    render(<LoginPage />)

    fill("auth-email", "seller@example.com")
    fill("auth-password", "correct horse battery")
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        email: "seller@example.com",
        password: "correct horse battery",
      })
    })
    // The session is in the store before the redirect, so My Store's guard has
    // something to trust.
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("authenticated")
    })
    expect(replacedWith()).toContain("/my-store")
    expect(register).not.toHaveBeenCalled()
  })

  it("registers when a store name is supplied", async () => {
    vi.mocked(register).mockResolvedValue(session)
    render(<LoginPage />)
    fireEvent.click(screen.getByRole("button", { name: "Create a store" }))

    fill("auth-email", "seller@example.com")
    fill("auth-password", "correct horse battery")
    fill("auth-store-name", "Riverbend Vintage")
    fireEvent.click(screen.getByRole("button", { name: "Create store" }))

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith({
        email: "seller@example.com",
        password: "correct horse battery",
        storeName: "Riverbend Vintage",
      })
    })
    expect(login).not.toHaveBeenCalled()
  })

  it("surfaces a rejected credential and stays put", async () => {
    vi.mocked(login).mockRejectedValue(new Error("Unauthorized"))
    render(<LoginPage />)

    fill("auth-email", "seller@example.com")
    fill("auth-password", "correct horse battery")
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent("Unauthorized")
    })
    expect(replacedWith()).not.toContain("/my-store")
    expect(useSessionStore.getState().status).not.toBe("authenticated")
  })
})
