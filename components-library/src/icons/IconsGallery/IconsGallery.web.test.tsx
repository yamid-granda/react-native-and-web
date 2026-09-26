import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { IconsGallery } from "./IconsGallery"
import { iconRegistry } from "../registry"

describe("IconsGallery (web, via react-native-web)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it("shows every icon by default, labeled without the Icon suffix", () => {
    render(<IconsGallery />)
    for (const { name } of iconRegistry) {
      expect(screen.getByText(name.replace(/Icon$/, ""))).toBeInTheDocument()
    }
  })

  it("filters icons by keyword", () => {
    render(<IconsGallery />)
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "shop" } })
    expect(screen.getByText("Marketplace")).toBeInTheDocument()
    expect(screen.queryByText("Home")).not.toBeInTheDocument()
  })

  it("filters icons by name", () => {
    render(<IconsGallery />)
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "home" } })
    expect(screen.getByText("Home")).toBeInTheDocument()
    expect(screen.queryByText("Marketplace")).not.toBeInTheDocument()
  })

  it("shows a no-results message when nothing matches", () => {
    render(<IconsGallery />)
    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "zzz-not-a-keyword" },
    })
    expect(screen.getByText(/No icons match/)).toBeInTheDocument()
  })

  it("copies the icon's full component name to the clipboard when clicked", () => {
    render(<IconsGallery />)
    fireEvent.click(screen.getByLabelText("Copy HomeIcon"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("HomeIcon")
  })
})
