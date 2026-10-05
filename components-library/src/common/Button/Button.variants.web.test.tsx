import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { BUTTON_VARIANTS, Button, type ButtonVariant } from "./Button"
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
      const { unmount } = render(<Button label="Add to Cart" variant={variant} />)
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

  it("takes no size, because there is no size variant yet", () => {
    // Sizes are expected back, but as a proposal rather than as a quiet union
    // widening. This only has to police `Button.tsx` itself: TypeScript already
    // stops any *caller* passing a `size` the props type doesn't declare.
    expect(COMPONENT_SOURCE).not.toMatch(/^\s*size\??:/m)
    expect(COMPONENT_SOURCE).not.toMatch(/sizeClassNames|labelSize/)
  })
})
