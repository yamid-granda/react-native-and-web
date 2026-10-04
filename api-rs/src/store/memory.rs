use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use super::products::{NewProduct, Product, ProductPatch, ProductStore, StoreError};
use super::sessions::Session;
use super::users::UserRecord;

/// A surface of [`InMemoryStore`] a test can make misbehave.
///
/// One flag per surface rather than per method: a handler that needs the public
/// page query to fail needs its owner-scoped twin to fail with it, and a spy
/// wrapping a whole store needs one switch instead of sixteen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StoreOp {
    /// `list_page`, `list_owned_page`, `count_owned`, `find_owned_by_id`,
    /// `create`, `update_owned` and `delete_owned`.
    Products,
    /// `count`.
    Count,
    /// `find_by_id`.
    Product,
    /// `ping`.
    Ping,
    /// `find_user_by_email`, `find_user_by_id` and `create_user`.
    Users,
    /// `find_valid_session`, `create_session` and `delete_session`.
    Sessions,
}

/// The switch count, i.e. one slot per [`StoreOp`].
const OPS: usize = 6;

impl StoreOp {
    fn index(self) -> usize {
        match self {
            StoreOp::Products => 0,
            StoreOp::Count => 1,
            StoreOp::Product => 2,
            StoreOp::Ping => 3,
            StoreOp::Users => 4,
            StoreOp::Sessions => 5,
        }
    }
}

/// Deterministic in-process store for unit tests and benchmarks.
///
/// The user and session maps exist so a handler test can exercise the whole
/// auth path — register, login, `/auth/me`, logout — without a database, on the
/// same terms as the pre-existing product fixtures.
///
/// It can also be told to fail. The switches below used to live in one handler's
/// test module, which made `/health`'s error and timeout arms unreachable without
/// Docker even though every other router-level test in the crate runs against
/// this store.
#[derive(Clone, Default)]
pub struct InMemoryStore {
    products: Arc<Mutex<Vec<Product>>>,
    users: Arc<Mutex<HashMap<String, UserRecord>>>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    /// One-shot failures, consumed on use so a retry succeeds.
    fail_once: Arc<[AtomicBool; OPS]>,
    /// Sticky failures, for a surface that must keep refusing.
    fail_always: Arc<[AtomicBool; OPS]>,
    /// Surfaces whose future never resolves, so the caller's own timeout is what
    /// ends the call.
    hang: Arc<[AtomicBool; OPS]>,
}

impl InMemoryStore {
    pub fn new(products: Vec<Product>) -> Self {
        let mut products = products;
        sort_by_contract(&mut products);
        Self {
            products: Arc::new(Mutex::new(products)),
            users: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            fail_once: Arc::new(Default::default()),
            fail_always: Arc::new(Default::default()),
            hang: Arc::new(Default::default()),
        }
    }

    pub fn len(&self) -> usize {
        self.products.lock().expect("in-memory products").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The rows one query would return, in the order `LIST_QUERY` and
    /// `LIST_OWNED_QUERY` produce them — so a pagination assertion written
    /// against this store is the same assertion the E2E suite makes against
    /// Postgres. `owner_id: None` is the public catalogue.
    ///
    /// The product lock is released before the seller rows are read: `rows` is
    /// the only place that reads one lock while holding the other, so the order
    /// is always products-then-users and never the reverse.
    fn rows(&self, owner_id: Option<&str>) -> Vec<Product> {
        let mut rows: Vec<Product> = {
            let products = self.products.lock().expect("in-memory products");
            products
                .iter()
                .filter(|product| owner_id.is_none() || product.owner_id.as_deref() == owner_id)
                .cloned()
                .collect()
        };
        sort_by_contract(&mut rows);
        self.join_store_names(&mut rows);
        rows
    }

    /// The one query `LIMIT`/`OFFSET` answers, without the clamping this store
    /// used to do. Postgres refuses a negative `LIMIT` or `OFFSET` outright, so
    /// silently returning the first page instead would let a test pass on a page
    /// the database would refuse to produce. Every caller reaches this through
    /// `prisma_offset` (which rejects a negative skip) with a positive `limit`,
    /// so the refusal is a contract, not a live path.
    fn slice(rows: &[Product], offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        if offset < 0 || limit < 0 {
            return Err(StoreError::Database(format!(
                "negative page window: offset {offset}, limit {limit}"
            )));
        }
        let start = (offset as usize).min(rows.len());
        let end = (offset.saturating_add(limit) as usize).min(rows.len());
        Ok(rows[start..end].to_vec())
    }

    /// The `LEFT JOIN "User"` that every product query does in one statement: a
    /// product's store name is whatever the owner's row says *now*, and `NULL`
    /// when the owner has no row.
    ///
    /// Joining on the way out rather than copying at write time is the whole
    /// point. A snapshot is a stored field the moment it is written, so it goes
    /// stale the first time a seller renames — and the two implementations then
    /// answer differently for a row neither of them has changed.
    fn join_store_names(&self, rows: &mut [Product]) {
        if rows.is_empty() {
            return;
        }
        let users = self.users.lock().expect("in-memory users");
        for row in rows {
            row.store_name = row.owner_id.as_deref().and_then(|owner_id| {
                users.get(owner_id).map(|record| record.user.store_name.clone())
            });
        }
    }

    fn joined(&self, product: &mut Product) {
        self.join_store_names(std::slice::from_mut(product));
    }

    /// Fail the next call to `op` and behave normally afterwards. Consumed on
    /// use so a test can make exactly one attempt fail — the semantics the
    /// cache stampede tests need, where the retry has to succeed.
    pub fn fail_once(&self, op: StoreOp) {
        self.fail_once[op.index()].store(true, Ordering::SeqCst);
    }

    /// Fail every call to `op` until [`Self::clear_failures`].
    pub fn fail_always(&self, op: StoreOp) {
        self.fail_always[op.index()].store(true, Ordering::SeqCst);
    }

    /// Make every call to `op` hang. `/health` wraps `ping` in
    /// `tokio::time::timeout`, so this is what makes its timeout arm reachable
    /// without a socket that never answers — and without a sleep, which would
    /// only prove that a sleep elapsed.
    pub fn hang_always(&self, op: StoreOp) {
        self.hang[op.index()].store(true, Ordering::SeqCst);
    }

    /// Drop every switch set on `op`, so one store instance can serve a failing
    /// test and a passing one.
    pub fn clear_failures(&self, op: StoreOp) {
        self.fail_once[op.index()].store(false, Ordering::SeqCst);
        self.fail_always[op.index()].store(false, Ordering::SeqCst);
        self.hang[op.index()].store(false, Ordering::SeqCst);
    }

    /// The single place a switch becomes a store result, so no method can answer
    /// failure its own way and no method can quietly skip the gate.
    pub(super) async fn gate(&self, op: StoreOp) -> Result<(), StoreError> {
        let index = op.index();
        if self.hang[index].load(Ordering::SeqCst) {
            // Never resolves. The caller's timeout is what ends this call.
            return std::future::pending::<Result<(), StoreError>>().await;
        }
        if self.fail_once[index].swap(false, Ordering::SeqCst)
            || self.fail_always[index].load(Ordering::SeqCst)
        {
            return Err(StoreError::Database(format!("injected {op:?} failure")));
        }
        Ok(())
    }

    pub(super) fn users(&self) -> &Mutex<HashMap<String, UserRecord>> {
        &self.users
    }

    pub(super) fn sessions(&self) -> &Mutex<HashMap<String, Session>> {
        &self.sessions
    }
}

/// `createdAt ASC, id ASC` — the ordering every product query shares.
fn sort_by_contract(products: &mut [Product]) {
    products.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
}

#[async_trait]
impl ProductStore for InMemoryStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        self.gate(StoreOp::Products).await?;
        Self::slice(&self.rows(None), offset, limit)
    }

    async fn count(&self) -> Result<i64, StoreError> {
        self.gate(StoreOp::Count).await?;
        Ok(self.len() as i64)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        self.gate(StoreOp::Product).await?;
        let found = self
            .products
            .lock()
            .expect("in-memory products")
            .iter()
            .find(|product| product.id == id)
            .cloned();
        Ok(found.map(|mut product| {
            self.joined(&mut product);
            product
        }))
    }

    async fn list_owned_page(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        self.gate(StoreOp::Products).await?;
        Self::slice(&self.rows(Some(owner_id)), offset, limit)
    }

    async fn count_owned(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.gate(StoreOp::Products).await?;
        Ok(self.rows(Some(owner_id)).len() as i64)
    }

    async fn find_owned_by_id(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<Product>, StoreError> {
        self.gate(StoreOp::Products).await?;
        let found = self
            .products
            .lock()
            .expect("in-memory products")
            .iter()
            .find(|product| product.id == id && product.owner_id.as_deref() == Some(owner_id))
            .cloned();
        Ok(found.map(|mut product| {
            self.joined(&mut product);
            product
        }))
    }

    async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError> {
        self.gate(StoreOp::Products).await?;
        let product = Product {
            id: super::products::generate_product_id(),
            title: new_product.title,
            description: new_product.description,
            price: new_product.price,
            currency: "USD".to_string(),
            image_url: new_product.image_url,
            stock: new_product.stock,
            created_at: chrono::Utc::now().naive_utc(),
            owner_id: Some(owner_id.to_string()),
            // There is no store name column on the product row to copy into:
            // `store_name` is whatever the owner's row says when it is read.
            store_name: None,
        };
        {
            let mut products = self.products.lock().expect("in-memory products");
            products.push(product.clone());
            sort_by_contract(&mut products);
        }
        // Answered the way a read would answer it, because the handler that just
        // called this is the one that will read the row back.
        let mut created = product;
        self.joined(&mut created);
        Ok(created)
    }

    async fn update_owned(
        &self,
        owner_id: &str,
        id: &str,
        patch: ProductPatch,
    ) -> Result<Option<Product>, StoreError> {
        self.gate(StoreOp::Products).await?;
        let updated = {
            let mut products = self.products.lock().expect("in-memory products");
            let Some(product) = products
                .iter_mut()
                .find(|product| product.id == id && product.owner_id.as_deref() == Some(owner_id))
            else {
                return Ok(None);
            };
            if let Some(title) = patch.title {
                product.title = title;
            }
            if let Some(description) = patch.description {
                product.description = Some(description);
            }
            if let Some(price) = patch.price {
                product.price = price;
            }
            if let Some(image_url) = patch.image_url {
                product.image_url = Some(image_url);
            }
            if let Some(stock) = patch.stock {
                product.stock = stock;
            }
            let updated = product.clone();
            // Re-sort anyway: a patch cannot move a row today, but the invariant
            // "the vec is in contract order" is what `rows` relies on.
            sort_by_contract(&mut products);
            updated
        };
        let mut updated = updated;
        self.joined(&mut updated);
        Ok(Some(updated))
    }

    async fn delete_owned(&self, owner_id: &str, id: &str) -> Result<bool, StoreError> {
        self.gate(StoreOp::Products).await?;
        let mut products = self.products.lock().expect("in-memory products");
        let before = products.len();
        products
            .retain(|product| !(product.id == id && product.owner_id.as_deref() == Some(owner_id)));
        Ok(products.len() < before)
    }

    async fn ping(&self) -> Result<(), StoreError> {
        // A real result rather than `Ok(())`, which is what `/health` reports
        // when the database cannot be reached.
        self.gate(StoreOp::Ping).await
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use chrono::NaiveDateTime;

    use crate::store::contract::assert_store_contract;
    use crate::store::users::{NewUser, UserStore};

    fn at(hour: u32) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(
            &format!("2026-01-01 {hour:02}:00:00.000"),
            "%Y-%m-%d %H:%M:%S%.3f",
        )
        .expect("timestamp")
    }

    /// A product as the `Product` table holds it. The store name is *not* on the
    /// row: in SQL there is no such column either, it comes from the owner's row
    /// when the row is read.
    fn owned(id: &str, owner_id: &str, hour: u32) -> Product {
        Product {
            id: id.to_string(),
            title: format!("Product {id}"),
            description: None,
            price: 10.0,
            currency: "USD".to_string(),
            image_url: None,
            stock: 1,
            created_at: at(hour),
            owner_id: Some(owner_id.to_string()),
            store_name: None,
        }
    }

    fn seed(id: &str, hour: u32) -> Product {
        Product {
            id: id.to_string(),
            title: format!("Product {id}"),
            description: None,
            price: 5.0,
            currency: "USD".to_string(),
            image_url: None,
            stock: 3,
            created_at: at(hour),
            owner_id: None,
            store_name: None,
        }
    }

    /// A real `User` row, so the `LEFT JOIN` has something to find — the only
    /// way the SQL path can ever return a store name.
    async fn register(store: &InMemoryStore, id: &str, store_name: &str) {
        store
            .create_user(NewUser {
                id: id.to_string(),
                email: format!("{id}@rnw.test"),
                password_hash: "$argon2id$not-a-real-hash".to_string(),
                store_name: store_name.to_string(),
            })
            .await
            .expect("register a fixture seller");
    }

    /// The seeded catalogue plus the two sellers who own it.
    async fn store() -> InMemoryStore {
        let store = InMemoryStore::new(vec![
            owned("prod-b", "usr-2", 2),
            owned("prod-a", "usr-1", 1),
            seed("seeded", 3),
        ]);
        register(&store, "usr-1", "First Shop").await;
        register(&store, "usr-2", "Second Shop").await;
        store
    }

    #[tokio::test]
    async fn owned_pages_only_contain_that_owners_rows() {
        let store = store().await;
        let page = store.list_owned_page("usr-1", 0, 20).await.unwrap();
        assert_eq!(page.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["prod-a"]);
        assert_eq!(page[0].store_name.as_deref(), Some("First Shop"));
        assert_eq!(store.count_owned("usr-1").await.unwrap(), 1);
        assert_eq!(store.count_owned("usr-nobody").await.unwrap(), 0);
        // The ownerless seed row stays visible on the public list.
        assert_eq!(store.count().await.unwrap(), 3);
        let public = store.list_page(0, 20).await.unwrap();
        assert!(public
            .iter()
            .any(|product| product.id == "seeded" && product.store_name.is_none()));
    }

    #[tokio::test]
    async fn another_owners_product_is_invisible_not_forbidden() {
        let store = store().await;
        assert!(store.find_by_id("prod-a").await.unwrap().is_some());
        assert!(store.find_owned_by_id("usr-2", "prod-a").await.unwrap().is_none());
        assert!(!store.delete_owned("usr-2", "prod-a").await.unwrap());
        assert!(store
            .update_owned("usr-2", "prod-a", ProductPatch::default())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn update_patches_only_the_fields_it_carries() {
        let store = store().await;
        let patched = store
            .update_owned(
                "usr-1",
                "prod-a",
                ProductPatch { price: Some(42.0), ..ProductPatch::default() },
            )
            .await
            .unwrap()
            .expect("owned row");
        assert_eq!(patched.price, 42.0);
        assert_eq!(patched.title, "Product prod-a", "absent fields are left alone");
        assert_eq!(patched.store_name.as_deref(), Some("First Shop"));
    }

    #[tokio::test]
    async fn create_returns_the_owners_store_name_and_sorts_last() {
        let store = store().await;
        let created = store
            .create(
                "usr-1",
                NewProduct {
                    title: "Handmade Mug".to_string(),
                    description: None,
                    price: 12.5,
                    image_url: None,
                    stock: 4,
                },
            )
            .await
            .unwrap();
        assert_eq!(created.owner_id.as_deref(), Some("usr-1"));
        assert_eq!(created.store_name.as_deref(), Some("First Shop"), "joined from the owner");
        assert_eq!(created.currency, "USD", "the write path pins the currency");
        let page = store.list_owned_page("usr-1", 0, 20).await.unwrap();
        assert_eq!(page.last().unwrap().id, created.id);
    }

    /// The value is joined at read time rather than copied at write time. A
    /// seller who registers *after* the product was written still appears on it:
    /// a write-time snapshot answers `None` here, and `SqlProductStore` answers
    /// `Some`.
    #[tokio::test]
    async fn a_store_name_is_joined_not_snapshotted() {
        let store = InMemoryStore::new(vec![]);
        let created = store
            .create(
                "usr-late",
                NewProduct {
                    title: "Late Seller".to_string(),
                    description: None,
                    price: 1.0,
                    image_url: None,
                    stock: 1,
                },
            )
            .await
            .unwrap();
        assert_eq!(created.store_name, None, "no `User` row exists yet");

        register(&store, "usr-late", "Ninth Street").await;

        let reread = store.find_by_id(&created.id).await.unwrap().expect("the row is there");
        assert_eq!(reread.store_name.as_deref(), Some("Ninth Street"));
    }

    /// The failure switches live on the store, so `/health`'s down arms are
    /// reachable from a unit test — and a hang is a hang, not a sleep.
    #[tokio::test]
    async fn a_switch_makes_the_surface_fail_and_stops() {
        let store = InMemoryStore::new(vec![seed("prod-1", 1)]);

        store.fail_once(StoreOp::Count);
        assert!(store.count().await.is_err(), "the first call fails");
        assert_eq!(store.count().await.unwrap(), 1, "one-shot means one failure");

        store.fail_always(StoreOp::Products);
        assert!(store.list_page(0, 20).await.is_err());
        assert!(store.count_owned("usr-1").await.is_err(), "the surface, not the method");
        assert_eq!(store.count().await.unwrap(), 1, "another surface is untouched");

        store.clear_failures(StoreOp::Products);
        assert_eq!(store.list_page(0, 20).await.unwrap().len(), 1);

        store.hang_always(StoreOp::Ping);
        assert!(
            tokio::time::timeout(Duration::from_millis(50), store.ping()).await.is_err(),
            "a hung ping is ended by the caller's timeout, never by itself"
        );
    }

    #[tokio::test]
    async fn delete_removes_exactly_one_row_and_is_idempotent_safe() {
        let store = store().await;
        assert!(store.delete_owned("usr-1", "prod-a").await.unwrap());
        assert_eq!(store.count().await.unwrap(), 2);
        // A second delete reports "nothing to do", not an error.
        assert!(!store.delete_owned("usr-1", "prod-a").await.unwrap());
    }

    /// Every assertion here is also run against Postgres, under `test:e2e`.
    #[tokio::test]
    async fn the_store_contract_holds_for_the_double() {
        let store = InMemoryStore::new(vec![seed("prod-fixture", 1)]);
        let handle = store.clone();
        assert_store_contract(&store, move |owner_id, new_name| {
            // Owned, not borrowed: the contract takes one future type, so the
            // closure's arguments cannot be captured by reference.
            let owner_id = owner_id.to_string();
            let new_name = new_name.to_string();
            let handle = handle.clone();
            async move {
                // The rename the store has no method for, which is exactly the
                // situation production is in too.
                handle
                    .users()
                    .lock()
                    .expect("in-memory users")
                    .get_mut(&owner_id)
                    .expect("the contract's own seller")
                    .user
                    .store_name = new_name;
            }
        })
        .await;
    }
}
