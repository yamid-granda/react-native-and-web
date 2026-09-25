import { expect, test } from "@playwright/test";

test("home page renders and the shared button is interactive", async ({ page }) => {
  await page.goto("/");

  const button = page.getByText("Pressed 0 times");
  await expect(button).toBeVisible();

  await button.click();
  await expect(page.getByText("Pressed 1 times")).toBeVisible();
});
