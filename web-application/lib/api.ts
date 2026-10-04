import type {
  AuthSession,
  ProductData,
  ProductsByIds,
  ProductsPage,
  StoreProfile,
  StoreUser,
} from "@rnw/components-library"
import { getSessionToken } from "@rnw/components-library"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

/**
 * A non-2xx response, with the status intact.
 *
 * `ApiError` rather than a bare `Error` because callers branch on 401: the My
 * Store screens need to tell "your session expired, sign in again" apart from
 * "the server is down", and a message string cannot carry that.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(path: string, status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    // The path is on the error rather than the message: the message comes from
    // the server and is shown to a user, the path is for a console.
    this.message = `${path}: ${message}`
  }
}

/**
 * One fetch wrapper for the whole app.
 *
 * `init` was added for the write path; the read helpers below call it with no
 * `init`, so every existing call site is unchanged.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init)
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
 * The token is read from the store at call time rather than captured, so a
 * sign-out in another tab is reflected immediately instead of after a reload.
 */
function authedRequest<T>(path: string, init?: RequestInit) {
  const token = getSessionToken()
  return request<T>(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
}

export function fetchProducts(page = 1) {
  return request<ProductsPage>(`/products?page=${page}`)
}

export function fetchProduct(id: string) {
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
export function fetchProductsByIds(ids: string[], signal?: AbortSignal) {
  const query = ids.map((id) => encodeURIComponent(id)).join(",")
  return request<ProductsByIds>(`/products/by-ids?ids=${query}`, { signal })
}

export function fetchStore(id: string) {
  return request<StoreProfile>(`/stores/${encodeURIComponent(id)}`)
}

export function fetchStoreProducts(id: string, page = 1) {
  return request<ProductsPage>(`/stores/${encodeURIComponent(id)}/products?page=${page}`)
}

// --- auth ---

/** Both credential endpoints answer with the session, so both return it whole. */
export function register(input: { email: string; password: string; storeName: string }) {
  return json<AuthSession>("POST", "/auth/register", input)
}

export function login(input: { email: string; password: string }) {
  return json<AuthSession>("POST", "/auth/login", input)
}

export function logout() {
  return authedRequest<void>("/auth/logout", { method: "POST" })
}

export function fetchMe() {
  return authedRequest<StoreUser>("/auth/me")
}

/** `useSessionBootstrap`'s validator. Takes the token so it can be passed on. */
export function validateSession(token: string) {
  return request<StoreUser>("/auth/me", { headers: { authorization: `Bearer ${token}` } })
}

// --- my store ---

export function fetchMyProducts() {
  return authedRequest<ProductsPage>("/my-store/products")
}

export function createMyProduct(values: {
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

export function updateMyProduct(
  id: string,
  values: Partial<{ title: string; description?: string; price: number; imageUrl?: string; stock: number }>,
) {
  return authedRequest<ProductData>(`/my-store/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(values),
  })
}

export function deleteMyProduct(id: string) {
  return authedRequest<void>(`/my-store/products/${encodeURIComponent(id)}`, { method: "DELETE" })
}