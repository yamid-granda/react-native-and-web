import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProductFilterControls } from "./ProductFilterControls"

describe("ProductFilterControls (web, via react-native-web)", () => {
  it("calls onSortByChange when a sort option is pressed", () => {
    const onSortByChange = vi.fn()
    render(
      <ProductFilterControls
        sortBy="relevance"
        onSortByChange={onSortByChange}
        priceRange={{}}
        onPriceRangeChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByLabelText("Sort by Price: Low to High"))
    expect(onSortByChange).toHaveBeenCalledWith("price-asc")
  })

  it("marks the active sort option as selected", () => {
    render(
      <ProductFilterControls
        sortBy="price-desc"
        onSortByChange={vi.fn()}
        priceRange={{}}
        onPriceRangeChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText("Sort by Price: High to Low")).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByLabelText("Sort by Relevance")).toHaveAttribute("aria-selected", "false")
  })

  it("renders the current min/max price values", () => {
    render(
      <ProductFilterControls
        sortBy="relevance"
        onSortByChange={vi.fn()}
        priceRange={{ min: 10, max: 100 }}
        onPriceRangeChange={vi.fn()}
      />,
    )
    expect(screen.getByLabelText("Minimum price")).toHaveValue("10")
    expect(screen.getByLabelText("Maximum price")).toHaveValue("100")
  })

  it("calls onPriceRangeChange with a parsed number when typing a min price", () => {
    const onPriceRangeChange = vi.fn()
    render(
      <ProductFilterControls
        sortBy="relevance"
        onSortByChange={vi.fn()}
        priceRange={{}}
        onPriceRangeChange={onPriceRangeChange}
      />,
    )
    fireEvent.change(screen.getByLabelText("Minimum price"), { target: { value: "20" } })
    expect(onPriceRangeChange).toHaveBeenCalledWith({ min: 20 })
  })

  it("clears the bound when the price input is emptied", () => {
    const onPriceRangeChange = vi.fn()
    render(
      <ProductFilterControls
        sortBy="relevance"
        onSortByChange={vi.fn()}
        priceRange={{ max: 100 }}
        onPriceRangeChange={onPriceRangeChange}
      />,
    )
    fireEvent.change(screen.getByLabelText("Maximum price"), { target: { value: "" } })
    expect(onPriceRangeChange).toHaveBeenCalledWith({ max: undefined })
  })
})
