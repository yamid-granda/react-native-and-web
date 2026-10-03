# Seller storefronts: a "My Store" section behind a basic login

## Problem / opportunity

The marketplace has exactly one supply source, and it is `api-rs`'s seed data.
The `Product` table has no owner column (only `20260926133034_create_product`
and `20260929101635_add_product_stock` exist), the router answers four GETs and
nothing else (`api-rs/src/app.rs:56-61`), and the frontend has no auth surface
whatsoever — no `middleware.ts`, no login screen, no `User`/`Session` type, no
`Authorization` header anywhere in the repo. A shopper can browse, wishlist and
buy, but the platform has no concept of a *seller*.

This is the proposal the rest of the folder is queued behind.
`2026-09-29-order-history.md:20-26` and
`2026-09-29-product-ratings-and-reviews.md:53-57` both explicitly punt on
identity ("the app has no auth/user model at all") while flagging that they are
what turn api-rs into a write path. `api-rs/ARCHITECTURE.md` §12 ("The write
path, and why there is no broker") exists so the *first* mutation lands on a
considered design, and `CacheTier::invalidate_detail`
(`api-rs/src/cache/mod.rs:75-81`) is the seam §12 says that first mutation is
supposed to use. Nothing in the folder touches either yet.

Every other open proposal adds *content* to a fixed catalog (reviews, coupons,
ratings, order records). This one is different in kind: it is the first change
to **who may put something in the catalog**. That makes it the first proposal
needing authorization rather than authentication, the first needing a write
path, and the first that has to invalidate the cache currently doing all the
heavy lifting for the public read path.

The marketplace stays public and unauthenticated. The new **My Store** section
is a per-user authenticated surface: sign in, then create, edit and delete your
own products, which then appear in the shared public marketplace next to the
seeded ones.

## Proposed approach

### Decisions

| Decision | Choice | Rejected |
| --- | --- | --- |
| Session mechanism | Opaque 256-bit random token in a `Session` table, sent as `Authorization: Bearer`; only its SHA-256 is stored | **JWT** — needs a signing dep and cannot be revoked before expiry. **httpOnly cookie** — `tower-http`'s `request`/`set-header` features are off (`api-rs/Cargo.toml`), so cookie plumbing is hand-rolled, and RN `fetch` cookie handling differs from the browser's. |
| Password storage | New direct dep `argon2`, verified on `tokio::task::spawn_blocking` | **bcrypt** (older primitive). **SHA-256 + salt** — a fast hash is not a password hash. |
| Credential storage (client) | Reuse the existing `localStorage` + in-memory-fallback helper, extracted once from its three existing copies | **`expo-secure-store`** — the right native answer, but per `mobile-application/AGENTS.md` a new native module means Expo Go stops being enough and the whole repo needs `expo run:ios` / an EAS dev build. Too big a change for this proposal to make unilaterally; named as the upgrade path below. |
| Entry point for My Store | `business/HomeScreen` (currently a counter stub) on both platforms, plus a tappable "Sold by `<store>`" line on the product detail screen | **A 5th bottom-nav tab** — the bar is already 4 items plus a Theme slot, and `mobile-application/e2e/tab-bar-position.e2e.ts` guards its geometry. |
| Seller identity in public data | Nullable `storeId`/`storeName` on the product payload via one `LEFT JOIN`, rendered as "Sold by `<store>`" and linked to a public store page | **No seller info** — products appear anonymously, which makes the storefront invisible. Costs a regeneration of the byte-compared goldens; accepted. |

Out of scope, deliberately: **image upload** (`imageUrl` stays a pasted URL —
an upload endpoint means object storage, content sniffing and a CDN, which is
its own proposal), product images beyond that, roles/permissions beyond "owner",
and password reset / email verification.

### 1. Schema: two tables, one nullable column

Reversible sqlx migration pairs under `api-rs/migrations/`, per `README.md`
("api-rs is Rust-only and owns its schema"):

- `20261003120000_create_user_and_session.{up,down}.sql`
  - `User (id TEXT PK, email TEXT NOT NULL UNIQUE, "passwordHash" TEXT NOT NULL, "storeName" TEXT NOT NULL, "createdAt" TIMESTAMP(3))` — `TEXT` ids match the existing `Product` house style; no new sequence or uuid extension.
  - `Session ("tokenHash" TEXT PK, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, "createdAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3))` plus an index on `("expiresAt")`.
  - Email uniqueness is a `UNIQUE` constraint, not a check — the database enforces it, so two concurrent registrations of the same address cannot both win.
- `20261003120100_add_product_owner.{up,down}.sql`
  - `ALTER TABLE "Product" ADD COLUMN "ownerId" TEXT REFERENCES "User"(id) ON DELETE SET NULL;`
  - `CREATE INDEX "Product_ownerId_createdAt_id_idx" ON "Product"("ownerId", "createdAt", "id");`

Three deliberate choices here:

- **`ownerId` is nullable.** Seeded products stay ownerless and `tests/fixtures/seed.sql` keeps working unchanged.
- **`ON DELETE SET NULL`, not `CASCADE`.** A deleted seller account must not silently delete products that other people may already have in a cart, wishlist or (per the open order-history proposal) a placed order. The products fall back to being anonymous listings.
- **The index is `("ownerId", "createdAt", "id")` because both owner-scoped queries want exactly that** — the equality prefix is `ownerId`, the sort is the same `"createdAt" ASC, "id" ASC` as `LIST_QUERY` (`api-rs/src/store/products.rs:87`). One index serves both the seller's private list and the public store page, and it inherits the same non-covering caveat §11 already records for the existing index.

The `.down.sql` for the owner pair must drop the index and the column, and it runs *before* the `User` drop because sqlx reverses the pairs — worth a comment in the migration, since the reverse order is the only thing keeping the `REFERENCES` valid.

### 2. api-rs: sessions and credentials

New `api-rs/src/store/users.rs` and `api-rs/src/store/sessions.rs`, plus a `#[async_trait]` `UserStore`/`SessionStore` alongside the existing `ProductStore` (`api-rs/src/store/products.rs:42-52`), re-exported from `api-rs/src/store/mod.rs`. `InMemoryStore` (`api-rs/src/store/memory.rs`) needs in-memory equivalents for handler unit tests, exactly as it does for products.

Token generation is 32 bytes from the OS RNG (`rand` is already a direct dependency) encoded with `base64` (also already direct, `0.22`), hashed with `sha2` (present transitively via rustls; promoted to a direct dependency for this). SHA-256 is the right primitive *here* and argon2 is not: the input is 256 bits of CSPRNG output, so there is nothing to brute-force — the hash exists only so a database leak does not hand over live sessions.

Password hashing is `argon2` with `SaltString::generate(&mut OsRng)`. Two implementation details that are easy to get wrong:

- **Verification must run on `spawn_blocking`.** Default argon2 parameters cost tens of milliseconds of pure CPU; on an async worker that is a stall, and `GLOBAL_CONCURRENCY_LIMIT` (1024) is the only thing bounding it. Hence the per-IP login throttle in §3 — it is not optional hardening, it is what keeps the worker pool alive.
- **Unit tests must use deliberately cheap `Params`** (e.g. `m_cost: 64, t_cost: 1`). Otherwise every handler test pays production hash cost and `cargo test --lib` grows by seconds.

Response and error shapes:

- `AppError` (`api-rs/src/error.rs:11-23`) has no 400/401/403/409 today. Add `Validation(String)` → 400, `Unauthorized` → 401, `Forbidden` → 403, `EmailTaken` → 409, each with a case in `status()` and `body()` (`error.rs:55-76`). The three existing error goldens are unaffected.
- Every authenticated or mutating response carries `Cache-Control: no-store`, passed through `json_response`'s `extra_headers` (`error.rs:117-141`). No seller response ever enters `CacheTier`.
- **Not-found, not forbidden.** `PATCH`/`DELETE` on a product the caller does not own returns `AppError::ProductNotFound` (404), not 403 — a 403 confirms the id exists to a non-owner, which is an enumeration oracle on a public catalog.
- `POST /auth/logout` returns a bare `204` built with `Response::builder()`, *not* `json_response`, because `json_response` would attach a content-type and a weak ETag to an empty body.

### 3. api-rs: the routes

Namespaced under `/auth` and `/my-store` rather than extending `/products`:

```
POST   /auth/register              { email, password, storeName } -> 201 { user, token }
POST   /auth/login                 { email, password }            -> 200 { user, token }
POST   /auth/logout                (Bearer)                       -> 204
GET    /auth/me                    (Bearer)                       -> 200 { user }
GET    /my-store/products?page=N   (Bearer)                       -> 200 ProductsPage
POST   /my-store/products          (Bearer)                       -> 201 Product
PATCH  /my-store/products/{id}     (Bearer)                       -> 200 Product
DELETE /my-store/products/{id}     (Bearer)                       -> 204
GET    /stores/{id}                                             -> 200 { id, storeName, createdAt }
GET    /stores/{id}/products?page=N                              -> 200 ProductsPage
```

`POST /products` on the public namespace would read as "anyone can create a product" and invite exactly the authorization hole this proposal closes; the `/my-store` prefix makes the auth requirement legible in the route table and keeps `GET /products` as the only public product route.

This also has a free consequence for the existing contract: `app.rs:59-60` gives `/products` and `/products/{id}` a `.fallback(any(fallback))` so a wrong method is `Cannot POST /products` (404, not 405), asserted at `app.rs:189-206`. Because no seller route is added to those two paths, **that test does not change**. The new routes keep the same convention — `.post(...).fallback(any(fallback))`, so `GET /my-store/products` is a 404 rather than a 405.

Three more specifics:

- **Pagination is reused, not reinvented.** `GET /my-store/products` calls `products::parse_page` (`handlers/products.rs:79-99`) so `?page=` behaves identically, including the float-truncation quirks the current clients already parse.
- **Login throttling reuses `RateLimiter` rather than a new mechanism.** `rate_limit.rs:199-215` is a Valkey fixed window keyed per client IP, and `client_ip` (`rate_limit.rs:160`) is already `pub`. Generalize the limiter from one rps value to a `(limit, window)` pair per scope — `General` (today's 1 s window) and `AuthLogin` (new `AUTH_LOGIN_ATTEMPTS_PER_MIN`, default 10, 60 s window) — and add `enforce_auth`, applied as a `route_layer` scoped to `/auth/login` and `/auth/register`. `route_layer` only wraps routes declared *before* it in the builder chain, which `app.rs:62-65` already relies on. This lives on `RateLimiter`, not on `AppState`, so `benches/handlers.rs:38-54` (which constructs `AppState` as a struct literal) does not break.
- **Honest limitation, stated rather than glossed:** the limiter is fail-open, like every Valkey consumer in this service (`ARCHITECTURE.md` §7). An unreachable Valkey removes the login throttle. A per-*account* throttle is not available on an unauthenticated endpoint without already telling the caller which accounts exist, so per-IP is the right bound here.

Finally, `POST /auth/login` must run a verification against a dummy hash when the email does not exist, so response timing does not disclose which addresses are registered. And `api-rs/src/telemetry.rs` should register an `auth_login_total{result="ok"|"invalid"}` counter — the reason the limiter exists is to be observable, and `http_metrics`' `MatchedPath` labels will pick up the new routes for free.

`api-rs/src/seed.rs` gains one demo seller plus one owned product so the `LEFT JOIN` and the owner-scoped queries are exercisable locally. Session rows are never seeded — a seeded token would be a live credential in every developer's database.

### 4. Cache: the list-generation counter, now shared by three list families

`ARCHITECTURE.md` already answers the invalidation hole (`ARCHITECTURE.md:460-484`): `invalidate_detail(id)` retires one product's detail entry, but list keys are `products:list:<page_bits>` (`handlers/products.rs:131`) and cannot be enumerated, so a price change would leave every cached list page stale for its TTL. §12's answer is a generation counter at `api-rs:products:list:gen` folded into every list key, bumped with `INCR` after the write commits.

This proposal is the first mutation, so it implements that counter — with one deviation, and one correction:

- **Deviation from the §12 sketch.** `ARCHITECTURE.md` shows `cache.get_generation().await?` on *every* list request. That is one extra Valkey round trip in front of the L1 hit path, on the hottest route in a service explicitly built for high traffic. Do it free instead: hold the generation in an `Arc<AtomicI64>` on `CacheTier`, seeded at startup and refreshed by a background task on the `L2_TTL_SECS` interval; `bump` does the `INCR` (fleet-wide correctness) and updates the local atomic (this instance is immediately correct). Worst case a marketplace page is stale for one refresh interval — exactly today's behaviour, since `L1_LIST_TTL_SECS` is 5 s anyway. When Valkey is disabled (`CacheTier::disabled()`, used by tests and benches) the generation is always 0 and bumping is a local increment. §12 should be updated to record this.
- **Correction to scope.** A new product is visible in *three* list families: `products:list`, `stores:{id}:products:list` (the seller's public page) and `my-store:products:list`. All three fold in the generation. The order §12 insists on still holds and still matters: `invalidate_detail(id)` **then** `bump_list_generation()`, so no reader can pair a fresh detail entry with a list filled before the write.

`/my-store/products` is per-user and therefore never cached at all — not in L1, not in L2, not at the edge.

### 5. The read replica and read-your-writes

`store/products.rs:101-105` names the hazard this proposal activates: *"Replica lag is the documented hazard — a just-created product can briefly be missing from the replica. That is only acceptable while products are immutable once visible; it becomes a correctness problem the moment `POST /products` exists."* `reads()` (`store/products.rs:146-148`) sends all product reads to the replica when one is configured.

Resolution, and it is a real trade-off rather than a free win:

- **All writes and all owner-scoped reads go to the primary**, the same pool `ping` already uses unconditionally. So a seller sees their own product in My Store and on their public store page immediately.
- **`GET /products` and `GET /stores/{id}/products` keep reading from the replica**, so the public marketplace may show a just-created product only after replica lag — sub-second on a healthy replica.
- If that is unacceptable, unsetting `DATABASE_READ_URL` puts every read on the primary and is a one-line config change. The code should not decide this; `ARCHITECTURE.md` §5 should record the choice and its cost.

Note the second-order consequence: with a *broken* replica (`tests/common/mod.rs`'s `broken_read_pool` helper covers this), a product created while the replica is down does not appear in the public marketplace at all, because reads fail open to the primary but the write is not replicated back. This is acceptable for a demo marketplace and should be written down rather than discovered.

### 6. Shared UI in `components-library`

All screens go in the shared library and are imported by both apps — no per-platform UI, per `.agents/rules/component-reuse.md`.

- **Types.** `types/Store.ts` (new): `StoreUser { id, email, storeName }` and `AuthSession { token, user }`. `types/Product.ts` gains `storeId?: string | null` and `storeName?: string | null` — optional, matching the existing `currency?`/`imageUrl?` style so the ~30 inline fixture objects in stories and tests do not all need editing, and nullable because the wire emits `null` for ownerless products. `ownerId` is deliberately **not** on `ProductData`: it is redundant (My Store only ever lists your own products) and it is not in the public payload.
- **`business/AuthScreen/AuthScreen.tsx`** — one screen, two modes (sign in / sign up) behind a toggle, so registration is not a separate route. Email, password, and `storeName` (sign-up only), inline validation, error display. Composed from `common/Input` and `common/Button`. `testID="auth-screen"`.
- **`business/StoreScreen/StoreScreen.tsx`** — the private My Store list: `storeName` heading, one row per product with edit and delete, an "Add product" `Button`, and an empty state. Structurally a sibling of `CartScreen`/`WishlistScreen`: props in, no fetching inside.
- **`business/ProductFormScreen/ProductFormScreen.tsx`** — create/edit form: title, description (multiline), price, image URL, stock; client-side validation matching the server's; submits through an injected `onSubmit` prop so both apps own their own mutation.
- **`business/PublicStoreScreen/PublicStoreScreen.tsx`** — the public store page: store name plus a grid of that store's products, reusing `common/Product`.
- **`ProductDetailScreen.tsx`** gains an optional `onOpenStore?: (storeId: string) => void` prop and renders a `Sold by <storeName>` line next to the existing stock line, wrapped in a `ClassNamePressable` only when `storeName` is present. Inline in the existing screen rather than a new `common/` component — it has exactly one call site.

Two form primitives do not exist yet and are needed: a labelled field, and a multiline text input (`Input` already forwards `multiline`, but its inner `className` is hardcoded *after* `{...rest}`, so a taller box needs an outer `className` plus its own `testID` — the wrapper's is already taken by `input-container`). Also: `common/Button` is label-only (`Button.tsx:10-14`) with no `disabled` or `loading`, which a save button needs. Extend `Button` with `disabled?` and `loading?` rather than adding a fourth copy of the hand-rolled brand `Pressable` that `CartScreen.tsx:87-95` and `CheckoutScreen.tsx:93-101` already have.

This is also the first mutation code in the repo — there is no `useMutation` or `invalidateQueries` anywhere yet — so `StoreScreen` establishes the pattern: `useMutation` for the write, then invalidate the owner's list query. Nothing optimistic; the lists are small and the server is the source of truth.

### 7. Session state and credential storage

`business/AuthScreen/useSessionStore.ts`, colocated with the screen like the four sibling stores. Zustand, `persist`-wrapped, holding `{ token, user, status: "loading" | "authenticated" | "anonymous" }` plus `setSession`/`clear`. `status` exists because the persisted token has to be validated against `GET /auth/me` on boot before the UI can trust it.

The storage helper is currently duplicated three times verbatim — `useCartStore.ts:24-37`, `useWishlistStore.ts:11`, `useRecentlyViewedStore.ts:12` — so this proposal extracts it once to `components-library/src/utils/persistStorage.ts` and points all four stores at it. That is a pure refactor with no behaviour change, and it is called out here because "copy the existing pattern" would have produced a fourth copy.

**The credential is weaker than a cart, and the plan says so.** On native the fallback is an in-memory `Map`, so the session is dropped on any JS reload and the seller is silently signed out. That is acceptable for a basic login on a demo marketplace and unacceptable for a real credential; the honest fix is `expo-secure-store` via `npx expo install`, at the cost of a native dev build for the whole mobile app. Recommended sequence: ship with the existing helper, record the limitation, and take `expo-secure-store` as a separate proposal. A token in `localStorage` is also XSS-readable; the hardened answer is the cookie session rejected in the decisions table, and that is a follow-up too.

`useRequireSession()` — a small hook next to the store that renders a loading state while `status === "loading"` and calls an injected `onSignIn` when anonymous. **This guard is UX, not security**: the API's 401 is the boundary, and the client guard only avoids rendering an empty screen. No `middleware.ts` is introduced — there is no precedent in the repo, it runs in the Edge runtime where a `localStorage` token is invisible, and it would duplicate a rule the server already enforces.

### 8. Per-app API clients and routes

Both `request<T>` wrappers take only a `path` today (`web-application/lib/api.ts:5-11`, `mobile-application/src/api/client.ts:20-26`). Extend both to `request<T>(path, init?: RequestInit)` — backwards compatible — and add an `ApiError extends Error { status }` so `StoreScreen` can branch on 401. Each app's api module gets a thin `authedRequest` that pulls the token from `useSessionStore.getState()` and sets the header. This lands twice because `components-library` deliberately has no api layer (fetchers are injected), so the duplication is the existing architecture, not a shortcut.

Seller-created fields are `title`, `description?`, `price`, `imageUrl?`, `stock`. `currency` is hardcoded `'USD'` on insert, matching `seed.rs:171`, because the whole app formats through `formatPrice(price, currency)` and there is no currency picker. Server-side validation rejects a non-finite or negative price, a negative `stock`, and a title over 200 characters. `createdAt` is server-set.

**Web** (`web-application/`), every page `"use client"` because NativeWind has no RSC support (root `README.md` gotcha 1) — `app/layout.tsx` is the only file without it:

- `app/login/page.tsx`
- `app/my-store/page.tsx`, `app/my-store/new/page.tsx`, `app/my-store/[id]/edit/page.tsx`
- `app/stores/[id]/page.tsx`

Next is 16.3.6 and `web-application/AGENTS.md` requires reading `node_modules/next/dist/docs/` before writing any of it: `params` is an async promise, and the generated `PageProps<"/my-store/[id]/edit">` global type is used instead of a hand-written prop interface, as the existing dynamic route already does.

**Mobile** (`mobile-application/`):

- `src/app/login.tsx`
- `src/app/my-store/index.tsx`, `new.tsx`, `[id]/edit.tsx`
- `src/app/stores/[id].tsx`

These are the repo's **first root-level non-tab routes** — `(tabs)/` currently holds every screen, and `src/app/_layout.tsx:14-16` declares only `<Stack.Screen name="(tabs)" />`. Add explicit `Stack.Screen` entries in that style. Keeping My Store outside `(tabs)` is what lets the bottom bar stay at four items. `app.json` has `"typedRoutes": true`, so `router.push("/my-store")` type-checks only once the file exists. Non-route code (the session store, the api helpers) stays outside `src/app/`, per `mobile-application/AGENTS.md`.

### 9. Entry points

- `business/HomeScreen/HomeScreen.tsx` gains a "My Store" row — signed out it routes to `/login`, signed in it shows the `storeName` and routes to `/my-store`. This is the screen both apps already render identically, so it is the one place a new top-level entry needs to be written once.
- `ProductDetailScreen`'s "Sold by `<store>`" line routes to `/stores/{id}` via the new `onOpenStore` prop, wired in both `app/marketplace/[id]/page.tsx` and `(tabs)/marketplace/[id].tsx`.
- The bottom nav and `TAB_ITEMS` (`(tabs)/_layout.tsx:27-32`) are **not** touched, which is what keeps `tab-bar-position.e2e.ts` green.

### 10. Documentation

`api-rs/README.md`: two rows in the env table (§"Environment") for the new keys. Note that `src/config.rs` needs **four** edits per key — the struct field, the `Default`, the `from_env` branch, and the `ENV_KEYS` array (`config.rs:197-216`) — plus a `set(...)` line and an assertion in `from_env_reads_every_documented_key` (`config.rs:281-303`), which asserts that *every* documented key is read. `api-rs/.env.example` too.

`api-rs/ARCHITECTURE.md`: §1's route table, §12's deviated sketch, and the fact that the generation counter is now shared by three list families, plus §5's replica story.

Root `README.md` "Architecture boundaries and known gotchas": one bullet that a write path must invalidate the public cache, and one that a credential does not get the sibling stores' in-memory-on-native treatment.

## Key files/areas

**api-rs — new**

- `api-rs/migrations/20261003120000_create_user_and_session.{up,down}.sql`
- `api-rs/migrations/20261003120100_add_product_owner.{up,down}.sql`
- `api-rs/src/handlers/auth.rs`, `api-rs/src/handlers/my_store.rs`, `api-rs/src/handlers/stores.rs`
- `api-rs/src/store/users.rs`, `api-rs/src/store/sessions.rs`
- `api-rs/src/middleware/session.rs` (the `Bearer` extractor), `api-rs/src/auth/password.rs` (argon2 helpers)
- `api-rs/tests/e2e_auth.rs`, `api-rs/tests/e2e_my_store.rs`

**api-rs — edit**

- `api-rs/src/app.rs` (register routes + `route_layer` ordering, keep the 404-not-405 fallback on every new route)
- `api-rs/src/store/products.rs` (the `LEFT JOIN` in `LIST_QUERY`/`DETAIL_QUERY`, the two owner-scoped queries on the primary, the `storeName` field)
- `api-rs/src/store/mod.rs`, `api-rs/src/store/memory.rs`
- `api-rs/src/handlers/products.rs` (`ProductJson` gains `storeId`/`storeName`, appended after `createdAt` so the golden regeneration is a mechanical addition and reviewers see only the new keys; always emitted, `null` for ownerless products — the `skip_serializing_if` on `ErrorBody` is an error-body convention, not a product one)
- `api-rs/src/cache/mod.rs` (`get_generation`/`bump_list_generation` + the background refresher)
- `api-rs/src/error.rs` (`Validation`/`Unauthorized`/`Forbidden`/`EmailTaken`)
- `api-rs/src/config.rs` (`session_ttl_secs`, `auth_login_attempts_per_min`)
- `api-rs/src/middleware/rate_limit.rs` (per-scope `(limit, window)`, `enforce_auth`)
- `api-rs/src/seed.rs`, `api-rs/src/telemetry.rs`
- `api-rs/tests/common/mod.rs`, `api-rs/tests/fixtures/seed.sql`, `api-rs/tests/fixtures/generate_goldens.py`, and the regenerated `products-page-{1,2}.json` / `product-prod-1.json`
- `api-rs/package.json` — `test:e2e` names `--test e2e_products --test parity` explicitly (`api-rs/README.md:131`), so the new test files must be added
- `api-rs/Cargo.toml` (`argon2`, `sha2`), `api-rs/README.md`, `api-rs/ARCHITECTURE.md`

**components-library — new**

- `src/types/Store.ts`
- `src/business/AuthScreen/AuthScreen.tsx` + `useSessionStore.ts` + stories + tests
- `src/business/StoreScreen/StoreScreen.tsx` + stories + tests
- `src/business/ProductFormScreen/ProductFormScreen.tsx` + stories + tests
- `src/business/PublicStoreScreen/PublicStoreScreen.tsx` + stories + tests
- `src/utils/persistStorage.ts` (extracted from the three existing copies)
- `src/common/Label/Label.tsx` and a multiline variant of `Input`

**components-library — edit**

- `src/index.ts` (every new export)
- `src/types/Product.ts` (`storeId?`, `storeName?`)
- `src/business/ProductDetailScreen/ProductDetailScreen.tsx` (`onOpenStore`, the "Sold by" line)
- `src/business/HomeScreen/HomeScreen.tsx` (the My Store entry)
- `src/common/Button/Button.tsx` (`disabled?`, `loading?`)
- `src/common/Input/Input.tsx` (a `testID` that isn't `input-container`, so a multi-field form has distinct selectors)
- `src/business/CartScreen/useCartStore.ts`, `src/business/WishlistScreen/useWishlistStore.ts`, `src/business/ProductDetailScreen/useRecentlyViewedStore.ts` (point at the extracted helper)

**apps — new**

- `web-application/app/login/page.tsx`, `app/my-store/page.tsx`, `app/my-store/new/page.tsx`, `app/my-store/[id]/edit/page.tsx`, `app/stores/[id]/page.tsx`
- `web-application/tests/login.test.tsx`, `tests/my-store.test.tsx`
- `web-application/e2e/my-store.spec.ts`
- `mobile-application/src/app/login.tsx`, `src/app/my-store/{index,new}.tsx`, `src/app/my-store/[id]/edit.tsx`, `src/app/stores/[id].tsx`
- `mobile-application/e2e/my-store.e2e.ts`

**apps — edit**

- `web-application/lib/api.ts`, `mobile-application/src/api/client.ts`
- `mobile-application/src/app/_layout.tsx` (explicit `Stack.Screen` entries)

**No changes**

- `web-application/app/nav-header.tsx` and `(tabs)/_layout.tsx`'s `TAB_ITEMS` — the bar stays at four items.
- `web-application/app/marketplace/*` and `mobile-application/src/app/(tabs)/marketplace/index.tsx` — the public list needs no new parameters.
- `useCartStore`, `useWishlistStore`, `useRecentlyViewedStore` behaviour, `CartScreen.tsx`, `CheckoutScreen.tsx`, `Product.tsx`, `ProductListScreen.tsx`.

## Verification

**api-rs unit tests**

- `handlers/auth.rs`: register creates a user and a session and returns a token whose SHA-256 is what got stored (the raw token is never in the database); duplicate email is a 409; login is case-insensitive on email and rejects a wrong password with the same 401 body as an unknown address; `/auth/me` rejects a missing, malformed, and expired token identically; logout deletes the row so the token stops working immediately. All with cheap `argon2` `Params` so the suite does not crawl.
- `handlers/my_store.rs`: every route without a valid token is a 401; a product owned by someone else is a **404, not a 403**; create validates price (negative, `NaN`, `Infinity`), stock, and title length; `DELETE` is idempotent-safe (second delete is a 404, not a 500).
- `cache/mod.rs`: generation defaults to 0; a bump changes the key that `products:list` and `stores:{id}:products:list` compute; `bump` without Valkey is a local increment and still retires L1.
- `config.rs`: the two new keys get `set(...)` lines and assertions in `from_env_reads_every_documented_key`, per the four-edit rule above.
- `app.rs`: `wrong_method_returns_404_not_405` still passes for `/products`, and the same assertion is added for `GET /my-store/products`.

**api-rs E2E (hermetic, Docker)**

- `e2e_auth.rs`: register → login → `/auth/me` → logout → `/auth/me` is now 401; a second registration of the same address is a 409.
- `e2e_my_store.rs`: sign in, create a product, assert it appears in `GET /my-store/products` **immediately** (proving the owner-scoped read went to the primary); assert it appears in `GET /products`; PATCH it and assert `GET /products/{id}` reflects the change after invalidation; DELETE it and assert it is gone from both; assert another user's PATCH on the same id is a 404.
- A **cache-invalidation** case that is the whole point: warm `GET /products?page=1` and `GET /products/{id}`, then create and PATCH a product, then assert the very next request for each is not a stale hit.
- `parity.rs`: the three product goldens are regenerated. Give the new owner-scoped fixture product the **latest** `createdAt` so it sorts last — otherwise it shifts rows across the page-1/page-2 boundary and the regeneration is not a mechanical addition.
- `TestStack::start_with_read_replica`: the replica-coupled assertions in the existing harness must still hold with the `LEFT JOIN` in place.

**components-library tests**

- `useSessionStore` (`.web.test.tsx`, since it touches `localStorage` — the `utils` vitest project is node-only and would not have a DOM): persistence round-trip, `setSession`/`clear`, and the boot-status transition.
- `AuthScreen.web.test.tsx`: renders in both modes, `storeName` only in sign-up, submits credentials, surfaces a server error message.
- `ProductFormScreen.web.test.tsx`: blocks submission on an empty title and a negative price, calls `onSubmit` with the parsed values, disables the save button while `loading`.
- `StoreScreen.web.test.tsx`: empty state, list rendering, edit/delete callbacks, error state — mirroring `CartScreen.web.test.tsx`.
- `ProductDetailScreen.web.test.tsx`: "Sold by" renders and calls `onOpenStore` when `storeName` is present, and is omitted when it is `null`.
- `HomeScreen.web.test.tsx`: the entry routes to sign-in when anonymous and to My Store when authenticated.
- `Button.web.test.tsx`: extended for `disabled`/`loading`.

**apps**

- `web-application/tests/login.test.tsx` and `tests/my-store.test.tsx`, following the existing `vi.mock("../lib/api")` + `renderWithClient` pattern — every current page has one.
- `web-application/e2e/my-store.spec.ts` (Playwright, `fullyParallel: true`): register → create a product → see it in My Store → open `/marketplace` → see it in the list → edit it → delete it. Follows the existing selector conventions (`testID` on the screen root, `getByText` on visible labels). Because it mutates the shared dev database, the spec must delete what it creates, and it carries the same "api-rs must be running and seeded" comment as its siblings.
- `mobile-application/e2e/my-store.e2e.ts` (Detox) for the same flow, including that the Home entry sends an anonymous user to the login screen. Requires a native build and a simulator.
- Manual pass on both apps: register, sign out, sign back in (confirming the session survives a web reload, and noting that on native it does not survive a JS reload — the limitation from §7, observed rather than assumed); create a product and confirm it appears in the marketplace; confirm the "Sold by" line navigates to the public store page; confirm the product survives signing out and back in; confirm it remains listed after the seller account is deleted (the `ON DELETE SET NULL` behavior).

**Checks that may not be runnable here:** the api-rs E2E suites need Docker; Detox needs a native build and a simulator. Report both if unavailable.
