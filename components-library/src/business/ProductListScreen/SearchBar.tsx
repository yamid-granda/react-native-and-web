import type { ComponentType } from "react"
import { TextInput, View, type TextInputProps, type ViewProps } from "react-native"
import { SearchIcon } from "../../icons/SearchIcon/SearchIcon"

const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameTextInput = TextInput as ComponentType<TextInputProps & { className?: string }>

export type SearchBarProps = {
  value: string
  onChangeText: (value: string) => void
}

export function SearchBar({ value, onChangeText }: SearchBarProps) {
  return (
    <ClassNameView className="flex-row items-center gap-2 rounded-lg border border-surface-muted bg-surface px-3 py-2">
      <SearchIcon size={16} className="text-muted" />
      <ClassNameTextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search products..."
        accessibilityLabel="Search products"
        className="flex-1 text-sm text-foreground"
      />
    </ClassNameView>
  )
}
