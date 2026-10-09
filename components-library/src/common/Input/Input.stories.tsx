import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { View } from "react-native"
import { SearchIcon } from "../../icons/SearchIcon/SearchIcon"
import { Input, INPUT_SIZES } from "./Input"
import { FormField } from "../FormField/FormField"

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

export const Small: Story = {
  args: {
    placeholder: "Min",
    accessibilityLabel: "Minimum price",
    size: "sm",
  },
}

export const WithPrependIcon: Story = {
  args: {
    placeholder: "Search...",
    prependIcon: SearchIcon,
  },
}

// Every size at once, driven off `INPUT_SIZES` — so adding a size to the
// component puts it on screen before it can reach an app. `sm` is the compact
// filter density (`h-8` wrapper, `text-sm` field); `md` is the default.
export const AllSizes: Story = {
  render: () => (
    <View className="w-72 gap-4 p-6">
      {INPUT_SIZES.map((size) => (
        <Input
          key={size}
          inputTestID={`example-${size}`}
          value=""
          size={size}
          onChangeText={() => {}}
          placeholder={size === "sm" ? "Min" : "Type something..."}
          accessibilityLabel={`Example input ${size}`}
          prependIcon={SearchIcon}
        />
      ))}
    </View>
  ),
}

/**
 * The `multiline` field a product form needs. `FormField` is what a captioned
 * field takes — this story shows the bare `Input` underneath it, because that is
 * the layer `multiline` lives on. `inputTestID` is what makes the fields
 * individually addressable — the wrapper's own testID is taken.
 */
export const Multiline: Story = {
  render: () => {
    function Demo() {
      const [description, setDescription] = useState("")
      return (
        <View className="w-72 gap-2 p-6">
          <FormField
            label="Description"
            inputTestID="description"
            multiline
            value={description}
            onChangeText={setDescription}
            placeholder="What should a shopper know about it?"
          />
        </View>
      )
    }
    return <Demo />
  },
}

export const MultipleInputs: Story = {
  render: () => {
    function InputsDemo() {
      const [name, setName] = useState("")
      const [search, setSearch] = useState("")
      const [email, setEmail] = useState("jane@example.com")
      return (
        <View className="w-72 gap-4 p-6">
          <Input
            inputTestID="name"
            value={name}
            onChangeText={setName}
            placeholder="Name"
            accessibilityLabel="Name"
          />
          <Input
            inputTestID="search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search..."
            accessibilityLabel="Search"
            prependIcon={SearchIcon}
          />
          <Input
            inputTestID="email"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            accessibilityLabel="Email"
            keyboardType="email-address"
          />
        </View>
      )
    }
    return <InputsDemo />
  },
}