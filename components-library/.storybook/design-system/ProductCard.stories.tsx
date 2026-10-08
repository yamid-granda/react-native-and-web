import type { Meta, StoryObj } from "@storybook/react"
import { Product } from "../../src/common/Product/Product"
import { ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §6 of the manual — the product card, which is the conversion unit and the one
 * component whose inside may never change per screen, breakpoint, or platform.
 *
 * These specimens render the real `Product`, so what is on screen is what ships.
 * Where §6 specifies something the component does not do yet, the specimen shows
 * the target and says so rather than quietly displaying today's behaviour as if
 * it were the rule.
 */

const PRODUCT = {
  id: "design-system-headphones",
  title: "Wireless Headphones",
  description: "Noise-cancelling over-ear headphones with 30h battery life.",
  price: 129.99,
  currency: "USD",
  stock: 10,
  imageUrl: "https://picsum.photos/seed/headphones/480/360",
}

const meta: Meta = {
  title: "Design System/Product Card",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Anatomy: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Order is fixed"
        status="shipped"
        hint="Image, then title, then description, then price. Never reordered, never restyled per screen. The order is the argument: the photo answers what it is, the title names it, the description qualifies it, and the price closes."
      >
        <Row className="items-start">
          <ClassNameView className="w-56">
            <Product {...PRODUCT} />
          </ClassNameView>
          <ClassNameView className="max-w-[72ch] flex-1 gap-2">
            <Sample value="image — w-full rounded-md bg-surface-muted, aspect-[4/3], cover, accessibilityLabel, web width/height" />
            <Sample value="badge — absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-1 text-xs font-semibold uppercase text-white" />
            <Sample value="title — text-sm font-semibold leading-5 text-foreground, clamped 2 lines" />
            <Sample value="description — text-xs leading-4 text-muted, clamped 2 lines, ≤ ~60 chars" />
            <Sample value="price — text-base font-bold leading-6 text-brand" />
            <Sample value="cta row — one primary Button + icon-only wishlist" />
          </ClassNameView>
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const MissingImage: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="No image is a state, not an omission"
        status="planned"
        hint="The image wrapper is `bg-surface-muted` precisely so there is always something to fill it. Today the wrapper is only rendered when there is a URL, so a product without a photo gets no surface at all and the card is shorter than its neighbours. Specified: always render the wrapper, fill it with surface-muted, never a broken icon."
      >
        <Row className="items-start gap-3">
          <ClassNameView className="w-56">
            <Product {...PRODUCT} imageUrl={undefined} />
          </ClassNameView>
          <ClassNameView className="w-56 gap-1">
            <ClassNameView className="aspect-[4/3] w-full rounded-md bg-surface-muted" />
            <Sample value="target — always render the wrapper" />
          </ClassNameView>
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const OutOfStock: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Out of stock"
        status="shipped"
        hint="The badge is a fact about the product, not a promotion, so it sits over the image in foreground/80 and the whole card drops to 70% — the item is still browsable, it just cannot be bought. The detail screen is where the buy button dies, and it dies with a label."
      >
        <Row className="items-start">
          <ClassNameView className="w-56">
            <Product {...PRODUCT} stock={0} />
          </ClassNameView>
        </Row>
        <Sample value="opacity-70 on the card · badge bg-foreground/80 px-2 py-1 · primary CTA disabled and relabelled &quot;Out of stock&quot;" />
      </Spec>
    </Sheet>
  ),
}

export const LowStock: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Only N left"
        status="planned"
        hint="Honest scarcity, and the only scarcity the system allows: stock ≤ 5 and true. The manual sets the threshold at 5, which is what ProductDetailScreenBase already uses. No countdowns, no viewers counter, no 'X people are looking'."
      >
        <Row className="items-start gap-3">
          <ClassNameView className="w-56">
            <Product {...PRODUCT} stock={3} />
          </ClassNameView>
          <ClassNameView className="w-56 gap-1 rounded-lg bg-surface p-3">
            <Note>Target: the badge becomes &quot;Only 3 left&quot; in text-warning.</Note>
            <Sample value="LOW_STOCK_THRESHOLD = 5" />
          </ClassNameView>
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const CardActionRow: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="The CTA row"
        status="planned"
        hint="One primary action and an icon-only wishlist, side by side. The wishlist never competes — same height as the control token, muted unless filled, no text. Specified and not yet built: the toggle was removed from the card when the marketplace surface changed, and §6 puts it back as a secondary action rather than a peer of the buy button."
      >
        <ClassNameView className="w-56 gap-2 rounded-lg bg-surface p-3 shadow-sm">
          <ClassNameView className="aspect-[4/3] w-full rounded-md bg-surface-muted" />
          <Note className="text-foreground">Wireless Headphones</Note>
          <Note>Noise-cancelling over-ear headphones.</Note>
          <Row className="gap-2">
            <ClassNameView className="h-control flex-1 items-center justify-center rounded-lg bg-brand px-4">
              <Sample value="Add to cart" />
            </ClassNameView>
            <ClassNameView className="h-control w-control items-center justify-center rounded-lg border border-control-border bg-control-bg" />
          </Row>
        </ClassNameView>
        <Sample value="primary Button + w-control icon-only wishlist · gap-2 · h-control both" />
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
        hint="Each one has been shipped at some point, or is the kind of thing a designer will ask for by Friday."
      >
        <Row className="gap-2">
          <Sample value="a muted price — the price is the one thing in brand" />
          <Sample value="a description longer than ~60 chars on a card" />
          <Sample value="two primary CTAs on one card" />
          <Sample value="reordering the card's contents per screen" />
          <Sample value="a broken-icon placeholder for a missing photo" />
          <Sample value="a card internals change at md: or lg:" />
        </Row>
      </Spec>
    </Sheet>
  ),
}
