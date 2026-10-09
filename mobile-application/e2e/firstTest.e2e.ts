import { by, device, element, expect } from "detox"

describe("Home screen", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("shows the marketplace catalogue", async () => {
    await expect(element(by.id("product-list-screen"))).toBeVisible()
  })
})
