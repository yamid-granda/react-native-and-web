import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CatalogueView } from "../app/catalogue-view"

// `lib/api` is a re-export of the shared client (`createApi` in
// `@rnw/components-library`/api/transport), but the module path and every export
// name are unchanged, so this automock still intercepts all the call sites. The
// transport behind it is covered in components-library/src/api/transport.test.ts.
vi.mock("../lib/api")
vi.mock("solito/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const initialPage = {
  items: [{ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 }],
  page: 1,
  limit: 20,
  total: 1,
  hasNextPage: false,
}

function renderWithClient(ui: ReactElement) {
  // The first page is seeded from the server render, so it must not be refetched:
  // this test is about the server-fetched page being shown, not query timing.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("CatalogueView", () => {
  it("renders the server-fetched first page", () => {
    renderWithClient(<CatalogueView initialPage={initialPage} />)

    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
  })
})
