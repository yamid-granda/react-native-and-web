import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { Button, BUTTON_VARIANTS } from "../../src/common/Button/Button"
import { FormField } from "../../src/common/FormField/FormField"
import { Label } from "../../src/common/Label/Label"
import { SearchInput } from "../../src/common/SearchInput/SearchInput"
import { HeartIcon } from "../../src/icons/HeartIcon/HeartIcon"
import { ClassNameText, ClassNameView, Note, Row, Sample, Sheet, Spec } from "./spec"

/**
 * §5 of the manual — the closed control set.
 *
 * `BUTTON_VARIANTS` is imported rather than written out, so this section cannot
 * drift from the component: adding a variant to `Button.tsx` puts it on screen
 * here before it can reach an app, and `Button.variants.test.ts` still pins the
 * list to the two the proposal rule allows.
 */

const meta: Meta = {
  title: "Design System/Controls",
  parameters: {
    layout: "fullscreen",
  },
}

export default meta

type Story = StoryObj

export const Buttons: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="Two variants, no sizes"
        status="shipped"
        hint="primary is the single call to action on a screen. secondary is everything else. A third variant or a size is an improve-proposals/ entry, not a local union."
      >
        <Row className="gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button
              key={variant}
              label={variant}
              variant={variant}
              testId={`controls-${variant}`}
            />
          ))}
        </Row>
        <Sample value="primary: rounded-lg bg-brand active:bg-brand-dark + text-white  ·  secondary: rounded-lg border border-control-border bg-control-bg active:bg-surface-muted + text-control-text" />
      </Spec>

      <Spec
        label="States"
        status="shipped"
        hint="A disabled primary still says what it would have done — see Marketplace for why that matters on an out-of-stock buy button. Loading keeps the label's name for the screen reader and shows … for the eye."
      >
        <Row className="gap-3">
          <Button label="Save changes" testId="controls-default" />
          <Button label="Saving" loading testId="controls-loading" />
          <Button label="Out of stock" disabled testId="controls-disabled" />
        </Row>
        <Sample value="loading → label renders … with aria-busy · disabled → opacity-50" />
      </Spec>

      <Spec
        label="Selection is a variant, not a state"
        status="shipped"
        hint="selected announces membership in a set and paints nothing; the current option is primary and its siblings secondary. This is what a sort chip, a filter chip, and a quantity chip all look like."
      >
        <Row className="gap-2">
          <Button label="Relevance" variant="primary" selected testId="controls-sort-relevance" />
          <Button label="Price: Low to High" variant="secondary" testId="controls-sort-price" />
          <Button label="Newest" variant="secondary" testId="controls-sort-newest" />
        </Row>
        <Sample value="variant={selected ? &quot;primary&quot; : &quot;secondary&quot;} selected={selected}" />
      </Spec>

      <Spec
        label="Icon-only"
        status="shipped"
        hint="w-control keeps it square at the same height as every other control. The label is still required — it is the accessible name, not the visible text — and the state has to be carried by fill as well as tint, or it is invisible to anyone who cannot separate them."
      >
        <Row className="gap-3">
          <Button label="Add to wishlist" variant="secondary" testId="controls-wishlist-off">
            <HeartIcon size={18} className="text-muted" />
          </Button>
          <Button label="Remove from wishlist" variant="secondary" testId="controls-wishlist-on">
            <HeartIcon size={18} filled className="text-brand" />
          </Button>
        </Row>
        <Sample value="children + w-control px-0 · <HeartIcon filled /> · accessibilityLabel required" />
      </Spec>
    </Sheet>
  ),
}

export const Fields: Story = {
  render: () => (
    <Sheet>
      <Spec
        label="FormField owns the pairing"
        status="shipped"
        hint="Caption, error, and the accessible name all come from one string, so a field cannot end up captioned one thing and announced as another. React Native has no label/for; this composition is the only place that can reach both."
      >
        <ClassNameView className="w-72 gap-6">
          <FormField
            label="Price"
            inputTestID="controls-price"
            value=""
            onChangeText={() => {}}
            placeholder="0.00"
          />
          <FormField
            label="Stock"
            error="Enter a number"
            inputTestID="controls-stock"
            value=""
            onChangeText={() => {}}
          />
        </ClassNameView>
        <Sample value="FormField gap-1 → Label(text-xs uppercase tracking-wide) → Input(h-control rounded-lg border-control-border bg-control-bg px-3)" />
      </Spec>

      <Spec
        label="SearchInput"
        status="shipped"
        hint="The one field with no caption: the magnifier is the caption, so the name is supplied here rather than derived. Placeholder and label are Search products… — with an ellipsis character, which is what every other string in the app already uses."
      >
        <ClassNameView className="w-72 gap-2">
          <SearchInput inputTestID="controls-search" value="" onChangeText={() => {}} />
        </ClassNameView>
        <Sample value="&lt;Input prependIcon={SearchIcon} accessibilityLabel=&quot;Search products&quot; placeholder=&quot;Search products…&quot; /&gt;" />
        <Note>
          Today the default is <Sample value="Search products..." /> with three periods. The
          ellipsis character is specified; fixing it is a one-line change in SearchInput.tsx.
        </Note>
      </Spec>

      <Spec
        label="Multiline"
        status="shipped"
        hint="Padding replaces the fixed height by design — a textarea that kept h-control would clip its first line of text."
      >
        <ClassNameView className="w-72">
          <FormField
            label="Description"
            inputTestID="controls-description"
            multiline
            value=""
            onChangeText={() => {}}
            placeholder="What should a shopper know about it?"
          />
        </ClassNameView>
        <Sample value="Input multiline: items-start py-2 min-h-20 text-left" />
      </Spec>

      <Spec
        label="Label"
        status="planned"
        hint="Label renders the caption and the error in the same slot — the error replaces the caption rather than sitting under it. Specified to carry the error in text-danger; today it is text-brand, the same colour as the price and the primary CTA."
      >
        <ClassNameView className="w-72 gap-6">
          <Label>Price</Label>
          <Label error="Enter a number">Stock</Label>
        </ClassNameView>
        <Sample value="Label: text-xs font-semibold uppercase tracking-wide leading-4 text-muted · error → text-danger (planned)" />
      </Spec>
    </Sheet>
  ),
}

export const SearchInteraction: Story = {
  render: () => {
    function Demo() {
      const [query, setQuery] = useState("")
      return (
        <Sheet className="gap-4">
          <ClassNameView className="w-72 gap-2">
            <SearchInput inputTestID="controls-search-live" value={query} onChangeText={setQuery} />
          </ClassNameView>
          <ClassNameText className="text-sm font-normal leading-5 text-muted">
            {query ? `128 results for “${query}”` : "128 results"}
          </ClassNameText>
          <Note>
            The count sits above the grid in Meta and carries the live region (§4), so a screen
            reader hears the result set change after a search. Both are specified and not yet built.
          </Note>
        </Sheet>
      )
    }
    return <Demo />
  },
}
