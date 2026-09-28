import { by, device, element, expect } from "detox"

describe("Checkout flow", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("places an order and shows a confirmation", async () => {
    await element(by.text("Marketplace")).tap()
    await element(by.id("product-card-prod-1")).tap()
    await element(by.text("Add to Cart")).tap()
    await element(by.text("Cart")).tap()

    await element(by.text("Proceed to Checkout")).tap()
    await expect(element(by.id("checkout-screen"))).toBeVisible()

    await element(by.text("Place Order")).tap()
    await expect(element(by.text("Order placed!"))).toBeVisible()
  })
})
