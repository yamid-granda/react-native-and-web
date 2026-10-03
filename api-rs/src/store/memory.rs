use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use super::products::{NewProduct, Product, ProductPatch, ProductStore, StoreError};
use super::sessions::Session;
use super::users::UserRecord;

/// Deterministic in-process store for unit tests and benchmarks.
///
/// The user and session maps exist so a handler test can exercise the whole
/// auth path — register, login, `/auth/me`, logout — without a database, on the
/// same terms as the pre-existing product fixtures.
#[derive(Clone, Default)]
pub struct InMemoryStore {
    products: Arc<Mutex<Vec<Product>>>,
    users: Arc<Mutex<HashMap<String, UserRecord>>>,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}

impl InMemoryStore {
    pub fn new(products: Vec<Product>) -> Self {
        let mut products = products;
        sort_by_contract(&mut products);
        Self {
            products: Arc::new(Mutex::new(products)),
            users: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
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
    fn rows(&self, owner_id: Option<&str>) -> Vec<Product> {
        let products = self.products.lock().expect("in-memory products");
        let mut rows: Vec<Product> = products
            .iter()
            .filter(|product| owner_id.is_none() || product.owner_id.as_deref() == owner_id)
            .cloned()
            .collect();
        sort_by_contract(&mut rows);
        rows
    }

    fn slice(rows: &[Product], offset: i64, limit: i64) -> Vec<Product> {
        let start = (offset.max(0) as usize).min(rows.len());
        let end = ((offset.max(0) + limit.max(0)) as usize).min(rows.len());
        rows[start..end].to_vec()
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
        Ok(Self::slice(&self.rows(None), offset, limit))
    }

    async fn count(&self) -> Result<i64, StoreError> {
        Ok(self.len() as i64)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        let products = self.products.lock().expect("in-memory products");
        Ok(products.iter().find(|product| product.id == id).cloned())
    }

    async fn list_owned_page(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        Ok(Self::slice(&self.rows(Some(owner_id)), offset, limit))
    }

    async fn count_owned(&self, owner_id: &str) -> Result<i64, StoreError> {
        Ok(self.rows(Some(owner_id)).len() as i64)
    }

    async fn find_owned_by_id(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<Product>, StoreError> {
        Ok(self
            .products
            .lock()
            .expect("in-memory products")
            .iter()
            .find(|product| product.id == id && product.owner_id.as_deref() == Some(owner_id))
            .cloned())
    }

    async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError> {
        // Mirrors the store name the SQL path gets from its LEFT JOIN.
        let store_name = self
            .users()
            .lock()
            .expect("in-memory users")
            .get(owner_id)
            .map(|record| record.user.store_name.clone());
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
            store_name,
        };
        let mut products = self.products.lock().expect("in-memory products");
        products.push(product.clone());
        sort_by_contract(&mut products);
        Ok(product)
    }

    async fn update_owned(
        &self,
        owner_id: &str,
        id: &str,
        patch: ProductPatch,
    ) -> Result<Option<Product>, StoreError> {
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
        Ok(Some(updated))
    }

    async fn delete_owned(&self, owner_id: &str, id: &str) -> Result<bool, StoreError> {
        let mut products = self.products.lock().expect("in-memory products");
        let before = products.len();
        products
            .retain(|product| !(product.id == id && product.owner_id.as_deref() == Some(owner_id)));
        Ok(products.len() < before)
    }

    async fn ping(&self) -> Result<(), StoreError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    fn at(hour: u32) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(
            &format!("2026-01-01 {hour:02}:00:00.000"),
            "%Y-%m-%d %H:%M:%S%.3f",
        )
        .expect("timestamp")
    }

    /// A product the SQL path would have returned with a store name attached.
    pub(crate) fn owned(id: &str, owner_id: &str, store_name: &str, hour: u32) -> Product {
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
            store_name: Some(store_name.to_string()),
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

    fn store() -> InMemoryStore {
        InMemoryStore::new(vec![
            owned("prod-b", "usr-2", "Second Shop", 2),
            owned("prod-a", "usr-1", "First Shop", 1),
            seed("seeded", 3),
        ])
    }

    #[tokio::test]
    async fn owned_pages_only_contain_that_owners_rows() {
        let store = store();
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
        let store = store();
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
        let store = store();
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
    async fn create_stamps_the_owners_store_name_and_sorts_last() {
        let store = store();
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
        // No "User" row exists in this fixture, so the join has nothing to add.
        assert_eq!(created.store_name, None);
        assert_eq!(created.currency, "USD", "the write path pins the currency");
        let page = store.list_owned_page("usr-1", 0, 20).await.unwrap();
        assert_eq!(page.last().unwrap().id, created.id);
    }

    #[tokio::test]
    async fn delete_removes_exactly_one_row_and_is_idempotent_safe() {
        let store = store();
        assert!(store.delete_owned("usr-1", "prod-a").await.unwrap());
        assert_eq!(store.count().await.unwrap(), 2);
        // A second delete reports "nothing to do", not an error.
        assert!(!store.delete_owned("usr-1", "prod-a").await.unwrap());
    }
}
