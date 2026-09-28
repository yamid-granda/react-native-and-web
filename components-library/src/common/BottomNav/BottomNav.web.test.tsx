import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { SunIcon } from "../../icons/SunIcon/SunIcon"
import { BottomNav, BOTTOM_NAV_MIN_GAP, getFloatingNavStyle } from "./BottomNav"

// MainNav.web.tsx's solito/navigation useLink() calls next/navigation's
// useRouter(), which throws outside a real Next.js app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

describe("BottomNav (web, via react-native-web)", () => {
  it("renders a MainNav item per entry, as links when given href", () => {
    render(
      <BottomNav
        items={[
          { key: "home", title: "Home", icon: HomeIcon, href: "/" },
          { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
        ]}
      />,
    )
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "Marketplace" })).toHaveAttribute("href", "/marketplace")
  })

  it("renders items with onPress as buttons (native usage)", () => {
    const onPress = vi.fn()
    render(<BottomNav items={[{ key: "home", title: "Home", icon: HomeIcon, onPress }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Home" }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("renders a trailingItem alongside the main items, without changing them", () => {
    const onPress = vi.fn()
    render(
      <BottomNav
        items={[{ key: "home", title: "Home", icon: HomeIcon, href: "/" }]}
        trailingItem={{ key: "theme", title: "Theme", icon: SunIcon, onPress }}
      />,
    )
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("renders nothing extra when trailingItem is omitted", () => {
    render(<BottomNav items={[{ key: "home", title: "Home", icon: HomeIcon, href: "/" }]} />)
    expect(screen.queryByText("Theme")).not.toBeInTheDocument()
  })
})

describe("getFloatingNavStyle", () => {
  it("adds the minimum gap to the given safe-area inset", () => {
    expect(getFloatingNavStyle(0).marginBottom).toBe(BOTTOM_NAV_MIN_GAP)
    expect(getFloatingNavStyle(34).marginBottom).toBe(BOTTOM_NAV_MIN_GAP + 34)
  })

  // mobile-application/(tabs)/_layout.tsx's TabList asChild wraps this style
  // in expo-router/ui's Slot, which throws in dev on an array style prop —
  // must always be a flattened, plain object, not an array.
  it("returns a flat object, not an array", () => {
    const style = getFloatingNavStyle(0)
    expect(Array.isArray(style)).toBe(false)
    expect(typeof style).toBe("object")
  })
})
