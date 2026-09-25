const preset = require("./tailwind-preset.cjs")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset"), preset],
  content: ["./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
  important: "html",
  // Storybook-only: web/mobile stay "media" (OS-driven, see preview.tsx) so the
  // backgrounds-addon toolbar can toggle dark mode independently of the OS.
  darkMode: "class",
}
