import type { Meta, StoryObj } from "@storybook/react"
import { Product } from "../../src/common/Product/Product"
import { Button } from "../../src/common/Button/Button"
import { CartIcon } from "../../src/icons/CartIcon/CartIcon"
import { HeartIcon } from "../../src/icons/HeartIcon/HeartIcon"
import { HomeIcon } from "../../src/icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../src/icons/MarketplaceIcon/MarketplaceIcon"
import { ClassNameText, ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §8 of the manual — the phone / tablet / desktop / wide ladder.
 *
 * Each frame below is a fixed-width mock of one rung, drawn side by side rather
 * than resized by the browser. That is deliberate: a Storybook canvas is a
 * desktop window, so a specimen that responded to its own viewport would only
 * ever show the wide rung and the other three would never be looked at.
 *
 * What changes between rungs is columns, containment, and rails. What does not
 * change is anything inside a card — the same `Product` renders in all four
 * frames below, at four different widths, without a single breakpoint class.
 */

const meta: Meta = {
  title: "Design System/Layout",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

const CARDS = [
  {
    id: "a",
    title: "Wireless Headphones",
    description: "Noise-cancelling, 30h battery.",
    price: 129.99,
    currency: "USD",
    stock: 10,
  },
  {
    id: "b",
    title: "Ceramic Pour-Over Set",
    description: "Stoneware, dishwasher safe.",
    price: 48,
    currency: "USD",
    stock: 4,
  },
  {
    id: "c",
    title: "Linen Apron",
    description: "Waxed, cross-back straps.",
    price: 64,
    currency: "USD",
    stock: 12,
  },
  {
    id: "d",
    title: "Cast Iron Skillet",
    description: "26cm, pre-seasoned.",
    price: 72,
    currency: "USD",
    stock: 0,
  },
  {
    id: "e",
    title: "Walnut Board",
    description: "Oil-finished, 40cm.",
    price: 58,
    currency: "USD",
    stock: 7,
  },
  {
    id: "f",
    title: "Enamel Mug",
    description: "350ml, dishwasher safe.",
    price: 22,
    currency: "USD",
    stock: 20,
  },
]

export const Catalogue: Story = {
  render: () => (
    <Sheet className="gap-8">
      <Spec
        label="The ladder"
        status="planned"
        hint="Every rung below is specified and none is built: no route in either app defines a container, no screen uses a breakpoint class, and the desktop filter rail does not exist. The cards are the real component — which is the whole claim of §8, that the inside never changes."
      >
        <Row className="items-start gap-6">
          <Rung
            name="Phone"
            range="<640px"
            container="px-6, full bleed"
            width={360}
            columns={2}
            detail="filters in a Drawer · 1-col detail + sticky buy bar · floating BottomNav"
          />
          <Rung
            name="Tablet"
            range="640–1024px"
            container="max-w-3xl mx-auto (768)"
            width={640}
            columns={3}
            detail="filters inline, flex-row flex-wrap gap-2 · floating BottomNav"
          />
          <Rung
            name="Desktop"
            range="1024–1280px"
            container="max-w-6xl mx-auto (1152)"
            width={900}
            columns={4}
            detail="left filter rail w-60 sticky top-6 · top header nav"
          />
          <Rung
            name="Wide"
            range="≥1280px"
            container="max-w-7xl mx-auto (1280)"
            width={1180}
            columns={5}
            detail="left filter rail w-60 sticky · top header nav"
          />
        </Row>
      </Spec>

      <Spec
        label="One column-count rule"
        status="planned"
        hint="Web derives it from a min card width; native derives it from window width and clamps to a two-column floor. The floor is the point: at 360px the current formula yields one column, which turns a two-across grid into a stack of wide cards and is the most visible way this catalogue is currently wrong on a phone."
      >
        <Sample value="CATALOGUE_MIN_CARD_WIDTH = 168 · web: grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4 · native: FlatList numColumns, clamped to ≥ 2" />
      </Spec>

      <Spec
        label="Never"
        status="shipped"
        hint="Named because two of the four shipped catalogue screens still do the second one."
      >
        <Row className="gap-2">
          <Sample value="flex-wrap + ScrollView for a catalogue — not virtualized, breaks on resize" />
          <Sample value="letting a 360px phone drop to one column" />
          <Sample value="a breakpoint class inside a shared component" />
          <Sample value="full-bleed content on desktop" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Detail: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Detail screen"
        status="planned"
        hint="Phone stacks and pins the buy bar to the bottom so the action is always reachable without scrolling back up. Tablet and wider go two-column with the buy box sticky beside the media — the media gets the room, and the price and the button stay in view while the shopper reads the description."
      >
        <Row className="items-start gap-6">
          <ClassNameView className="w-72 gap-3 rounded-lg border border-border bg-background p-4">
            <Sample value="phone · 1 column" />
            <ClassNameView className="h-48 w-full rounded-lg bg-surface-muted" />
            <ClassNameText className="text-2xl font-bold leading-8 text-foreground">
              Wireless Headphones
            </ClassNameText>
            <ClassNameText className="text-sm font-normal leading-5 text-muted">
              Sold by Northside Audio
            </ClassNameText>
            <ClassNameText className="text-xl font-bold leading-7 text-brand">
              $129.99
            </ClassNameText>
            <ClassNameView className="flex-row gap-2">
              <ClassNameView className="h-control flex-1 items-center justify-center rounded-lg bg-brand">
                <Sample value="Add to cart" />
              </ClassNameView>
            </ClassNameView>
            <Sample value="+ sticky bottom buy bar above pb-20" />
          </ClassNameView>

          <ClassNameView className="w-[520px] flex-row gap-6 rounded-lg border border-border bg-background p-4">
            <ClassNameView className="flex-1 gap-2">
              <Sample value="media — 1fr" />
              <ClassNameView className="h-64 w-full rounded-lg bg-surface-muted" />
              <ClassNameText className="max-w-[72ch] text-base font-normal leading-6 text-foreground">
                Over-ear, active noise cancelling, 30 hours on a charge.
              </ClassNameText>
            </ClassNameView>
            <ClassNameView className="w-80 gap-3">
              <Sample value="buy box — w-80 lg:w-96 sticky top-6" />
              <ClassNameText className="text-2xl font-bold leading-8 text-foreground">
                Wireless Headphones
              </ClassNameText>
              <ClassNameText className="text-xl font-bold leading-7 text-brand">
                $129.99
              </ClassNameText>
              <ClassNameView className="h-control items-center justify-center rounded-lg bg-brand">
                <Sample value="Add to cart" />
              </ClassNameView>
            </ClassNameView>
          </ClassNameView>
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const Navigation: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Floating nav, and the clearance it needs"
        status="planned"
        hint="The bar itself is shipped and identical on both platforms — one class constant, one offset helper, and native positioning behind an adapter. What is missing is `pb-20` on the mobile app: only the web layout reserves room for the bar today, so on a phone the last row of every screen sits underneath it."
      >
        <ClassNameView className="h-64 w-full gap-3 rounded-lg border border-border bg-background">
          <Sample value="pb-20 — content clearance under the floating nav" />
          <ClassNameView className="fixed inset-x-0 bottom-0 z-50 flex-row items-center border-t border-surface-muted bg-surface p-2">
            <ClassNameView className="flex-1" />
            <ClassNameView className="flex-row justify-center gap-1">
              <BottomNavItem icon={HomeIcon} title="Home" />
              <BottomNavItem icon={MarketplaceIcon} title="Marketplace" />
              <BottomNavItem icon={HeartIcon} title="Wishlist" badgeCount={2} />
              <BottomNavItem icon={CartIcon} title="Cart" badgeCount={1} />
            </ClassNameView>
          </ClassNameView>
        </ClassNameView>
        <Sample value="BOTTOM_NAV_BAR_CLASSNAME · getFloatingNavStyle(insets.bottom) → marginBottom 12 + insetBottom · content pb-20 on both apps" />
      </Spec>

      <Spec
        label="Header"
        status="shipped"
        hint="paddingTop is min(insets.top, 48) + 8 so a notch gets cleared and an unusually tall inset does not push the title off screen."
      >
        <Row className="items-center gap-3">
          <ClassNameText className="text-2xl font-bold leading-8 text-foreground">
            Marketplace
          </ClassNameText>
          <Sample value="gap-1 px-6 pb-3 md:px-8 · text-2xl font-bold leading-8" />
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const NarrowFirst: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Test 320px before 1280px"
        status="shipped"
        hint="320px is the narrowest viewport a mainstream browser supports and the floor for text scaling. If a layout only reads well on a phone-sized canvas it is broken, and the desktop rung is the one that hides the bug."
      >
        <Row className="items-start gap-3">
          <ClassNameView className="w-72 gap-2">
            <Sample value="320px" />
            <Button label="Add to cart" testId="layout-320" />
          </ClassNameView>
          <ClassNameView className="flex-row gap-2">
            <Button label="Cancel" variant="secondary" testId="layout-320-secondary" />
            <Button label="Buy" testId="layout-320-primary" />
          </ClassNameView>
          <Note>
            Two primaries side by side is the other half of this specimen: it is not a layout
            failure, it is §7 breaking. A 320px canvas is where a second CTA gets pushed onto its
            own row, which is exactly when someone adds one to fill the space.
          </Note>
        </Row>
      </Spec>
    </Sheet>
  ),
}

/** One rung of the §8 ladder: a fixed-width frame holding the real card at that column count. */
function Rung({
  name,
  range,
  container,
  columns,
  detail,
  width,
}: {
  name: string
  range: string
  container: string
  columns: number
  detail: string
  width: number
}) {
  return (
    <ClassNameView style={{ width }} className="gap-2">
      <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
        {name}
      </ClassNameText>
      <Sample value={range} />
      <ClassNameView className="gap-1 rounded-lg border border-border bg-surface p-3">
        <Sample value={container} />
        <ClassNameView
          className="flex-row flex-wrap"
          style={{ gap: 16 }}
          accessibilityLabel={`${columns}-column catalogue`}
        >
          {CARDS.slice(0, columns * 2).map((card) => (
            <ClassNameView key={card.id} style={{ width: `${100 / columns}%` }} className="gap-2">
              <Product {...card} />
            </ClassNameView>
          ))}
        </ClassNameView>
        <Sample value={`${columns} columns · gap-4`} />
      </ClassNameView>
      <Note>{detail}</Note>
    </ClassNameView>
  )
}

function BottomNavItem({
  icon: Icon,
  title,
  badgeCount,
}: {
  icon: typeof HomeIcon
  title: string
  badgeCount?: number
}) {
  return (
    <ClassNameView className="min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2">
      <ClassNameView className="relative">
        <Icon size={22} className="text-muted" />
        {badgeCount ? (
          <ClassNameView className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1">
            <ClassNameText className="text-xs font-bold text-white">{badgeCount}</ClassNameText>
          </ClassNameView>
        ) : null}
      </ClassNameView>
      <ClassNameText className="text-sm leading-5 text-muted">{title}</ClassNameText>
    </ClassNameView>
  )
}
