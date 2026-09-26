import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { BottomNav } from "./BottomNav"

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
    expect(screen.getByRole("link", { name: "Marketplace" })).toHaveAttribute(
      "href",
      "/marketplace",
    )
  })

  it("renders items with onPress as buttons (native usage)", () => {
    const onPress = vi.fn()
    render(<BottomNav items={[{ key: "home", title: "Home", icon: HomeIcon, onPress }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Home" }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
