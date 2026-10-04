import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The design tokens have one owner. `tailwind-preset.cjs` names five semantic
 * colors and maps each to `rgb(var(--color-x) / <alpha-value>)`, but the values
 * those variables resolve to used to live in three stylesheets, so "where do I
 * change the brand's dark background?" was a five-file question and nothing
 * failed when the copies drifted. `components-library/tokens.css` is now that
 * owner and every consumer imports it; these tests are what keep it one.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url))

const TOKENS = "components-library/tokens.css"
const PRESET = "components-library/tailwind-preset.cjs"

/** Every consumer of the palette, and the import that is its only source of it. */
const CONSUMERS: Record<string, string> = {
  "web-application/app/globals.css": "../../components-library/tokens.css",
  "mobile-application/global.css": "../components-library/tokens.css",
  "components-library/global.css": "./tokens.css",
}

const TAILWIND_CONFIGS = [
  "components-library/tailwind.config.cjs",
  "web-application/tailwind.config.ts",
  "mobile-application/tailwind.config.js",
]

/**
 * The two places a CSS variable cannot be read, so both restate palette values
 * as hex: React Navigation's `screenOptions` takes a plain object and Storybook's
 * `backgrounds` option takes a color string. Their comments used to assert they
 * mirrored the tokens; this asserts it instead.
 */
const HEX_MIRRORS = [
  "mobile-application/src/navHeaderTheme.ts",
  "components-library/.storybook/preview.tsx",
]

const SOURCE_ROOTS = ["components-library/src", "web-application/app", "mobile-application/src"]

/**
 * Every block in `tokens.css` that carries the palette, with the reason that
 * block has to exist. Pinned in both directions: a block this table does not
 * list, and a listed block that has gone, each fail — so the selector set is a
 * deliberate edit rather than an accident of whoever edited last.
 */
const PALETTE_BLOCKS: Record<string, string> = {
  ":root":
    "the light default every host starts from, including native's dark-mode media block target",
  "@media (prefers-color-scheme: dark) :root":
    "the OS default. Must be a bare :root: React Native CSS Interop builds its light/dark rootVariables from exactly this selector and silently drops any other shape, which leaves native rendering the light palette in dark mode",
  ":root.light":
    "an explicit light pick (web's Theme button, Storybook's toolbar). Outranks the OS block on specificity so it wins even when the OS prefers dark",
  ":root.dark":
    "an explicit dark pick. Declared last so it wins over :root.light, and more specific than the OS block so the Theme button works on a light OS",
}

/**
 * Every numeric height a component sets outside the `h-control` token, with the
 * reason it is not a control height. `tailwind-preset.cjs` claims no component
 * anywhere may hardcode one and `README.md` repeats the rule, but nothing
 * checked it, so the rule was latent rather than held. Image heights, badge
 * heights and nav padding are legitimate; a control height is not, because that
 * is the one value `Button` and `Input` have to agree on.
 */
const CONTROL_HEIGHT_EXCEPTIONS: Record<string, string> = {
  "business/ProductDetailScreen/ProductDetailScreen.tsx h-64": "product image height",
  "common/Input/Input.tsx min-h-20":
    "multiline textarea height — padding replaces the fixed height by design (see Input.tsx)",
  "common/Input/Input.tsx py-2":
    "the padding half of the same multiline decision; a single-line input uses h-control",
  "common/MainNav/MainNavItem.tsx h-5": "cart/wishlist badge height",
  "common/MainNav/MainNavItem.tsx py-2": "nav item vertical padding",
  "common/Product/ProductCard.tsx h-32": "product image height",
  "common/Product/ProductCard.tsx py-1": "product card chip padding",
  "common/Product/Product.web.tsx h-32": "product image height",
}

// `min-`/`max-` count as heights too. The lookbehind stops `h-20` matching
// inside `min-h-20`, and stops either matching inside a longer utility name.
const LITERAL_HEIGHT = /(?<![\w-])(?:min-|max-)?(?:h|py)-[0-9]+(?:\.[0-9]+)?\b/g

/** One CSS rule that declares palette values, with the media query wrapping it. */
type PaletteBlock = {
  /** `media prelude + selector`, or just the selector when there is no media. */
  key: string
  /** The block's own declarations, not those of a rule nested inside it. */
  tokens: Map<string, string>
}

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

// Comments legitimately explain the palette and the selector choices, and a
// mention inside one is documentation, not a declaration.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

function matchingBrace(css: string, open: number): number {
  let depth = 0
  for (let index = open; index < css.length; index++) {
    if (css[index] === "{") depth++
    if (css[index] === "}" && --depth === 0) return index
  }
  return css.length
}

/**
 * Every rule that declares a `--color-*` property, with the `@media` prelude
 * wrapping it, if any. At-rules other than `@media` are skipped: `@tailwind`
 * directives hold no declarations, and a block whose only content is `@apply`
 * (web's `body`) is not a palette block.
 */
function paletteBlocks(css: string, media: string | null = null): PaletteBlock[] {
  const blocks: PaletteBlock[] = []
  let index = 0

  while (index < css.length) {
    const open = css.indexOf("{", index)
    if (open === -1) return blocks

    // `@tailwind base;` has no braces of its own, so the prelude of the block
    // that follows starts after the last statement, not at the last `}`.
    const raw = css.slice(index, open)
    const prelude = raw.slice(Math.max(raw.lastIndexOf(";"), raw.lastIndexOf("}")) + 1).trim()
    const close = matchingBrace(css, open)
    const body = css.slice(open + 1, close)

    if (prelude.startsWith("@media")) {
      blocks.push(...paletteBlocks(body, prelude))
    } else if (!prelude.startsWith("@")) {
      const tokens = new Map<string, string>()
      for (const [, token, value] of body.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) {
        if (token !== undefined && value !== undefined) tokens.set(token, value.trim())
      }
      if (tokens.size > 0) blocks.push({ key: media ? `${media} ${prelude}` : prelude, tokens })
    }

    index = close + 1
  }

  return blocks
}

/** The palette of the blocks whose key is one of `keys`, checked against each other. */
function scheme(blocks: PaletteBlock[], keys: string[]): Map<string, string> {
  const matching = blocks.filter((block) => keys.includes(block.key))
  expect(matching.map((block) => block.key).sort()).toEqual([...keys].sort())

  const [first, ...rest] = matching
  // The expectation above already failed if nothing matched; this keeps the
  // narrowing that follows honest rather than asserting twice.
  if (first === undefined) throw new Error(`no palette block matched ${keys.join(" / ")}`)

  for (const block of rest) {
    expect([...block.tokens], `${block.key} disagrees with ${first.key}`).toEqual([...first.tokens])
  }

  return first.tokens
}

function channelsToHex(channels: string): string {
  return `#${channels
    .trim()
    .split(/\s+/)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    // Stories and tests may name a utility without setting a height.
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Every `<root-relative-path> <utility>` pair that sets a literal height. */
function literalHeights(): Set<string> {
  const found = new Set<string>()

  for (const root of SOURCE_ROOTS) {
    const rootPath = join(REPO_ROOT, root)
    for (const path of sourceFiles(rootPath)) {
      const relativePath = path.slice(rootPath.length + 1).replace(/\\/g, "/")
      for (const [utility] of readFileSync(path, "utf8").matchAll(LITERAL_HEIGHT)) {
        found.add(`${relativePath} ${utility}`)
      }
    }
  }

  return found
}

const tokenBlocks = () => paletteBlocks(stripComments(read(TOKENS)))

describe("design tokens", () => {
  it("is imported by every consumer, which is what makes it the owner", () => {
    for (const [file, specifier] of Object.entries(CONSUMERS)) {
      const imports = [...read(file).matchAll(/@import\s+"([^"]+)"/g)].map((match) => match[1])
      expect(imports, `${file} must import ${TOKENS}`).toContain(specifier)
    }
  })

  it("leaves no --color-* declaration outside tokens.css", () => {
    // The duplication this replaces: the values were written out in three
    // stylesheets and agreed only by hand. Now a consumer that declares one
    // itself is a second owner, so it has to fail.
    const restated = Object.keys(CONSUMERS).filter(
      (file) => paletteBlocks(stripComments(read(file))).length > 0,
    )

    expect(restated).toEqual([])
  })

  it("declares each scheme once, with every block that repeats it agreeing", () => {
    const blocks = tokenBlocks()

    // Each scheme is spelled in two blocks because CSS cannot express "the OS
    // is dark unless a class says otherwise" without `:not()`, which native
    // cannot extract. Those repeats are the only duplication left, so they are
    // the thing pinned.
    const light = scheme(blocks, [":root", ":root.light"])
    const dark = scheme(blocks, ["@media (prefers-color-scheme: dark) :root", ":root.dark"])

    expect([...light.keys()].sort()).toEqual([
      "background",
      "foreground",
      "muted",
      "surface",
      "surface-muted",
    ])
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort())
  })

  it("gives every palette value a distinct dark counterpart", () => {
    const blocks = tokenBlocks()
    const light = scheme(blocks, [":root", ":root.light"])
    const dark = scheme(blocks, ["@media (prefers-color-scheme: dark) :root", ":root.dark"])

    const unchanged = [...light].filter(([token, value]) => dark.get(token) === value)
    expect(
      unchanged.map(([token]) => token),
      "declared but never flips",
    ).toEqual([])
  })

  it("uses only the dark-mode blocks it documents, so the set can't grow quietly", () => {
    expect(tokenBlocks().map((block) => block.key)).toEqual(Object.keys(PALETTE_BLOCKS))
  })

  it("documents every dark-mode block it uses, so the list can't go stale", () => {
    const used = new Set(tokenBlocks().map((block) => block.key))

    for (const key of Object.keys(PALETTE_BLOCKS)) {
      expect([...used], key).toContain(key)
    }
  })

  it("declares exactly the tokens the preset reads, and no others", () => {
    const referenced = new Set(
      [...read(PRESET).matchAll(/var\(--color-([\w-]+)\)/g)]
        .map((match) => match[1])
        .filter((token): token is string => token !== undefined),
    )
    const declared = new Set(scheme(tokenBlocks(), [":root", ":root.light"]).keys())

    expect(
      [...declared].filter((token) => !referenced.has(token)),
      "declared in tokens.css but unread by the preset",
    ).toEqual([])
    expect(
      [...referenced].filter((token) => !declared.has(token)),
      "read by the preset but undeclared",
    ).toEqual([])
  })

  it('sets darkMode: "class" in every Tailwind config', () => {
    // Read as text rather than loaded: a JS/TS config cannot be required from a
    // node-environment test, and the value under test is a literal. Comments go
    // first, or a config that explains the setting in prose matches twice.
    for (const config of TAILWIND_CONFIGS) {
      const found = [...stripComments(read(config)).matchAll(/darkMode:\s*"([^"]+)"/g)].map(
        (match) => match[1],
      )
      expect(found, config).toEqual(["class"])
    }
  })

  it("mirrors no hex that isn't a token value", () => {
    const tokenHexes = new Set(
      tokenBlocks().flatMap((block) =>
        [...block.tokens.values()].map((channels) => channelsToHex(channels)),
      ),
    )

    for (const file of HEX_MIRRORS) {
      const hexes = [...stripComments(read(file)).matchAll(/#[0-9a-f]{6}\b/gi)].map((match) =>
        match[0].toLowerCase(),
      )
      // An empty result means one of these files stopped restating the palette,
      // which is a decision to make deliberately rather than let pass quietly.
      expect(hexes.length, `${file} should still mirror at least one token`).toBeGreaterThan(0)

      for (const hex of hexes) {
        expect(tokenHexes.has(hex), `${file} hardcodes ${hex}, which is not a token value`).toBe(
          true,
        )
      }
    }
  })

  it("restates no control height as a literal", () => {
    const offenders = [...literalHeights()].filter((entry) => !CONTROL_HEIGHT_EXCEPTIONS[entry])

    expect(offenders).toEqual([])
  })

  it("documents every control height it allows, so the list can't go stale", () => {
    const present = literalHeights()

    for (const allowed of Object.keys(CONTROL_HEIGHT_EXCEPTIONS)) {
      expect([...present], allowed).toContain(allowed)
    }
  })
})
