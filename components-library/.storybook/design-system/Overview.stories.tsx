import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "../../src/common/Button/Button"
import { Row, Sheet, Spec, Note, Heading, Sample, StatusBadge } from "./spec"

/**
 * The `Design System` section's front page.
 *
 * `docs/system-design/index.md` is the authority; this section is its specimen.
 * Each entry below is one section of the manual, and each story in this section
 * exists to make one rule of it visible rather than to be read — a specimen that
 * only restated the prose would be a second copy to keep in sync.
 *
 * Read a story by reading the `Sample` under each block: that is the exact class
 * string the sample was built from, so the screen and the manual cannot disagree
 * without the disagreement being visible.
 */

const meta: Meta = {
  title: "Design System/Overview",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Principles: Story = {
  render: () => (
    <Sheet className="gap-8">
      <Heading>Visual Manual</Heading>
      <Note>
        Binding for every agent and developer. Read before writing, changing, or reviewing any UI.
        Where a component disagrees with the manual, the manual wins and the component is fixed in
        the same change. Values live in <Sample value="components-library/tokens.css" /> and{" "}
        <Sample value="components-library/tailwind-preset.cjs" /> — never in a component.
      </Note>

      <Spec label="Recognition over recall" status="shipped">
        <Note>
          Price, stock, primary action, and image answer the buyer's question without a tap. The
          card and the detail screen are built so no single one of them is behind a control.
        </Note>
      </Spec>

      <Spec label="One primary action per screen" status="shipped">
        <Note>
          Two equally loud things means there is no call to action. Brand is rationed to the price,
          one <Sample value="bg-brand" /> fill, the active nav icon, and badges — nothing else.
        </Note>
        <Row>
          <Button label="Add to cart" testId="overview-primary" />
          <Button label="Wishlist" variant="secondary" testId="overview-secondary" />
        </Row>
      </Spec>

      <Spec label="Shared view" status="shipped">
        <Note>
          Phone, web-mobile, tablet, and desktop render the same component tree. Breakpoints add
          columns, containment, and rails in app wrappers — never component internals. See Layout.
        </Note>
      </Spec>

      <Spec label="Accessible by default" status="shipped">
        <Note>
          Contrast floors, 44px targets, and the elevation ramp are asserted by{" "}
          <Sample value="components-library/src/tokens.parity.test.ts" />. Heading order, focus
          rings, live regions, and reduced motion are specified and not yet built. See
          Accessibility.
        </Note>
      </Spec>

      <Spec label="Honest urgency" status="shipped">
        <Note>
          Real stock, real prices, real seller names. No invented countdowns, no fake viewers. Faked
          urgency is the fastest way to lose a marketplace. See Marketplace.
        </Note>
      </Spec>

      <Spec label="Kill patterns more than you add" status="shipped">
        <Note>
          A new color, type size, spacing value, radius, control variant, or elevation step is an{" "}
          <Sample value="improve-proposals/" /> entry with a reason, agreed before implementation.
        </Note>
      </Spec>
    </Sheet>
  ),
}

export const SectionMap: Story = {
  render: () => (
    <Sheet className="gap-6">
      <Heading>Sections</Heading>
      <Note>Each entry links the manual to the story that demonstrates it.</Note>
      <Row className="gap-2">
        {[
          ["Color", "§1 tokens, status palette, brand rationing"],
          ["Typography", "§2 the nine type roles"],
          ["Spacing and Shape", "§3 spacing, radii, elevation, motion"],
          ["Controls", "§5 Button, Input, FormField, icon-only"],
          ["Product Card", "§6 the conversion unit"],
          ["Marketplace", "§7 the rules that make money"],
          ["States", "§4 loading, empty, error"],
          ["Layout", "§8 phone / tablet / desktop / wide"],
          ["Accessibility", "§9 the floors that are not negotiable"],
        ].map(([name, covers]) => (
          <Sheet key={name} className="w-64 gap-1 rounded-lg border border-border bg-surface p-3">
            <StatusBadge status="shipped" />
            <Sample value={name ?? ""} />
            <Note>{covers}</Note>
          </Sheet>
        ))}
      </Row>
    </Sheet>
  ),
}

export const ShippedVersusPlanned: Story = {
  render: () => (
    <Sheet className="gap-6">
      <Heading>Shipped and planned</Heading>
      <Note>
        Every specimen carries one of these badges. A rule marked <b>planned</b> is specified in the
        manual and not yet built — the sample shows what it will look like, and the class string
        under it is the one that has to land. This is the section's honest inventory; a specimen
        that rendered planned rules as though they worked would be the worst kind of documentation.
      </Note>
      <Row className="items-center gap-3">
        <StatusBadge status="shipped" />
        <Note>Implemented today, and asserted by the guard tests where a value can drift.</Note>
      </Row>
      <Row className="items-center gap-3">
        <StatusBadge status="planned" />
        <Note>Specified, not built. Drawn so the target is unambiguous.</Note>
      </Row>
    </Sheet>
  ),
}
