import { expect, test } from "@playwright/test"

// Assumes api-rs is already running (docker compose up). The fixture products
// are seeded and cleared by e2e/global-setup.ts.
//
// This spec mutates the shared dev database. The products it creates are deleted
// again at the end; the *seller* rows are not, because there is no
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

// The price-change spec below registers a seller of its own, so it needs its own
// identity: the two tests run in parallel against one database, and registration
// is unique on email, so reusing `email` would answer 409 and fail the run.
const priceEmail = `e2e-price-${stamp}@rnw.test`
const priceStoreName = `E2E Price Store ${stamp}`
const priceTitle = `E2E Priced Product ${stamp}`

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
  // A description to clear later. Editing twice would re-read the product through
  // a client-side navigation, which is a separate staleness question this spec
  // does not own — one edit that both renames and clears covers the same ground.
  await page.getByTestId("product-description").fill("Waxed, not leather.")
  await page.getByTestId("product-price").fill("189")
  await page.getByTestId("product-stock").fill("6")
  await page.getByRole("button", { name: "Create product" }).click()

  await expect(page).toHaveURL("/my-store")
  await expect(page.getByText(title)).toBeVisible()

  // It is in the shared marketplace, and it says who sells it.
  //
  // Searched for rather than scrolled to: the list is `createdAt ASC`, so a
  // product created *now* sorts last, behind the seeded fixtures — this is
  // exactly the case that used to fail on mobile, where a search collapsed the
  // list to nothing, an unscrollable list never fired `onEndReached`, and the
  // product was never fetched. Searching is also what a shopper would do.
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

  // Edit: rename, and clear the description in the same save.
  //
  // Clearing is the regression this covers. A blank field used to be dropped from
  // the request body, which the server read as "leave it alone" — so the seller
  // deleted the text, got a successful save, and it stayed on the storefront for
  // every shopper. Asserted through the real form, because what matters is the
  // body the form sends, not what the api would accept.
  await page.goto("/my-store")
  await page.getByLabel(`Edit ${title}`).click()
  await expect(page).toHaveURL(/\/my-store\/.+\/edit/)
  await page.getByTestId("product-title").fill(`${title} v2`)
  await page.getByTestId("product-description").fill("")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page).toHaveURL("/my-store")
  await expect(page.getByText(`${title} v2`)).toBeVisible()

  // And it is gone when the form is read back. This is the same public
  // `GET /products/{id}` the storefront renders, so "the deleted text still
  // answers" is exactly what this catches — and `toHaveValue` retries, so it
  // waits for the refetch rather than racing it.
  //
  // Deliberately not asserted through the marketplace search: that answers from
  // the server, but a product renamed to `${title} v2` is a *different* search
  // term, and asserting the rename through search would be testing the search
  // rather than the edit. The form is read back above instead.
  await page.goto("/my-store")
  await page.getByLabel(`Edit ${title} v2`).click()
  await expect(page).toHaveURL(/\/my-store\/.+\/edit/)
  await expect(page.getByTestId("product-description")).toHaveValue("")

  // Delete, so the next run starts from the same catalogue.
  await page.goto("/my-store")
  await page.getByLabel(`Delete ${title} v2`).click()
  await expect(page.getByText(/You have no products yet/)).toBeVisible()
})

/// The finding the persisted-snapshot change exists for, in one assertion: a
/// price the seller has moved has to reach a cart that already holds the
/// product.
///
/// This fails on `main`. The cart used to persist a whole `ProductData` per line
/// and total the price inside it, so the second total is still the first price and
/// no amount of revisiting the cart changes it. One browser context is enough
/// because the cart is a client-side store — the same person can be the shopper
/// and the seller, which is also what makes this one test rather than two
/// contexts passing a token around.
test("a seller's price change reaches a cart that already holds the product", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: "Create a store" }).click()
  await page.getByTestId("auth-email").fill(priceEmail)
  await page.getByTestId("auth-password").fill(password)
  await page.getByTestId("auth-store-name").fill(priceStoreName)
  await page.getByRole("button", { name: "Create store" }).click()
  await expect(page).toHaveURL("/my-store")

  await page.getByRole("button", { name: "Add product" }).click()
  await page.getByTestId("product-title").fill(priceTitle)
  await page.getByTestId("product-price").fill("189")
  await page.getByTestId("product-stock").fill("6")
  await page.getByRole("button", { name: "Create product" }).click()
  await expect(page).toHaveURL("/my-store")

  // The shopper's half: find it in the shared marketplace and put it in the cart.
  // Searched for rather than scrolled to, for the same reason as above: a product
  // created now sorts last.
  await page.goto("/marketplace")
  await page.getByLabel("Search products").fill(priceTitle)
  await page.getByRole("button", { name: new RegExp(`^${priceTitle} `) }).click()
  await expect(page.getByTestId("product-detail-screen")).toBeVisible()
  await page.getByText("Add to Cart").click()

  await page.goto("/cart")
  await expect(page.getByText(/Total:\s*\$189\.00/)).toBeVisible()

  // The seller moves the price…
  await page.goto("/my-store")
  await page.getByLabel(`Edit ${priceTitle}`).click()
  await expect(page).toHaveURL(/\/my-store\/.+\/edit/)
  await page.getByTestId("product-price").fill("299")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page).toHaveURL("/my-store")

  // …and the cart that already held the product totals the new one. This also
  // pins the cache half: the first cart visit filled the detail entry the batch
  // lookup reads through, so seeing 299 is proof the write retired it rather than
  // the batch answering from its own copy.
  await page.goto("/cart")
  await expect(page.getByText(/Total:\s*\$299\.00/)).toBeVisible()

  // Delete, so the next run starts from the same catalogue.
  await page.goto("/my-store")
  await page.getByLabel(`Delete ${priceTitle}`).click()
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