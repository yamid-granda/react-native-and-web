import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProductDetailView } from "../app/marketplace/[id]/product-detail-view"

// solito/navigation's useRouter() calls next/navigation's useRouter, which
// throws outside a real Next.js app router (see MainNav.web.test.tsx).
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))

const product = {
  id: "prod-1",
  title: "Wireless Headphones",
  description: "Noise cancelling.",
  price: 129.99,
  stock: 10,
  storeId: "usr_1",
  storeName: "Riverbend Vintage",
}

describe("ProductDetailView", () => {
  beforeEach(() => push.mockClear())

  it("renders the server-fetched product", () => {
    render(<ProductDetailView product={product} />)

    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("routes the seller link to the public storefront", () => {
    render(<ProductDetailView product={product} />)

    fireEvent.click(screen.getByTestId("product-detail-store"))

    // The URL, ignoring solito's extra options argument.
    expect(push.mock.calls.map((call) => call[0])).toContain("/stores/usr_1")
  })
})
