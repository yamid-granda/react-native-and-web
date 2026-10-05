import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, createApi } from "./transport"

/**
 * The request pipeline both apps used to carry twice and test never.
 *
 * Every case here is one that could land on one platform and miss the other — the
 * header merge order, the 204 short-circuit, the non-JSON error fallback — with
 * nothing in the repository able to observe it. Plain `.test.ts` so it runs in the
 * node `utils` project: the transport has no DOM and no react-native in its
 * module graph, and `fetch` is stubbed per test.
 */

const BASE_URL = "http://api.test:3001"

/** The shape of a `vi.fn` stub standing in for `fetch`. */
type FetchStub = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>
>

/**
 * Stubs the global `fetch` with a `Response`-shaped stand-in.
 *
 * Modelled on the real thing where it matters: a 204 carries no body, so `json()`
 * rejects on the empty string exactly as `Response.json()` does, and a non-JSON
 * body rejects the same way. A stub that resolved instead would leave the
 * short-circuit and the error fallback untested.
 */
function respondWith(body: unknown, init?: { status?: number; text?: string }) {
  const status = init?.status ?? 200
  const raw = status === 204 ? "" : (init?.text ?? JSON.stringify(body))
  const stub = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(raw),
    text: async () => raw,
  }))
  vi.stubGlobal("fetch", stub)
  return stub
}

/** The `RequestInit` the transport passed on the nth call. */
function initOf(fetch: FetchStub, nth = 0): RequestInit {
  return (fetch.mock.calls[nth]?.[1] ?? {}) as RequestInit
}

/** The merged headers the transport sent on the nth call. */
function headersOf(fetch: FetchStub, nth = 0): Record<string, string> {
  return (initOf(fetch, nth).headers ?? {}) as Record<string, string>
}

/** The absolute URL the transport requested on the nth call. */
function urlOf(fetch: FetchStub, nth = 0): string {
  return String(fetch.mock.calls[nth]?.[0])
}

function makeApi(token: string | null = null) {
  return createApi({ baseUrl: BASE_URL, getToken: () => token })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createApi — authenticated requests", () => {
  it("sends the bearer token when there is one", async () => {
    const fetch = respondWith({ items: [], page: 1 })
    await makeApi("tok_abc").fetchMyProducts()

    expect(headersOf(fetch).authorization).toBe("Bearer tok_abc")
  })

  it("omits the authorization header entirely when there is no token", async () => {
    const fetch = respondWith({ items: [], page: 1 })
    await makeApi(null).fetchMyProducts()

    // Not `Bearer null` and not an empty string: an anonymous request must not
    // carry a bearer header at all.
    expect(headersOf(fetch)).not.toHaveProperty("authorization")
  })

  it("reads the token per request, so a sign-out elsewhere applies immediately", async () => {
    const fetch = respondWith({ items: [], page: 1 })
    let token: string | null = "tok_abc"
    const api = createApi({ baseUrl: BASE_URL, getToken: () => token })

    await api.fetchMyProducts()
    token = null
    await api.fetchMyProducts()

    expect(headersOf(fetch, 0).authorization).toBe("Bearer tok_abc")
    expect(headersOf(fetch, 1)).not.toHaveProperty("authorization")
  })
})

describe("createApi — header merge order", () => {
  it("sets content-type only when there is a body", async () => {
    const withBody = respondWith({})
    await makeApi().createMyProduct({ title: "Mug", price: 8, stock: 1 })
    expect(headersOf(withBody)).toHaveProperty("content-type", "application/json")

    const withoutBody = respondWith({ items: [], page: 1 })
    await makeApi().fetchMyProducts()
    expect(headersOf(withoutBody)).not.toHaveProperty("content-type")
  })

  it("lets a caller-supplied header win over the content-type default", async () => {
    const fetch = respondWith({})

    // Pinned through `authedRequest` directly, because no endpoint wrapper passes
    // its own `headers`: the order is only observable by reaching the merge
    // itself. Move `...init.headers` above the defaults and this fails.
    await makeApi("tok").authedRequest("/somewhere", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })

    expect(headersOf(fetch)["content-type"]).toBe("application/x-www-form-urlencoded")
  })

  it("gives a bodyless write no content-type at all", async () => {
    const fetch = respondWith({})

    // `logout` and `deleteMyProduct` pass only a method; they must not gain a
    // content-type they never asked for.
    await makeApi("tok").deleteMyProduct("prd_1")

    expect(headersOf(fetch)).not.toHaveProperty("content-type")
  })
})

describe("createApi — responses", () => {
  it("returns undefined for a 204 instead of parsing an empty body", async () => {
    respondWith(undefined, { status: 204 })

    // `logout` and `deleteMyProduct` are typed `Promise<void>`; without the
    // short-circuit both would call `response.json()` on an empty body and reject.
    await expect(makeApi("tok").logout()).resolves.toBeUndefined()
  })

  it("throws an ApiError carrying the status and the server's message", async () => {
    respondWith({ message: "Not authenticated" }, { status: 401 })

    const error: unknown = await makeApi("tok")
      .fetchMe()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
    // The path rides along for a console; the message is what a user is shown.
    expect((error as ApiError).message).toBe("/auth/me: Not authenticated")
  })

  it("degrades to the status line when the error body is not JSON", async () => {
    respondWith(undefined, { status: 502, text: "<html>Bad Gateway</html>" })

    // A proxy's HTML 502 must not throw a second parse error from inside the
    // error path, which is what this fallback exists to prevent.
    const error: unknown = await makeApi()
      .fetchProducts()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(502)
    expect((error as ApiError).message).toBe("/products?page=1: Request failed with status 502")
  })
})

describe("createApi — fetchProducts", () => {
  it("asks the server for the search, rather than leaving it to filter the page", async () => {
    const fetch = respondWith({})
    await makeApi().fetchProducts(1, "blusa para bebé")

    // Escaped, because the term is free text on its way into a query string, and
    // it reaches the server because that is the only layer holding the whole
    // catalogue — a client-side filter only ever sees the pages already loaded.
    expect(urlOf(fetch)).toBe(`${BASE_URL}/products?page=1&q=blusa%20para%20beb%C3%A9`)
  })

  it("pages and searches together", async () => {
    const fetch = respondWith({})
    await makeApi().fetchProducts(3, "kettle")
    expect(urlOf(fetch)).toBe(`${BASE_URL}/products?page=3&q=kettle`)
  })

  /// A blank box is no search, so it must be the same request — otherwise clearing
  /// the input re-keys the query and the shopper loses the pages already fetched.
  it("omits a blank term rather than sending an empty one", async () => {
    for (const blank of [undefined, "", "   "]) {
      const fetch = respondWith({})
      await makeApi().fetchProducts(2, blank)
      expect(urlOf(fetch), `q: ${JSON.stringify(blank)}`).toBe(`${BASE_URL}/products?page=2`)
    }
  })
})

describe("createApi — validateSession", () => {
  it("sends the token it is given, not the store's", async () => {
    const fetch = respondWith({ id: "usr_1" })

    // Bootstrap runs before the session store settles, so this is the one place
    // that spells the header out by hand against an argument.
    await makeApi("tok_from_store").validateSession("tok_from_argument")

    expect(headersOf(fetch).authorization).toBe("Bearer tok_from_argument")
  })
})

describe("createApi — baseUrl", () => {
  it("prefixes every path with the configured base URL", async () => {
    const fetch = respondWith({})
    await makeApi().fetchProduct("prd/1")

    expect(urlOf(fetch)).toBe(`${BASE_URL}/products/prd%2F1`)
  })

  it("prefers an injected fetch implementation over the global", async () => {
    const injected = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }))
    const globalFetch = vi.fn()
    vi.stubGlobal("fetch", globalFetch)

    await createApi({
      baseUrl: BASE_URL,
      getToken: () => null,
      fetchImpl: injected as unknown as typeof fetch,
    }).fetchProducts()

    expect(injected).toHaveBeenCalledOnce()
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
