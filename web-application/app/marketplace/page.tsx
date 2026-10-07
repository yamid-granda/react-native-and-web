import type { Metadata } from "next"
import { connection } from "next/server"
import { getProductsPage } from "../../lib/api-server"
import { CatalogueUnavailable } from "../catalogue-unavailable"
import { MarketplaceView } from "./marketplace-view"

export const metadata: Metadata = {
  title: "Marketplace",
  description: "Browse every product listed on the marketplace.",
}

/**
 * The marketplace list, server-rendered for SEO.
 *
 * Page 1 is fetched here and rendered into the initial HTML; `MarketplaceView`
 * seeds React Query with it and paginates from there. The fetch is cached and
 * tagged (see `lib/api-server.ts`), so the route is statically regenerated and a
 * seller write retires it on demand.
 *
 * If the API is unreachable at build, `connection()` opts this render out of the
 * static cache rather than baking an unavailable catalogue in: the route then
 * serves per-request instead of serving a broken page, and a build with the API
 * reachable prerenders it as ISR again. That is what keeps `next build` from
 * requiring a running API.
 */
export default async function MarketplacePage() {
  try {
    const initialPage = await getProductsPage(1)
    return <MarketplaceView initialPage={initialPage} />
  } catch {
    await connection()
    return <CatalogueUnavailable />
  }
}
