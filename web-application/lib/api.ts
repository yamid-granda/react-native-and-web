import { createApi, getSessionToken } from "@rnw/components-library"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

/**
 * This app's HTTP client.
 *
 * The transport itself is `createApi` in `@rnw/components-library` — one
 * implementation shared with the mobile app, with the request pipeline covered by
 * `components-library/src/api/transport.test.ts`. All this app contributes is the
 * host it talks to and the session token it reads; the mobile client is the same
 * three lines with a different `baseUrl` (see `mobile-application/src/api/client.ts`).
 *
 * The endpoint names are re-exported individually so the existing
 * `import { fetchProducts } from "../../lib/api"` call sites and the
 * `vi.mock("../lib/api")` automocks in `tests/` keep working unchanged.
 */
const api = createApi({
  baseUrl: API_URL,
  getToken: getSessionToken,
})

export const {
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
} = api

export { ApiError } from "@rnw/components-library"
