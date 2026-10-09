import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { LocaleProvider } from "./LocaleContext"
import { HomeScreen } from "../business/HomeScreen/HomeScreen"

describe("LocaleProvider (web, via react-native-web)", () => {
  it("renders English by default", () => {
    render(<HomeScreen />)
    expect(screen.getByText("Sign in to sell")).toBeInTheDocument()
  })

  it("renders Spanish when locale is es", () => {
    render(
      <LocaleProvider locale="es">
        <HomeScreen />
      </LocaleProvider>,
    )
    expect(screen.getByText("Inicia sesión para vender")).toBeInTheDocument()
    expect(screen.getByText("Mi tienda")).toBeInTheDocument()
  })
})
