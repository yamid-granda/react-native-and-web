import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { IconGallery } from "./IconGallery"
import { iconRegistry } from "../registry"

describe("IconGallery (web, via react-native-web)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it("shows every icon by default", () => {
    render(<IconGallery />)
    for (const { name } of iconRegistry) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it("filters icons by keyword", () => {
    render(<IconGallery />)
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "shop" } })
    expect(screen.getByText("MarketplaceIcon")).toBeInTheDocument()
    expect(screen.queryByText("HomeIcon")).not.toBeInTheDocument()
  })

  it("filters icons by name", () => {
    render(<IconGallery />)
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "home" } })
    expect(screen.getByText("HomeIcon")).toBeInTheDocument()
    expect(screen.queryByText("MarketplaceIcon")).not.toBeInTheDocument()
  })

  it("shows a no-results message when nothing matches", () => {
    render(<IconGallery />)
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "zzz-not-a-keyword" } })
    expect(screen.getByText(/No icons match/)).toBeInTheDocument()
  })

  it("copies the icon name to the clipboard when clicked", () => {
    render(<IconGallery />)
    fireEvent.click(screen.getByLabelText("Copy HomeIcon"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("HomeIcon")
  })
})
