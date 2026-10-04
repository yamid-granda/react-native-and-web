/**
 * Derives the `testID` every Button gets from its label, so a button's test
 * id is always predictable from the text a user (or a screen-reader user) sees:
 * lowercase, spaces replaced by dashes, and any other punctuation collapsed
 * into a single dash. "Add to Cart" -> "add-to-cart",
 * "Price: Low to High" -> "price-low-to-high".
 *
 * Button buttons whose visible content is only a glyph or icon have nothing
 * meaningful to derive from, so those callers pass an explicit `testID` to
 * Button instead.
 */
export function toButtonTestId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
