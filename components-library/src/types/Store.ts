/**
 * A seller account, as the API exposes it.
 *
 * Deliberately the three fields the auth surface returns. The password hash and
 * the session rows never leave the server, and `createdAt` is on
 * {@link StoreProfile} instead — the auth endpoints are about credentials, and
 * mixing the two shapes is how a session token ends up in a `localStorage` dump
 * of somebody's profile.
 */
export type StoreUser = {
  id: string
  email: string
  storeName: string
}

/** `POST /auth/login` and `POST /auth/register` both answer with this. */
export type AuthSession = {
  /**
   * The opaque bearer token. Send it as `Authorization: Bearer <token>` and
   * nothing else — there is no cookie and no refresh token, so losing it means
   * signing in again.
   */
  token: string
  user: StoreUser
}

/** The public storefront record: `GET /stores/{id}`. */
export type StoreProfile = {
  id: string
  storeName: string
  createdAt: string
}