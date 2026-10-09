import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { MainNavItem } from "./MainNavItem"

// The body both platforms render, so these assertions describe the nav item
// rather than one platform's copy of it. How a press becomes navigation is
// the adapter's job and is asserted in MainNav.web.test.tsx.
describe("MainNavItem (shared body, via react-native-web)", () => {
  const navProps = { accessibilityRole: "button" as const, onPress: vi.fn() }

  it("renders the given title below the icon", () => {
    render(<MainNavItem navProps={navProps} icon={HomeIcon} title="Home" />)
    expect(screen.getByText("Home")).toBeInTheDocument()
  })

  it("accepts any icon from the icons/ folder", () => {
    expect(() =>
      render(<MainNavItem navProps={navProps} icon={MarketplaceIcon} title="Marketplace" />),
    ).not.toThrow()
  })

  it("renders a badge count when given one", () => {
    render(<MainNavItem navProps={navProps} icon={HomeIcon} title="Cart" badgeCount={3} />)
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("caps the badge count display at 99+", () => {
    render(<MainNavItem navProps={navProps} icon={HomeIcon} title="Cart" badgeCount={150} />)
    expect(screen.getByText("99+")).toBeInTheDocument()
  })

  it("renders no badge when badgeCount is omitted or zero", () => {
    const { rerender } = render(<MainNavItem navProps={navProps} icon={HomeIcon} title="Cart" />)
    expect(screen.queryByText("0")).not.toBeInTheDocument()
    rerender(<MainNavItem navProps={navProps} icon={HomeIcon} title="Cart" badgeCount={0} />)
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })

  it("passes aria-current from the adapter through to the link", () => {
    render(
      <MainNavItem
        navProps={{ href: "/cart", "aria-current": "page" }}
        icon={HomeIcon}
        title="Cart"
        active
      />,
    )
    expect(screen.getByText("Cart").closest("a")).toHaveAttribute("aria-current", "page")
  })

  it("renders the platform-supplied navProps onto the pressable", () => {
    const onPress = vi.fn()
    render(
      <MainNavItem
        navProps={{ accessibilityRole: "button", onPress }}
        icon={HomeIcon}
        title="Home"
      />,
    )
    expect(screen.getByRole("button")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
