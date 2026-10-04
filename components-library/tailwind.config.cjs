const preset = require("./tailwind-preset.cjs")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset"), preset],
  content: ["./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
  important: "html",
  // Every config in the repo sets darkMode: "class", and
  // tokens.parity.test.ts fails if one stops. The palette itself flips in
  // tokens.css, not here: web's Theme button and Storybook's backgrounds toolbar
  // toggle `.light`/`.dark`, and native follows `Appearance` instead.
  darkMode: "class",
}
