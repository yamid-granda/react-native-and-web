import { by, device, element, expect } from "detox"

describe("Marketplace flow", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("browses from Home to a product's detail screen", async () => {
    await element(by.text("Marketplace")).tap()
    await expect(element(by.id("product-list-screen"))).toBeVisible()

    await element(by.id("product-card-prod-1")).tap()
    await expect(element(by.id("product-detail-screen"))).toBeVisible()
  })
})
