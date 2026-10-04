import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ProductData } from "../../types/Product"
import type { FetchProductsByIds } from "../ProductLookup/useProductLookup"
import { CheckoutScreen } from "./CheckoutScreen"
import { useCartStore } from "../CartScreen/useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 }

const catalog = (...products: ProductData[]): FetchProductsByIds => async (ids) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

function renderCheckout(fetchProductsByIds: FetchProductsByIds, props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CheckoutScreen fetchProductsByIds={fetchProductsByIds} {...props} />
    </QueryClientProvider>,
  )
}

describe("CheckoutScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("shows an empty-cart guard and calls onGoToCart", async () => {
    const onGoToCart = vi.fn()
    renderCheckout(catalog(product), { onGoToCart })

    await waitFor(() => expect(screen.getByText("Your cart is empty.")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Go to Cart"))
    expect(onGoToCart).toHaveBeenCalled()
  })

  it("renders an order summary with the cart's items and total", async () => {
    useCartStore.getState().addItem(product.id)
    renderCheckout(catalog(product))

    await waitFor(() => expect(screen.getByText("Total: $129.99")).toBeInTheDocument())
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
  })

  /// The figure confirmed on the next screen is the one the lookup produced.
  /// Before, it was `getCartTotalPrice` over a localStorage snapshot.
  it("confirms the total from the resolved price", async () => {
    useCartStore.getState().addItem(product.id)
    renderCheckout(catalog({ ...product, price: 999 }))

    await waitFor(() => expect(screen.getByText("Place Order")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Place Order"))
    expect(screen.getByText("$999.00")).toBeInTheDocument()
  })

  it("says a deleted line is no longer part of the order rather than dropping it silently", async () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem("gone")
    renderCheckout(catalog(product))

    await waitFor(() => expect(screen.getByTestId("checkout-missing")).toHaveTextContent(
      "1 saved item is no longer available, so it is not part of this order.",
    ))
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("reports a failing lookup rather than rendering an empty order", async () => {
    useCartStore.getState().addItem(product.id)
    renderCheckout(async () => {
      throw new Error("service unavailable")
    })

    await waitFor(() =>
      expect(screen.getByText("Error: service unavailable")).toBeInTheDocument(),
    )
    expect(screen.queryByText("Your cart is empty.")).not.toBeInTheDocument()
    expect(screen.queryByText("Place Order")).not.toBeInTheDocument()
  })

  it("clears the cart and shows a confirmation when Place Order is clicked", async () => {
    useCartStore.getState().addItem(product.id)
    renderCheckout(catalog(product))
    await waitFor(() => expect(screen.getByText("Place Order")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Place Order"))

    expect(screen.getByText("Order placed!")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
    expect(useCartStore.getState().items).toEqual({})
  })

  it("calls onContinueShopping after placing an order", async () => {
    useCartStore.getState().addItem(product.id)
    const onContinueShopping = vi.fn()
    renderCheckout(catalog(product), { onContinueShopping })
    await waitFor(() => expect(screen.getByText("Place Order")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Place Order"))
    fireEvent.click(screen.getByText("Continue Shopping"))

    expect(onContinueShopping).toHaveBeenCalled()
  })

  it("tots a multi-line order from resolved prices", async () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem(otherProduct.id)
    useCartStore.getState().incrementQuantity("2")
    renderCheckout(catalog(product, otherProduct))

    await waitFor(() => expect(screen.getByText("Total: $308.99")).toBeInTheDocument())
  })
})
