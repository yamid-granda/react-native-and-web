import { expect, test } from "@playwright/test"

// Assumes api-rs is already running and seeded (docker compose up +
// pnpm --filter @rnw/api-rs db:migrate + db:seed).
//
// This spec mutates the shared dev database. The product it creates is deleted
// again at the end; the *seller* row is not, because there is no
// delete-account endpoint — that is deliberate (it is what proves
// `ON DELETE SET NULL`), and the email is unique per run so nothing collides.
//
// `test.info()` is only available inside a test, so the stamp is built at module
// scope from the clock alone. Under `fullyParallel` each worker loads this file
// separately, and `Date.now()` in base36 is unique enough to keep two workers off
// the unique email index — a collision would answer 409 and fail the run.
const stamp = Date.now().toString(36)
const email = `e2e-my-store-${stamp}@rnw.test`
const password = "correct horse battery"
const storeName = `E2E Store ${stamp}`
const title = `E2E Product ${stamp}`

test("a seller registers, lists a product, and sees it in the marketplace", async ({ page }) => {
  await page.goto("/login")

  await page.getByRole("button", { name: "Create a store" }).click()
  await page.getByTestId("auth-email").fill(email)
  await page.getByTestId("auth-password").fill(password)
  await page.getByTestId("auth-store-name").fill(storeName)
  await page.getByRole("button", { name: "Create store" }).click()

  await expect(page).toHaveURL("/my-store")
  await expect(page.getByTestId("store-screen")).toBeVisible()
  await expect(page.getByText(storeName)).toBeVisible()
  // The empty state, so the next step is unambiguous.
  await expect(page.getByText(/You have no products yet/)).toBeVisible()

  // Create.
  await page.getByRole("button", { name: "Add product" }).click()
  await expect(page).toHaveURL("/my-store/new")
  await page.getByTestId("product-title").fill(title)
  await page.getByTestId("product-price").fill("189")
  await page.getByTestId("product-stock").fill("6")
  await page.getByRole("button", { name: "Create product" }).click()

  await expect(page).toHaveURL("/my-store")
  await expect(page.getByText(title)).toBeVisible()

  // It is in the shared marketplace, and it says who sells it.
  //
  // Searched for rather than scrolled to: the list is `createdAt ASC`, so a
  // product created *now* sorts last — on page three of a freshly seeded
  // catalogue. Searching is also what a shopper would actually do.
  await page.goto("/marketplace")
  await page.getByLabel("Search products").fill(title)
  // By role, not by text: the title `Text` is inside the card's Pressable, and
  // clicking the inner node does not reach the button's own handler.
  const card = page.getByRole("button", { name: new RegExp(`^${title} `) })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.getByTestId("product-detail-screen")).toBeVisible()
  await expect(page.getByText(`Sold by ${storeName}`)).toBeVisible()

  // …and the "Sold by" line reaches the public storefront.
  await page.getByLabel(`Sold by ${storeName}`).click()
  await expect(page).toHaveURL(/\/stores\//)
  await expect(page.getByTestId("public-store-screen")).toBeVisible()
  await expect(page.getByText(title)).toBeVisible()

  // Edit.
  await page.goto("/my-store")
  await page.getByLabel(`Edit ${title}`).click()
  await expect(page).toHaveURL(/\/my-store\/.+\/edit/)
  await page.getByTestId("product-title").fill(`${title} v2`)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page).toHaveURL("/my-store")
  await expect(page.getByText(`${title} v2`)).toBeVisible()

  // Delete, so the next run starts from the same catalogue.
  await page.getByLabel(`Delete ${title} v2`).click()
  await expect(page.getByText(/You have no products yet/)).toBeVisible()
})

test("an anonymous visitor is sent from Home to the login screen", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByTestId("home-screen")).toBeVisible()
  await expect(page.getByText("Sign in to sell")).toBeVisible()

  await page.getByLabel("My Store").click()

  await expect(page).toHaveURL("/login")
  await expect(page.getByTestId("auth-screen")).toBeVisible()
})