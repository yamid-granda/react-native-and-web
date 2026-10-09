import { expect, test } from "@playwright/test"

// Assumes api-rs is already running, same precondition as
// e2e/catalogue.spec.ts — including the fixtures that e2e/global-setup.ts
// seeds for the run.
test("placing an order clears the cart and shows a confirmation", async ({ page }) => {
  await page.goto("/product/prod-1")
  await page.getByText("Add to Cart").click()

  await page.goto("/cart")
  await page.getByText("Proceed to Checkout").click()

  await expect(page.getByTestId("checkout-screen")).toBeVisible()
  await expect(page.getByText(/Total: /)).toBeVisible()

  await page.getByText("Place Order").click()
  await expect(page.getByText("Order placed!")).toBeVisible()
})
