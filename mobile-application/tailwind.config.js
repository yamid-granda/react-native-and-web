const preset = require("../components-library/tailwind-preset.cjs")

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("nativewind/preset"), preset],
  content: ["./App.tsx", "./src/**/*.{ts,tsx}", "../components-library/src/**/*.{ts,tsx}"],
}
