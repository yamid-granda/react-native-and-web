"use client"

import type { ReactNode } from "react"
import { useServerInsertedHTML } from "next/navigation"
import { StyleSheet } from "react-native"

// react-native-web adds getSheet() at runtime; real react-native's types don't know it.
type StyleSheetWithSsrSheet = typeof StyleSheet & {
  getSheet: () => { id: string; textContent: string }
}

// Flushes react-native-web's runtime stylesheet into the SSR HTML to avoid a
// flash of unstyled content (Tailwind/NativeWind output needs no runtime injection).
export function SsrStylesWrapper({ children }: { children: ReactNode }) {
  useServerInsertedHTML(() => {
    const sheet = (StyleSheet as StyleSheetWithSsrSheet).getSheet()
    // biome-ignore lint/security/noDangerouslySetInnerHtml: injecting RNW's own generated stylesheet, not user input.
    return <style id={sheet.id} dangerouslySetInnerHTML={{ __html: sheet.textContent }} />
  })

  return <>{children}</>
}
