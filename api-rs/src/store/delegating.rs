//! Forwarding to another store, written once.

use std::sync::Arc;

use async_trait::async_trait;

use super::products::{NewProduct, Product, ProductPatch, ProductStore, StoreError};
use super::sessions::{Session, SessionStore};
use super::users::{NewUser, StoreUser, UserRecord, UserStore};
use super::MarketplaceStore;

/// A [`MarketplaceStore`] that forwards every method to another one.
///
/// `AppState` holds one `Arc<dyn MarketplaceStore>` rather than three handles,
/// so a test double that cares about one method still has to satisfy all three
/// traits. Writing those forwards by hand puts ~40 lines of no-content
/// boilerplate in every test module that needs a spy, and a new trait method
/// turns each of them into a compile error the author then has to fix by copying
/// more boilerplate.
///
/// Composing this instead means a spy overrides one method and nothing else, and
/// a new trait method costs zero edits in it. The forwards below are the same
/// forwards `CountingStore` used to own; they are just not owned by a handler's
/// test module any more.
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
