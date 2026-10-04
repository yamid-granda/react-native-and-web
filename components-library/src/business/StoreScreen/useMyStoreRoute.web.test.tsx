import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, act, waitFor } from "@testing-library/react"
import { ApiError } from "../../api/transport"
import type { ProductData, ProductsPage } from "../../types/Product"
import { useSessionStore } from "../AuthScreen/useSessionStore"
import type { MyStoreApi } from "./useMyStoreProducts"
import { useMyStoreRoute } from "./useMyStoreRoute"

const STORE_ID = "usr_1"
const PRODUCT_ID = "prd_1"

const user = { id: STORE_ID, email: "seller@example.com", storeName: "Riverbend Vintage" }

const product: ProductData = {
  id: PRODUCT_ID,
  title: "Leather Weekender Bag",
  price: 189,
  stock: 6,
}

const page: ProductsPage = { items: [product], page: 1, limit: 20, total: 1, hasNextPage: false }

/** What `components-library/src/api/transport.ts` throws for a rejected session. */
function expired(): ApiError {
  return new ApiError("/my-store/products", 401, "Not authenticated")
}

function api(overrides: Partial<MyStoreApi> = {}): MyStoreApi {
  return {
    list: vi.fn(() => Promise.resolve(page)),
    create: vi.fn(() => Promise.resolve(product)),
    update: vi.fn(() => Promise.resolve(product)),
    remove: vi.fn(() => Promise.resolve(undefined)),
    ...overrides,
  }
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function renderRoute(transport: MyStoreApi = api()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(
    () =>
      useMyStoreRoute(
        transport,
        () => {},
        () => {},
      ),
    {
      wrapper: wrapperFor(client),
    },
  )
}

// `.web.test.tsx` rather than `.test.ts`: the session store persists through
// `localStorage`, so the node-only `utils` project would exercise the in-memory
// fallback instead of the real web path.
describe("useMyStoreRoute — an expired session", () => {
  beforeEach(async () => {
    localStorage.clear()
    await useSessionStore.persist.rehydrate()
    useSessionStore.getState().setSession({ token: "stale-token", user })
  })

  it("signs the seller out when the list read comes back 401", async () => {
    // This is the reader `ApiError.status` was built for. Clearing the session
    // flips `useRequireSession` to "anonymous", and the `SessionGate` every My
    // Store route already wraps itself in then routes to the login screen — so no
    // per-app wiring is needed for either platform.
    const { result } = renderRoute(api({ list: vi.fn(() => Promise.reject(expired())) }))

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    await waitFor(() => expect(useSessionStore.getState().status).toBe("anonymous"))
    expect(useSessionStore.getState().token).toBeNull()
  })

  it("signs the seller out when a write comes back 401", async () => {
    // `onDelete` is the only write this route exposes; it stands in for the
    // create/edit routes, which run the same hook against their own forms.
    const transport = api({ remove: vi.fn(() => Promise.reject(expired())) })
    const { result } = renderRoute(transport)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(useSessionStore.getState().status).toBe("authenticated")

    await act(async () => {
      result.current.onDelete(PRODUCT_ID)
    })

    await waitFor(() => expect(useSessionStore.getState().status).toBe("anonymous"))
    expect(useSessionStore.getState().token).toBeNull()
  })

  it("leaves the session alone for any other failure", async () => {
    // A 500 is "the server is down", not "your session expired": signing the
    // seller out here would discard a valid token over a transient fault.
    const down = new ApiError("/my-store/products", 500, "Internal error")
    const { result } = renderRoute(api({ list: vi.fn(() => Promise.reject(down)) }))

    await waitFor(() => expect(result.current.error).toBe(down))
    expect(useSessionStore.getState().status).toBe("authenticated")
    expect(useSessionStore.getState().token).toBe("stale-token")
  })

  it("leaves the session alone when the read succeeds", async () => {
    const { result } = renderRoute()

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.products).toEqual([product])
    expect(useSessionStore.getState().status).toBe("authenticated")
  })
})
