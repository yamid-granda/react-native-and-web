import { expect, test } from "@playwright/test"

// Assumes api-rs is already running (docker compose up). The fixture products
// this spec needs are seeded and cleared by e2e/global-setup.ts, so nothing has
// to be run by hand.
test("home catalogue navigates to a product detail page", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByTestId("product-list-screen")).toBeVisible()
  await page.getByTestId("product-card-prod-1").click()

  await expect(page).toHaveURL("/product/prod-1")
  await expect(page.getByTestId("product-detail-screen")).toBeVisible()
})
