/**
 * The absolute origin used for canonical URLs, OpenGraph metadata and the
 * sitemap. Overridden per environment by `NEXT_PUBLIC_SITE_URL`.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
