import type { Meta, StoryObj } from "@storybook/react"
import { Text, View } from "react-native"
import { ScreenHeader } from "./ScreenHeader"

const meta: Meta<typeof ScreenHeader> = {
  title: "common/ScreenHeader",
  component: ScreenHeader,
  decorators: [
    (Story) => (
      // Wrap with a colored surface so the safe-area padding is visible at a glance.
      <View style={{ flex: 1, backgroundColor: "#09090b" }}>
        <Story />
      </View>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof ScreenHeader>

export const Default: Story = {
  args: { title: "Marketplace" },
}

export const WithSubtitle: Story = {
  args: {
    title: "Marketplace",
    subtitle: "Fresh finds from sellers near you",
  },
}

export const Compact: Story = {
  args: { title: "Product", compact: true },
}

export const WithTrailingControl: Story = {
  args: {
    title: "Cart",
    trailing: (
      <View
        accessibilityRole="button"
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: "#27272a",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#fafafa", fontSize: 18 }}>⚙</Text>
      </View>
    ),
  },
}