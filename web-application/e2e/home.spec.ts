import { expect, test } from "@playwright/test"

test("home page renders the marketplace catalogue", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByTestId("product-list-screen")).toBeVisible()
  await expect(page.getByLabel("Search products")).toBeVisible()
})
