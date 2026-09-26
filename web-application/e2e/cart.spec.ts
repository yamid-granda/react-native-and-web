import { expect, test } from "@playwright/test"

// Assumes the api workspace is already running and seeded, same precondition
// as e2e/marketplace.spec.ts.
test("adding a product from its detail page shows it in the cart", async ({ page }) => {
  await page.goto("/marketplace/prod-1")

  await expect(page.getByTestId("product-detail-screen")).toBeVisible()
  await page.getByText("Add to Cart").click()

  await page.goto("/cart")
  await expect(page.getByTestId("cart-screen")).toBeVisible()
  await expect(page.getByText(/Total: /)).toBeVisible()
})
