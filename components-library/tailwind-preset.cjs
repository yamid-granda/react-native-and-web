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
      },
    },
  },
};
