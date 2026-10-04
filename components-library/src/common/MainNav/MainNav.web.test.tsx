import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MainNav } from "./MainNav"

// MainNav.web.tsx's solito/navigation useLink() calls next/navigation's
// useRouter(), which throws outside a real Next.js app router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

// This file is the web adapter's wiring and nothing else: the icon, title and
// badge it renders live in MainNavItem.web.test.tsx.
describe("MainNav (web adapter, via react-native-web)", () => {
  it("renders a link pointing at the given href", () => {
    render(<MainNav href="/home" icon={HomeIcon} title="Home" />)
    expect(screen.getByRole("link")).toHaveAttribute("href", "/home")
  })

  it("renders as a button and calls onPress when there is no href (native usage)", () => {
    const onPress = vi.fn()
    render(<MainNav onPress={onPress} icon={HomeIcon} title="Home" />)
    expect(screen.getByRole("button")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})