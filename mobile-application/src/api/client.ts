import Constants from "expo-constants"
import { createApi, getSessionToken } from "@rnw/components-library"

// "localhost" means the phone itself on a physical device via Expo Go, not
// the dev machine — there's no EXPO_PUBLIC_API_URL override, derive the api
// host from the same address Metro's own dev server was reached at
// (Constants.expoConfig.hostUri, e.g. "192.168.1.21:8081"), which is
// guaranteed reachable since that's how the JS bundle itself just loaded.
function resolveApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL
  }

  const host = Constants.expoConfig?.hostUri?.split(":")[0]
  return host ? `http://${host}:3001` : "http://localhost:3001"
}

/**
 * This app's HTTP client.
 *
 * The transport itself is `createApi` in `@rnw/components-library` — one
 * implementation shared with the web app, with the request pipeline covered by
 * `components-library/src/api/transport.test.ts`. What stays here is
 * `resolveApiUrl`, the one real platform difference, and the token read; the web
 * client is the same shape with a `NEXT_PUBLIC_API_URL` constant instead
 * (see `web-application/lib/api.ts`).
 *
 * The endpoint names are re-exported individually so the existing
 * `import { fetchProducts } from "@/api/client"` call sites keep working unchanged.
 */
const api = createApi({
  baseUrl: resolveApiUrl(),
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
