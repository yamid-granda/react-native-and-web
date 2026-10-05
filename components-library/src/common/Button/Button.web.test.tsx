import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Text } from "react-native"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { Button, BUTTON_VARIANTS } from "./Button"

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
      render(<Button label="Price: Low to High" variant="secondary" />)
      expect(screen.getByTestId("price-low-to-high")).toBeInTheDocument()
    })

    it("gives every button a testID, icon buttons included", () => {
      render(
        <Button label="Add to wishlist">
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

    it("gives every variant a testID", () => {
      for (const variant of BUTTON_VARIANTS) {
        const { unmount } = render(<Button label="Order now" variant={variant} />)
        expect(screen.getByTestId("order-now"), variant).toBeInTheDocument()
        unmount()
      }
    })

    it("keeps the same testID while loading, since it comes from label not text", () => {
      render(<Button label="Save changes" loading />)
      expect(screen.getByTestId("save-changes")).toBeInTheDocument()
    })
  })

  describe("accessibility", () => {
    it("uses the label as its accessible name", () => {
      render(<Button label="Place Order" />)
      expect(screen.getByRole("button", { name: "Place Order" })).toBeInTheDocument()
    })

    it("prefers accessibilityLabel over the label", () => {
      render(<Button label="Relevance" accessibilityLabel="Sort by Relevance" />)
      expect(screen.getByRole("button", { name: "Sort by Relevance" })).toBeInTheDocument()
    })

    it("names an icon button after its label, with no text of its own", () => {
      render(
        <Button label="Close" variant="secondary">
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

    it("keeps its accessible name while loading", () => {
      // The visible label becomes "…", which on its own would leave a screen reader
      // with nothing to announce.
      render(<Button label="Save changes" loading />)
      expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
    })

    it("announces the busy state", () => {
      const { unmount } = render(<Button label="Save changes" loading />)
      expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute(
        "aria-busy",
        "true",
      )
      unmount()

      render(<Button label="Go" />)
      expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("aria-busy", "false")
    })

    it("exposes aria-selected only when the caller opts in with `selected`", () => {
      const { rerender } = render(<Button label="Relevance" selected={false} />)
      expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "false")

      rerender(<Button label="Relevance" selected />)
      expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "true")

      // An ordinary button must not claim to be part of a selection.
      rerender(<Button label="Relevance" />)
      expect(screen.getByRole("button")).not.toHaveAttribute("aria-selected")
    })
  })

  describe("loading", () => {
    it("shows an ellipsis and refuses presses", () => {
      const onPress = vi.fn()
      render(<Button label="Save changes" onPress={onPress} loading />)
      expect(screen.queryByText("Save changes")).not.toBeInTheDocument()
      expect(screen.getByText("…")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      expect(onPress).not.toHaveBeenCalled()
    })
  })

  describe("children", () => {
    it("renders children instead of the label text", () => {
      render(
        <Button label="Decrease quantity" variant="secondary">
          <Text>-</Text>
        </Button>,
      )
      expect(screen.getByText("-")).toBeInTheDocument()
      expect(screen.queryByText("Decrease quantity")).not.toBeInTheDocument()
    })

    it("still calls onPress", () => {
      const onPress = vi.fn()
      render(
        <Button label="Close" variant="secondary" onPress={onPress}>
          <HeartIcon size={18} />
        </Button>,
      )
      fireEvent.click(screen.getByTestId("close"))
      expect(onPress).toHaveBeenCalledTimes(1)
    })

    it("keeps children while loading, so an icon button never becomes a bare ellipsis", () => {
      render(
        <Button label="Close" variant="secondary" loading>
          <HeartIcon size={18} />
        </Button>,
      )
      expect(screen.queryByText("…")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled()
    })
  })
})