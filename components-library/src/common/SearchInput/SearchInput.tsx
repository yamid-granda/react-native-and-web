import { SearchIcon } from "../../icons/SearchIcon/SearchIcon"
import { Input, type InputProps } from "../Input/Input"
import { useT } from "../../i18n/LocaleContext"

export type SearchInputProps = Omit<InputProps, "prependIcon">

/**
 * An `Input` with the search icon and a default accessible name.
 *
 * Deliberately *not* a `FormField`: this is the one field in the library with no
 * visible caption — a magnifier in a rounded box is the caption, and a screen
 * reader needs a name it cannot read off the icon. So the name is supplied here
 * rather than derived from a caption, which is the gap `FormField` exists to
 * close. A new captioned field takes a `FormField`; a new search field takes
 * this.
 */
export function SearchInput({
  placeholder,
  accessibilityLabel,
  ...rest
}: SearchInputProps) {
  const t = useT()
  return (
    <Input
      {...rest}
      placeholder={placeholder ?? t("searchPlaceholder")}
      accessibilityLabel={accessibilityLabel ?? t("searchLabel")}
      prependIcon={SearchIcon}
    />
  )
}
