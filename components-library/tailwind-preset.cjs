/**
 * Shared Tailwind/NativeWind theme, consumed as a `presets` entry by every
 * package's own tailwind.config (this package's Storybook config,
 * web-application, and mobile-application) so design tokens stay in sync
 * across web and native.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2563eb",
          dark: "#1d4ed8",
        },
        // Values come from each app's --color-* custom properties (see
        // README "Architecture boundaries"), which flip for dark mode —
        // components use these instead of dark: variants.
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--color-surface-muted) / <alpha-value>)",
      },
    },
  },
}
