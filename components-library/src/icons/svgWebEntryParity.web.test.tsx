import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * `react-native-svg` is two different modules depending on who is asking, and
 * nothing in the toolchain notices.
 *
 * `tsc`, Vitest, Storybook and Metro all resolve the real web entry,
 * `react-native-svg/lib/module/ReactNativeSVG.web.js`. The Next.js build resolves
 * `stubs/react-native-svg.js` instead, which re-exports `elements.web.js` and
 * nothing else. So every import below typechecks, lints, unit-tests and builds
 * green against a surface the web app does not have — and the day one of them
 * reaches past it, the failure is a render error in a browser, not a red build.
 *
 * This file is that boundary, made executable.
 *
 * It must stay `*.web.test.tsx` under `src/`. The `utils` Vitest project
 * declares no `resolve` key at all, so it applies Vite's default extension
 * order, in which the web entry's extensionless `from './elements'` lands on the
 * native Flow-typed `elements.js` and fails to parse. Only the `web` project's
 * `.web.js`-first order makes both modules loadable — and it also replaces
 * `react-native-svg` with a prefix alias, which is why they are loaded by file
 * URL below rather than by the bare specifier a source file would use.
 */

/** The stub is two re-export lines and nothing else, so its export surface is
 *  `elements.web.js`'s. `it("re-exports exactly ...")` below pins that, so this
 *  substitution can never quietly stop being true. */
/** Paths are anchored on `import.meta.dirname` rather than
 *  `fileURLToPath(new URL(".", import.meta.url))`, which `Button.centralization.test.ts`
 *  gets away with because it runs in the node `utils` project: Vite rewrites
 *  `new URL(x, import.meta.url)` into an asset URL under the jsdom `web` project,
 *  and `fileURLToPath` then rejects it for not being a `file:` URL. */
const STUB_SOURCE = join(import.meta.dirname, "../../stubs/react-native-svg.js")

/**
 * Every runtime export of the real web entry that the stub leaves out, each
 * naming why it is still missing. There are three distinct routes here, not one:
 *
 * - The `xml` names arrive via `./xml` → `xmlTags.js`, which imports `./elements`
 *   extensionlessly. That is the resolution Turbopack cannot perform inside
 *   `node_modules`, and the entire reason `stubs/react-native-svg.js` exists.
 * - The `deprecated` names come from `./deprecated`, a module with no imports at
 *   all. They would load without trouble; they are `throw`-on-call placeholders
 *   whose own error message redirects callers to the `react-native-svg/css`
 *   sub-package, so re-exporting them would only make a dead API look alive.
 * - `fetchText` comes from `./utils/fetchData`, which imports nothing but
 *   `react-native` — already aliased to `react-native-web`. It would load too,
 *   and is omitted only because the stub re-exports shapes and it is not one.
 */
const OMITTED: Record<string, string> = {
  // ./xml -> ./xmlTags -> extensionless './elements'
  SvgAst: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  SvgFromUri: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  SvgFromXml: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  SvgUri: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  SvgXml: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  camelCase: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  parse: "reached through ./xml -> ./xmlTags -> extensionless './elements'",
  // ./deprecated — throw-on-call placeholders, and import-free besides
  LocalSvg: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  SvgCss: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  SvgCssUri: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  SvgWithCss: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  SvgWithCssUri: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  WithLocalSvg: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  inlineStyles: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  loadLocalRawResource: "deprecated throw-on-call placeholder; react-native-svg/css supersedes it",
  // ./utils/fetchData — imports only `react-native`, so this one would load
  fetchText: "not a shape; the stub re-exports shapes only",
}

const SRC_ROOT = join(import.meta.dirname, "../../")
const STUB_ELEMENTS = "react-native-svg/lib/module/elements.web.js"

const require = createRequire(import.meta.url)

/** Resolved through Node and loaded by file URL, so the `web` project's
 *  prefix alias for `react-native-svg` cannot rewrite the specifier out from
 *  under us. Extensionless imports *inside* these modules still resolve through
 *  that project's `.web.js`-first order, which is the whole reason it can load
 *  them. */
const load = async (subpath: string): Promise<Record<string, unknown>> =>
  import(pathToFileURL(require.resolve(subpath)).href)

/** Every named binding this library imports from `react-native-svg`. Default
 *  imports are not collected: the stub re-exports `elements.web.js`'s default,
 *  so one always resolves.
 *
 *  The clause is tempered against a second `import` keyword rather than merely
 *  delimited by `;`, because this tree is formatted without semicolons — an
 *  `[^;]*?` clause happily runs from `import … from "react"` in one statement to
 *  `from "react-native-svg"` three statements later and reports React's bindings
 *  as svg's. */
const SVG_IMPORT =
  /import\s+(?!type\s)((?:(?!import\b)[\s\S])*?)from\s+["']react-native-svg["']/g
const SVG_NAMED_BINDING = /\{([^}]*)\}/

/** The stub's own doc comment explains the resolution it works around and names
 *  `./elements` while doing so, so its source has to be read without comments. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    // Stories and tests are excluded: they run under Vitest, which resolves
    // react-native-svg to the real web entry rather than to the stub.
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function importedSvgBindings(): string[] {
  const bindings: string[] = []

  for (const path of sourceFiles(SRC_ROOT)) {
    const relativePath = path.slice(SRC_ROOT.length).replace(/\\/g, "/")
    for (const statement of stripComments(readFileSync(path, "utf8")).match(SVG_IMPORT) ?? []) {
      const named = statement.match(SVG_NAMED_BINDING)?.[1]
      if (!named) continue
      for (const specifier of named.split(",")) {
        // `import { Svg as Alias }` and `import { type Foo }` both reduce to the
        // name as exported, which is what the stub has to provide.
        const name = specifier.replace(/\btype\b/, "").trim().split(/\s+as\s+/)[0]?.trim()
        if (name) bindings.push(`${relativePath}: ${name}`)
      }
    }
  }

  return bindings.sort()
}

describe("react-native-svg stub parity", () => {
  it("re-exports exactly the module this test compares against", async () => {
    // The rest of this file treats `elements.web.js`'s exports as the stub's
    // surface. If the stub ever grows a second source module, that stops being
    // true, and every assertion below would quietly under-report.
    const reExports = [
      ...stripComments(readFileSync(STUB_SOURCE, "utf8")).matchAll(/from\s+["']([^"']+)["']/g),
    ]
    expect([...new Set(reExports.map((match) => match[1]))]).toEqual([STUB_ELEMENTS])
  })

  it("never exports something the real web entry does not", async () => {
    const elements = await load(STUB_ELEMENTS)
    const web = await load("react-native-svg/lib/module/ReactNativeSVG.web.js")
    expect(Object.keys(elements).filter((name) => !(name in web))).toEqual([])
  })

  it("records every runtime export it leaves out, so no gap is silent", async () => {
    const elements = await load(STUB_ELEMENTS)
    const web = await load("react-native-svg/lib/module/ReactNativeSVG.web.js")
    const unrecorded = Object.keys(web).filter((name) => !(name in elements) && !(name in OMITTED))
    expect(unrecorded).toEqual([])
  })

  it("has no omission on record that the web entry no longer exports", async () => {
    // Without this, an upstream removal would leave a stale entry behind,
    // silently licensing an export that no longer exists.
    const web = await load("react-native-svg/lib/module/ReactNativeSVG.web.js")
    expect(Object.keys(OMITTED).filter((name) => !(name in web))).toEqual([])
  })

  it("is the whole of what this library's react-native-svg imports resolve to", async () => {
    // The assertion that makes the four above worth having. Typecheck, lint,
    // every web Vitest project and Storybook resolve the *real* web entry, so
    // an icon reaching past the stub would pass all of them and fail only in the
    // running web app.
    const elements = await load(STUB_ELEMENTS)
    const unavailable = importedSvgBindings().filter((binding) => {
      const name = binding.slice(binding.lastIndexOf(": ") + 2)
      return !(name in elements)
    })
    expect(unavailable).toEqual([])
  })
})