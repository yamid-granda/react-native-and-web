import type { MetadataRoute } from "next"
import { getProductsPage } from "../lib/api-server"
import { SITE_URL } from "../lib/site"

/**
 * The public, crawlable routes.
 *
 * The home page is the marketplace list; product detail pages are listed from
 * the first catalogue page and the rest are discovered by following links. A
 * sitemap does not have to be exhaustive, and paging the whole catalogue at
 * build time would make the build depend on the API for a marginal gain.
 *
 * If the catalogue is unreachable the static routes are still returned, so the
 * sitemap never fails the build. It is cached and tagged through
 * `getProductsPage`, so a seller write refreshes it.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "hourly", priority: 1 },
  ]

  try {
    const page = await getProductsPage(1)
    return [
      ...staticRoutes,
      ...page.items.map((product) => ({
        url: `${SITE_URL}/product/${product.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ]
  } catch {
    return staticRoutes
  }
}
