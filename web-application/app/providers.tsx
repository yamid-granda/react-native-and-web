"use client"

import { useCallback, useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSessionBootstrap } from "@rnw/components-library"
import { validateSession } from "../lib/api"

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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}