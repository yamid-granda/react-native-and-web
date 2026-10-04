//! `/stores/*`: the public face of a seller.
//!
//! Deliberately unauthenticated. A storefront is a catalogue page, and the
//! marketplace itself is public — requiring a token here would make a seller's
//! products unreachable for the shoppers they exist for.
//!
//! The products page is the same read path as `GET /products` — the same cache
//! helpers, the same stampede ordering, the same headers and the same envelope —
//! with a different key and the same list generation folded in, so a create or
//! an edit retires it in the same `INCR` that retires the marketplace.

use axum::extract::{Path, Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Serialize;

use crate::app::AppState;
use crate::cache::{self, Kind};
use crate::error::{json_response, AppError, NO_STORE};
use crate::handlers::products::{cached, parse_page, product_headers, ProductsPageJson};
use crate::serde_js::prisma_datetime;
use crate::store::PAGE_SIZE;

#[derive(Serialize)]
pub struct StoreJson {
    id: String,
    #[serde(rename = "storeName")]
    store_name: String,
    #[serde(rename = "createdAt", serialize_with = "prisma_datetime")]
    created_at: chrono::NaiveDateTime,
}

pub async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let user = state
        .store
        .find_user_by_id(&id)
        .await?
        .ok_or_else(|| AppError::StoreNotFound(id.clone()))?;
    let bytes = serde_json::to_vec(&StoreJson {
        id: user.id,
        store_name: user.store_name,
        created_at: user.created_at,
    })?;
    // `no-store`, not the product cache headers: a store is one row by primary
    // key, so there is nothing to gain from an edge cache and a rename later
    // would have to invalidate a key it cannot enumerate.
    Ok(json_response(StatusCode::OK, bytes, &[NO_STORE], None))
}

pub async fn products(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Request,
) -> Result<Response, AppError> {
    let (parts, _body) = request.into_parts();
    let query = parse_page(parts.uri.query())?;
    let conditional = Some((&parts.method, &parts.headers));

    // A 404 is not cached: an id that has no store today may have one tomorrow,
    // and the page is the only way a shopper finds out. This stays *before* the
    // cache read because nothing can invalidate "this store exists" — see
    // `my_store.rs`'s delete path, which relies on exactly that.
    if state.store.find_user_by_id(&id).await?.is_none() {
        return Err(AppError::StoreNotFound(id));
    }

    let key = cache::store_list_key(state.cache.generation(), &id, query.page);

    if let Some(response) = cached(&state, Kind::List, &key, conditional).await {
        return Ok(response);
    }

    // Stampede protection, inherited from `GET /products` through the same
    // helper. The ordering is the whole design: check, then take the flight,
    // then check *again*, because the leader we waited behind may have just
    // populated the cache.
    let flight = state.cache.flights().for_key(Kind::List, &key).await;
    let _fill = flight.lock().await;
    if let Some(response) = cached(&state, Kind::List, &key, conditional).await {
        return Ok(response);
    }

    // A public page, so the store reads replica-safe: eventually consistent by
    // choice, as `ARCHITECTURE.md`'s pool table says. The seller's own `GET
    // /my-store/products` is the read that must not race replica lag.
    let items = state.store.list_public_page_by_owner(&id, query.offset, PAGE_SIZE).await?;
    let total = state.store.count_public_by_owner(&id).await?;
    let body = ProductsPageJson::from_page(items, &query, total);
    let bytes = serde_json::to_vec(&body)?;
    state.cache.set(Kind::List, &key, axum::body::Bytes::copy_from_slice(&bytes)).await;

    Ok(json_response(StatusCode::OK, bytes, &product_headers(&state, None), conditional))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use axum::Router;
    use chrono::NaiveDateTime;
    use tower::ServiceExt;

    use crate::app::router;
    use crate::config::Config;
    use crate::store::{
        InMemoryStore, NewProduct, NewUser, Product, ProductStore, Session, SessionStore,
        StoreError, StoreUser, UserRecord, UserStore,
    };

    use super::*;

    const STORE_A: &str = "usr_store_a";
    const STORE_B: &str = "usr_store_b";
    /// One store, many pages: the stampede and retirement properties both need
    /// more rows than fit in a single page.
    const PRODUCTS_PER_STORE: usize = 200;

    #[test]
    fn the_store_shape_is_id_name_created_at() {
        let json = serde_json::to_string(&StoreJson {
            id: "usr_1".to_string(),
            store_name: "Corner Shop".to_string(),
            created_at: chrono::NaiveDateTime::parse_from_str(
                "2026-01-01 00:00:00.000",
                "%Y-%m-%d %H:%M:%S%.3f",
            )
            .unwrap(),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"id":"usr_1","storeName":"Corner Shop","createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }

    /// Counts the queries that actually reach the store and makes each one slow
    /// enough that concurrent requests genuinely collide on a single fill
    /// instead of racing past it — the same technique `handlers::products` uses,
    /// because it is the only way to assert deduplication rather than infer it.
    #[derive(Clone)]
    struct CountingStore {
        inner: InMemoryStore,
        list_calls: Arc<AtomicUsize>,
        count_calls: Arc<AtomicUsize>,
        delay: Duration,
    }

    impl CountingStore {
        async fn new() -> Self {
            let inner = InMemoryStore::default();
            let store = Self {
                inner: inner.clone(),
                list_calls: Arc::new(AtomicUsize::new(0)),
                count_calls: Arc::new(AtomicUsize::new(0)),
                delay: Duration::from_millis(30),
            };
            store.register(STORE_A, "Shop A").await;
            store.register(STORE_B, "Shop B").await;
            store
        }

        /// One seller row plus a full page of catalogue, so `total` is larger
        /// than `PAGE_SIZE` and a second page exists.
        async fn register(&self, id: &str, store_name: &str) {
            self.inner
                .create_user(NewUser {
                    id: id.to_string(),
                    email: format!("{id}@rnw.test"),
                    password_hash: "$argon2id$not-a-real-hash".to_string(),
                    store_name: store_name.to_string(),
                })
                .await
                .expect("insert seller");
            for index in 0..PRODUCTS_PER_STORE {
                self.inner
                    .create(
                        id,
                        NewProduct {
                            title: format!("Product {index}"),
                            description: None,
                            price: 10.0,
                            image_url: None,
                            stock: 1,
                        },
                    )
                    .await
                    .expect("insert product");
            }
        }
    }

    #[async_trait::async_trait]
    impl ProductStore for CountingStore {
        async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
            self.inner.list_page(offset, limit).await
        }

        async fn count(&self) -> Result<i64, StoreError> {
            self.inner.count().await
        }

        async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
            self.inner.find_by_id(id).await
        }

        async fn list_page_for_owner(
            &self,
            owner_id: &str,
            offset: i64,
            limit: i64,
        ) -> Result<Vec<Product>, StoreError> {
            self.inner.list_page_for_owner(owner_id, offset, limit).await
        }

        async fn list_public_page_by_owner(
            &self,
            owner_id: &str,
            offset: i64,
            limit: i64,
        ) -> Result<Vec<Product>, StoreError> {
            self.list_calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(self.delay).await;
            self.inner.list_public_page_by_owner(owner_id, offset, limit).await
        }

        async fn count_for_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
            self.inner.count_for_owner(owner_id).await
        }

        async fn count_public_by_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
            self.count_calls.fetch_add(1, Ordering::SeqCst);
            self.inner.count_public_by_owner(owner_id).await
        }

        async fn find_owned_by_id(
            &self,
            owner_id: &str,
            id: &str,
        ) -> Result<Option<Product>, StoreError> {
            self.inner.find_owned_by_id(owner_id, id).await
        }

        async fn create(
            &self,
            owner_id: &str,
            new_product: NewProduct,
        ) -> Result<Product, StoreError> {
            self.inner.create(owner_id, new_product).await
        }

        async fn update_owned(
            &self,
            owner_id: &str,
            id: &str,
            patch: crate::store::ProductPatch,
        ) -> Result<Option<Product>, StoreError> {
            self.inner.update_owned(owner_id, id, patch).await
        }

        async fn delete_owned(&self, owner_id: &str, id: &str) -> Result<bool, StoreError> {
            self.inner.delete_owned(owner_id, id).await
        }

        async fn ping(&self) -> Result<(), StoreError> {
            self.inner.ping().await
        }
    }

    /// These tests are about the storefront's read path, so identity is a
    /// pass-through. They exist only because `AppState` holds one
    /// `Arc<dyn MarketplaceStore>` rather than three handles.
    #[async_trait::async_trait]
    impl UserStore for CountingStore {
        async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, StoreError> {
            self.inner.find_user_by_email(email).await
        }

        async fn find_user_by_id(&self, id: &str) -> Result<Option<StoreUser>, StoreError> {
            self.inner.find_user_by_id(id).await
        }

        async fn create_user(&self, new_user: NewUser) -> Result<StoreUser, StoreError> {
            self.inner.create_user(new_user).await
        }
    }

    #[async_trait::async_trait]
    impl SessionStore for CountingStore {
        async fn find_valid_session(
            &self,
            token_hash: &str,
        ) -> Result<Option<Session>, StoreError> {
            self.inner.find_valid_session(token_hash).await
        }

        async fn create_session(
            &self,
            token_hash: &str,
            user_id: &str,
            expires_at: NaiveDateTime,
        ) -> Result<(), StoreError> {
            self.inner.create_session(token_hash, user_id, expires_at).await
        }

        async fn delete_session(&self, token_hash: &str) -> Result<bool, StoreError> {
            self.inner.delete_session(token_hash).await
        }
    }

    /// The concurrency limiter is a confounder here: these tests assert how many
    /// queries reach the store, not that load was shed.
    fn base_config() -> Config {
        Config {
            global_concurrency_limit: 4096,
            per_ip_concurrency_limit: 4096,
            rate_limit_global_rps: 0,
            rate_limit_per_ip_rps: 0,
            ..Config::default()
        }
    }

    fn counting_state(store: CountingStore) -> AppState {
        AppState::new(base_config(), Arc::new(store), None, None)
    }

    fn get(uri: &str) -> axum::http::Request<axum::body::Body> {
        axum::http::Request::builder().uri(uri).body(axum::body::Body::empty()).unwrap()
    }

    /// Drives `uris` as genuinely concurrent requests. Cloning the `Router`
    /// clones the `AppState`, which is the point: the singleflight map has to be
    /// shared across those clones to deduplicate anything.
    async fn get_all(app: Router, uris: &[String]) -> Vec<StatusCode> {
        let tasks: Vec<_> = uris
            .iter()
            .map(|uri| {
                let app = app.clone();
                let uri = uri.clone();
                tokio::spawn(async move { app.oneshot(get(&uri)).await.unwrap().status() })
            })
            .collect();
        let mut statuses = Vec::new();
        for task in tasks {
            statuses.push(task.await.unwrap());
        }
        statuses
    }

    async fn body_of(response: axum::response::Response) -> serde_json::Value {
        let bytes: axum::body::Bytes =
            http_body_util::BodyExt::collect(response.into_body()).await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// The stampede this read path is supposed to collapse: 64 concurrent
    /// requests on a cold storefront key issued 64 page queries plus 64 counts.
    #[tokio::test]
    async fn concurrent_cold_storefront_requests_fill_once() {
        let store = CountingStore::new().await;
        let list_calls = Arc::clone(&store.list_calls);
        let count_calls = Arc::clone(&store.count_calls);
        let app = router(counting_state(store));

        let uri = format!("/stores/{STORE_A}/products");
        let statuses = get_all(app, &vec![uri; 64]).await;

        assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
        assert_eq!(list_calls.load(Ordering::SeqCst), 1, "one page query, not 64");
        assert_eq!(count_calls.load(Ordering::SeqCst), 1, "one COUNT(*), not 64");
    }

    /// The property the shared key scheme exists for, and the one the copied
    /// handler had no test for: a write retires a seller's cached page.
    #[tokio::test]
    async fn a_generation_bump_makes_a_cached_storefront_page_unreachable() {
        let store = CountingStore::new().await;
        let list_calls = Arc::clone(&store.list_calls);
        let state = counting_state(store);
        let app = router(state.clone());

        let uri = format!("/stores/{STORE_A}/products");
        for _ in 0..2 {
            assert_eq!(app.clone().oneshot(get(&uri)).await.unwrap().status(), StatusCode::OK);
        }
        assert_eq!(list_calls.load(Ordering::SeqCst), 1, "the second read is a cache hit");

        state.cache.bump_list_generation().await;

        assert_eq!(app.clone().oneshot(get(&uri)).await.unwrap().status(), StatusCode::OK);
        assert_eq!(list_calls.load(Ordering::SeqCst), 2, "the retired page has to be refilled");
    }

    /// Collapsing must not serialise unrelated keys into one queue.
    #[tokio::test]
    async fn distinct_stores_are_not_serialised_against_each_other() {
        let store = CountingStore::new().await;
        let list_calls = Arc::clone(&store.list_calls);
        let app = router(counting_state(store));

        let uris: Vec<String> = [STORE_A, STORE_B]
            .iter()
            .flat_map(|id| (1..=8).map(move |page| format!("/stores/{id}/products?page={page}")))
            .collect();
        let statuses = get_all(app, &uris).await;

        assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
        assert_eq!(list_calls.load(Ordering::SeqCst), 16, "each store/page is its own key");
    }

    /// The page a shopper sees: the shared envelope, with `total` and
    /// `hasNextPage` computed from the storefront's own rows.
    #[tokio::test]
    async fn the_storefront_page_carries_the_shared_envelope() {
        let store = CountingStore::new().await;
        let response = router(counting_state(store))
            .oneshot(get(&format!("/stores/{STORE_A}/products")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = body_of(response).await;
        assert_eq!(body["page"], 1.0);
        assert_eq!(body["limit"], PAGE_SIZE);
        assert_eq!(body["total"], PRODUCTS_PER_STORE as i64);
        assert_eq!(body["hasNextPage"], true);
        assert_eq!(body["items"].as_array().unwrap().len(), PAGE_SIZE as usize);
        assert_eq!(body["items"][0]["storeId"], STORE_A);
    }

    /// A store with no rows is a real page with `total: 0`, not a 404 — the
    /// distinction the envelope builder exists to keep.
    #[tokio::test]
    async fn a_store_with_no_products_is_an_empty_page_not_a_404() {
        let store = CountingStore::new().await;
        let response = router(counting_state(store))
            .oneshot(get("/stores/usr_store_c/products"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "an unknown store is still a 404");

        let store = CountingStore::new().await;
        let response = router(counting_state(store))
            .oneshot(get(&format!("/stores/{STORE_B}/products?page=99")))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_of(response).await;
        assert_eq!(body["total"], PRODUCTS_PER_STORE as i64);
        assert_eq!(body["items"].as_array().unwrap().len(), 0);
        assert_eq!(body["hasNextPage"], false);
    }
}
