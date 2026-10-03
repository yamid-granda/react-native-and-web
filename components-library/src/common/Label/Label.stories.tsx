import type { Meta, StoryObj } from "@storybook/react"
import { View } from "react-native"
import { Label } from "./Label"

const meta: Meta<typeof Label> = {
  title: "common/Label",
  component: Label,
  args: { children: "Email" },
  decorators: [
    (Story) => (
      <View className="w-72 gap-2 p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof Label>

export const Default: Story = {}

export const WithError: Story = {
  args: { error: "That is not an email address" },
}