import type { Meta, StoryObj } from "@storybook/react"
import { ClassNameText, ClassNameView, MissingSwatch, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §4 of the manual — loading, empty, and error.
 *
 * Every one of these specimens is drawn from the primitives rather than from a
 * shipped component, and every one is marked planned. That is the point of the
 * section: today all three states across nine screens are a bare
 * `text-muted` string, with no icon, no panel, no skeleton, and no retry. The
 * error state in particular is unreachable by keyboard-only and by screen reader,
 * because a bare `<Text>` is neither focusable nor announced.
 */

const meta: Meta = {
  title: "Design System/States",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Order: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Error, then skeleton, then empty, then content"
        status="shipped"
        hint="The order is load-bearing and the same on every screen: a failed fetch must not render as an empty catalogue, and an empty catalogue must not render as a spinner that never resolves."
      >
        <Row className="gap-2">
          <Sample value="1 error" />
          <Sample value="2 loading" />
          <Sample value="3 empty" />
          <Sample value="4 content" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Loading: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Skeleton"
        status="planned"
        hint="Blocks that match the final layout's exact dimensions, so the grid's height is already correct and nothing jumps when the data lands. The pulse is web-only — a looping animation on a virtualized list is what makes a phone feel slow — and it stops under reduced motion."
      >
        <ClassNameView className="w-56 gap-2 rounded-lg bg-surface p-3 shadow-sm">
          <ClassNameView className="aspect-[4/3] w-full rounded-md bg-surface-muted" />
          <ClassNameView className="h-5 w-4/5 rounded-md bg-surface-muted" />
          <ClassNameView className="h-4 w-3/5 rounded-md bg-surface-muted" />
          <ClassNameView className="h-6 w-1/3 rounded-md bg-surface-muted" />
        </ClassNameView>
        <Sample value="bg-surface-muted rounded-md · dimensions equal the real card's · motion-safe:animate-pulse (web only)" />
        <Note>
          Shipped today as{" "}
          <Sample value="&lt;Text className=&quot;text-muted&quot;&gt;Loading products…&lt;/Text&gt;" />{" "}
          on nine screens.
        </Note>
      </Spec>
    </Sheet>
  ),
}

export const Empty: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="StatePanel"
        status="planned"
        hint="One panel shape for both empty and error: an optional 24px muted icon, a semibold title in foreground, a body line in muted, and exactly one secondary button that names the next step. An empty state with no action is a dead end — the shopper is told they have nothing and then nothing else."
      >
        <ClassNameView className="w-96 items-center gap-2 rounded-lg bg-surface p-6">
          <CartIconPlaceholder />
          <ClassNameText className="text-base font-semibold leading-6 text-foreground">
            Your cart is empty
          </ClassNameText>
          <ClassNameText className="text-sm font-normal leading-5 text-muted">
            Browse the marketplace and add something you like.
          </ClassNameText>
        </ClassNameView>
        <Sample value="items-center gap-2 rounded-lg bg-surface p-6 · text-base font-semibold leading-6 + text-sm leading-5 text-muted" />
      </Spec>

      <Spec
        label="The button names the next step"
        status="planned"
        hint="Not 'OK', not 'Dismiss'. 'Add your first product' on a seller's empty catalogue, 'Clear filters' on a filtered catalogue with no matches."
      >
        <Row className="gap-2">
          <Note>Add your first product</Note>
          <Note>Clear filters</Note>
          <Note>Start shopping</Note>
        </Row>
        <Sample value="variant=&quot;secondary&quot; · one per panel" />
      </Spec>
    </Sheet>
  ),
}

export const ErrorState: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="An error a shopper can act on"
        status="planned"
        hint="Same panel, danger title, message in muted, one 'Try again'. It has to be reachable and announced: accessibilityRole=&quot;alert&quot; plus a real button. Today every screen renders a bare `text-foreground` string with no retry, which means a failed fetch looks like an empty catalogue and is invisible to a screen reader."
      >
        <ClassNameView className="w-96 items-center gap-2 rounded-lg bg-surface p-6">
          <Note>We couldn’t load the marketplace.</Note>
          <ClassNameText className="text-sm font-normal leading-5 text-muted">
            Check your connection and try again.
          </ClassNameText>
        </ClassNameView>
        <Sample value="title in text-danger (planned) · body text-sm leading-5 text-muted · accessibilityRole=&quot;alert&quot;" />
        <Note>
          There is no danger token in the palette today, so this title is being rendered in
          foreground above — see Color → Status palette for the three missing tokens and what they
          cost.
        </Note>
      </Spec>

      <Spec
        label="Missing tokens, named"
        status="planned"
        hint="§9 requires error text to clear 4.5:1 on its actual background and §1 requires a danger colour to carry it. Neither exists yet, which is the whole of this specimen's point."
      >
        <Row>
          <MissingSwatch
            name="danger"
            intended="#b91c1c / #f87171"
            reason="Every error, validation message, and out-of-stock state on both platforms."
          />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Unavailable: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="An item that cannot be bought"
        status="shipped"
        hint="Distinct from both: the screen loaded, the list is real, and one entry in it is a problem. It gets a warning-coloured notice and a button that resolves it in one tap, above the summary — never a silent removal, because a cart that quietly drops an item is how a shopper loses trust in a basket total."
      >
        <ClassNameView className="w-96 gap-3">
          <Note>2 items are no longer available.</Note>
          <Row className="gap-2">
            <Note>Remove unavailable items</Note>
            <Sample value="secondary Button" />
          </Row>
        </ClassNameView>
        <Sample value="text-sm leading-5 text-warning (planned; text-muted today) + secondary Button" />
      </Spec>
    </Sheet>
  ),
}

export const Announcement: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Async results announce themselves"
        status="planned"
        hint="A live region on the result count and the pagination status, and role=alert on errors. Without it, a shopper who searched with a screen reader has no way of knowing the page below them changed."
      >
        <Sample value="accessibilityLiveRegion=&quot;polite&quot; on the result count · accessibilityRole=&quot;alert&quot; on errors" />
      </Spec>
    </Sheet>
  ),
}

/** The 24px muted icon slot from §4, drawn rather than imported so the panel shows its real size. */
function CartIconPlaceholder() {
  return (
    <ClassNameView className="h-6 w-6 items-center justify-center rounded-full bg-surface-muted">
      <Sample value="24" />
    </ClassNameView>
  )
}
