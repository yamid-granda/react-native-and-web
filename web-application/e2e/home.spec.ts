import { expect, test } from "@playwright/test"

test("home page renders the My Store entry", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByTestId("home-screen")).toBeVisible()
  await expect(page.getByText("Sign in to sell")).toBeVisible()
})
