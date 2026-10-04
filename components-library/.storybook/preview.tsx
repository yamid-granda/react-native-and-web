import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { Preview } from "@storybook/react"
import "../global.css"

// Matches --color-background in tokens.css (zinc-50 / zinc-950).
const APP_LIGHT_BACKGROUND = "#fafafa"
const APP_DARK_BACKGROUND = "#09090b"

/**
 * A QueryClient for stories, one per browser session.
 *
 * `useState` rather than a module-level constant so a story that writes through
 * a mutation starts from a clean cache on reload, and `retry: false` so a story
 * that deliberately fails renders its error state instead of retrying forever.
 * Both apps wrap the real app in a provider with a five-minute catalog
 * `staleTime`; stories have no server, so there is nothing to keep fresh.
 */
let storybookQueryClient: QueryClient | undefined
function queryClient() {
  storybookQueryClient ??= new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return storybookQueryClient
}

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    backgrounds: {
      options: {
        light: { name: "light", value: APP_LIGHT_BACKGROUND },
        dark: { name: "dark", value: APP_DARK_BACKGROUND },
      },
    },
  },
  initialGlobals: {
    backgrounds: "light",
  },
  decorators: [
    (Story, context) => {
      const background = context.globals.backgrounds
      const name = typeof background === "string" ? background : background?.value
      // Both classes, because tokens.css decides dark mode by outranking the OS
      // media query with `.light`/`.dark` rather than by `:not(.light)` — a
      // selector React Native CSS Interop cannot extract on native, and native
      // ignores both of these anyway since it has no DOM to put them on.
      document.documentElement.classList.toggle("dark", name === "dark")
      document.documentElement.classList.toggle("light", name === "light")
      // Stories have no api layer to inject a fetcher from, so the screens that
      // take one get a stub that resolves nothing. A screen whose data lives in a
      // persisted store then renders its empty state, which is a real story to
      // look at; the "with items" variants seed the store and stub the lookup.
      return (
        <QueryClientProvider client={queryClient()}>
          <Story />
        </QueryClientProvider>
      )
    },
  ],
}

export default preview
