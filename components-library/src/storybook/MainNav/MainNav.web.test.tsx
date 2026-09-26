import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { MainNav } from "./MainNav"

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
})
