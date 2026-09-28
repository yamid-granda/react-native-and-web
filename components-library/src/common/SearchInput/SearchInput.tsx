import { SearchIcon } from "../../icons/SearchIcon/SearchIcon"
import { Input, type InputProps } from "../Input/Input"

export type SearchInputProps = Omit<InputProps, "prependIcon">

export function SearchInput({
  placeholder = "Search products...",
  accessibilityLabel = "Search products",
  ...rest
}: SearchInputProps) {
  return (
    <Input
      {...rest}
      placeholder={placeholder}
      accessibilityLabel={accessibilityLabel}
      prependIcon={SearchIcon}
    />
  )
}
