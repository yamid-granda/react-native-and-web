export function formatPrice(price: number, currency = "USD", localeTag = "en-US") {
  try {
    return new Intl.NumberFormat(localeTag, { style: "currency", currency }).format(price)
  } catch {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price)
  }
}
