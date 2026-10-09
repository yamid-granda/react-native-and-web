import type { Meta, StoryObj } from "@storybook/react"
import { View } from "react-native"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { Input } from "../Input/Input"
import { Button, BUTTON_SIZES, BUTTON_VARIANTS } from "./Button"

const meta: Meta<typeof Button> = {
  title: "common/Button",
  component: Button,
  args: {
    label: "Press me",
    testId: "press-me",
  },
}

export default meta

type Story = StoryObj<typeof Button>

// Every variant at once, driven off `BUTTON_VARIANTS` rather than a list written
// out here — so adding a variant to the component puts it on screen before it
// can reach an app. Each one also gets a story of its own below, which
// `Button.variants.test.ts` enforces.
export const AllVariants: Story = {
  render: () => (
    <View className="flex-row flex-wrap items-center gap-3">
      {BUTTON_VARIANTS.map((variant) => (
        <Button key={variant} label={variant} variant={variant} testId={variant} />
      ))}
    </View>
  ),
}

// Every default button is `h-control` — the same token Input uses — so buttons
// and inputs line up in a form without anyone restating a height. The `sm`
// pair below is the compact filter density (`h-8` + `text-sm` on both), so the
// two still line up with each other.
export const HeightMatchesInput: Story = {
  render: () => (
    <View className="gap-2">
      <Button label="Default" className="self-start" testId="height-default" />
      <Input value="" onChangeText={() => {}} accessibilityLabel="Example input" />
    </View>
  ),
}

export const SmallHeightMatchesInput: Story = {
  render: () => (
    <View className="gap-2">
      <Button label="Default" size="sm" className="self-start" testId="height-default-sm" />
      <Input value="" size="sm" onChangeText={() => {}} accessibilityLabel="Example input" />
    </View>
  ),
}

export const Default: Story = {}

export const Primary: Story = {
  args: { label: "Add to Cart", variant: "primary", testId: "add-to-cart" },
}

export const Secondary: Story = {
  args: { label: "Remove", variant: "secondary", testId: "remove" },
}

export const Small: Story = {
  args: { label: "Relevance", variant: "secondary", size: "sm", testId: "relevance-sm" },
}

// Every size at once, driven off `BUTTON_SIZES` like `AllVariants` above — so
// adding a size to the component puts it on screen before it can reach an app.
export const AllSizes: Story = {
  render: () => (
    <View className="gap-3">
      {BUTTON_SIZES.map((size) => (
        <View key={size} className="flex-row flex-wrap items-center gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button
              key={`${variant}-${size}`}
              label={`${variant} ${size}`}
              variant={variant}
              size={size}
              testId={`${variant}-${size}`}
            />
          ))}
        </View>
      ))}
    </View>
  ),
}

export const Disabled: Story = {
  args: { label: "Out of stock", disabled: true, testId: "out-of-stock" },
}

export const Loading: Story = {
  args: { label: "Save changes", loading: true, testId: "save-changes" },
}

// A button whose visible content is an icon passes `children` and has no text
// of its own. It still needs a `label`, because that is the accessible name, and
// an explicit `testId`, because an icon button has no text to derive one from.
export const Icon: Story = {
  args: { label: "Add to wishlist", variant: "secondary", testId: "add-to-wishlist" },
  render: (args) => (
    <Button {...args}>
      <HeartIcon size={18} className="text-muted" />
    </Button>
  ),
}

// `selected` announces which button of a set is current and paints nothing, so
// the visible half of "this one is on" is the variant — here the current sort is
// `primary` and its siblings are `secondary`. `ProductFilterControls` is the
// real caller.
export const Selected: Story = {
  args: {
    label: "Price: Low to High",
    variant: "primary",
    selected: true,
    testId: "sort-price-asc",
  },
}
