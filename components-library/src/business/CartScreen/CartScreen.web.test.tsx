import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ProductData } from "../../types/Product"
import type { FetchProductsByIds } from "../ProductLookup/useProductLookup"
import { CartScreen } from "./CartScreen"
import { useCartStore } from "./useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 }

const catalog = (...products: ProductData[]): FetchProductsByIds => async (ids) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

/** The screen takes a fetcher rather than reaching for one — see `StoreScreen`. */
function renderCart(fetchProductsByIds: FetchProductsByIds, onCheckout?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CartScreen onCheckout={onCheckout} fetchProductsByIds={fetchProductsByIds} />
    </QueryClientProvider>,
  )
}

describe("CartScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("shows an empty state", async () => {
    renderCart(catalog(product))
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument())
  })

  it("renders a line item with its quantity and the total price", async () => {
    useCartStore.getState().addItem(product.id)
    renderCart(catalog(product))

    await waitFor(() => expect(screen.getByText("Total: $129.99")).toBeInTheDocument())
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  /// The whole change in one assertion: the total is computed from what the
  /// lookup returned, so a seller raising a price moves it. Before, the total
  /// came out of localStorage and nothing could ever move it.
  it("renders the total from the resolved price, not one remembered in the store", async () => {
    useCartStore.getState().addItem(product.id)

    const before = renderCart(catalog(product))
    await waitFor(() => expect(screen.getByText("Total: $129.99")).toBeInTheDocument())
    before.unmount()

    const raised = { ...product, price: 999 }
    renderCart(catalog(raised))
    await waitFor(() => expect(screen.getByText("Total: $999.00")).toBeInTheDocument())
    expect(screen.queryByText("Total: $129.99")).not.toBeInTheDocument()
  })

  it("says a deleted line is no longer available instead of dropping it silently", async () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem("gone")
    renderCart(catalog(product))

    await waitFor(() => expect(screen.getByTestId("cart-missing")).toHaveTextContent(
      "1 saved item is no longer available.",
    ))
    // Still renders the line it can resolve, and totals only that one.
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("removes the unavailable lines when asked, so a deleted product leaves the cart", async () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem("gone")
    renderCart(catalog(product))

    await waitFor(() => expect(screen.getByTestId("cart-missing")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Remove unavailable items"))

    await waitFor(() => expect(screen.queryByTestId("cart-missing")).not.toBeInTheDocument())
    expect(useCartStore.getState().items.gone).toBeUndefined()
    expect(useCartStore.getState().items["1"]).toBeDefined()
  })

  it("reports a failing lookup rather than rendering an empty cart", async () => {
    useCartStore.getState().addItem(product.id)
    renderCart(async () => {
      throw new Error("service unavailable")
    })

    await waitFor(() =>
      expect(screen.getByText("Error: service unavailable")).toBeInTheDocument(),
    )
    // Not "Your cart is empty." — the cart has a line in it.
    expect(screen.queryByText("Your cart is empty.")).not.toBeInTheDocument()
  })

  it("increases quantity when the + button is pressed", async () => {
    useCartStore.getState().addItem(product.id)
    renderCart(catalog(product))
    await waitFor(() => expect(screen.getByText("Total: $129.99")).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText("Increase Wireless Headphones quantity"))
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument())
  })

  it("decreases quantity when the - button is pressed", async () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().incrementQuantity("1")
    renderCart(catalog(product))
    await waitFor(() => expect(screen.getByText("Total: $259.98")).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText("Decrease Wireless Headphones quantity"))
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument())
  })

  it("removes the item when Remove is clicked", async () => {
    useCartStore.getState().addItem(product.id)
    renderCart(catalog(product))
    await waitFor(() => expect(screen.getByText("Total: $129.99")).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText("Remove Wireless Headphones from cart"))
    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument())
  })

  it("calls onCheckout when Proceed to Checkout is clicked", async () => {
    useCartStore.getState().addItem(product.id)
    const onCheckout = vi.fn()
    renderCart(catalog(product), onCheckout)
    await waitFor(() => expect(screen.getByText("Proceed to Checkout")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Proceed to Checkout"))
    expect(onCheckout).toHaveBeenCalled()
  })

  it("tots a multi-line cart from resolved prices", async () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem(otherProduct.id)
    useCartStore.getState().incrementQuantity("2")
    renderCart(catalog(product, otherProduct))

    await waitFor(() => expect(screen.getByText("Total: $308.99")).toBeInTheDocument())
  })
})
