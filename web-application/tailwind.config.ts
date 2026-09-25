import type { Config } from "tailwindcss";
import preset from "../components-library/tailwind-preset.cjs";

// nativewind/preset ships no type declarations at all (its .d.ts is empty),
// so it can't be `import`ed in a typechecked config file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativewindPreset = require("nativewind/preset");

const config: Config = {
  presets: [nativewindPreset, preset],
  content: ["./app/**/*.{ts,tsx}", "../components-library/src/**/*.{ts,tsx}"],
  important: "html",
};

export default config;
