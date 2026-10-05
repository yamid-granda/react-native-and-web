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
        // Values come from the --color-* custom properties that
        // components-library/tokens.css declares for every consumer (see
        // README "Architecture boundaries"), which flip for dark mode —
        // components use these instead of dark: variants.
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--color-surface-muted) / <alpha-value>)",
        // The outline of a control, kept apart from `surface-muted` so that
        // token can stay a plain fill: a border has to clear 3:1 against both
        // its neighbours (WCAG 1.4.11), a fill does not. `Button`'s outline and
        // chip variants use this; decorative dividers keep `surface-muted`,
        // which 1.4.11 does not cover.
        border: "rgb(var(--color-border) / <alpha-value>)",
        // The quieter edge, for a control that repeats down a form. Clearing
        // 3:1 is a floor rather than a target and overshoots as one: at ~1.7:1
        // this is the weight of iOS's systemGray4, and a cage of 3.4:1 borders
        // on every field reads as heavier than the cards it sits on. See the
        // "two border weights" section of tokens.css for the trade.
        "border-muted": "rgb(var(--color-border-muted) / <alpha-value>)",
      },
    },
  },
}
