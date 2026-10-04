import type { Meta, StoryObj } from "@storybook/react"
import { View } from "react-native"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { Input } from "../Input/Input"
import { Button, type ButtonSize, type ButtonVariant } from "./Button"

const meta: Meta<typeof Button> = {
  title: "common/Button",
  component: Button,
  args: {
    label: "Press me",
  },
}

export default meta

type Story = StoryObj<typeof Button>

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "outline", "ghost", "chip"]
const SIZES: ButtonSize[] = ["sm", "md", "icon"]

// Every variant/size pair, so a newly added one can't slip in undocumented.
export const AllVariants: Story = {
  render: () => (
    <View className="flex-row flex-wrap items-center gap-3">
      {VARIANTS.flatMap((variant) =>
        SIZES.map((size) => (
          <Button
            key={`${variant}-${size}`}
            label={size === "icon" ? "Add to wishlist" : `${variant} ${size}`}
            variant={variant}
            size={size}
            selected={variant === "chip" ? true : undefined}
          >
            {size === "icon" ? <HeartIcon size={18} className="text-muted" /> : undefined}
          </Button>
        )),
      )}
    </View>
  ),
}

// Every button is `h-control` — the same token Input uses — so buttons and
// inputs line up in a form without anyone restating a height.
export const HeightMatchesInput: Story = {
  render: () => (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <Button label="Default" />
        <Button label="Small" size="sm" />
      </View>
      <Input value="" onChangeText={() => {}} accessibilityLabel="Example input" />
    </View>
  ),
}

export const Default: Story = {}

export const Small: Story = {
  args: { label: "Add to Cart", size: "sm" },
}

export const Disabled: Story = {
  args: { label: "Out of stock", disabled: true },
}

// Icon buttons have no text to derive a test id from, so they pass one
// explicitly — see toButtonTestId for the rule the rest of them follow.
export const Icon: Story = {
  args: { label: "Add to wishlist", size: "icon", variant: "secondary" },
  render: (args) => (
    <Button {...args}>
      <HeartIcon size={18} className="text-muted" />
    </Button>
  ),
}

// A chip's test id comes from its label with punctuation collapsed into dashes
// — this one's is "price-low-to-high".
export const Chip: Story = {
  args: { label: "Price: Low to High", variant: "chip", size: "sm", selected: true },
}
