import { describe, expect, it, vi } from "vitest"

// The sitemap reads the catalogue through the server client; stub it so this test
// asserts the sitemap's shape, not the API's.
vi.mock("../lib/api-server", () => ({
  getProductsPage: vi.fn(async () => ({
    items: [{ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 }],
    page: 1,
    limit: 20,
    total: 1,
    hasNextPage: false,
  })),
}))

import robots from "../app/robots"
import sitemap from "../app/sitemap"
import { SITE_URL } from "../lib/site"

describe("robots", () => {
  it("points at the sitemap and keeps the private routes out of the index", () => {
    const result = robots()

    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`)
    expect(Array.isArray(result.rules)).toBe(false)
    const rule = result.rules as { userAgent: string; allow: string; disallow: string[] }
    expect(rule.userAgent).toBe("*")
    expect(rule.allow).toBe("/")
    expect(rule.disallow).toContain("/my-store")
    expect(rule.disallow).toContain("/cart")
  })
})

describe("sitemap", () => {
  it("lists the static routes and the first catalogue page", async () => {
    const urls = (await sitemap()).map((entry) => entry.url)

    expect(urls).toContain(`${SITE_URL}/`)
    expect(urls).toContain(`${SITE_URL}/marketplace`)
    expect(urls).toContain(`${SITE_URL}/marketplace/prod-1`)
  })
})
