pub mod contract;
pub mod memory;
pub mod products;
pub mod sessions;
pub mod users;

// Test scaffolding rather than part of the library: nothing outside a
// `#[cfg(test)]` module composes `DelegatingStore` or `CountingStore`, so
// neither is compiled into the binary the Dockerfile ships or documented as API.
#[cfg(test)]
pub mod testdouble;

pub use memory::{InMemoryStore, StoreOp};
pub use products::{
    connect_primary_pool, connect_read_replica, generate_product_id, MarketplaceStore, NewProduct,
    Patch, Product, ProductPatch, ProductStore, SqlProductStore, StoreError,
    MAX_DESCRIPTION_LENGTH, MAX_IMAGE_URL_LENGTH, MAX_TITLE_LENGTH, PAGE_SIZE,
};
pub use sessions::{Session, SessionStore};
#[cfg(test)]
pub use testdouble::CountingStore;
pub use users::{normalize_email, NewUser, StoreUser, UserRecord, UserStore};
