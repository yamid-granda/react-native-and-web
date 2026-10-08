import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "../../src/common/Button/Button"
import { FormField } from "../../src/common/FormField/FormField"
import { HeartIcon } from "../../src/icons/HeartIcon/HeartIcon"
import { ClassNameText, ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §9 of the manual — the floors that are not negotiable.
 *
 * This section separates what the guard tests already hold from what is written
 * down but unenforced. The first two stories are the shipped half: contrast and
 * elevation, asserted against the palette in `tokens.parity.test.ts` on every
 * test run, so they cannot regress without a red build. Everything below that is
 * specified and has no test behind it, which is stated per specimen rather than
 * left for a reviewer to discover.
 */

const meta: Meta = {
  title: "Design System/Accessibility",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Contrast: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Enforced by the guard test"
        status="shipped"
        hint="tokens.parity.test.ts computes WCAG relative luminance for every pair the UI actually puts together, in both schemes, and fails the build if any drops below its floor. These are numbers, not opinions — the reason --color-border exists is that this test caught every field in the app at 1.10:1."
      >
        <Row className="gap-2">
          <Sample value="text ≥ 4.5:1 on its actual background — foreground, muted, all three neutrals" />
          <Sample value="UI boundaries ≥ 3:1 — border on surface and on background (1.4.11)" />
          <Sample value="each neutral step ≥ 1.08:1 off the one below it — not a WCAG criterion, but the ramp is what regressed" />
        </Row>
      </Spec>

      <Spec
        label="The one documented deviation"
        status="shipped"
        hint="A field edge sits at roughly 1.7:1, the weight of iOS's systemGray4, and does not satisfy 1.4.11. It is deliberate: a cage of 3.4:1 borders on every field reads heavier than the cards it sits on, and Material's outlined field is in the same range. The test asserts the deviation instead of ignoring it, and the fix is one class name away if a field ever has to clear 3:1."
      >
        <Sample value="border-muted → border-control-border · 1.7:1 by design · tokens.parity.test.ts names it" />
      </Spec>
    </Sheet>
  ),
}

export const TouchTargets: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="44px, everywhere, including icons"
        status="shipped"
        hint="h-control is 2.75rem — 44px — and every Button and Input is that height. The part that is easy to lose is the icon button: a 20px heart inside a Pressable is a 20px target unless the control is given the same token, which is why w-control exists."
      >
        <Row className="items-end gap-3">
          <Button label="Add to cart" testId="a11y-target-primary" />
          <Button label="Add to wishlist" variant="secondary" testId="a11y-target-icon">
            <HeartIcon size={18} className="text-muted" />
          </Button>
        </Row>
        <Sample value="h-control · w-control for icon-only · 44×44 floor" />
      </Spec>
    </Sheet>
  ),
}

export const Focus: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Visible focus, always"
        status="planned"
        hint="A keyboard user has to be able to see where they are on a screen full of surfaces. Every interactive element gets focus-visible:ring-2 ring-brand, and outline is never removed without a replacement. Nothing in the library sets a focus ring today, and Input's outline-none has nothing standing in for it."
      >
        <Row className="gap-3">
          <Button
            label="Add to cart"
            testId="a11y-focus"
            className="focus-visible:ring-2 ring-brand"
          />
        </Row>
        <Sample value="focus-visible:ring-2 ring-brand · never outline-none without a replacement" />
        <Note>
          Tab to the button on the canvas to see it. The ring is on the specimen rather than in the
          component, which is exactly the gap this story is reporting.
        </Note>
      </Spec>
    </Sheet>
  ),
}

export const Headings: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Exactly one H1 per screen"
        status="planned"
        hint="Screen titles and product names are the document outline a screen reader navigates by. No component sets accessibilityRole=&quot;heading&quot; today, so on web the detail page is a wall of divs — ProductDetailScreenWithSemantics wraps it in <article> and its comment claims an <h1> that is not actually rendered."
      >
        <ClassNameView className="w-96 gap-2">
          <ClassNameText
            className="text-2xl font-bold leading-8 text-foreground"
            accessibilityRole="header"
          >
            Wireless Headphones
          </ClassNameText>
          <ClassNameText
            className="text-xl font-semibold leading-7 text-foreground"
            accessibilityRole="header"
          >
            Specifications
          </ClassNameText>
        </ClassNameView>
        <Sample value="accessibilityRole=&quot;header&quot; on H1 and H2 · one H1 per screen" />
      </Spec>
    </Sheet>
  ),
}

export const ColourIsNeverAlone: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Say it twice"
        status="shipped"
        hint="An out-of-stock card carries a badge, not just a dimmer price. A wishlist toggle is filled as well as tinted. A selection is primary as well as announced. The colour is the third signal, never the first."
      >
        <Row className="items-center gap-6">
          <Button label="Add to wishlist" variant="secondary" testId="a11y-signal-off">
            <HeartIcon size={18} className="text-muted" />
          </Button>
          <Button label="Remove from wishlist" variant="secondary" testId="a11y-signal-on">
            <HeartIcon size={18} filled className="text-brand" />
          </Button>
          <Note>Wishlist · off / on</Note>
        </Row>
        <Sample value="HeartIcon filled + text-brand · badge text next to any status colour" />
      </Spec>
    </Sheet>
  ),
}

export const Names: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="An accessible name is not a test id"
        status="shipped"
        hint="A caption and the field's name come from one string through FormField, because React Native has no label/for and a caption that labels itself leaves the input the user is typing into with no name at all. SearchInput is the one deliberate exception: a magnifier is the caption, so the name is supplied rather than derived."
      >
        <ClassNameView className="w-72 gap-4">
          <FormField
            label="Price"
            inputTestID="a11y-name-price"
            value=""
            onChangeText={() => {}}
            placeholder="0.00"
          />
        </ClassNameView>
        <Sample value="accessibilityLabel={label} on the TextInput · never derived from testId" />
      </Spec>
    </Sheet>
  ),
}

export const Drawers: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="A modal has to behave like one"
        status="planned"
        hint="The drawer closes on Escape, traps focus on web, and hides its scrim from the accessibility tree — an overlay that still reads out as a focusable element is worse than no focus management, because it looks handled. The scrim's importantForAccessibility is not set today."
      >
        <Sample value="Escape closes · focus trapped on web · scrim accessibilityElementsHidden + importantForAccessibility=&quot;no-hide-descendants&quot;" />
      </Spec>
    </Sheet>
  ),
}

export const ZoomAndScale: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="200% zoom, 320px, max OS text scale"
        status="shipped"
        hint="Nothing may clip or overlap at any of the three. This is the reason control heights are a single token and prose is capped at 72ch: both are fixed-size assumptions that break the moment a user scales text."
      >
        <Row className="gap-2">
          <Sample value="200% browser zoom — no horizontal scroll, no overlap" />
          <Sample value="320px viewport — the narrowest mainstream browser supports" />
          <Sample value="max OS text scale on native — layout must reflow, not clip" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Untested: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Specified, unenforced"
        status="planned"
        hint="The honest inventory. Contrast and elevation have a guard test. Nothing below does, which means each is a review-time habit rather than something the build enforces — the reason the next story in the manual's §11 exists."
      >
        <Row className="gap-2">
          <Sample value="heading order" />
          <Sample value="focus rings" />
          <Sample value="live regions and alert roles" />
          <Sample value="reduced-motion gating" />
          <Sample value="drawer focus trapping" />
          <Sample value="colour-never-alone on status states" />
        </Row>
        <Note>
          The pattern to copy is tokens.parity.test.ts: a rule that is written down and measured at
          test time stops being a rule that has to be remembered.
        </Note>
      </Spec>
    </Sheet>
  ),
}
