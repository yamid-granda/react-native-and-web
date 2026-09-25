import { by, device, element, expect } from "detox"

describe("Home screen", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("shows the shared Button and reacts to presses", async () => {
    await expect(element(by.id("home-screen"))).toBeVisible()
    await expect(element(by.text("Pressed 0 times"))).toBeVisible()

    await element(by.text("Pressed 0 times")).tap()

    await expect(element(by.text("Pressed 1 times"))).toBeVisible()
  })
})
