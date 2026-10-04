import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AuthScreen } from "./AuthScreen"
import { useSessionStore } from "./useSessionStore"
import type { AuthSession } from "../../types/Store"

const session: AuthSession = {
  token: "a-token",
  user: { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" },
}

/** By role, not by text: "Sign in" is both the heading and the submit button. */
const submitButton = (name: string) => screen.getByRole("button", { name })

function fill(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

function fillCredentials() {
  fill("auth-email", "seller@example.com")
  fill("auth-password", "correct horse battery")
}

describe("AuthScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  })

  it("starts in sign-in mode, with no store name field", () => {
    render(<AuthScreen onSubmit={vi.fn()} />)
    expect(screen.getByTestId("auth-title")).toHaveTextContent("Sign in")
    expect(screen.queryByTestId("auth-store-name")).not.toBeInTheDocument()
  })

  it("shows the subtitle when one is given", () => {
    render(<AuthScreen subtitle="Please sign in to continue" onSubmit={vi.fn()} />)
    expect(screen.getByText("Please sign in to continue")).toBeInTheDocument()
  })

  it("switches to sign-up and reveals the store name field", () => {
    render(<AuthScreen onSubmit={vi.fn()} />)
    fireEvent.click(submitButton("Create a store"))
    expect(screen.getByTestId("auth-title")).toHaveTextContent("Open your store")
    expect(screen.getByTestId("auth-store-name")).toBeInTheDocument()

    fireEvent.click(submitButton("Sign in instead"))
    expect(screen.queryByTestId("auth-store-name")).not.toBeInTheDocument()
  })

  it("submits credentials and stores the session", async () => {
    const onSubmit = vi.fn().mockResolvedValue(session)
    const onAuthenticated = vi.fn()
    render(<AuthScreen onSubmit={onSubmit} onAuthenticated={onAuthenticated} />)

    fillCredentials()
    fireEvent.click(submitButton("Sign in"))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: "seller@example.com",
        password: "correct horse battery",
        storeName: undefined,
      })
    })
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("authenticated")
    })
    expect(useSessionStore.getState().token).toBe("a-token")
    expect(useSessionStore.getState().user?.storeName).toBe("Riverbend Vintage")
    expect(onAuthenticated).toHaveBeenCalledWith(session)
  })

  it("sends the store name in sign-up mode, trimmed", async () => {
    const onSubmit = vi.fn().mockResolvedValue(session)
    render(<AuthScreen onSubmit={onSubmit} />)
    fireEvent.click(submitButton("Create a store"))

    fill("auth-email", "  seller@example.com  ")
    fill("auth-password", "correct horse battery")
    fill("auth-store-name", "  Riverbend Vintage  ")
    fireEvent.click(submitButton("Create store"))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: "seller@example.com",
        password: "correct horse battery",
        storeName: "Riverbend Vintage",
      })
    })
  })

  it("surfaces the server's message and stays signed out", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Invalid email or password"))
    render(<AuthScreen onSubmit={onSubmit} />)

    fillCredentials()
    fireEvent.click(submitButton("Sign in"))

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent("Invalid email or password")
    })
    expect(useSessionStore.getState().status).not.toBe("authenticated")
  })

  it("falls back to a generic message when the failure carries none", async () => {
    const onSubmit = vi.fn().mockRejectedValue("nope")
    render(<AuthScreen onSubmit={onSubmit} />)
    fillCredentials()
    fireEvent.click(submitButton("Sign in"))

    await waitFor(() => {
      expect(screen.getByTestId("auth-error")).toHaveTextContent("Something went wrong")
    })
  })

  it("blocks submission and explains why", () => {
    const onSubmit = vi.fn()
    render(<AuthScreen onSubmit={onSubmit} />)

    fireEvent.click(submitButton("Sign in"))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId("auth-error")).toHaveTextContent("Email is required")

    fill("auth-email", "not-an-email")
    fireEvent.click(submitButton("Sign in"))
    expect(screen.getByTestId("auth-error")).toHaveTextContent("valid email")

    fill("auth-email", "seller@example.com")
    fireEvent.click(submitButton("Sign in"))
    expect(screen.getByTestId("auth-error")).toHaveTextContent("Password is required")

    fill("auth-password", "short")
    fireEvent.click(submitButton("Sign in"))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId("auth-error")).toHaveTextContent("at least 8 characters")
  })

  it("requires a store name to sign up", () => {
    const onSubmit = vi.fn()
    render(<AuthScreen onSubmit={onSubmit} />)
    fireEvent.click(submitButton("Create a store"))
    fillCredentials()
    fireEvent.click(submitButton("Create store"))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId("auth-error")).toHaveTextContent("Store name is required")
  })

  it("clears the error when the mode is switched", () => {
    render(<AuthScreen onSubmit={vi.fn()} />)
    fireEvent.click(submitButton("Sign in"))
    expect(screen.getByTestId("auth-error")).toBeInTheDocument()

    fireEvent.click(submitButton("Create a store"))
    expect(screen.queryByTestId("auth-error")).not.toBeInTheDocument()
  })

  it("disables both buttons while the submission is in flight", async () => {
    let release: (session: AuthSession) => void = () => {}
    const onSubmit = vi.fn(
      () =>
        new Promise<AuthSession>((resolve) => {
          release = resolve
        })
    )
    render(<AuthScreen onSubmit={onSubmit} />)
    fillCredentials()
    fireEvent.click(submitButton("Sign in"))

    await waitFor(() => {
      expect(submitButton("Sign in")).toBeDisabled()
    })
    // A loading submit button that can still be pressed twice is worse than one
    // that cannot: two registrations, two products.

    release(session)
    await waitFor(() => {
      expect(useSessionStore.getState().status).toBe("authenticated")
    })
  })
})