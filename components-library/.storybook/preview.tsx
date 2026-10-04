import type { Preview } from "@storybook/react"
import "../global.css"

// Matches --color-background in tokens.css (zinc-50 / zinc-950).
const APP_LIGHT_BACKGROUND = "#fafafa"
const APP_DARK_BACKGROUND = "#09090b"

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
      return <Story />
    },
  ],
}

export default preview
