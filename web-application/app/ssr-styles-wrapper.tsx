"use client";

import type { ReactNode } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { StyleSheet } from "react-native";

// `react-native` is aliased to react-native-web at bundle time (next.config.ts),
// but react-native-web ships zero TypeScript declarations, so `StyleSheet`
// here is still typed against real react-native, which doesn't know about
// this react-native-web-only method.
type StyleSheetWithSsrSheet = typeof StyleSheet & {
  getSheet: () => { id: string; textContent: string };
};

/**
 * Flushes react-native-web's own runtime stylesheet (base component styles,
 * `style={{...}}` inline props -> atomic CSS classes) into the initial SSR
 * HTML response, so there's no flash of unstyled content for those styles.
 *
 * This is separate from Tailwind/NativeWind's `className` output, which is
 * already compiled at build time into app/globals.css and needs no runtime
 * injection.
 */
export function SsrStylesWrapper({ children }: { children: ReactNode }) {
  useServerInsertedHTML(() => {
    const sheet = (StyleSheet as StyleSheetWithSsrSheet).getSheet();
    return <style id={sheet.id} dangerouslySetInnerHTML={{ __html: sheet.textContent }} />;
  });

  return <>{children}</>;
}
