import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { View } from "react-native"
import { ProductCard } from "./ProductCard"

// The body both platforms render, so these assertions describe the card rather
// than one platform's copy of it. What each adapter contributes — the image
// element — is asserted in Product.web.test.tsx; the native adapter can only
// be reached by Detox (see README on components-library's Vitest projects).
describe("ProductCard (shared body, via react-native-web)", () => {
  const props = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }

  it("renders the title and formatted price", () => {
    render(<ProductCard {...props} />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("renders the description when provided", () => {
    render(<ProductCard {...props} description="Great sound" />)
    expect(screen.getByText("Great sound")).toBeInTheDocument()
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<ProductCard {...props} onPress={onPress} />)
    fireEvent.click(screen.getByText("Wireless Headphones"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("exposes a testID keyed by product id, for e2e targeting", () => {
    render(<ProductCard {...props} />)
    expect(screen.getByTestId("product-card-1")).toBeInTheDocument()
  })

  it("does not show an out-of-stock badge when stock is available", () => {
    render(<ProductCard {...props} stock={5} />)
    expect(screen.queryByText("Out of stock")).not.toBeInTheDocument()
  })

  it("shows an out-of-stock badge when stock is zero", () => {
    render(<ProductCard {...props} stock={0} />)
    expect(screen.getByText("Out of stock")).toBeInTheDocument()
  })

  it("renders the image slot the adapter supplies, and omits it entirely when there is none", () => {
    const { rerender } = render(<ProductCard {...props} image={<View testID="card-image" />} />)
    expect(screen.getByTestId("card-image")).toBeInTheDocument()

    rerender(<ProductCard {...props} />)
    expect(screen.queryByTestId("card-image")).not.toBeInTheDocument()
  })

  it("keeps the image full-bleed with the copy in a separate body container", () => {
    // The image wrapper holds nothing but the image (and badge) and sits
    // beside the body — the title/price are never direct card children, which
    // is what lets the image touch the card edges while the copy keeps its inset.
    render(<ProductCard {...props} image={<View testID="card-image" />} />)
    const card = screen.getByTestId("product-card-1")
    const imageWrapper = screen.getByTestId("card-image").parentElement
    const title = screen.getByText("Wireless Headphones")

    expect(imageWrapper?.parentElement).toBe(card)
    expect(title.parentElement).not.toBe(card)
    expect(title.parentElement).toBe(imageWrapper?.nextElementSibling)
    expect(title.parentElement?.textContent).toMatch(/\$129\.99/)
  })

  it("matches the body padding to the marketplace grid gutter", () => {
    // NativeWind compiles class names away under jsdom, so the equality the
    // request asks for — body inset = grid separation — is pinned at the
    // source instead: p-4 (16) in both card copies, gap-4 / GRID_GAP = 16 in
    // both list screens.
    const dir = import.meta.dirname
    const card = readFileSync(join(dir, "ProductCard.tsx"), "utf8")
    const cardWeb = readFileSync(join(dir, "ProductCard.web.tsx"), "utf8")
    const list = readFileSync(join(dir, "../../business/ProductListScreen/ProductListScreen.tsx"), "utf8")
    const listWeb = readFileSync(
      join(dir, "../../business/ProductListScreen/ProductListScreen.web.tsx"),
      "utf8",
    )

    expect(card).toMatch(/className="w-full gap-2 p-4"/)
    expect(cardWeb).toMatch(/className="w-full gap-2 p-4"/)
    expect(list).toMatch(/GRID_GAP = 16/)
    expect(listWeb).toMatch(/gap-4/)
  })
})
