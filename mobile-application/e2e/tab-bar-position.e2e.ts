import { by, device, element, expect } from "detox"

describe("Tab bar position", () => {
  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  // Regression test: an absolutely-positioned tab bar with no bottom/left/
  // right insets defaults to the screen's top-left (see README "Architecture
  // boundaries" — a className that never reached a real View silently
  // dropped those insets once). Assert the bar renders in the lower half of
  // the screen, not pinned to the top.
  it("renders at the bottom of the screen, not the top", async () => {
    const homeScreen = (await element(by.id("home-screen")).getAttributes()) as { frame: { y: number; height: number } }
    const homeTab = (await element(by.text("Home")).getAttributes()) as { frame: { y: number } }

    const screenMidpoint = homeScreen.frame.y + homeScreen.frame.height / 2
    expect(homeTab.frame.y).toBeGreaterThan(screenMidpoint)
  })
})
