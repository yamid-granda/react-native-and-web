import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "../../src/common/Button/Button"
import {
  ClassNameView,
  FillSwatch,
  InkSwatch,
  MissingSwatch,
  Note,
  Row,
  Sample,
  Sheet,
  Spec,
} from "./spec"

/**
 * §1 of the manual — the elevation ramp, the rationed accent, and the status
 * palette that replaces today's habit of painting errors in `brand`.
 *
 * The swatches resolve their colour from `tokens.css` at runtime rather than
 * repeating a hex, so a swatch cannot claim a value the palette does not have,
 * and switching the Storybook background to `dark` re-reads them. Use the
 * background toolbar at the top of the canvas to see both schemes: the ramp
 * raises elevation in opposite directions in each, which is the whole reason
 * dark mode is not a `dark:` variant away.
 */

const meta: Meta = {
  title: "Design System/Color",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const NeutralRamp: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Neutral ramp"
        status="shipped"
        hint="Six neutrals, ordered as an elevation ladder: each step has to be visible against the one below it, or nothing reads as raised. Light mode raises by going lighter; dark mode raises by going lighter off near-black, which is why elevation there is carried by fill and not shadow."
      >
        <Row>
          <FillSwatch token="background" className="bg-background" label="canvas" />
          <FillSwatch token="surface" className="bg-surface" label="card" />
          <FillSwatch token="surface-muted" className="bg-surface-muted" label="recessed" />
        </Row>
      </Spec>

      <Spec
        label="Text"
        status="shipped"
        hint="Drawn on bg-surface, which is the harder of the two neutrals to hold contrast against. muted is darker than zinc-500 in light mode on purpose: secondary text sits on the canvas, and zinc-500 on zinc-100 measures 4.40:1 — just under AA."
      >
        <Row>
          <InkSwatch token="foreground" className="text-foreground" label="foreground" />
          <InkSwatch token="muted" className="text-muted" label="muted" />
        </Row>
      </Spec>

      <Spec
        label="Two border weights"
        status="shipped"
        hint="border clears WCAG 1.4.11's 3:1 against both its neighbours and is for standalone actions. border-muted is the quiet field edge at roughly 1.7:1 — the weight of iOS's systemGray4 — and is a documented deviation, not an oversight. If a control has to clear 3:1, the fix is one class name away."
      >
        <Row>
          <FillSwatch token="border" className="bg-border" label="border" />
          <FillSwatch token="border-muted" className="bg-border-muted" label="border-muted" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Accent: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Brand is rationed"
        status="shipped"
        hint="One hue, four jobs: the price, the single primary CTA, the active nav icon, and a badge. A screen with brand on more than the price plus one CTA has lost its accent. Never a ramp, never an opacity ladder."
      >
        <Row className="items-center gap-3">
          <ClassNameView className="h-16 w-44 rounded-lg bg-brand" />
          <Row className="gap-2">
            <Button label="Add to cart" testId="color-primary" />
            <Button label="Cancel" variant="secondary" testId="color-secondary" />
          </Row>
        </Row>
        <Sample value="bg-brand · active:bg-brand-dark · w-5 min-w-5 rounded-full (badge) · text-brand font-bold (price)" />
      </Spec>

      <Spec
        label="Status palette"
        status="planned"
        hint="Three semantic tokens for the states the UI keeps having to express today. Errors are the reason this exists: there is no danger token in the palette, so every validation and server error is currently painted in brand blue — the same colour as the price and the primary CTA, on the one screen where the message must not be missed."
      >
        <Row>
          <MissingSwatch
            name="success"
            intended="#166534 / #4ade80"
            reason="In stock, order confirmed. Today the only way to say this is muted body text."
          />
          <MissingSwatch
            name="warning"
            intended="#b45309 / #fbbf24"
            reason="Low stock only, stock ≤ 5, and only when true."
          />
          <MissingSwatch
            name="danger"
            intended="#b91c1c / #f87171"
            reason="Out of stock, validation, server errors, destructive confirmation. Currently brand."
          />
        </Row>
        <Note>
          Adding them means <Sample value="tokens.css" /> → <Sample value="tailwind-preset.cjs" /> →
          guard test, in that order (§11). The ramp check and the dark-counterpart check in
          tokens.parity.test.ts cover new tokens automatically; the contrast floors need entries for
          the three pairs each one is drawn on.
        </Note>
      </Spec>

      <Spec
        label="Control finish is one decision"
        status="shipped"
        hint="A field and a secondary button share one border, one fill, and one label colour through the three control aliases, so the two can never drift apart. Mixing them — a field's border on a button, a button's fill on a field — is the failure this prevents."
      >
        <Row className="items-center gap-2">
          <Button label="Cancel" variant="secondary" testId="color-control-secondary" />
          <Sample value="border-control-border bg-control-bg text-control-text" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Prohibitions: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Never"
        status="shipped"
        hint="Each of these is either unrepresentable in this system or the reason a token exists. They are listed as specimens so the reason travels with the rule."
      >
        <Row className="gap-2">
          <Sample value="dark:bg-surface — dark mode flips in tokens.css, not per class" />
          <Sample value="text-[15px] — type sizes are roles, not numbers" />
          <Sample value="h-10 — controls are h-control, always" />
          <Sample value="rounded-2xl on a button — pills and near-squares only" />
          <Sample value="#2563eb in a component — brand is named, never restated" />
          <Sample value="bg-brand/10 text-brand on two CTAs — one primary per screen" />
        </Row>
      </Spec>

      <Spec
        label="The literals that are allowed"
        status="shipped"
        hint="Four, and no more. Everything else comes from a token."
      >
        <Row className="gap-2">
          <Sample value="bg-black/50 — drawer scrim" />
          <Sample value="bg-foreground/80 — badge over an image" />
          <Sample value="text-white — on a brand fill" />
          <Sample value="opacity-50 / 70 / 80 — de-emphasis and inert states" />
        </Row>
      </Spec>
    </Sheet>
  ),
}
