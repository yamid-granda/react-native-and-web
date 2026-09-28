import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { MainNav } from "./MainNav"

// MainNav.web.tsx's solito/navigation useLink() calls next/navigation's
// useRouter(), which throws outside a real Next.js app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

describe("MainNav (web, via react-native-web)", () => {
  it("renders a link pointing at the given href", () => {
    render(<MainNav href="/home" icon={HomeIcon} title="Home" />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/home")
  })

  it("renders the given title below the icon", () => {
    render(<MainNav href="/home" icon={HomeIcon} title="Home" />)
    expect(screen.getByText("Home")).toBeInTheDocument()
  })

  it("accepts any icon from the icons/ folder", () => {
    expect(() =>
      render(<MainNav href="/marketplace" icon={MarketplaceIcon} title="Marketplace" />),
    ).not.toThrow()
  })

  it("renders as a button and calls onPress when there is no href (native usage)", () => {
    const onPress = vi.fn()
    render(<MainNav onPress={onPress} icon={HomeIcon} title="Home" />)
    expect(screen.getByRole("button")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("renders a badge count when given one", () => {
    render(<MainNav href="/cart" icon={HomeIcon} title="Cart" badgeCount={3} />)
    expect(screen.getByText("3")).toBeInTheDocument()
  })

  it("caps the badge count display at 99+", () => {
    render(<MainNav href="/cart" icon={HomeIcon} title="Cart" badgeCount={150} />)
    expect(screen.getByText("99+")).toBeInTheDocument()
  })

  it("renders no badge when badgeCount is omitted or zero", () => {
    const { rerender } = render(<MainNav href="/cart" icon={HomeIcon} title="Cart" />)
    expect(screen.queryByText("0")).not.toBeInTheDocument()
    rerender(<MainNav href="/cart" icon={HomeIcon} title="Cart" badgeCount={0} />)
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })
})
