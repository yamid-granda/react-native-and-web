import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Text } from "react-native"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { Button } from "./Button"

describe("Button (web, via react-native-web)", () => {
  it("renders the label", () => {
    render(<Button label="Click me" testId="click-me" />)
    expect(screen.getByText("Click me")).toBeInTheDocument()
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<Button label="Click me" testId="click-me" onPress={onPress} />)
    fireEvent.click(screen.getByText("Click me"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  describe("testId", () => {
    it("passes the given test id through, and derives nothing from the label", () => {
      render(<Button label="Price: Low to High" testId="sort-price-asc" variant="chip" />)
      expect(screen.getByTestId("sort-price-asc")).toBeInTheDocument()
      expect(screen.queryByTestId("price-low-to-high")).not.toBeInTheDocument()
    })

    it("gives icon buttons a test id too", () => {
      render(
        <Button label="Add to wishlist" testId="wishlist-toggle-1" size="icon">
          <HeartIcon size={18} />
        </Button>,
      )
      expect(screen.getByTestId("wishlist-toggle-1")).toBeInTheDocument()
    })

    it("keeps the same test id while loading, since it does not come from the text", () => {
      render(<Button label="Save changes" testId="auth-submit" loading />)
      expect(screen.getByTestId("auth-submit")).toBeInTheDocument()
    })

    it("gives every variant and size the test id it was given", () => {
      const variants = ["primary", "secondary", "outline", "ghost", "chip"] as const
      const sizes = ["sm", "md", "icon"] as const

      for (const variant of variants) {
        for (const size of sizes) {
          const { unmount } = render(
            <Button
              label="Order now"
              testId={`order-now-${variant}-${size}`}
              variant={variant}
              size={size}
            />,
          )
          expect(
            screen.getByTestId(`order-now-${variant}-${size}`),
            `${variant}/${size}`,
          ).toBeInTheDocument()
          unmount()
        }
      }
    })
  })

  describe("accessibility", () => {
    it("uses the label as its accessible name", () => {
      render(<Button label="Place Order" testId="checkout-place-order" />)
      expect(screen.getByRole("button", { name: "Place Order" })).toBeInTheDocument()
    })

    it("prefers accessibilityLabel over the label", () => {
      render(
        <Button
          label="Relevance"
          testId="sort-relevance"
          accessibilityLabel="Sort by Relevance"
          variant="chip"
        />,
      )
      expect(screen.getByRole("button", { name: "Sort by Relevance" })).toBeInTheDocument()
    })

    it("names an icon button after its label, with no text of its own", () => {
      render(
        <Button label="Close" testId="drawer-close" size="icon">
          <HeartIcon size={18} />
        </Button>,
      )
      const button = screen.getByRole("button", { name: "Close" })
      expect(button).toBeInTheDocument()
      expect(button).toHaveTextContent("")
    })

    it("marks a disabled button as disabled and ignores presses", () => {
      const onPress = vi.fn()
      render(<Button label="Out of stock" testId="out-of-stock" disabled onPress={onPress} />)
      const button = screen.getByRole("button", { name: "Out of stock" })
      expect(button).toBeDisabled()
      fireEvent.click(button)
      expect(onPress).not.toHaveBeenCalled()
    })

    it("keeps its accessible name while loading", () => {
      // The visible label becomes "…", which on its own would leave a screen reader
      // with nothing to announce.
      render(<Button label="Save changes" testId="auth-submit" loading />)
      expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
    })

    it("announces the busy state", () => {
      const { unmount } = render(<Button label="Save changes" testId="auth-submit" loading />)
      expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute(
        "aria-busy",
        "true",
      )
      unmount()

      render(<Button label="Go" testId="go" />)
      expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("aria-busy", "false")
    })

    it("exposes aria-selected on a chip, and only on a chip", () => {
      const { rerender } = render(
        <Button label="Relevance" testId="sort-relevance" variant="chip" selected={false} />,
      )
      expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "false")

      rerender(<Button label="Relevance" testId="sort-relevance" variant="chip" selected />)
      expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "true")

      rerender(<Button label="Relevance" testId="sort-relevance" />)
      expect(screen.getByRole("button")).not.toHaveAttribute("aria-selected")
    })
  })

  describe("loading", () => {
    it("shows an ellipsis and refuses presses", () => {
      const onPress = vi.fn()
      render(<Button label="Save changes" testId="auth-submit" onPress={onPress} loading />)
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
        <Button label="Decrease quantity" testId="cart-decrease-prd-1" size="icon">
          <Text>-</Text>
        </Button>,
      )
      expect(screen.getByText("-")).toBeInTheDocument()
      expect(screen.queryByText("Decrease quantity")).not.toBeInTheDocument()
    })

    it("still calls onPress", () => {
      const onPress = vi.fn()
      render(
        <Button label="Close" testId="drawer-close" size="icon" onPress={onPress}>
          <HeartIcon size={18} />
        </Button>,
      )
      fireEvent.click(screen.getByTestId("drawer-close"))
      expect(onPress).toHaveBeenCalledTimes(1)
    })

    it("keeps children while loading, so an icon button never becomes a bare ellipsis", () => {
      render(
        <Button label="Close" testId="drawer-close" size="icon" loading>
          <HeartIcon size={18} />
        </Button>,
      )
      expect(screen.queryByText("…")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled()
    })
  })
})