import { Suspense, act, type ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { productWriteKeys, useSessionStore } from "@rnw/components-library"
import MyStorePage from "../app/my-store/page"
import NewProductPage from "../app/my-store/new/page"
import StorePage from "../app/stores/[id]/page"
import {
  createMyProduct,
  deleteMyProduct,
  fetchMyProducts,
  fetchStore,
  fetchStoreProducts,
} from "../lib/api"

vi.mock("../lib/api")
const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }))

const user = { id: "usr_1", email: "seller@example.com", storeName: "Riverbend Vintage" }
const product = {
  id: "prd_1",
  title: "Leather Weekender Bag",
  description: "Full-grain leather.",
  price: 189,
  currency: "USD",
  stock: 6,
  storeId: "usr_1",
  storeName: "Riverbend Vintage",
}

const page = { items: [product], page: 1, limit: 20, total: 1, hasNextPage: false }

/** The URL, ignoring solito's extra options argument. */
const pushedTo = () => push.mock.calls.map((call) => call[0])
const replacedWith = () => replace.mock.calls.map((call) => call[0])

function renderWithClient(ui: ReactElement) {
  // staleTime 0 and no retries: these tests are about what the page renders and
  // which calls it makes, not about react-query's timing.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  })
  return { ...render(wrap(ui, queryClient)), queryClient }
}

function wrap(ui: ReactElement, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      {/* A dynamic route's `params` is a promise, so the component suspends on
          its first render and the retry only commits from inside the same act()
          batch as the initial render. */}
      <Suspense fallback={null}>{ui}</Suspense>
    </QueryClientProvider>
  )
}

/** For the promise-taking `params` prop: settle it inside act(). */
async function renderAsync(ui: ReactElement) {
  await act(async () => {
    renderWithClient(ui)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function signIn() {
  useSessionStore.getState().setSession({ token: "a-token", user })
}

describe("MyStorePage", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
    push.mockClear()
    replace.mockClear()
  })

  it("sends an anonymous visitor to the login screen", async () => {
    renderWithClient(<MyStorePage />)
    await waitFor(() => {
      expect(replacedWith()).toContain("/login")
    })
    expect(fetchMyProducts).not.toHaveBeenCalled()
  })

  it("shows a loading state while the session is still being validated", () => {
    useSessionStore.setState({ token: "a-token", user, status: "loading" })
    renderWithClient(<MyStorePage />)
    expect(screen.getByText("Checking your session…")).toBeInTheDocument()
    expect(fetchMyProducts).not.toHaveBeenCalled()
  })

  it("lists the seller's own products under the store name", async () => {
    signIn()
    vi.mocked(fetchMyProducts).mockResolvedValue(page)
    renderWithClient(<MyStorePage />)

    await waitFor(() => {
      expect(screen.getByText("Leather Weekender Bag")).toBeInTheDocument()
    })
    expect(screen.getByText("Riverbend Vintage")).toBeInTheDocument()
    expect(screen.queryByText(/You have no products yet/)).not.toBeInTheDocument()
  })

  it("navigates to the create and edit screens", async () => {
    signIn()
    vi.mocked(fetchMyProducts).mockResolvedValue(page)
    renderWithClient(<MyStorePage />)

    await waitFor(() => expect(screen.getByText("Leather Weekender Bag")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Add product" }))
    expect(pushedTo()).toContain("/my-store/new")

    fireEvent.click(screen.getByLabelText("Edit Leather Weekender Bag"))
    expect(pushedTo()).toContain("/my-store/prd_1/edit")
  })

  it("deletes through the shared mutation, which invalidates the list", async () => {
    signIn()
    vi.mocked(fetchMyProducts).mockResolvedValue(page)
    vi.mocked(deleteMyProduct).mockResolvedValue(undefined)
    renderWithClient(<MyStorePage />)

    await waitFor(() => expect(screen.getByText("Leather Weekender Bag")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("Delete Leather Weekender Bag"))

    await waitFor(() => {
      expect(deleteMyProduct).toHaveBeenCalledWith("prd_1")
    })
    // Refetched: the mutation invalidates the owner's list key.
    await waitFor(() => {
      expect(vi.mocked(fetchMyProducts).mock.calls.length).toBeGreaterThan(1)
    })
  })

  it("surfaces a failed list request", async () => {
    signIn()
    vi.mocked(fetchMyProducts).mockRejectedValue(new Error("Unauthorized"))
    renderWithClient(<MyStorePage />)

    await waitFor(() => {
      expect(screen.getByText("Error: Unauthorized")).toBeInTheDocument()
    })
  })
})

describe("NewProductPage", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
    replace.mockClear()
  })

  it("sends an anonymous visitor to the login screen", async () => {
    renderWithClient(<NewProductPage />)
    await waitFor(() => expect(replacedWith()).toContain("/login"))
  })

  it("creates a product and returns to the list", async () => {
    signIn()
    vi.mocked(createMyProduct).mockResolvedValue(product)
    const { queryClient } = renderWithClient(<NewProductPage />)
    // Seeded so the invalidation is observable: under this harness's `staleTime: 0`
    // a refetch cannot distinguish "invalidated" from "always stale", so the
    // assertion has to be `isInvalidated` and not a call count.
    for (const queryKey of productWriteKeys(user.id, product.id)) {
      queryClient.setQueryData(queryKey, page)
    }

    fireEvent.change(screen.getByTestId("product-title"), {
      target: { value: "Leather Weekender" },
    })
    fireEvent.change(screen.getByTestId("product-price"), { target: { value: "189" } })
    fireEvent.change(screen.getByTestId("product-stock"), { target: { value: "6" } })
    fireEvent.click(screen.getByRole("button", { name: "Create product" }))

    await waitFor(() => {
      // `description` and `imageUrl` are sent as `""` rather than omitted: the form
      // submits every field, and an empty string is what tells the server to store
      // `NULL` instead of leaving whatever was there.
      expect(createMyProduct).toHaveBeenCalledWith({
        title: "Leather Weekender",
        description: "",
        price: 189,
        imageUrl: "",
        stock: 6,
      })
    })
    expect(replacedWith()).toContain("/my-store")
    // The write went through the seam, so the seller's list, the catalogue and
    // the storefront are all retired — not just the one key the old `refresh` knew.
    for (const queryKey of productWriteKeys(user.id, product.id)) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  })

  it("keeps the seller on the form when the server refuses", async () => {
    signIn()
    vi.mocked(createMyProduct).mockRejectedValue(new Error("Title must be at most 200 characters"))
    renderWithClient(<NewProductPage />)

    fireEvent.change(screen.getByTestId("product-title"), { target: { value: "Mug" } })
    fireEvent.change(screen.getByTestId("product-price"), { target: { value: "18" } })
    fireEvent.click(screen.getByRole("button", { name: "Create product" }))

    await waitFor(() => {
      expect(screen.getByText(/Title must be at most 200 characters/)).toBeInTheDocument()
    })
    expect(replacedWith()).not.toContain("/my-store")
  })
})

describe("StorePage (the public storefront)", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
    replace.mockClear()
  })

  it("renders a store without a session", async () => {
    vi.mocked(fetchStore).mockResolvedValue({
      id: "usr_1",
      storeName: "Riverbend Vintage",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    vi.mocked(fetchStoreProducts).mockResolvedValue(page)

    await renderAsync(
      <StorePage params={Promise.resolve({ id: "usr_1" })} searchParams={Promise.resolve({})} />,
    )

    await waitFor(() => {
      expect(screen.getByText("Leather Weekender Bag")).toBeInTheDocument()
    })
    expect(screen.getAllByText("Riverbend Vintage").length).toBeGreaterThan(0)
    // And no session was required for any of it.
    expect(replacedWith()).not.toContain("/login")
    expect(fetchStore).toHaveBeenCalledWith("usr_1")
    expect(fetchStoreProducts).toHaveBeenCalledWith("usr_1")
  })
})