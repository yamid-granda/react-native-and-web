const preset = require("../components-library/tailwind-preset.cjs")

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  presets: [require("nativewind/preset"), preset],
  content: ["./src/**/*.{ts,tsx}", "../components-library/src/**/*.{ts,tsx}"],
}
