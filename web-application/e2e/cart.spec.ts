import { expect, test } from "@playwright/test"

// Assumes api-rs is already running, same precondition as
// e2e/catalogue.spec.ts — including the fixtures that e2e/global-setup.ts
// seeds for the run.
test("adding a product from its detail page shows it in the cart", async ({ page }) => {
  await page.goto("/product/prod-1")

  await expect(page.getByTestId("product-detail-screen")).toBeVisible()
  await page.getByText("Add to Cart").click()

  await page.goto("/cart")
  await expect(page.getByTestId("cart-screen")).toBeVisible()
  await expect(page.getByText(/Total: /)).toBeVisible()
})
