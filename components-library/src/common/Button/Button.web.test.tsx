import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Text } from "react-native"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { Button } from "./Button"

describe("Button (web, via react-native-web)", () => {
  it("renders the label", () => {
    render(<Button label="Click me" />)
    expect(screen.getByText("Click me")).toBeInTheDocument()
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<Button label="Click me" onPress={onPress} />)
    fireEvent.click(screen.getByText("Click me"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  describe("testID", () => {
    it("derives one from the label: lowercase, spaces dashed", () => {
      render(<Button label="Add to Cart" />)
      expect(screen.getByTestId("add-to-cart")).toBeInTheDocument()
    })

    it("collapses punctuation in the label", () => {
      render(<Button label="Price: Low to High" variant="chip" />)
      expect(screen.getByTestId("price-low-to-high")).toBeInTheDocument()
    })

    it("gives every button a testID, icon buttons included", () => {
      render(
        <Button label="Add to wishlist" size="icon">
          <HeartIcon size={18} />
        </Button>,
      )
      expect(screen.getByTestId("add-to-wishlist")).toBeInTheDocument()
    })

    it("prefers an explicit testID over the derived one", () => {
      render(<Button label="Remove" testID="remove-prod-1" />)
      expect(screen.getByTestId("remove-prod-1")).toBeInTheDocument()
      expect(screen.queryByTestId("remove")).not.toBeInTheDocument()
    })

    it("gives every variant and size a testID", () => {
      const variants = ["primary", "secondary", "outline", "ghost", "chip"] as const
      const sizes = ["sm", "md", "icon"] as const

      for (const variant of variants) {
        for (const size of sizes) {
          const { unmount } = render(<Button label="Order now" variant={variant} size={size} />)
          expect(screen.getByTestId("order-now"), `${variant}/${size}`).toBeInTheDocument()
          unmount()
        }
      }
    })
  })

  describe("accessibility", () => {
    it("uses the label as its accessible name", () => {
      render(<Button label="Place Order" />)
      expect(screen.getByRole("button", { name: "Place Order" })).toBeInTheDocument()
    })

    it("prefers accessibilityLabel over the label", () => {
      render(<Button label="Relevance" accessibilityLabel="Sort by Relevance" variant="chip" />)
      expect(screen.getByRole("button", { name: "Sort by Relevance" })).toBeInTheDocument()
    })

    it("names an icon button after its label, with no text of its own", () => {
      render(
        <Button label="Close" size="icon">
          <HeartIcon size={18} />
        </Button>,
      )
      const button = screen.getByRole("button", { name: "Close" })
      expect(button).toBeInTheDocument()
      expect(button).toHaveTextContent("")
    })

    it("marks a disabled button as disabled and ignores presses", () => {
      const onPress = vi.fn()
      render(<Button label="Out of stock" disabled onPress={onPress} />)
      const button = screen.getByRole("button", { name: "Out of stock" })
      expect(button).toBeDisabled()
      fireEvent.click(button)
      expect(onPress).not.toHaveBeenCalled()
    })

    it("exposes aria-selected on a chip, and only on a chip", () => {
      const { rerender } = render(<Button label="Relevance" variant="chip" selected={false} />)
      expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "false")

      rerender(<Button label="Relevance" variant="chip" selected />)
      expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "true")

      rerender(<Button label="Relevance" />)
      expect(screen.getByRole("button")).not.toHaveAttribute("aria-selected")
    })
  })

  describe("children", () => {
    it("renders children instead of the label text", () => {
      render(
        <Button label="Decrease quantity" size="icon">
          <Text>-</Text>
        </Button>,
      )
      expect(screen.getByText("-")).toBeInTheDocument()
      expect(screen.queryByText("Decrease quantity")).not.toBeInTheDocument()
    })

    it("still calls onPress", () => {
      const onPress = vi.fn()
      render(
        <Button label="Close" size="icon" onPress={onPress}>
          <HeartIcon size={18} />
        </Button>,
      )
      fireEvent.click(screen.getByTestId("close"))
      expect(onPress).toHaveBeenCalledTimes(1)
    })
  })
})
