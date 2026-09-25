import { defineConfig } from "vitest/config"

// Ties the web/utils Vitest projects together via `projects` (Vitest 3.2+,
// not the deprecated vitest.workspace.ts). No native project — see README
// ("Architecture boundaries") for why.
export default defineConfig({
  test: {
    projects: ["./vitest.config.web.ts", "./vitest.config.utils.ts"],
  },
})
