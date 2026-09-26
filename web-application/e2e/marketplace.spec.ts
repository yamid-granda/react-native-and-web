import { expect, test } from "@playwright/test"

// Assumes the api workspace is already running and seeded (docker compose up
// + db:migrate + db:seed), same precondition as api's own e2e suite.
test("marketplace list navigates to a product detail page", async ({ page }) => {
  await page.goto("/marketplace")

  await expect(page.getByTestId("product-list-screen")).toBeVisible()
  await page.getByTestId("product-card-prod-1").click()

  await expect(page).toHaveURL("/marketplace/prod-1")
  await expect(page.getByTestId("product-detail-screen")).toBeVisible()
})
