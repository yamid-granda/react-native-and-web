import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { ProductFilterControls } from "./ProductFilterControls"
import type { PriceRange, SortOption } from "../../business/ProductListScreen/useProductSearch"

function ProductFilterControlsDemo() {
  const [sortBy, setSortBy] = useState<SortOption>("relevance")
  const [priceRange, setPriceRange] = useState<PriceRange>({})

  return (
    <ProductFilterControls
      sortBy={sortBy}
      onSortByChange={setSortBy}
      priceRange={priceRange}
      onPriceRangeChange={setPriceRange}
    />
  )
}

const meta: Meta<typeof ProductFilterControlsDemo> = {
  title: "common/ProductFilterControls",
  component: ProductFilterControlsDemo,
}

export default meta

type Story = StoryObj<typeof ProductFilterControlsDemo>

export const Default: Story = {}
