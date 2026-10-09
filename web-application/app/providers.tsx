"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { LocaleProvider, resolveLocale, useSessionBootstrap, type Locale } from "@rnw/components-library"
import { validateSession } from "../lib/api"

const LOCALE_STORAGE_KEY = "locale"

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    return stored === "en" || stored === "es" ? stored : null
  } catch {
    return null
  }
}

export function Providers({ children }: { children: ReactNode }) {
  // v5's default staleTime is 0, so every remount/refocus can trigger a
  // background refetch of every already-loaded product page — wasted work
  // for catalog data that doesn't change minute to minute.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } } }),
  )

  // Mounted once, here, rather than per screen: the persisted token has to be
  // validated exactly once per app launch, and every guarded screen keys off the
  // status this sets. A stable reference matters — the hook runs inside a
  // useEffect, so an inline arrow would re-validate on every render.
  const validate = useCallback((token: string) => validateSession(token), [])
  useSessionBootstrap({ validate })

  // Server HTML stays English so ISR caches never bake one visitor's language
  // for the next; the client takes over on hydration (stored choice first,
  // then browser detection) and keeps `<html lang>` in sync for AT/crawlers.
  const [locale, setLocaleState] = useState<Locale>("en")
  useEffect(() => {
    const stored = readStoredLocale()
    setLocaleState(
      stored ?? resolveLocale(typeof navigator !== "undefined" ? navigator.language : undefined),
    )
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // Storage-blocked browsers keep the in-memory choice for the session.
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider locale={locale} onLocaleChange={setLocale}>
        {children}
      </LocaleProvider>
    </QueryClientProvider>
  )
}
