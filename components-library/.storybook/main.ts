import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

// Web-only Storybook (react-native-web, Vite builder). @storybook/addon-react-native-web
// requires webpack5, so the alias it would set is configured directly below
// via viteFinal instead. safe-area-context stub: see README.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      "react-native-safe-area-context": fileURLToPath(
        new URL("../stubs/react-native-safe-area-context.js", import.meta.url),
      ),
      "react-native": "react-native-web",
    };
    return viteConfig;
  },
};

export default config;
