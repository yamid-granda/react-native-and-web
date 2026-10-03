import "../../global.css"
import { useCallback } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useSessionBootstrap } from "@rnw/components-library"
import { queryClient } from "../query/queryClient"
import { validateSession } from "../api/client"

export default function RootLayout() {
  // Mounted once, here, rather than per screen: the persisted token has to be
  // validated exactly once per app launch, and every guarded screen keys off the
  // status this sets. A stable reference matters — the hook runs inside a
  // useEffect, so an inline arrow would re-validate on every render.
  const validate = useCallback((token: string) => validateSession(token), [])
  useSessionBootstrap({ validate })

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* The repo's first root-level non-tab routes. My Store lives outside
                `(tabs)` precisely so the bottom bar stays at four items, which is
                what mobile-application/e2e/tab-bar-position.e2e.ts guards. */}
            <Stack.Screen name="login" />
            <Stack.Screen name="my-store" />
            <Stack.Screen name="stores/[id]" />
          </Stack>
          <StatusBar style="auto" />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}