//! The store test double, written once.
//!
//! `AppState` holds one `Arc<dyn MarketplaceStore>` rather than three handles
//! (`app.rs`), and `MarketplaceStore` is a marker supertrait over `ProductStore`,
//! `UserStore` and `SessionStore` (`products.rs`). Rust has no partial trait
//! impl, so a value stored there owes all three traits in full whether or not it
//! cares about them — and every test double is a value stored there. Those 21
//! forwards, and the handful of helpers around them, used to be written out
//! twice: once in `handlers::products`' test module and once in
//! `handlers::stores`'.
//!
//! Two types live here, and the difference between them is the point:
//!
//! - [`DelegatingStore`] forwards all 21 methods and nothing else.
//! - [`CountingStore`] is that plus the counters and the delay that make
//!   concurrent requests collide on a single cache fill instead of racing past
//!   it, which is the only way to assert deduplication rather than infer it.
//!
//! Both are `#[cfg(test)]`-only, which is the whole of their audience: no
//! production store is wrapped by either, so neither belongs in the library the
//! binary and the integration tests are built from.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use axum::body::{Body, Bytes};
use axum::http::StatusCode;
use axum::Router;

use super::products::{NewProduct, Product, ProductPatch, ProductStore, StoreError};
use super::sessions::{Session, SessionStore};
use super::users::{NewUser, StoreUser, UserRecord, UserStore};
use super::{InMemoryStore, MarketplaceStore};
use crate::app::AppState;
use crate::config::Config;

/// A [`MarketplaceStore`] that forwards every method to another one.
///
/// Composing one of these is what a spy does instead of hand-writing 21
/// pass-through bodies, so the forwards live here rather than in a handler's
/// test module.
///
/// Adding a trait method costs one forward *in here* and nothing in either
/// handler test module, because the spy they use is [`CountingStore`] below.
/// That is the whole of what composing this buys. It does not make a spy free in
/// general: `Arc<dyn MarketplaceStore>` demands all three traits of whatever is
/// stored in it, so a spy written somewhere else would still owe its own three
/// impl blocks, and a new trait method would still have to be added to it. This
/// type is what makes that cost cheap, not what removes it.
///
/// The only composition in the crate is [`CountingStore`]'s. No production store
/// is wrapped by one.
#[derive(Clone)]
pub struct DelegatingStore(Arc<dyn MarketplaceStore>);

impl DelegatingStore {
    pub fn new(inner: Arc<dyn MarketplaceStore>) -> Self {
        Self(inner)
    }
}

#[async_trait]
impl ProductStore for DelegatingStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        self.0.list_page(offset, limit).await
    }

    async fn count(&self) -> Result<i64, StoreError> {
        self.0.count().await
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        self.0.find_by_id(id).await
    }

    async fn find_by_ids(&self, ids: &[String]) -> Result<Vec<Product>, StoreError> {
        self.0.find_by_ids(ids).await
    }

    async fn list_page_for_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        self.0.list_page_for_owner(owner_id, offset, limit).await
    }

    async fn list_public_page_by_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        self.0.list_public_page_by_owner(owner_id, offset, limit).await
    }

    async fn count_for_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.0.count_for_owner(owner_id).await
    }

    async fn count_public_by_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.0.count_public_by_owner(owner_id).await
    }

    async fn find_owned_by_id(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<Product>, StoreError> {
        self.0.find_owned_by_id(owner_id, id).await
    }

    async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError> {
        self.0.create(owner_id, new_product).await
    }

    async fn update_owned(
        &self,
        owner_id: &str,
        id: &str,
        patch: ProductPatch,
    ) -> Result<Option<Product>, StoreError> {
        self.0.update_owned(owner_id, id, patch).await
    }

    async fn delete_owned(&self, owner_id: &str, id: &str) -> Result<bool, StoreError> {
        self.0.delete_owned(owner_id, id).await
    }

    async fn ping(&self) -> Result<(), StoreError> {
        self.0.ping().await
    }
}

#[async_trait]
impl UserStore for DelegatingStore {
    async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, StoreError> {
        self.0.find_user_by_email(email).await
    }

    async fn find_user_by_id(&self, id: &str) -> Result<Option<StoreUser>, StoreError> {
        self.0.find_user_by_id(id).await
    }

    async fn create_user(&self, new_user: NewUser) -> Result<StoreUser, StoreError> {
        self.0.create_user(new_user).await
    }
}

#[async_trait]
impl SessionStore for DelegatingStore {
    async fn find_valid_session(&self, token_hash: &str) -> Result<Option<Session>, StoreError> {
        self.0.find_valid_session(token_hash).await
    }

    async fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: chrono::NaiveDateTime,
    ) -> Result<(), StoreError> {
        self.0.create_session(token_hash, user_id, expires_at).await
    }

    async fn delete_session(&self, token_hash: &str) -> Result<bool, StoreError> {
        self.0.delete_session(token_hash).await
    }

    async fn delete_expired_for_user(&self, user_id: &str) -> Result<u64, StoreError> {
        self.0.delete_expired_for_user(user_id).await
    }

    async fn list_sessions(&self, user_id: &str) -> Result<Vec<Session>, StoreError> {
        self.0.list_sessions(user_id).await
    }
}

/// [`DelegatingStore`] plus the counters that let a handler test say how many
/// queries reached the store.
///
/// Four counters rather than two, because the two suites that use this count
/// different methods and each reads only its own: `handlers::products` pins the
/// catalogue page (`list_page`, `count`), the detail route (`find_by_id`) and
/// the batch read (`find_by_ids`), while `handlers::stores` pins the storefront
/// pair (`list_public_page_by_owner`, `count_public_by_owner`). The counters a
/// suite does not exercise stay at zero, which is why one type can serve both
/// without either one asserting something the other made happen.
///
/// `find_calls` and `batch_calls` are separate on purpose: the claim behind
/// them is that one *batch* is one store call, which a counter that also moved
/// for each singular read could not distinguish from the shape it replaced.
#[derive(Clone)]
pub struct CountingStore {
    inner: DelegatingStore,
    pub list_calls: Arc<AtomicUsize>,
    pub count_calls: Arc<AtomicUsize>,
    pub find_calls: Arc<AtomicUsize>,
    pub batch_calls: Arc<AtomicUsize>,
    delay: Duration,
}

impl CountingStore {
    pub fn new(inner: InMemoryStore) -> Self {
        Self {
            inner: DelegatingStore::new(Arc::new(inner)),
            list_calls: Arc::new(AtomicUsize::new(0)),
            count_calls: Arc::new(AtomicUsize::new(0)),
            find_calls: Arc::new(AtomicUsize::new(0)),
            batch_calls: Arc::new(AtomicUsize::new(0)),
            delay: Self::DELAY,
        }
    }

    /// One seller row plus a full page of catalogue, so `total` is larger than
    /// `PAGE_SIZE` and a second page exists.
    pub async fn seed_seller(&self, id: &str, store_name: &str, products: usize) {
        self.inner
            .create_user(NewUser {
                id: id.to_string(),
                email: format!("{id}@rnw.test"),
                password_hash: "$argon2id$not-a-real-hash".to_string(),
                store_name: store_name.to_string(),
            })
            .await
            .expect("insert seller");
        for index in 0..products {
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

    /// How long an instrumented read takes before it reaches the inner store.
    ///
    /// Long enough that concurrent requests genuinely collide on one fill rather
    /// than racing past it, which is what turns "the count is 1" into a claim
    /// about singleflight instead of a lucky schedule. A test that needs a
    /// different window can shorten it in the future; nothing here depends on
    /// the value.
    const DELAY: Duration = Duration::from_millis(30);
}

/// The store reaches `InMemoryStore` through [`DelegatingStore`], so these read
/// as one-line forwards. That is deliberate: every method of all three traits is
/// here once, and [`the_store_contract_holds_through_the_forwards`] drives each
/// of them through the contract suite, so a forward written as `self.find_by_id`
/// rather than `self.inner.find_by_id` — which type-checks, because both are
/// `ProductStore` — fails here instead of hanging some unrelated test.
#[async_trait]
impl ProductStore for CountingStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        self.list_calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(self.delay).await;
        self.inner.list_page(offset, limit).await
    }

    async fn count(&self) -> Result<i64, StoreError> {
        self.count_calls.fetch_add(1, Ordering::SeqCst);
        self.inner.count().await
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        self.find_calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(self.delay).await;
        self.inner.find_by_id(id).await
    }

    /// The delay is what the per-id loop used to pay N times over. Kept per
    /// call, not per id, because that is the shape now under test: one round trip
    /// for the whole set.
    async fn find_by_ids(&self, ids: &[String]) -> Result<Vec<Product>, StoreError> {
        self.batch_calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(self.delay).await;
        self.inner.find_by_ids(ids).await
    }

    /// The storefront's page query, counted under the same `list_calls` as the
    /// catalogue's: both are "the one page read this request had to make", and a
    /// suite never reaches both, so they cannot collide.
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

    async fn count_public_by_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.count_calls.fetch_add(1, Ordering::SeqCst);
        self.inner.count_public_by_owner(owner_id).await
    }

    // The owner-scoped and write paths are pass-throughs too: the suites that use
    // this are about the read path's cache behaviour, and `handlers::my_store.rs`
    // is where a mutation is asserted. The failure switches moved to the store
    // itself, which is what `/health` needs and what keeps the mechanism in one
    // place.
    async fn list_page_for_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        self.inner.list_page_for_owner(owner_id, offset, limit).await
    }

    async fn count_for_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.inner.count_for_owner(owner_id).await
    }

    async fn find_owned_by_id(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<Product>, StoreError> {
        self.inner.find_owned_by_id(owner_id, id).await
    }

    async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError> {
        self.inner.create(owner_id, new_product).await
    }

    async fn update_owned(
        &self,
        owner_id: &str,
        id: &str,
        patch: ProductPatch,
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

/// These stay, and `Arc<dyn MarketplaceStore>` is why: the spy is the thing
/// stored there, so it owes `UserStore` and `SessionStore` as well. They are
/// pass-throughs because no suite here is about identity or sessions.
#[async_trait]
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

#[async_trait]
impl SessionStore for CountingStore {
    async fn find_valid_session(&self, token_hash: &str) -> Result<Option<Session>, StoreError> {
        self.inner.find_valid_session(token_hash).await
    }

    async fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: chrono::NaiveDateTime,
    ) -> Result<(), StoreError> {
        self.inner.create_session(token_hash, user_id, expires_at).await
    }

    async fn delete_session(&self, token_hash: &str) -> Result<bool, StoreError> {
        self.inner.delete_session(token_hash).await
    }

    async fn delete_expired_for_user(&self, user_id: &str) -> Result<u64, StoreError> {
        self.inner.delete_expired_for_user(user_id).await
    }

    async fn list_sessions(&self, user_id: &str) -> Result<Vec<Session>, StoreError> {
        self.inner.list_sessions(user_id).await
    }
}

/// The concurrency limiter is a confounder in the suites that use these
/// helpers: they assert how many queries reach the store, not that load was
/// shed.
pub fn base_config() -> Config {
    Config {
        global_concurrency_limit: 4096,
        per_ip_concurrency_limit: 4096,
        rate_limit_global_rps: 0,
        rate_limit_per_ip_rps: 0,
        ..Config::default()
    }
}

/// An [`AppState`] over any store, with the rate limiter out of the way.
pub fn counting_state<S: MarketplaceStore>(store: S) -> AppState {
    AppState::new(base_config(), Arc::new(store), None, None)
}

pub fn get(uri: &str) -> axum::http::Request<Body> {
    axum::http::Request::builder().uri(uri).body(Body::empty()).unwrap()
}

/// Drives `uris` as genuinely concurrent requests. Cloning the `Router` clones
/// the `AppState`, which is the point: the singleflight map has to be shared
/// across those clones to deduplicate anything.
pub async fn get_all(app: Router, uris: &[String]) -> Vec<StatusCode> {
    use tower::ServiceExt;

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

pub async fn body_of(response: axum::response::Response) -> serde_json::Value {
    use http_body_util::BodyExt;

    let bytes: Bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

mod tests {
    use chrono::NaiveDateTime;

    use super::*;
    use crate::store::contract::assert_store_contract;

    fn seed(id: &str) -> Product {
        Product {
            id: id.to_string(),
            title: "Test".to_string(),
            description: None,
            price: 10.0,
            currency: "USD".to_string(),
            image_url: None,
            stock: 1,
            created_at: NaiveDateTime::parse_from_str(
                "2026-01-01 00:00:00.000",
                "%Y-%m-%d %H:%M:%S%.3f",
            )
            .unwrap(),
            owner_id: None,
            store_name: None,
        }
    }

    /// Nothing asserted that the forwards forward.
    ///
    /// The compiler catches a *missing* trait method; nothing caught a *wrong*
    /// one. `self.count()` where `self.inner.count()` was meant type-checks,
    /// because both are `ProductStore`, and used to surface as a hang inside
    /// whichever unrelated test happened to reach it — or as a count of 64 where
    /// one was expected, which reads like a singleflight bug rather than a typo.
    ///
    /// So this runs the repository's own store contract through
    /// [`CountingStore`], which reaches the inner store through
    /// [`DelegatingStore`]. Every method of all three traits is driven once, and
    /// each answer has to be the inner store's. One suite, the one already
    /// responsible for "what a store must mean", rather than a second set of
    /// expectations about the same forwards.
    ///
    /// Checked by mutation rather than assumed. Making `count` forward to
    /// `self.count()` fails here, as a stack overflow attributed to this test
    /// rather than to whichever handler test used to reach it; making
    /// `list_page` drop its `offset` fails here with `an offset past the last row
    /// is an empty page`.
    ///
    /// What it cannot catch, stated so nobody assumes otherwise: two forwards
    /// swapped for a sibling `InMemoryStore` implements identically. The double
    /// has one pool, so `list_page_for_owner` and `list_public_page_by_owner` are
    /// the same call, as are `count_for_owner` and `count_public_by_owner` —
    /// `memory.rs` says so and `owned_pages_only_contain_that_owners_rows`
    /// pins it. No assertion written against the double can tell those four
    /// apart, because there is no difference to tell. Catching one of them
    /// swapped needs an inner store that reads a different pool, which is
    /// `SqlProductStore` under `test:e2e`.
    #[tokio::test]
    async fn the_store_contract_holds_through_the_forwards() {
        let inner = InMemoryStore::new(vec![seed("prd_delegating")]);
        let store = CountingStore::new(inner.clone());
        // One clone per harness hook: both closures are `move`, so a single
        // `handle` could not be captured twice. Both reach past the traits,
        // which is the point — the suite needs two edits no store trait exposes.
        let for_rename = inner.clone();
        let for_seeding = inner.clone();
        assert_store_contract(
            &store,
            move |owner_id, new_name| {
                let owner_id = owner_id.to_string();
                let new_name = new_name.to_string();
                let handle = for_rename.clone();
                async move {
                    handle
                        .users()
                        .lock()
                        .expect("in-memory users")
                        .get_mut(&owner_id)
                        .expect("the contract's own seller")
                        .user
                        .store_name = new_name;
                }
            },
            move |owner_id, ids, created_at| {
                let owner_id = owner_id.to_string();
                let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
                let handle = for_seeding.clone();
                async move {
                    let mut products = handle.products().lock().expect("in-memory products");
                    products.extend(ids.into_iter().map(|id| Product {
                        title: format!("Product {id}"),
                        id,
                        description: None,
                        price: 5.0,
                        currency: "USD".to_string(),
                        image_url: None,
                        stock: 3,
                        created_at,
                        owner_id: Some(owner_id.clone()),
                        store_name: None,
                    }));
                }
            },
        )
        .await;
    }
}
