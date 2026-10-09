import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SettingsSheet } from "./SettingsSheet"

describe("SettingsSheet (web, via react-native-web)", () => {
  it("renders nothing when not visible", () => {
    render(
      <SettingsSheet
        visible={false}
        onClose={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        locale="en"
        onLocaleChange={vi.fn()}
      />,
    )
    expect(screen.queryByText("Settings")).not.toBeInTheDocument()
  })

  it("renders theme and language options when visible", () => {
    render(
      <SettingsSheet
        visible
        onClose={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        locale="en"
        onLocaleChange={vi.fn()}
      />,
    )
    expect(screen.getByText("Settings")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Español" })).toBeInTheDocument()
  })

  it("fires onThemeChange when the dark option is pressed", () => {
    const onThemeChange = vi.fn()
    render(
      <SettingsSheet
        visible
        onClose={vi.fn()}
        theme="light"
        onThemeChange={onThemeChange}
        locale="en"
        onLocaleChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId("settings-theme-dark"))
    expect(onThemeChange).toHaveBeenCalledWith("dark")
  })

  it("fires onLocaleChange when Español is pressed", () => {
    const onLocaleChange = vi.fn()
    render(
      <SettingsSheet
        visible
        onClose={vi.fn()}
        theme="light"
        onThemeChange={vi.fn()}
        locale="en"
        onLocaleChange={onLocaleChange}
      />,
    )
    fireEvent.click(screen.getByTestId("settings-language-es"))
    expect(onLocaleChange).toHaveBeenCalledWith("es")
  })
})
