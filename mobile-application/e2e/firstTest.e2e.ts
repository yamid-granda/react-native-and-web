import { by, device, element, expect } from "detox"

describe("Home screen", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("shows the My Store entry", async () => {
    await expect(element(by.id("home-screen"))).toBeVisible()
    await expect(element(by.text("Sign in to sell"))).toBeVisible()
  })
})
