/**
 * Shared Tailwind/NativeWind theme, consumed as a `presets` entry by every
 * package's own tailwind.config (this package's Storybook config,
 * web-application, and mobile-application) so design tokens stay in sync
 * across web and native.
 */
module.exports = {
  theme: {
    extend: {
      // Single source of truth for the size of every button and input in the
      // repo. `h-control` is applied by components-library's Button/Input and
      // nothing anywhere else may hardcode a control height, so web and native
      // stay on one value without either app restating it. 2.75rem == 44px,
      // the smallest touch target iOS HIG and WCAG both consider comfortable.
      // `w-control` keeps square (icon) buttons circular at the same size.
      height: {
        control: "2.75rem",
      },
      width: {
        control: "2.75rem",
      },
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
