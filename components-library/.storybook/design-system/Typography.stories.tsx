import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "../../src/common/Button/Button"
import { Input } from "../../src/common/Input/Input"
import { ClassNameText, ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §2 of the manual — nine roles, each fixed to a size, a weight, and an explicit
 * line height.
 *
 * The line height is the part this section exists to make visible. Tailwind's
 * default leading differs per platform once react-native-web and RN's own
 * Text metrics are in play, so a size without one renders three different
 * heights for the same string. Every role below carries its own `leading-*`, and
 * the `ExplicitLeading` story exists to show what happens without one.
 *
 * There is one family — the system UI stack — so weight and size are the only
 * axes available. That is a deliberate trade: identical rendering and zero
 * layout shift on both platforms, at the cost of not having a display face.
 */

const meta: Meta = {
  title: "Design System/Typography",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Roles: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Display"
        status="shipped"
        hint="Home hero only — one per app. If a second screen wants it, the answer is a H1."
      >
        <ClassNameText className="text-3xl font-bold tracking-tight leading-9 text-foreground">
          Find it. Buy it. Done.
        </ClassNameText>
        <Sample value="text-3xl font-bold tracking-tight leading-9" />
      </Spec>

      <Spec
        label="H1"
        status="shipped"
        hint="The screen title and the product or store name. Exactly one per screen (§9) — the web wrapper is what makes it an actual <h1>."
      >
        <ClassNameText className="text-2xl font-bold leading-8 text-foreground">
          Wireless Headphones
        </ClassNameText>
        <Sample value="text-2xl font-bold leading-8" />
      </Spec>

      <Spec
        label="H2"
        status="planned"
        hint="Section titles and drawer titles. Present in the palette of roles but not yet used by any screen; ProductDetailScreenBase and CartScreen use text-lg for these instead."
      >
        <ClassNameText className="text-xl font-semibold leading-7 text-foreground">
          Added to cart
        </ClassNameText>
        <Sample value="text-xl font-semibold leading-7" />
      </Spec>

      <Spec
        label="Price large"
        status="shipped"
        hint="Cart and checkout totals only. Never a card price, never a detail price."
      >
        <Row className="items-center gap-4">
          <ClassNameText className="text-lg font-bold leading-7 text-brand">$284.97</ClassNameText>
          <Sample value="text-lg font-bold leading-7 text-brand" />
        </Row>
      </Spec>

      <Spec
        label="Body"
        status="planned"
        hint="Product descriptions and paragraphs. Not yet wrapped in the §8 prose measure."
      >
        <ClassNameText className="max-w-[72ch] text-base font-normal leading-6 text-foreground">
          Over-ear, active noise cancelling, 30 hours on a charge. The ear cups are memory foam and
          the headband folds flat, so it travels as well as it listens.
        </ClassNameText>
        <Sample value="text-base font-normal leading-6 + max-w-[72ch]" />
      </Spec>

      <Spec
        label="Body strong"
        status="shipped"
        hint="Button labels. The only place weight carries an action."
      >
        <Button label="Add to cart" testId="type-body-strong" />
        <Sample value="text-base font-semibold leading-6" />
      </Spec>

      <Spec
        label="Title"
        status="shipped"
        hint="Card and row titles, and the text inside an input."
      >
        <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
          Wireless Headphones
        </ClassNameText>
        <Sample value="text-sm font-semibold leading-5" />
      </Spec>

      <Spec
        label="Meta"
        status="shipped"
        hint="Subtitles, row descriptions, result counts, placeholders."
      >
        <ClassNameText className="text-sm font-normal leading-5 text-muted">
          Fresh finds from sellers near you · 128 results
        </ClassNameText>
        <Sample value="text-sm font-normal leading-5 text-muted" />
      </Spec>

      <Spec
        label="Label"
        status="shipped"
        hint="Field captions, badges, overlines. The only uppercase role."
      >
        <ClassNameText className="text-xs font-semibold uppercase tracking-wide leading-4 text-muted">
          Only 3 left
        </ClassNameText>
        <Sample value="text-xs font-semibold uppercase tracking-wide leading-4 text-muted" />
      </Spec>
    </Sheet>
  ),
}

export const InContext: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="The same roles, in a real screen"
        status="shipped"
        hint="Nothing here is a new combination: Title, Meta, Label, and the card price, in the order §6 fixes for the product card."
      >
        <ClassNameView className="w-72 gap-2 rounded-lg bg-surface p-3 shadow-sm">
          <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
            Wireless Headphones
          </ClassNameText>
          <ClassNameText className="text-xs leading-4 text-muted">
            Noise-cancelling over-ear headphones with 30h battery life.
          </ClassNameText>
          <ClassNameText className="text-base font-bold leading-6 text-brand">
            $129.99
          </ClassNameText>
        </ClassNameView>
        <Sample value="SCREEN_CARD_CLASSNAME · text-sm font-semibold leading-5 · text-xs leading-4 text-muted · text-base font-bold leading-6 text-brand" />
      </Spec>

      <Spec
        label="Form"
        status="shipped"
        hint="Label above, Title inside, Meta as placeholder — the three text roles a field uses."
      >
        <ClassNameView className="w-72 gap-1">
          <ClassNameText className="text-xs font-semibold uppercase tracking-wide leading-4 text-muted">
            Price
          </ClassNameText>
          <Input
            inputTestID="type-price"
            value=""
            onChangeText={() => {}}
            placeholder="0.00"
            accessibilityLabel="Price"
          />
        </ClassNameView>
        <Sample value="FormField → gap-1 + Label + Input(text-sm leading-5 text-control-text placeholder:text-muted)" />
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
        hint="Sizes are roles, not numbers, and a size without a line height is the most common cross-platform type bug."
      >
        <Row className="gap-2">
          <Sample value="text-[15px] — no arbitrary sizes" />
          <Sample value="font-medium / font-black — semibold or bold only" />
          <Sample value="text-base without leading-6 — Android and web disagree" />
          <Sample value="a bigger title on tablet — roles do not respond to breakpoints" />
          <Sample value="line-through on the price — strikethrough is text-muted, sale price is text-brand" />
        </Row>
      </Spec>
      <Note>
        Weights available: 400 (normal), 600 (semibold), 700 (bold). Three is enough for nine roles,
        because size already separates them.
      </Note>
    </Sheet>
  ),
}
