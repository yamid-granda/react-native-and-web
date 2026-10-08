import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "../../src/common/Button/Button"
import { HeartIcon } from "../../src/icons/HeartIcon/HeartIcon"
import { CartIcon } from "../../src/icons/CartIcon/CartIcon"
import { ClassNameText, ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §7 of the manual — the rules that make money.
 *
 * Everything here is a claim about behaviour, not about colour, so each specimen
 * is a small mock of the arrangement the rule describes rather than a render of
 * a shipped screen. The price, the stock ladder, the trust row, and the flow
 * order are the four that move revenue; the rest is friction removal.
 */

const meta: Meta = {
  title: "Design System/Marketplace",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Price: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Price is never muted and never below the title"
        status="shipped"
        hint="Currency travels with the number. If the card price is `text-base font-bold text-brand`, the detail price is one step up at `text-xl`, and a cart total is `text-lg font-bold leading-7 text-brand` — the three steps are a scale, not three arbitrary sizes."
      >
        <Row className="items-end gap-8">
          <ClassNameView className="gap-1">
            <ClassNameText className="text-base font-bold leading-6 text-brand">
              $129.99
            </ClassNameText>
            <Sample value="card — text-base font-bold leading-6" />
          </ClassNameView>
          <ClassNameView className="gap-1">
            <ClassNameText className="text-xl font-bold leading-7 text-brand">
              $129.99
            </ClassNameText>
            <Sample value="detail — text-xl font-bold leading-7" />
          </ClassNameView>
          <ClassNameView className="gap-1">
            <ClassNameText className="text-lg font-bold leading-7 text-brand">
              $284.97
            </ClassNameText>
            <Sample value="total — text-lg font-bold leading-7" />
          </ClassNameView>
        </Row>
      </Spec>

      <Spec
        label="A discount says both numbers and the saving"
        status="planned"
        hint="Only when the discount is real. Original struck through in muted, sale price in brand, saving as a percentage rather than an amount — a percentage is comparable between products, an amount is not."
      >
        <Row className="items-center gap-3">
          <ClassNameText className="text-sm leading-5 text-muted line-through">
            $189.99
          </ClassNameText>
          <ClassNameText className="text-base font-bold leading-6 text-brand">
            $129.99
          </ClassNameText>
          <ClassNameText className="text-xs font-semibold uppercase tracking-wide leading-4 text-muted">
            Save 32%
          </ClassNameText>
        </Row>
        <Note>
          A `line-through` price is not in the JSON-LD `Offer`; when a product carries one, the
          structured data needs a second price so the crawler and the screen agree.
        </Note>
      </Spec>

      <Spec
        label="Never make the buyer compute"
        status="shipped"
        hint="Per-unit price is what a shopper compares. '3 for $24' is worse than '$8 each', because the second one is already the answer."
      >
        <Row className="items-center gap-3">
          <ClassNameText className="text-base font-bold leading-6 text-brand">
            $8.00 each
          </ClassNameText>
          <Note>3 for $24</Note>
        </Row>
        <Sample value="text-base font-bold leading-6 text-brand + text-sm leading-5 text-muted" />
      </Spec>
    </Sheet>
  ),
}

export const StockLadder: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Three states, and no fourth"
        status="planned"
        hint="Every rung needs a status token (§1) and an icon or fill as well as a colour (§9), because the difference between 'only 3 left' and 'in stock' is exactly the kind of thing that disappears for a colourblind reader or in a greyscale screenshot of a competitor analysis."
      >
        <Row className="items-stretch gap-3">
          {[
            [
              "In stock",
              "success",
              "Ready to ship. The default state, and the one that says nothing alarming.",
            ],
            [
              "Only 3 left",
              "warning",
              "Only when stock ≤ 5 and it is true. This is the only scarcity the system permits.",
            ],
            [
              "Out of stock",
              "danger",
              "The primary CTA is disabled and relabelled — never a dead button with an unchanged label.",
            ],
          ].map(([state, token, why]) => (
            <ClassNameView key={state} className="w-64 gap-2 rounded-lg bg-surface p-3">
              <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
                {state}
              </ClassNameText>
              <Sample value={`text-${token} (planned)`} />
              <Note>{why}</Note>
              <Button
                label={state === "Out of stock" ? "Out of stock" : "Add to cart"}
                disabled={state === "Out of stock"}
                testId={`marketplace-stock-${token}`}
              />
            </ClassNameView>
          ))}
        </Row>
        <Note>
          <b>Never</b>: a countdown timer, a &quot;N people are viewing&quot; counter, or any
          scarcity the database does not support. The manual rules them out because faked urgency is
          the fastest way to lose a marketplace, and it is the one thing here a user cannot verify.
        </Note>
      </Spec>
    </Sheet>
  ),
}

export const OnePrimaryAction: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Add to cart, on every surface"
        status="shipped"
        hint="The same label for the same action everywhere — card, buy box, sticky bar. 'Buy now' is not a synonym here: it implies a different commitment, and a shopper who sees two names for one button has to read both."
      >
        <Row className="gap-3">
          <Button label="Add to cart" testId="marketplace-add" />
          <Button label="Add to wishlist" variant="secondary" testId="marketplace-wish">
            <HeartIcon size={18} className="text-muted" />
          </Button>
        </Row>
        <Sample value="one primary + one icon-only secondary · gap-2 · both h-control" />
      </Spec>

      <Spec
        label="Confirmation is instant"
        status="planned"
        hint="The cart badge increments and the label returns within a second. A shopper who taps add to cart and sees nothing happen assumes it failed and either taps again or leaves."
      >
        <Row className="gap-3">
          <Button label="Add to cart" testId="marketplace-confirm" />
          <ClassNameView className="h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1">
            <ClassNameText className="text-xs font-bold text-white">1</ClassNameText>
          </ClassNameView>
          <Sample value="h-5 min-w-5 rounded-full bg-brand text-xs font-bold text-white" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Trust: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Seller, then rating, then stock — in that order"
        status="planned"
        hint="A fixed order on the detail screen, because the sequence is the argument: who is selling this, what do other buyers think, and can I get it. Reassurance sits next to the price, not in a footer."
      >
        <ClassNameView className="w-80 gap-3 rounded-lg bg-surface p-3">
          <ClassNameText className="text-base font-semibold leading-6 text-foreground">
            Wireless Headphones
          </ClassNameText>
          <Row className="items-center gap-2">
            <Note>Sold by Northside Audio</Note>
            <Sample value="text-sm leading-5 text-muted" />
            <Sample value="★★★★★ 4.8 (1,247)" />
            <Sample value="In stock · success" />
          </Row>
        </ClassNameView>
        <Note>
          Ratings are not in the model yet, so the second element is a placeholder in this specimen.
          When they land, §7 requires them on the detail screen and in the JSON-LD, and not on
          cards.
        </Note>
      </Spec>

      <Spec
        label="One to three signals, never seven"
        status="shipped"
        hint="Reassurance stops being reassurance when there is enough of it to look desperate. Two signals placed where the buyer hesitates beat a wall of badges."
      >
        <Row className="gap-2">
          <ClassNameView className="rounded-full bg-surface-muted px-2 py-1">
            <Note>Free returns within 30 days</Note>
          </ClassNameView>
          <ClassNameView className="rounded-full bg-surface-muted px-2 py-1">
            <Note>Ships in 2–3 days</Note>
          </ClassNameView>
        </Row>
        <Sample value="rounded-full bg-surface-muted px-2 py-1 + text-sm leading-5 text-muted" />
      </Spec>
    </Sheet>
  ),
}

export const FlowOrder: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Cart and checkout read in one order"
        status="shipped"
        hint="Unavailable items first, because they are the only thing in the list that needs a decision. Then the items, then the summary, then the total, then the action — so the last thing on screen before the tap is the number being charged."
      >
        <ClassNameView className="w-96 gap-3">
          <Row className="items-center gap-2">
            <Sample value="text-sm leading-5 text-warning (planned)" />
            <Button
              label="Remove unavailable items"
              variant="secondary"
              testId="marketplace-remove"
            />
          </Row>

          <ClassNameView className="flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3">
            <ClassNameView className="flex-1 gap-1">
              <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
                Wireless Headphones
              </ClassNameText>
              <ClassNameText className="text-xs leading-4 text-muted">$129.99 each</ClassNameText>
            </ClassNameView>
            <Row className="items-center gap-2">
              <CartIcon size={18} className="text-muted" />
              <Sample value="2" />
            </Row>
          </ClassNameView>

          <ClassNameView className="flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3">
            <ClassNameView className="flex-1 gap-1">
              <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
                Subtotal
              </ClassNameText>
              <ClassNameText className="text-xs leading-4 text-muted">
                Shipping · Free
              </ClassNameText>
            </ClassNameView>
            <ClassNameText className="text-lg font-bold leading-7 text-brand">
              $259.98
            </ClassNameText>
          </ClassNameView>

          <Button label="Checkout" testId="marketplace-checkout" />
        </ClassNameView>
        <Sample value="SCREEN_ROW_CLASSNAME · text-lg font-bold leading-7 text-brand as the last thing before the CTA" />
      </Spec>

      <Spec
        label="Zero friction"
        status="shipped"
        hint="Quantity starts at 1, checkout is three steps or fewer, no account is forced, and nothing appears as a fee at the last step. These are constraints on the flow, not on the CSS — but they are the reason the summary row above says Shipping · Free rather than leaving it to be discovered."
      >
        <Row className="gap-2">
          <Sample value="quantity defaults to 1" />
          <Sample value="≤ 3 checkout steps" />
          <Sample value="guest checkout" />
          <Sample value="no fee revealed at the last step" />
        </Row>
      </Spec>
    </Sheet>
  ),
}
