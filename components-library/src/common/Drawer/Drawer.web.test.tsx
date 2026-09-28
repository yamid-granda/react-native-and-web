import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Drawer } from "./Drawer"

describe("Drawer (web, via react-native-web)", () => {
  it("renders nothing when not visible", () => {
    render(
      <Drawer visible={false} onClose={vi.fn()}>
        <>Drawer content</>
      </Drawer>,
    )
    expect(screen.queryByText("Drawer content")).not.toBeInTheDocument()
  })

  it("renders its children when visible", () => {
    render(
      <Drawer visible onClose={vi.fn()}>
        <>Drawer content</>
      </Drawer>,
    )
    expect(screen.getByText("Drawer content")).toBeInTheDocument()
  })

  it("calls onClose when the overlay is clicked", () => {
    const onClose = vi.fn()
    render(
      <Drawer visible onClose={onClose}>
        <>Drawer content</>
      </Drawer>,
    )
    fireEvent.click(screen.getByTestId("drawer-overlay"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not call onClose when the content is clicked", () => {
    const onClose = vi.fn()
    render(
      <Drawer visible onClose={onClose}>
        <>Drawer content</>
      </Drawer>,
    )
    fireEvent.click(screen.getByTestId("drawer-content"))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("calls onClose when the close (X) button is clicked", () => {
    const onClose = vi.fn()
    render(
      <Drawer visible onClose={onClose}>
        <>Drawer content</>
      </Drawer>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
