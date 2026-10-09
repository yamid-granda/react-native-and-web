import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DesktopHeader } from "../app/desktop-header"
import { NavHeader } from "../app/nav-header"
import { ProductListScreen } from "@rnw/components-library"

// solito/navigation's useRouter() calls next/navigation's useRouter, which
// throws outside a real Next.js app router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("solito/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("solito/navigation")>()
  return { ...actual, useRouter: () => ({ push: vi.fn() }) }
})

// useThemeToggle reads NativeWind's useColorScheme, which the vitest
// nativewind stub does not provide — the header only needs its return shape.
vi.mock("../app/use-theme-toggle", () => ({
  useThemeToggle: () => ({ theme: "light" as const, toggleTheme: vi.fn() }),
}))

const fetchProductsByIds = async (ids: string[]) => ({ items: [], missing: ids })

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe("Desktop shell", () => {
  it("renders the desktop header with crawlable links and a theme toggle", () => {
    render(<DesktopHeader />)

    expect(screen.getByTestId("desktop-header")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("link", { name: "My Store" })).toHaveAttribute(
      "href",
      "/my-store",
    )
    expect(screen.getByRole("button", { name: "Theme" })).toBeInTheDocument()
  })

  it("renders the bottom nav for phone/tablet alongside the desktop header", () => {
    render(
      <>
        <DesktopHeader />
        <NavHeader />
      </>,
    )

    // Exactly one nav per viewport: BottomNav is `lg:hidden`, DesktopHeader
    // is `hidden lg:flex` — both in the DOM, each visible in its own range
    // (visibility itself is asserted in e2e/desktop.spec.ts, where CSS applies).
    const mobileNav = screen.getByTestId("bottom-nav-mobile")
    const desktopNav = screen.getByTestId("desktop-header")
    expect(mobileNav).toBeInTheDocument()
    expect(desktopNav).toBeInTheDocument()
    expect(within(mobileNav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    expect(within(desktopNav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
  })
})

describe("Marketplace desktop grid (web split)", () => {
  const products = [
    { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 },
    { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 },
  ]

  it("renders the filters rail and grid landmarks", () => {
    renderWithClient(
      <ProductListScreen products={products} fetchProductsByIds={fetchProductsByIds} />,
    )

    // Column counts are computed CSS (2/3/4/5 across phone/tablet/desktop/wide);
    // jsdom has no layout, so the ladder itself is asserted in
    // e2e/desktop.spec.ts against a real browser.
    expect(screen.getByTestId("marketplace-filters-rail")).toBeInTheDocument()
    expect(screen.getByTestId("marketplace-grid")).toBeInTheDocument()
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
  })
})
