import { addons } from "storybook/manager-api"
import { themes } from "storybook/theming"

// Storybook's own "normal" theme only reads prefers-color-scheme once, at
// module load, so it misses OS theme changes made while Storybook stays
// open. Re-applying on the matchMedia "change" event keeps it live.
const media = window.matchMedia("(prefers-color-scheme: dark)")

function applyTheme(isDark: boolean) {
  addons.setConfig({ theme: isDark ? themes.dark : themes.light })
}

applyTheme(media.matches)
media.addEventListener("change", (event) => applyTheme(event.matches))
