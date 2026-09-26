export function formatPrice(price: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(price)
}
