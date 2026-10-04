import type { ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { Button } from "../Button/Button"
import { Input } from "../Input/Input"
import type { PriceRange, SortOption } from "../../business/ProductListScreen/useProductSearch"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
]

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
  return (
    <ClassNameView className="gap-3">
      <ClassNameView className="flex-row flex-wrap gap-2">
        {SORT_OPTIONS.map((option) => {
          const selected = sortBy === option.value
          return (
            <Button
              key={option.value}
              label={option.label}
              variant="chip"
              size="sm"
              selected={selected}
              // The visible chip text ("Relevance") is a poor standalone name
              // for a screen reader, which announces the control's purpose.
              accessibilityLabel={`Sort by ${option.label}`}
              onPress={() => onSortByChange(option.value)}
            />
          )
        })}
      </ClassNameView>
      <ClassNameView className="flex-row items-center gap-2">
        <Input
          value={priceRange.min !== undefined ? String(priceRange.min) : ""}
          onChangeText={(text) =>
            onPriceRangeChange({ ...priceRange, min: parseOptionalNumber(text) })
          }
          placeholder="Min price"
          accessibilityLabel="Minimum price"
          keyboardType="numeric"
          className="flex-1"
        />
        <ClassNameText className="text-muted">–</ClassNameText>
        <Input
          value={priceRange.max !== undefined ? String(priceRange.max) : ""}
          onChangeText={(text) =>
            onPriceRangeChange({ ...priceRange, max: parseOptionalNumber(text) })
          }
          placeholder="Max price"
          accessibilityLabel="Maximum price"
          keyboardType="numeric"
          className="flex-1"
        />
      </ClassNameView>
    </ClassNameView>
  )
}
