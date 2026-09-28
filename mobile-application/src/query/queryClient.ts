import { QueryClient } from "@tanstack/react-query"

// v5's default staleTime is 0, so every remount/refocus can trigger a
// background refetch of every already-loaded product page — wasted work
// for catalog data that doesn't change minute to minute.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
})
