import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useCartStore } from "@rnw/components-library"
import CartPage from "../app/cart/page"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("solito/navigation", () => ({ useRouter: () => ({ push }) }))
// The page hands the screen a fetcher from `lib/api`; only the resolution this
// test cares about is stubbed, so the cart prices what the "server" returns.
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fetchProductsByIds: vi.fn(async (ids: string[]) => ({
    items: ids.map((id) => ({
      id,
      title: "Wireless Headphones",
      price: 129.99,
      stock: 10,
    })),
    missing: [] as string[],
  })),
}))

function renderCartPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CartPage />
    </QueryClientProvider>,
  )
}

describe("CartPage", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
    push.mockClear()
  })

  it("shows an empty state with no items in the cart", async () => {
    renderCartPage()
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
  })

  it("renders an item added to the cart store", async () => {
    useCartStore.getState().addItem("prod-1")
    renderCartPage()

    await waitFor(() => expect(screen.getByText("Wireless Headphones")).toBeInTheDocument())
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("navigates to /checkout when Proceed to Checkout is clicked", async () => {
    useCartStore.getState().addItem("prod-1")
    renderCartPage()
    await waitFor(() => expect(screen.getByText("Proceed to Checkout")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Proceed to Checkout"))
    expect(push).toHaveBeenCalledWith("/checkout")
  })
})
