import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider, type UseMutationResult } from "@tanstack/react-query"
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import type { ProductData, ProductsPage } from "../../types/Product"
import type { ProductFormValues } from "../ProductFormScreen/ProductFormScreen"
import { useInfiniteProducts } from "../ProductListScreen/useInfiniteProducts"
import { useMyStoreMutations } from "./useMyStoreMutations"
import {
  PRODUCTS_KEY,
  myStoreKey,
  productQueryKey,
  productWriteKeys,
  storeKey,
  storeProductsKey,
  type MyStoreApi,
} from "./useMyStoreProducts"

const STORE_ID = "usr_1"
const PRODUCT_ID = "prd_1"

const product: ProductData = {
  id: PRODUCT_ID,
  title: "Leather Weekender Bag",
  description: "Full-grain leather.",
  price: 189,
  currency: "USD",
  stock: 6,
  storeId: STORE_ID,
  storeName: "Riverbend Vintage",
}

const page: ProductsPage = {
  items: [product],
  page: 1,
  limit: 20,
  total: 1,
  hasNextPage: false,
}

/** The production `staleTime`, from `web-application/app/providers.tsx`. It is
 *  the window in which a stale catalogue is served without a refetch, so it is
 *  the value these tests have to run at or they prove nothing. */
const PRODUCTION_STALE_TIME = 5 * 60 * 1000

function api(): MyStoreApi {
  return {
    list: vi.fn(() => Promise.resolve(page)),
    create: vi.fn(() => Promise.resolve(product)),
    update: vi.fn(() => Promise.resolve(product)),
    remove: vi.fn(() => Promise.resolve(undefined)),
  }
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function renderMutations(client: QueryClient, transport: MyStoreApi = api()) {
  return {
    ...renderHook(() => useMyStoreMutations(STORE_ID, transport), {
      wrapper: wrapperFor(client),
    }),
    transport,
  }
}

/** Seeds every key the policy touches, so a retired one is observable. */
function seedWrites(client: QueryClient) {
  const keys = productWriteKeys(STORE_ID, PRODUCT_ID)
  for (const queryKey of keys) client.setQueryData(queryKey, page)
  return keys
}

/** Starts a write without awaiting it, and returns the promise to await later. */
function actWrite(create: UseMutationResult<ProductData, Error, ProductFormValues, unknown>) {
  let pending: Promise<ProductData> = Promise.resolve(product)
  act(() => {
    pending = create.mutateAsync({ title: "Mug", price: 18, stock: 4 })
  })
  return pending
}

describe("productWriteKeys", () => {
  it("names every read a seller write can make wrong", () => {
    expect(productWriteKeys(STORE_ID, PRODUCT_ID)).toEqual([
      myStoreKey(STORE_ID),
      PRODUCTS_KEY,
      productQueryKey(PRODUCT_ID),
      storeKey(STORE_ID),
      storeProductsKey(STORE_ID),
    ])
  })
})

describe("useMyStoreMutations", () => {
  it("marks an update's own reads stale", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = seedWrites(client)
    const { result, transport } = renderMutations(client)

    await act(async () => {
      await result.current.update.mutateAsync({ id: PRODUCT_ID, values: { price: 99 } })
    })

    expect(transport.update).toHaveBeenCalledWith(PRODUCT_ID, { price: 99 })
    for (const queryKey of keys) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  })

  it("keys a create's invalidation on the product the server made", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = seedWrites(client)
    const { result, transport } = renderMutations(client)

    await act(async () => {
      await result.current.create.mutateAsync({ title: "Mug", price: 18, stock: 4 })
    })

    expect(transport.create).toHaveBeenCalledWith({ title: "Mug", price: 18, stock: 4 })
    for (const queryKey of keys) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  })

  it("retires the catalogue and the storefront after a delete", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = seedWrites(client)
    const { result, transport } = renderMutations(client)

    await act(async () => {
      await result.current.remove.mutateAsync(PRODUCT_ID)
    })

    expect(transport.remove).toHaveBeenCalledWith(PRODUCT_ID)
    for (const queryKey of keys) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  })

  // The regression this hook exists for. A seller edits a price, lands back on a
  // fresh `/my-store`, and a buyer with the app already open then opens the
  // marketplace: `["products"]` is younger than the five-minute window, so without
  // an invalidation react-query serves the old price and never refetches.
  it("makes a mounted catalogue reader refetch after a write", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: PRODUCTION_STALE_TIME } },
    })
    const fetchProducts = vi.fn((_page: number) => Promise.resolve(page))

    function MarketplaceTab() {
      const catalogue = useInfiniteProducts(fetchProducts)
      const store = useMyStoreMutations(STORE_ID, api())
      return (
        <button
          type="button"
          onClick={() => store.create.mutate({ title: "Mug", price: 18, stock: 4 })}
          disabled={catalogue.isLoading}
        >
          {catalogue.products.length}
        </button>
      )
    }

    render(<MarketplaceTab />, { wrapper: wrapperFor(client) })

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("1"))
    expect(fetchProducts).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button"))

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledTimes(2))
  })

  it("reports isMutating while a write is in flight", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    let release: (created: ProductData) => void = () => {}
    const transport = api()
    transport.create = vi.fn(() => new Promise<ProductData>((resolve) => (release = resolve)))

    const { result } = renderMutations(client, transport)

    expect(result.current.isMutating).toBe(false)
    const pending = actWrite(result.current.create)
    await waitFor(() => expect(result.current.isMutating).toBe(true))

    await act(async () => {
      release(product)
      await pending
    })
    await waitFor(() => expect(result.current.isMutating).toBe(false))
  })

  it("surfaces a failed write as the mutation's error and retires nothing", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const transport = api()
    transport.create = vi.fn(() => Promise.reject(new Error("Title must be at most 200 characters")))

    const { result } = renderMutations(client, transport)

    await act(async () => {
      await expect(
        result.current.create.mutateAsync({ title: "Mug", price: 18, stock: 4 }),
      ).rejects.toThrow("Title must be at most 200 characters")
    })
    await waitFor(() =>
      expect(result.current.create.error?.message).toBe("Title must be at most 200 characters"),
    )
    expect(result.current.isMutating).toBe(false)
    // The server still holds the old row, so nothing is retired.
    expect(client.getQueryState(PRODUCTS_KEY)).toBeUndefined()
  })
})