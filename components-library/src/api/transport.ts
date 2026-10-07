import type { ProductsByIds } from "../business/ProductLookup/useProductLookup"
import type { MyStoreApi } from "../business/StoreScreen/useMyStoreProducts"
import type { ProductData, ProductsPage } from "../types/Product"
import type { AuthSession, StoreProfile, StoreUser } from "../types/Store"

/**
 * The two things that differ between the web and mobile apps.
 *
 * `baseUrl` is the only real platform difference (each app resolves its own host
 * before calling this — see `resolveApiUrl` in `mobile-application/src/api/client.ts`),
 * and `getToken` is the credential, which stays with the app's session store and is
 * passed in rather than imported.
 */
export type ApiConfig = {
  baseUrl: string
  /**
   * Read at call time, not captured, so a sign-out in another tab is reflected
   * immediately instead of after a reload.
   */
  getToken: () => string | null
  /**
   * Injected so a test never has to reach the global. Defaults to `globalThis.fetch`,
   * resolved per call rather than per module so a stub installed after `createApi`
   * still applies.
   */
  fetchImpl?: typeof fetch
}

/**
 * A non-2xx response, with the status intact.
 *
 * `ApiError` rather than a bare `Error` because callers branch on 401: the My
 * Store screens need to tell "your session expired, sign in again" apart from
 * "the server is down", and a message string cannot carry that.
 *
 * One class identity in the process — it is exported from this module rather than
 * returned by `createApi`, so `instanceof ApiError` works against a client this
 * package did not create.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(path: string, status: number, message: string) {
    // The path is on the error rather than the message: the message comes from
    // the server and is shown to a user, the path is for a console.
    super(`${path}: ${message}`)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * The HTTP boundary, owned once.
 *
 * Both apps used to carry their own copy of `request`, `errorMessage`, `json`,
 * `authedRequest` and the endpoint set. `baseUrl` and `getToken` are the only two
 * things that actually differed, and both are single values, so everything else
 * lives here: one header-merge order, one 204 rule, one error-message fallback,
 * enforced by the tests in `transport.test.ts` instead of by two files agreeing.
 *
 * Deliberately imports no store and no react-native: this is plain fetch logic
 * with no DOM in it, which is what lets it be tested in the node `utils` Vitest
 * project. Apps pass `getSessionToken` in.
 */
export function createApi(config: ApiConfig) {
  const { baseUrl, getToken } = config
  const doFetch: typeof fetch = config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))

  /**
   * One fetch wrapper for the whole client.
   *
   * `init` was added for the write path; the read helpers below call it with no
   * `init`, so every existing call site is unchanged.
   */
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, init)
    if (!response.ok) {
      throw new ApiError(path, response.status, await errorMessage(response))
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  /** Prefers the server's `message`, falling back to the status line. */
  async function errorMessage(response: Response) {
    try {
      const body = await response.json()
      if (typeof body?.message === "string") return body.message
    } catch {
      // A non-JSON body (a proxy's HTML error page, say) falls through to the
      // status line rather than throwing a second parse error.
    }
    return `Request failed with status ${response.status}`
  }

  function json<T>(method: string, path: string, body: unknown) {
    return request<T>(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  /**
   * A request carrying the caller's session token.
   *
   * The endpoint wrappers below are all built on it, and it is returned so a
   * caller can reach an authenticated endpoint that has no wrapper yet without
   * re-implementing the header merge.
   */
  function authedRequest<T>(path: string, init?: RequestInit) {
    const token = getToken()
    return request<T>(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        // Spread last, so a caller-supplied header wins over the defaults above.
        ...init?.headers,
      },
    })
  }

  /**
   * `q` is the case-insensitive substring search the marketplace uses for its
   * search bar. When set, the server filters against `title` OR `description`
   * for the whole catalogue (not just the pages already loaded), so the same
   * `q` reaches the same answer regardless of which page a shopper has scrolled
   * to.
   */
  function fetchProducts(page = 1, q?: string) {
    const params = new URLSearchParams({ page: String(page) })
    const trimmed = q?.trim()
    if (trimmed) params.set("q", trimmed)
    return request<ProductsPage>(`/products?${params.toString()}`)
  }

  function fetchProduct(id: string) {
    return request<ProductData>(`/products/${encodeURIComponent(id)}`)
  }

  /**
   * Resolve remembered product ids to live products, one request for the lot.
   *
   * The comma is left unescaped on purpose — it is a legal separator inside a
   * query value, and the ids themselves are escaped. `missing` is what lets the
   * cart, the wishlist and the recently-viewed rail drop a product a seller has
   * since deleted; see `useProductLookup`.
   */
  function fetchProductsByIds(ids: string[], signal?: AbortSignal) {
    const query = ids.map((id) => encodeURIComponent(id)).join(",")
    return request<ProductsByIds>(`/products/by-ids?ids=${query}`, { signal })
  }

  function fetchStore(id: string) {
    return request<StoreProfile>(`/stores/${encodeURIComponent(id)}`)
  }

  function fetchStoreProducts(id: string, page = 1) {
    return request<ProductsPage>(`/stores/${encodeURIComponent(id)}/products?page=${page}`)
  }

  // --- auth ---

  /** Both credential endpoints answer with the session, so both return it whole. */
  function register(input: { email: string; password: string; storeName: string }) {
    return json<AuthSession>("POST", "/auth/register", input)
  }

  function login(input: { email: string; password: string }) {
    return json<AuthSession>("POST", "/auth/login", input)
  }

  function logout() {
    return authedRequest<void>("/auth/logout", { method: "POST" })
  }

  function fetchMe() {
    return authedRequest<StoreUser>("/auth/me")
  }

  /** `useSessionBootstrap`'s validator. Takes the token so it can be passed on. */
  function validateSession(token: string) {
    return request<StoreUser>("/auth/me", { headers: { authorization: `Bearer ${token}` } })
  }

  // --- my store ---

  function fetchMyProducts() {
    return authedRequest<ProductsPage>("/my-store/products")
  }

  function createMyProduct(values: {
    title: string
    description?: string
    price: number
    imageUrl?: string
    stock: number
  }) {
    return authedRequest<ProductData>("/my-store/products", {
      method: "POST",
      body: JSON.stringify(values),
    })
  }

  function updateMyProduct(
    id: string,
    values: Partial<{
      title: string
      description?: string
      price: number
      imageUrl?: string
      stock: number
    }>,
  ) {
    return authedRequest<ProductData>(`/my-store/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    })
  }

  function deleteMyProduct(id: string) {
    return authedRequest<void>(`/my-store/products/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  }

  /**
   * The My Store transport, in the shape `components-library` asks for.
   *
   * Built here rather than in each app's module so the four functions a My Store
   * route needs are named once. Passing the references straight through also means
   * no per-member `Parameters<typeof …>` adapter — the signatures already match.
   */
  const myStoreApi: MyStoreApi = {
    list: fetchMyProducts,
    create: createMyProduct,
    update: updateMyProduct,
    remove: deleteMyProduct,
  }

  return {
    authedRequest,
    fetchProducts,
    fetchProduct,
    fetchProductsByIds,
    fetchStore,
    fetchStoreProducts,
    register,
    login,
    logout,
    fetchMe,
    validateSession,
    fetchMyProducts,
    createMyProduct,
    updateMyProduct,
    deleteMyProduct,
    myStoreApi,
  }
}

/** The client `createApi` returns — the endpoint surface both apps re-export. */
export type Api = ReturnType<typeof createApi>
