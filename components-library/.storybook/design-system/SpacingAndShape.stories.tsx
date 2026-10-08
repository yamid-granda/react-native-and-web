import type { Meta, StoryObj } from "@storybook/react"
import { Button } from "../../src/common/Button/Button"
import { Input } from "../../src/common/Input/Input"
import { ClassNameText, ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §3 of the manual — the 4px spacing scale, the five radii, the two elevation
 * steps, one control height, and three motion durations.
 *
 * The shells are the part worth reading. `SCREEN_SHELL_CLASSNAME` and friends are
 * named in §3 but not yet exported, so every screen still restates its own
 * strings — which is exactly the drift the constants exist to stop, and the
 * reason those specimens are marked planned rather than shipped.
 */

const meta: Meta = {
  title: "Design System/Spacing and Shape",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const SpacingScale: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="4px base, six values"
        status="shipped"
        hint="A gap is a relationship between two things, so the scale is read as rhythm: 4 and 8 for things inside a thing, 12 for a row, 16 between sections, 24 and 32 for air around a hero or a sheet."
      >
        <Row className="items-end gap-3">
          {[
            ["gap-1", "4", "tight text stacks"],
            ["gap-2", "8", "card internals, steppers"],
            ["gap-3", "12", "rows, filter groups"],
            ["gap-4", "16", "sections, grid gap"],
            ["gap-6", "24", "hero, sheet padding"],
            ["gap-8", "32", "hero"],
          ].map(([utility, px, use]) => (
            <ClassNameView key={utility} className="w-28 gap-2">
              <ClassNameView
                style={{ height: Number(px) }}
                className="w-full rounded-sm bg-brand"
              />
              <Sample value={utility ?? ""} />
              <Note>{use}</Note>
            </ClassNameView>
          ))}
        </Row>
        <Sample value="gap-1 · gap-2 · gap-3 · gap-4 · gap-6 · gap-8 — no gap-5, no gap-10, no [Npx]" />
      </Spec>

      <Spec
        label="One control height"
        status="shipped"
        hint="h-control is 2.75rem — 44px, the smallest comfortable touch target in both the iOS HIG and WCAG. Every Button and Input is this height, and nothing anywhere else may name a height for a control."
      >
        <Row className="items-end gap-3">
          <Button label="Add to cart" testId="shape-control-primary" />
          <Input
            inputTestID="shape-control-input"
            value=""
            onChangeText={() => {}}
            accessibilityLabel="Example input"
          />
        </Row>
        <Sample value="h-control items-center justify-center px-4 · w-control for a square icon button" />
      </Spec>
    </Sheet>
  ),
}

export const Shapes: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Five radii"
        status="shipped"
        hint="A radius says what kind of thing this is: an image or an icon is tighter than a card, a sheet is looser still, and only badges and avatars close all the way."
      >
        <Row className="gap-3">
          {[
            ["rounded-md", "6", "images, icons"],
            ["rounded-lg", "8", "cards, inputs, buttons, rows"],
            ["rounded-xl", "12", "nav items, chips"],
            ["rounded-2xl", "16", "dialogs, bottom sheets"],
            ["rounded-full", "—", "badges, pills, avatars"],
          ].map(([utility, px, use]) => (
            <ClassNameView key={utility} className="w-32 gap-2">
              <ClassNameView
                className={`h-14 w-full border border-border bg-surface-muted ${utility}`}
              />
              <Sample value={utility ?? ""} />
              <Note>{`${px}px · ${use}`}</Note>
            </ClassNameView>
          ))}
        </Row>
      </Spec>

      <Spec
        label="Two elevation steps"
        status="shipped"
        hint="shadow-sm on resting cards, shadow-md on overlays. Dark mode carries elevation with fill instead — a shadow on a near-black canvas is invisible — so overlays also take a surface-muted border, which is what keeps them separated in both schemes."
      >
        <Row className="gap-3">
          <ClassNameView className="w-56 gap-1 rounded-lg bg-surface p-3 shadow-sm">
            <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
              Resting card
            </ClassNameText>
            <Sample value="shadow-sm" />
          </ClassNameView>
          <ClassNameView className="w-56 gap-1 rounded-lg border border-surface-muted bg-surface p-3 shadow-md">
            <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
              Overlay
            </ClassNameText>
            <Sample value="shadow-md + border-surface-muted" />
          </ClassNameView>
        </Row>
      </Spec>
    </Sheet>
  ),
}

export const ScreenShells: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Shell constants"
        status="planned"
        hint="§3 names these so a screen composes them instead of retyping them. Today every screen in src/business writes its own strings, which is how five screens ended up with four different bottom paddings. Until they exist, use the strings underneath."
      >
        <Row className="gap-2">
          <Sample value="SCREEN_SHELL_CLASSNAME → flex-1 bg-background" />
          <Sample value="SCREEN_CONTENT_CLASSNAME → gap-4 px-6 pb-6" />
          <Sample value="SCREEN_CONTENT_TABBED_CLASSNAME → + pb-20 md:px-8" />
          <Sample value="SCREEN_CARD_CLASSNAME → w-full gap-2 rounded-lg bg-surface p-3 shadow-sm" />
          <Sample value="SCREEN_ROW_CLASSNAME → flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3" />
        </Row>
      </Spec>

      <Spec
        label="Row"
        status="shipped"
        hint="The one row shape: a surface panel, a 3 gap, and 3 of padding on every side."
      >
        <ClassNameView className="w-80 flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3">
          <ClassNameView className="flex-1 gap-1">
            <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
              Wireless Headphones
            </ClassNameText>
            <ClassNameText className="text-xs leading-4 text-muted">$129.99 each</ClassNameText>
          </ClassNameView>
          <ClassNameText className="text-sm font-semibold leading-5 text-foreground">
            2
          </ClassNameText>
        </ClassNameView>
        <Sample value="SCREEN_ROW_CLASSNAME + text-sm font-semibold leading-5 + text-xs leading-4 text-muted" />
      </Spec>
    </Sheet>
  ),
}

export const Motion: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Three durations"
        status="planned"
        hint="Nothing in the library animates except the 150ms image fade and the drawer's platform slide, so these are the whole vocabulary. Press feedback is the only motion a shopper feels while deciding, which is why it is the shortest."
      >
        <Row className="gap-2">
          <Sample value="100ms — press feedback" />
          <Sample value="150ms — image cross-fade, hover and opacity transitions" />
          <Sample value="250ms — sheet and modal slide" />
        </Row>
        <Note>
          Every duration must be gated on prefers-reduced-motion (web) and{" "}
          <Sample value="AccessibilityInfo.isReduceMotionEnabled" /> (native). Reduced motion means
          the end state, immediately — not a slower version of the animation.
        </Note>
        <Row className="gap-3">
          <Button label="active:opacity-80" testId="motion-press" />
          <Sample value="active:opacity-80 hover:opacity-90 transition-opacity duration-150" />
        </Row>
      </Spec>

      <Spec
        label="Banned"
        status="shipped"
        hint="Named so a proposal has to argue with the list rather than quietly add to it."
      >
        <Row className="gap-2">
          <Sample value="bounce / elastic easing" />
          <Sample value="parallax" />
          <Sample value="auto-playing loops" />
          <Sample value="anything over 250ms" />
        </Row>
      </Spec>
    </Sheet>
  ),
}
