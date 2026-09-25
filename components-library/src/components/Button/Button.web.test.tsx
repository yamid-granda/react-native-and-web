import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./Button";

describe("Button (web, via react-native-web)", () => {
  it("renders the label", () => {
    render(<Button label="Click me" />);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    render(<Button label="Click me" onPress={onPress} />);
    fireEvent.click(screen.getByText("Click me"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
