import "../../global.css"
import { useCallback, useMemo } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { getLocales } from "expo-localization"
import { LocaleProvider, resolveLocale, useSessionBootstrap } from "@rnw/components-library"
import { queryClient } from "../query/queryClient"
import { validateSession } from "../api/client"

export default function RootLayout() {
  // Mounted once, here, rather than per screen: the persisted token has to be
  // validated exactly once per app launch, and every guarded screen keys off the
  // status this sets. A stable reference matters — the hook runs inside a
  // useEffect, so an inline arrow would re-validate on every render.
  const validate = useCallback((token: string) => validateSession(token), [])
  useSessionBootstrap({ validate })

  // Auto-detected device locale (en/es, no switcher): read once at launch from
  // the OS preferred list; anything not Spanish falls back to English.
  const locale = useMemo(
    () => resolveLocale(getLocales()[0]?.languageCode ?? getLocales()[0]?.languageTag),
    [],
  )

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <LocaleProvider locale={locale}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* The repo's first root-level non-tab routes. Login and the public
                storefront live outside `(tabs)`; My Store is a tab now, so the
                bottom bar stays at four items — see the TAB_ITEMS above. */}
            <Stack.Screen name="login" />
            <Stack.Screen name="stores/[id]" />
          </Stack>
          <StatusBar style="auto" />
          </LocaleProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}