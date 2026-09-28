"use client"

import { useState, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

export function Providers({ children }: { children: ReactNode }) {
  // v5's default staleTime is 0, so every remount/refocus can trigger a
  // background refetch of every already-loaded product page — wasted work
  // for catalog data that doesn't change minute to minute.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } } }),
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
