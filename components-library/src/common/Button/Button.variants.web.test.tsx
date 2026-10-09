import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { BUTTON_SIZES, BUTTON_VARIANTS, Button, type ButtonSize, type ButtonVariant } from "./Button"
import * as ButtonStories from "./Button.stories"

/**
 * The variant set is a decision the team makes in a proposal under
 * `improve-proposals/`, not something a component edit settles on its own — see
 * `.agents/rules/button-variants.md`. These are the checks that make that stick
 * without anyone having to remember it.
 *
 * This suite lives in the web project rather than beside
 * `Button.centralization.test.ts` because it imports `Button`, and only the web
 * project can resolve `react-native` (react-native-web). It is `.tsx` because of
 * the render assertion below.
 */
const COMPONENT_SOURCE = readFileSync(join(import.meta.dirname, "Button.tsx"), "utf8")

/**
 * The approved variants, written out here on purpose.
 *
 * `BUTTON_VARIANTS` is derived from the component's own `variantStyle`, so it
 * changes the moment someone adds a look — which is what this assertion is here
 * to catch. Landing an agreed proposal means updating this line in the same
 * change, so a diff shows the list deliberately moving rather than the list
 * quietly moving underneath the app.
 */
const APPROVED_VARIANTS: ButtonVariant[] = ["primary", "secondary"]

/**
 * The approved densities (`improve-proposals/2026-10-09-button-input-sm.md`).
 * Written out here on purpose, same as the variants above: landing another
 * size means updating this line in the same change.
 */
const APPROVED_SIZES: ButtonSize[] = ["md", "sm"]

/** Storybook export names are the variant name, capitalized. */
function storyNameFor(variant: ButtonVariant): string {
  return variant.charAt(0).toUpperCase() + variant.slice(1)
}

describe("Button variants", () => {
  it("exposes exactly the approved variants", () => {
    expect(BUTTON_VARIANTS).toEqual(APPROVED_VARIANTS)
  })

  it("renders every approved variant", () => {
    for (const variant of APPROVED_VARIANTS) {
      const { unmount } = render(
        <Button label="Add to Cart" variant={variant} testId={`add-to-cart-${variant}`} />,
      )
      expect(screen.getByRole("button", { name: "Add to Cart" }), variant).toBeInTheDocument()
      unmount()
    }
  })

  it("gives every approved variant a Storybook story of its own", () => {
    const exportedStories = new Set(Object.keys(ButtonStories))

    for (const variant of APPROVED_VARIANTS) {
      expect(exportedStories.has(storyNameFor(variant)), `missing ${storyNameFor(variant)} story`)
        .toBe(true)
    }
  })

  it("exposes exactly the approved sizes", () => {
    expect([...BUTTON_SIZES]).toEqual(APPROVED_SIZES)
  })

  it("renders at both sizes without changing the accessible name", () => {
    for (const size of APPROVED_SIZES) {
      const { unmount } = render(
        <Button label="Filter" variant="secondary" size={size} testId={`filter-${size}`} />,
      )
      expect(screen.getByRole("button", { name: "Filter" }), size).toBeInTheDocument()
      expect(screen.getByTestId(`filter-${size}`), size).toBeInTheDocument()
      unmount()
    }
  })

  it("keeps md on the shared height/type and compacts sm", () => {
    // `md` is the historical default; `sm` is the compact filter density.
    // Asserted on source: react-native-web compiles `className` to atomic CSS,
    // so the utilities are not visible on the rendered DOM node.
    expect(COMPONENT_SOURCE).toContain('md: "h-control"')
    expect(COMPONENT_SOURCE).toContain('sm: "h-8"')
    expect(COMPONENT_SOURCE).toContain('primary: { md: "px-4", sm: "px-3" }')
    expect(COMPONENT_SOURCE).toContain('secondary: { md: "px-3", sm: "px-2" }')
    expect(COMPONENT_SOURCE).toContain('md: "text-base leading-6"')
    expect(COMPONENT_SOURCE).toContain('sm: "text-sm leading-5"')
    // The size prop is declared once on `ButtonProps` — this keeps the
    // declaration from being silently dropped while the export above moves.
    expect(COMPONENT_SOURCE).toMatch(/^\s*size\??:/m)
  })
})
