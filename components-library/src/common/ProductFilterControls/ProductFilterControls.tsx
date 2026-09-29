import type { ComponentType } from "react"
import {
  Pressable,
  Text,
  View,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { cn } from "../../utils/cn"
import { Input } from "../Input/Input"
import type { PriceRange, SortOption } from "../../business/ProductListScreen/useProductSearch"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
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
            <ClassNamePressable
              key={option.value}
              accessibilityRole="button"
              aria-selected={selected}
              accessibilityLabel={`Sort by ${option.label}`}
              onPress={() => onSortByChange(option.value)}
              className={cn(
                "rounded-full border px-3 py-1.5",
                selected ? "border-brand bg-brand/10" : "border-surface-muted bg-surface",
              )}
            >
              <ClassNameText
                className={cn("text-xs font-medium", selected ? "text-brand" : "text-muted")}
              >
                {option.label}
              </ClassNameText>
            </ClassNamePressable>
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
