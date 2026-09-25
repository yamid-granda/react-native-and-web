import type { Preview } from "@storybook/react"
import "../global.css"

// Matches --color-background in global.css (zinc-50 / zinc-950).
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
      document.documentElement.classList.toggle("dark", name === "dark")
      return <Story />
    },
  ],
}

export default preview
