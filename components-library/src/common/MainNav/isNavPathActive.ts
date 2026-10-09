// Home owns the catalogue section, so product and store detail pages keep
// Home highlighted (they are reached from it and have no nav item of their own).
const CATALOGUE_PREFIXES = ["/product/", "/stores/"]

/**
 * Whether a nav item pointing at `href` is the section `pathname` is in.
 * Exact match, or a child route of `href` (`/cart` owns `/cart/checkout`);
 * `/` only matches the catalogue, never every route.
 */
export function isNavPathActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || CATALOGUE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
