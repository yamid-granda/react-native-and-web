import { useState } from "react"
import type { ComponentType } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { Button } from "../Button/Button"
import { Drawer } from "./Drawer"

const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

const meta: Meta<typeof Drawer> = {
  title: "common/Drawer",
  component: Drawer,
}

export default meta

type Story = StoryObj<typeof Drawer>

export const Default: Story = {
  render: () => {
    function DrawerDemo() {
      const [visible, setVisible] = useState(true)
      return (
        <ClassNameView className="gap-4 p-6">
          <Button label="Open Drawer" onPress={() => setVisible(true)} className="self-start" />
          <Drawer visible={visible} onClose={() => setVisible(false)}>
            <ClassNameText className="text-lg font-semibold text-foreground">
              Added to cart
            </ClassNameText>
            <ClassNameText className="text-muted">
              Wireless Headphones has been added to your cart.
            </ClassNameText>
            <Button label="Go to Cart" onPress={() => setVisible(false)} className="mt-2" />
          </Drawer>
        </ClassNameView>
      )
    }
    return <DrawerDemo />
  },
}
