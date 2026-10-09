import type { ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { Button } from "../Button/Button"
import { FormField } from "../FormField/FormField"
import { useT } from "../../i18n/LocaleContext"
import type { PriceRange, SortOption } from "../../business/ProductListScreen/useProductSearch"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ProductFilterControlsProps = {
  sortBy: SortOption
  onSortByChange: (sortBy: SortOption) => void
  priceRange: PriceRange
  onPriceRangeChange: (priceRange: PriceRange) => void
}

function parseOptionalNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined
  const value = Number(text)
  return Number.isNaN(value) ? undefined : value
}

export function ProductFilterControls({
  sortBy,
  onSortByChange,
  priceRange,
  onPriceRangeChange,
}: ProductFilterControlsProps) {
  const t = useT()
  const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: "relevance", label: t("sortRelevance") },
    { value: "price-asc", label: t("sortPriceAsc") },
    { value: "price-desc", label: t("sortPriceDesc") },
  ]
  return (
    <ClassNameView className="gap-3">
      <ClassNameView className="flex-row flex-wrap gap-2">
        {SORT_OPTIONS.map((option) => {
          const selected = sortBy === option.value
          return (
            <Button
              key={option.value}
              label={option.label}
              testId={`sort-${option.value}`}
              // There are only two variants, so the current sort is shown by which
              // one it uses: `primary` is the filled brand button, `secondary`
              // everything else. `selected` then only has to announce which is
              // current.
              variant={selected ? "primary" : "secondary"}
              selected={selected}
              // The visible text ("Relevance") is a poor standalone name
              // for a screen reader, which announces the control's purpose.
              accessibilityLabel={t("sortByAria", { label: option.label })}
              onPress={() => onSortByChange(option.value)}
            />
          )
        })}
      </ClassNameView>
      {/* `items-end` and not `items-center`: the two columns are taller than the
          dash by exactly the caption, and the dash belongs beside the boxes it
          separates rather than beside the pair of captions. */}
      <ClassNameView className="flex-row items-end gap-2">
        <FormField
          className="flex-1"
          label={t("minPriceLabel")}
          value={priceRange.min !== undefined ? String(priceRange.min) : ""}
          onChangeText={(text) =>
            onPriceRangeChange({ ...priceRange, min: parseOptionalNumber(text) })
          }
          placeholder={t("minPricePlaceholder")}
          keyboardType="numeric"
        />
        <ClassNameText className="mb-3 text-muted">–</ClassNameText>
        <FormField
          className="flex-1"
          label={t("maxPriceLabel")}
          value={priceRange.max !== undefined ? String(priceRange.max) : ""}
          onChangeText={(text) =>
            onPriceRangeChange({ ...priceRange, max: parseOptionalNumber(text) })
          }
          placeholder={t("maxPricePlaceholder")}
          keyboardType="numeric"
        />
      </ClassNameView>
    </ClassNameView>
  )
}
