import { expect, test } from "@playwright/test"

// Desktop shell: top header nav + container ladder + catalogue rail/columns.
// Assumes api-rs is already running; fixtures seeded by e2e/global-setup.ts.
test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("shows the desktop header and hides the bottom nav", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByTestId("desktop-header")).toBeVisible()
    await expect(page.getByTestId("bottom-nav-mobile")).toBeHidden()
  })

  test("catalogue renders 4+ columns with a sticky filters rail", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("product-list-screen")).toBeVisible()

    const columns = await page.getByTestId("marketplace-grid").evaluate((el) => {
      const value = window.getComputedStyle(el).getPropertyValue("grid-template-columns")
      return value.split(" ").filter(Boolean).length
    })
    expect(columns).toBeGreaterThanOrEqual(4)

    const position = await page.getByTestId("marketplace-filters-rail").evaluate((el) => {
      return window.getComputedStyle(el).position
    })
    expect(position).toBe("sticky")
  })

  test("page has no horizontal overflow", async ({ page }) => {
    await page.goto("/")

    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

test.describe("mobile layout unchanged", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("shows the bottom nav and hides the desktop header", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByTestId("bottom-nav-mobile")).toBeVisible()
    await expect(page.getByTestId("desktop-header")).toBeHidden()
  })

  test("catalogue renders exactly 2 columns", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("product-list-screen")).toBeVisible()

    const columns = await page.getByTestId("marketplace-grid").evaluate((el) => {
      const value = window.getComputedStyle(el).getPropertyValue("grid-template-columns")
      return value.split(" ").filter(Boolean).length
    })
    expect(columns).toBe(2)
  })
})
