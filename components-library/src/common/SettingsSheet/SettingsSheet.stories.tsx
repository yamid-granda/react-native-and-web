import { useState } from "react"
import type { ComponentType } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { View, type ViewProps } from "react-native"
import { Button } from "../Button/Button"
import { SettingsSheet } from "./SettingsSheet"

const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

const meta: Meta<typeof SettingsSheet> = {
  title: "common/SettingsSheet",
  component: SettingsSheet,
}

export default meta

type Story = StoryObj<typeof SettingsSheet>

export const Default: Story = {
  render: () => {
    function SettingsSheetDemo() {
      const [visible, setVisible] = useState(true)
      return (
        <ClassNameView className="gap-4 p-6">
          <Button
            label="Open settings"
            testId="settings-open"
            onPress={() => setVisible(true)}
            className="self-start"
          />
          <SettingsSheet
            visible={visible}
            onClose={() => setVisible(false)}
            theme="light"
            onThemeChange={() => setVisible(false)}
            locale="en"
            onLocaleChange={() => setVisible(false)}
          />
        </ClassNameView>
      )
    }
    return <SettingsSheetDemo />
  },
}
