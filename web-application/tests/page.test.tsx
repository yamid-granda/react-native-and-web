import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Home from "../app/page";

describe("Home page", () => {
  it("renders the shared Button and reacts to presses", () => {
    render(<Home />);

    expect(screen.getByText("Pressed 0 times")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pressed 0 times"));

    expect(screen.getByText("Pressed 1 times")).toBeInTheDocument();
  });
});
