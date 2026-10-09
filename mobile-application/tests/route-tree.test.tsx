import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
// Deep build imports: expo-router ships no public entry for its route builder
// or its navigation-config builder, and using those exact functions is what
// makes this test worth having — it walks the real src/app tree and asks the
// router itself for each screen's runtime path, rather than asserting on a
// hand-written route table.
import { getRoutes } from "expo-router/build/getRoutes"
import { getReactNavigationConfig } from "expo-router/build/getReactNavigationConfig"
import type { RouteNode } from "expo-router/build/Route"

const APP_DIR = join(__dirname, "../src/app")

/** Every route file under src/app, as Metro would hand them to the router. */
function routeFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    const rel = `${prefix}${entry}`
    if (statSync(full).isDirectory()) return routeFiles(full, `${rel}/`)
    return rel.endsWith(".tsx") ? [`./${rel}`] : []
  })
}

const modules: Record<string, () => Promise<unknown>> = {}
for (const file of routeFiles(APP_DIR)) {
  modules[file] = () => Promise.resolve({ default: () => null })
}
// Metro's require.context is callable and carries its own key map.
const context = Object.assign((key: string) => modules[key](), {
  keys: () => Object.keys(modules),
  resolve: (key: string) => key,
  id: "app",
  map: modules,
})

function routes(): RouteNode {
  // `getRoutes` supplies its own getSystemRoute, so the generated
  // `_sitemap` / `+not-found` nodes come from the router rather than a stub.
  const tree = getRoutes(context, { notFound: false })
  if (!tree) throw new Error("expo-router produced no route tree")
  return tree
}

function child(node: RouteNode | undefined, route: string): RouteNode | undefined {
  return node?.children.find((candidate) => candidate.route === route)
}

type ScreenMap = { path: string; screens?: Record<string, ScreenMap> }

function navigationScreens(): Record<string, ScreenMap> {
  return getReactNavigationConfig(routes(), false).screens as Record<string, ScreenMap>
}

/**
 * The URL a screen resolves to, read off the router's own screen config:
 * every `path` up the chain, minus group segments (`(tabs)`, `(home)`),
 * which contribute nothing to a URL. `index` arrives as an empty path and
 * a directory literally named `index` as a literal `index` segment, so this
 * is also what catches a route layout that quietly shifts a public path.
 */
function screenPath(name: string): string | undefined {
  const walk = (
    screens: Record<string, ScreenMap> | undefined,
    segments: string[],
  ): string[] | undefined => {
    for (const [key, screen] of Object.entries(screens ?? {})) {
      if (key === name) {
        return [...segments, screen.path].filter((segment) => segment !== "")
      }
      const found = walk(screen.screens, [...segments, screen.path])
      if (found) return found
    }
    return undefined
  }

  const segments = walk(navigationScreens(), [])
  if (!segments) return undefined
  const url = segments
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/")
  return `/${url.replace(/:([^/]+)$/, "[$1]")}`
}

describe("mobile route tree", () => {
  it("keeps the product detail screen mounted inside the Home tab", () => {
    // Regression guard: expo-router/ui's `Tabs` builds one screen per
    // TabTrigger (triggersToScreens), so a `product/` directory sitting
    // *beside* the Home tab is never mounted — `router.push("/product/[id]")`
    // then resolves against a screen that does not exist and tapping a
    // product does nothing. It has to live inside the tab's own subtree.
    const home = child(child(routes(), "(tabs)"), "(home)")

    expect(home, "the Home tab must exist").toBeDefined()
    const product = child(home, "product")
    expect(
      product,
      "product/ must nest under the Home tab, not beside it — a sibling has no TabTrigger to mount it",
    ).toBeDefined()
    expect(child(product, "[id]"), "product/[id] must exist").toBeDefined()
  })

  it("resolves the marketplace push target to /product/[id]", () => {
    // The exact href `(tabs)/(home)/index.tsx` passes to router.push. This is
    // the router's own runtime path, so a directory named `index` (which would
    // add an `index` segment) cannot pass this by accident.
    expect(screenPath("product")).toBe("/product")
    expect(screenPath("[id]")).toBe("/product/[id]")
  })

  it("keeps the Home tab at / and the other tabs at their public URLs", () => {
    // The group must stay transparent: adding `(home)` cannot move the
    // marketplace off `/`.
    expect(screenPath("index")).toBe("/")
    expect(screenPath("cart")).toBe("/cart")
    expect(screenPath("wishlist")).toBe("/wishlist")
    expect(screenPath("my-store")).toBe("/my-store")
    expect(screenPath("login")).toBe("/my-store/login")
  })

  it("keeps the four tab roots directly under the tabs group", () => {
    const tabs = child(routes(), "(tabs)")
    const directChildren = (tabs?.children.map((node) => node.route) ?? []).sort()

    // Each TabTrigger in (tabs)/_layout.tsx resolves to a route directly under
    // the group; anything else there would need a trigger or stay unmounted.
    for (const tabRoot of ["(home)", "my-store", "wishlist", "cart"]) {
      expect(directChildren, `tab root ${tabRoot} must sit directly under (tabs)`).toContain(
        tabRoot,
      )
    }

    // The detail screen must never become a sibling again: it is reachable
    // through the Home tab's subtree, not as a fifth tab.
    expect(directChildren).not.toContain("product")
  })

  it("keeps login inside the My Store tab, not beside the tabs", () => {
    // Regression guard: a root-level login screen replaces the whole (tabs)
    // group on redirect, so the bottom bar disappears on the sign-in page.
    const myStore = child(child(routes(), "(tabs)"), "my-store")

    expect(child(myStore, "login"), "login must nest under the My Store tab").toBeDefined()
    expect(child(routes(), "login"), "login must not be a root-level screen").toBeUndefined()
  })
})