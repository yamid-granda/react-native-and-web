import { by, device, element, expect } from "detox"

describe("Cart flow", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("adds a product to the cart and shows it on the Cart screen", async () => {
    await element(by.text("Marketplace")).tap()
    await element(by.id("product-card-prod-1")).tap()

    await element(by.text("Add to Cart")).tap()
    await element(by.text("Cart")).tap()

    await expect(element(by.id("cart-screen"))).toBeVisible()
    // prod-1 is seeded at $129.99 (api/prisma/seed.ts) — exact text match,
    // Detox's by.text() doesn't support regex like Playwright's locators do.
    await expect(element(by.text("Total: $129.99"))).toBeVisible()
  })
})
