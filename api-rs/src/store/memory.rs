use async_trait::async_trait;

use super::products::{Product, ProductStore, StoreError};

/// Deterministic in-process store for unit tests and benchmarks.
#[derive(Clone, Default)]
pub struct InMemoryStore {
    products: Vec<Product>,
}

impl InMemoryStore {
    pub fn new(mut products: Vec<Product>) -> Self {
        products.sort_by(|a, b| (&a.created_at, &a.id).cmp(&(&b.created_at, &b.id)));
        Self { products }
    }

    pub fn len(&self) -> usize {
        self.products.len()
    }

    pub fn is_empty(&self) -> bool {
        self.products.is_empty()
    }
}

#[async_trait]
impl ProductStore for InMemoryStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        let start = (offset.max(0) as usize).min(self.products.len());
        let end = ((offset.max(0) + limit.max(0)) as usize).min(self.products.len());
        Ok(self.products[start..end].to_vec())
    }

    async fn count(&self) -> Result<i64, StoreError> {
        Ok(self.products.len() as i64)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        Ok(self.products.iter().find(|product| product.id == id).cloned())
    }

    async fn ping(&self) -> Result<(), StoreError> {
        Ok(())
    }
}
