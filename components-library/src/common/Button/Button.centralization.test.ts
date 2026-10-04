import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/**
 * The one component every app button must be built from. `Button.tsx` itself is
 * obviously exempt; everything below is a surface that has
 * `accessibilityRole="button"` but is deliberately not a Button, because it is
 * a navigation target, a composite card, or a full-bleed click catcher rather
 * than a button someone presses to run an action.
 */
const NOT_A_BUTTON: Record<string, string> = {
  "business/HomeScreen/HomeScreen.tsx":
    '"My Store" card: a title plus a subtitle, not a single action label',
  "common/Drawer/Drawer.tsx": "overlay click-catcher that dismisses the drawer",
  "common/MainNav/MainNav.tsx": "nav item, onPress wiring",
  "common/MainNav/MainNav.web.tsx": "nav item, href wiring",
  "common/Product/ProductCard.tsx": "the product card itself, which navigates",
  "icons/IconsGallery/IconsGallery.tsx": "dev-only icon preview card",
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    // Stories and tests can name the prop without implementing a button.
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// Comments legitimately explain these components' role="button" choices, and
// a mention inside one is documentation, not a second implementation.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

// Matches the JSX spelling (`accessibilityRole="button"`), the object-literal
// one (`accessibilityRole: "button" as const`) and a JSX expression container,
// but not other roles — Label legitimately sets `accessibilityRole="text"`.
const BUTTON_ROLE = /accessibilityRole[=:]\s*(?:\{\s*)?["']button["']/

describe("Button centralization", () => {
  it("is the only component that marks something as a button", () => {
    const offenders: string[] = []

    for (const path of sourceFiles(SRC_ROOT)) {
      const relativePath = path.slice(SRC_ROOT.length).replace(/\\/g, "/")
      if (relativePath === "common/Button/Button.tsx") continue
      if (!BUTTON_ROLE.test(stripComments(readFileSync(path, "utf8")))) continue

      if (!NOT_A_BUTTON[relativePath]) {
        offenders.push(relativePath)
      }
    }

    expect(offenders).toEqual([])
  })

  it("documents every exemption it allows, so the list can't go stale", () => {
    // Each allowlisted file must still actually contain a button-role pressable,
    // otherwise the entry is dead weight pretending to permit something.
    for (const relativePath of Object.keys(NOT_A_BUTTON)) {
      const source = stripComments(readFileSync(join(SRC_ROOT, relativePath), "utf8"))
      expect(BUTTON_ROLE.test(source), relativePath).toBe(true)
    }
  })
})
