import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import MarketplacePage from "../app/marketplace/page"
import { fetchProducts } from "../lib/api"

vi.mock("../lib/api")
vi.mock("solito/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("MarketplacePage", () => {
  it("renders the fetched products", async () => {
    vi.mocked(fetchProducts).mockResolvedValue({
      items: [{ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 }],
      page: 1,
      limit: 20,
      total: 1,
      hasNextPage: false,
    })

    renderWithClient(<MarketplacePage />)

    await waitFor(() => {
      expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    })
  })
})
