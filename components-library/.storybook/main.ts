import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Web-based Storybook only: it renders RN-primitive components through
 * react-native-web, the exact same rendering path Next.js uses. This gives
 * the most representative "does it work on web" preview with the fastest
 * iteration loop (browser HMR, no simulator boot), so a separate on-device
 * Storybook isn't set up here — Detox already covers native-runtime
 * fidelity in mobile-application.
 *
 * @storybook/addon-react-native-web (the "official" addon for this) only
 * supports the webpack5 Storybook framework — its preset unconditionally
 * `require()`s `webpack`, which isn't installed here since we use the Vite
 * builder for fast HMR. The alias it would have configured is set directly
 * below via `viteFinal` instead.
 *
 * The react-native-safe-area-context alias below points at ../stubs/, which
 * web-application's next.config.ts also references — see the comment there
 * for why it's needed.
 */
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
