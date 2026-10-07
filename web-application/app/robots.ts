import type { MetadataRoute } from "next"
import { SITE_URL } from "../lib/site"

/**
 * The private, per-user routes are kept out of the index: none of them is
 * useful to a crawler (they render a client store or a session-gated form) and
 * indexing them only competes with the catalogue pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/cart", "/checkout", "/login", "/my-store", "/wishlist"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
