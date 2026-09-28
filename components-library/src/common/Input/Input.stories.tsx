import { useState } from "react"
import type { ComponentType } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { View, type ViewProps } from "react-native"
import { SearchIcon } from "../../icons/SearchIcon/SearchIcon"
import { Input } from "./Input"

const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

const meta: Meta<typeof Input> = {
  title: "common/Input",
  component: Input,
  args: {
    placeholder: "Type something...",
    accessibilityLabel: "Example input",
  },
}

export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {}

export const WithPrependIcon: Story = {
  args: {
    placeholder: "Search...",
    prependIcon: SearchIcon,
  },
}

export const MultipleInputs: Story = {
  render: () => {
    function InputsDemo() {
      const [name, setName] = useState("")
      const [search, setSearch] = useState("")
      const [email, setEmail] = useState("jane@example.com")
      return (
        <ClassNameView className="w-72 gap-4 p-6">
          <Input value={name} onChangeText={setName} placeholder="Name" accessibilityLabel="Name" />
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search..."
            accessibilityLabel="Search"
            prependIcon={SearchIcon}
          />
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            accessibilityLabel="Email"
            keyboardType="email-address"
          />
        </ClassNameView>
      )
    }
    return <InputsDemo />
  },
}
