import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { HomeScreen } from "./HomeScreen"
import { useCounterStore } from "./useCounterStore"

describe("HomeScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCounterStore.setState({ count: 0 })
  })

  it("renders the title and the shared Button", () => {
    render(<HomeScreen />)
    expect(screen.getByText("react-native-and-web")).toBeInTheDocument()
    expect(screen.getByText("Pressed 0 times")).toBeInTheDocument()
  })

  it("increments the counter when the button is pressed", () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByText("Pressed 0 times"))
    expect(screen.getByText("Pressed 1 times")).toBeInTheDocument()
  })
})
