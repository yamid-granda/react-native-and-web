import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useCartStore } from "@rnw/components-library"
import CheckoutPage from "../app/checkout/page"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("solito/navigation", () => ({ useRouter: () => ({ push }) }))
// The page hands the screen a fetcher from `lib/api`; only the resolution this
// test cares about is stubbed, so the order summary prices what the "server"
// returns.
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

function renderCheckoutPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CheckoutPage />
    </QueryClientProvider>,
  )
}

describe("CheckoutPage", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
    push.mockClear()
  })

  it("shows the empty-cart guard and navigates to /cart", async () => {
    renderCheckoutPage()

    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Go to Cart"))
    expect(push).toHaveBeenCalledWith("/cart")
  })

  it("renders the order summary for a seeded cart", async () => {
    useCartStore.getState().addItem("prod-1")
    renderCheckoutPage()

    await waitFor(() => expect(screen.getByText("Wireless Headphones")).toBeInTheDocument())
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("places the order then navigates to /marketplace on Continue Shopping", async () => {
    useCartStore.getState().addItem("prod-1")
    renderCheckoutPage()
    await waitFor(() => expect(screen.getByText("Place Order")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Place Order"))
    expect(screen.getByText("Order placed!")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Continue Shopping"))
    expect(push).toHaveBeenCalledWith("/marketplace")
  })
})
