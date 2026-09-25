import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Product } from "./Product"

describe("Product (web, via react-native-web)", () => {
  const props = { id: "1", title: "Wireless Headphones", price: 129.99 }

  it("renders the title and formatted price", () => {
    render(<Product {...props} />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("renders the description when provided", () => {
    render(<Product {...props} description="Great sound" />)
    expect(screen.getByText("Great sound")).toBeInTheDocument()
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<Product {...props} onPress={onPress} />)
    fireEvent.click(screen.getByText("Wireless Headphones"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
