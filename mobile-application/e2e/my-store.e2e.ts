import { by, device, element, expect } from "detox"

// Assumes api-rs is already running and seeded (docker compose up +
// pnpm --filter @rnw/api-rs db:migrate + db:seed). Requires a native build and a
// simulator: `pnpm prebuild` then `pnpm test:e2e:build` (see the repo README).
//
// Detox's by.text() does exact matches and has no regex, so every string here is
// spelled out in full.
describe("My Store flow", () => {
  const stamp = `${Date.now().toString(36)}`
  const email = `e2e-my-store-${stamp}@rnw.test`
  const password = "correct horse battery"
  const storeName = `E2E Store ${stamp}`
  const title = `E2E Product ${stamp}`

  beforeAll(async () => {
    await device.launchApp()
  })

  beforeEach(async () => {
    await device.reloadReactNative()
  })

  it("sends an anonymous Home visitor to the login screen", async () => {
    await expect(element(by.id("home-screen"))).toBeVisible()
    await expect(element(by.text("Sign in to sell"))).toBeVisible()

    await element(by.id("home-my-store")).tap()

    await expect(element(by.id("auth-screen"))).toBeVisible()
  })

  it("registers a store, lists a product, and finds it in the marketplace", async () => {
    await element(by.id("home-my-store")).tap()
    await element(by.text("Create a store")).tap()

    await element(by.id("auth-email")).replaceText(email)
    await element(by.id("auth-password")).replaceText(password)
    await element(by.id("auth-store-name")).replaceText(storeName)
    await element(by.text("Create store")).tap()

    await expect(element(by.id("store-screen"))).toBeVisible()
    await expect(element(by.text(storeName))).toBeVisible()

    // Create.
    await element(by.text("Add product")).tap()
    await element(by.id("product-title")).replaceText(title)
    await element(by.id("product-price")).replaceText("189")
    await element(by.id("product-stock")).replaceText("6")
    await element(by.text("Create product")).tap()

    await expect(element(by.id("store-screen"))).toBeVisible()
    await expect(element(by.text(title))).toBeVisible()

    // It is in the shared marketplace, and it names its seller.
    await element(by.text("Marketplace")).tap()
    await element(by.id("product-list-screen")).waitFor().scroll(2000, "down")
    await element(by.text(title)).tap()
    await expect(element(by.text(`Sold by ${storeName}`))).toBeVisible()

    // …and the "Sold by" line reaches the public storefront.
    await element(by.label(`Sold by ${storeName}`)).tap()
    await expect(element(by.id("public-store-screen"))).toBeVisible()

    // Edit, then delete, so the next run starts from the same catalogue. Reloaded
    // first: the native session is in memory only, so a reload signs the seller
    // out (components-library/src/business/AuthScreen/useSessionStore.ts) and the
    // journey starts again from Home.
    await device.reloadReactNative()
    await element(by.text("Home")).tap()
    await element(by.id("home-my-store")).tap()
    await expect(element(by.id("store-screen"))).toBeVisible()

    await element(by.label(`Edit ${title}`)).tap()
    await element(by.id("product-title")).replaceText(`${title} v2`)
    await element(by.text("Save changes")).tap()
    await expect(element(by.text(`${title} v2`))).toBeVisible()

    await element(by.label(`Delete ${title} v2`)).tap()
    await expect(element(by.text("You have no products yet."))).toBeVisible()
  })
})