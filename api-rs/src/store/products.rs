use std::time::Duration;
use std::time::Instant;

use std::str::FromStr;

use chrono::NaiveDateTime;
use sqlx::pool::PoolConnection;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{FromRow, PgPool, Postgres};

/// The marketplace list contract: the page size fixed at 20, `createdAt ASC,
/// id ASC` ordering (id tiebreaker for bulk-seeded rows sharing a timestamp),
/// and a separate `COUNT(*)`.
///
/// The ordering tuple is not free: it is backed by
/// `Product_createdAt_id_idx` (`@@index([createdAt, id])`). Without that index
/// Postgres sorts the whole table for every page before `LIMIT` can apply.
pub const PAGE_SIZE: i64 = 20;

/// Title cap for a seller-created product. Long enough for a real title,
/// short enough that the list projection stays small; matches what the API
/// accepts, so the client can validate without asking.
pub const MAX_TITLE_LENGTH: usize = 200;

#[derive(Clone, Debug, PartialEq)]
pub struct Product {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub price: f64,
    pub currency: String,
    pub image_url: Option<String>,
    pub stock: i32,
    pub created_at: NaiveDateTime,
    /// `NULL` for seeded and imported rows. Not exposed as `ownerId` — a
    /// seller never needs to be told which id they own, and `storeId` covers
    /// the one public question ("who sells this?").
    pub owner_id: Option<String>,
    /// The owner's store name, via the same `LEFT JOIN` as `owner_id`. `NULL`
    /// for ownerless products, which is why both are `Option`.
    pub store_name: Option<String>,
}

/// The fields a seller controls on create. `currency` is not among them: there
/// is no currency picker in either client, so the write path pins it the way
/// the seed does.
#[derive(Clone, Debug)]
pub struct NewProduct {
    pub title: String,
    pub description: Option<String>,
    pub price: f64,
    pub image_url: Option<String>,
    pub stock: i32,
}

/// The fields a seller controls on update. Every one is optional: `PATCH` with
/// an empty body is a no-op, not an error.
#[derive(Clone, Debug, Default)]
pub struct ProductPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub price: Option<f64>,
    pub image_url: Option<String>,
    pub stock: Option<i32>,
}

impl ProductPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.description.is_none()
            && self.price.is_none()
            && self.image_url.is_none()
            && self.stock.is_none()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(String),
    /// Postgres rejected the address as a duplicate. A distinct variant rather
    /// than a string match on the driver error, so the handler can answer 409
    /// without knowing anything about Postgres.
    #[error("email already registered")]
    EmailTaken,
}

impl From<sqlx::Error> for StoreError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

#[async_trait::async_trait]
pub trait ProductStore: Send + Sync + 'static {
    /// The rows for one page. The total row count is deliberately a separate
    /// call: it is per-catalog rather than per-page, so the handler caches it
    /// instead of recomputing it on every request.
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError>;
    /// `COUNT(*)` over the whole catalog — the `total` the envelope requires.
    async fn count(&self) -> Result<i64, StoreError>;
    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError>;
    /// The seller's own rows, for `GET /my-store/products`. Always the primary:
    /// a seller must see their own writes, so a lagged read here is a bug rather
    /// than a trade-off.
    async fn list_page_for_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError>;
    /// The public storefront page, for `GET /stores/{id}/products`. Replica-safe:
    /// eventually consistent by choice, per `ARCHITECTURE.md`'s pool table.
    ///
    /// The same rows as [`Self::list_page_for_owner`], served to anyone rather
    /// than to the seller. Split from it rather than shared with it so neither
    /// caller inherits the other's pool by accident — the two have opposite
    /// requirements and a single name cannot express both.
    async fn list_public_page_by_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError>;
    async fn count_for_owner(&self, owner_id: &str) -> Result<i64, StoreError>;
    /// The storefront's `total`, on the same pool as
    /// [`Self::list_public_page_by_owner`].
    async fn count_public_by_owner(&self, owner_id: &str) -> Result<i64, StoreError>;
    /// `None` for a product that does not exist *and* for one owned by someone
    /// else: a 403 would confirm the id exists on a public catalog.
    async fn find_owned_by_id(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<Product>, StoreError>;
    async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError>;
    /// `None` when the product does not exist or is not the caller's.
    async fn update_owned(
        &self,
        owner_id: &str,
        id: &str,
        patch: ProductPatch,
    ) -> Result<Option<Product>, StoreError>;
    /// `false` when the product does not exist or is not the caller's.
    async fn delete_owned(&self, owner_id: &str, id: &str) -> Result<bool, StoreError>;
    async fn ping(&self) -> Result<(), StoreError>;
}

/// Products, users and sessions behind the three traits above.
///
/// `AppState` holds one `Arc<dyn MarketplaceStore>` rather than three handles:
/// it is one Postgres pool, and routing a write to the primary and a read to the
/// replica is a decision each trait method makes explicitly.
pub trait MarketplaceStore:
    ProductStore + super::users::UserStore + super::sessions::SessionStore + Send + Sync + 'static
{
}

impl<T> MarketplaceStore for T where
    T: ProductStore
        + super::users::UserStore
        + super::sessions::SessionStore
        + Send
        + Sync
        + 'static
{
}

#[derive(FromRow)]
struct ProductRow {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    currency: String,
    #[sqlx(rename = "imageUrl")]
    image_url: Option<String>,
    stock: i32,
    #[sqlx(rename = "createdAt")]
    created_at: NaiveDateTime,
    #[sqlx(rename = "ownerId")]
    owner_id: Option<String>,
    #[sqlx(rename = "storeName")]
    store_name: Option<String>,
}

impl From<ProductRow> for Product {
    fn from(row: ProductRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            description: row.description,
            price: row.price,
            currency: row.currency,
            image_url: row.image_url,
            stock: row.stock,
            created_at: row.created_at,
            owner_id: row.owner_id,
            store_name: row.store_name,
        }
    }
}

/// Both statements are `&'static str` on purpose: sqlx 0.9 only accepts
/// literal SQL without an explicit injection audit, and since the column list
/// never varies there is nothing to interpolate — building them with `format!`
/// would only allocate once per query.
///
/// The `LEFT JOIN` is what puts the seller on a public product. It is a LEFT
/// join, not an inner one, precisely because seeded rows have no owner: an
/// inner join would silently drop most of the catalogue.
const LIST_QUERY: &str = r#"SELECT p."id", p."title", p."description", p."price", p."currency", p."imageUrl", p."stock", p."createdAt", p."ownerId", u."storeName" FROM "Product" p LEFT JOIN "User" u ON u."id" = p."ownerId" ORDER BY p."createdAt" ASC, p."id" ASC LIMIT $1 OFFSET $2"#;
// Not a raw string: this one *ends* in a `"`, and in `r#"…"#` that quote would
// pair with the `#` and become the terminator — leaving the identifier
// unclosed. The two queries above get away with `r#"…"#` only because neither
// ends in a quote.
const COUNT_QUERY: &str = "SELECT COUNT(*) FROM \"Product\"";
const DETAIL_QUERY: &str = r#"SELECT p."id", p."title", p."description", p."price", p."currency", p."imageUrl", p."stock", p."createdAt", p."ownerId", u."storeName" FROM "Product" p LEFT JOIN "User" u ON u."id" = p."ownerId" WHERE p."id" = $1"#;

/// The owner-scoped twin of `LIST_QUERY`, backed by
/// `Product_ownerId_createdAt_id_idx`: equality on `ownerId`, then the same
/// ordering tuple, so it is an index range scan that stops at `LIMIT`.
const LIST_OWNED_QUERY: &str = r#"SELECT p."id", p."title", p."description", p."price", p."currency", p."imageUrl", p."stock", p."createdAt", p."ownerId", u."storeName" FROM "Product" p LEFT JOIN "User" u ON u."id" = p."ownerId" WHERE p."ownerId" = $1 ORDER BY p."createdAt" ASC, p."id" ASC LIMIT $2 OFFSET $3"#;
const COUNT_OWNED_QUERY: &str = "SELECT COUNT(*) FROM \"Product\" WHERE \"ownerId\" = $1";
const DETAIL_OWNED_QUERY: &str = r#"SELECT p."id", p."title", p."description", p."price", p."currency", p."imageUrl", p."stock", p."createdAt", p."ownerId", u."storeName" FROM "Product" p LEFT JOIN "User" u ON u."id" = p."ownerId" WHERE p."id" = $1 AND p."ownerId" = $2"#;

const INSERT_PRODUCT: &str = r#"INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt", "ownerId") VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, $8)"#;

const DELETE_PRODUCT: &str = r#"DELETE FROM "Product" WHERE "id" = $1 AND "ownerId" = $2"#;

/// One statement for every partial update.
///
/// `COALESCE($, column)` per field is what makes this a real PATCH: an absent
/// field leaves the stored value alone. There is no way to distinguish "absent"
/// from "explicitly null" this way, which is a deliberate limit — clearing an
/// image or a description is out of scope, and doing it properly needs a
/// per-field presence list in the request body.
const UPDATE_PRODUCT: &str = r#"UPDATE "Product" SET "title" = COALESCE($2, "title"), "description" = COALESCE($3, "description"), "price" = COALESCE($4, "price"), "imageUrl" = COALESCE($5, "imageUrl"), "stock" = COALESCE($6, "stock") WHERE "id" = $1 AND "ownerId" = $7"#;

/// How the *bootstrap* connection differs from a request's pool acquisition.
///
/// `DB_ACQUIRE_TIMEOUT_MS` bounds how long a **request** waits for a pool
/// connection, and it is deliberately tight so a saturated pool fails fast and
/// visibly. It is the wrong deadline for the very first connection: sqlx bounds
/// that with the same value, and under `pnpm dev` api-rs starts in the same
/// second as Next/Turbopack, Storybook's esbuild, Metro and cargo itself. A
/// one-shot 2 s connect there is a coin flip.
///
/// Losing that coin flip used to kill the process, which took all four `pnpm dev`
/// tasks down with it. Postgres is still a hard dependency (`ARCHITECTURE.md`
/// §7): the service does not serve without it. It just no longer refuses to boot
/// because it was slow to answer the first time.
const BOOTSTRAP_ATTEMPTS: u32 = 5;
const BOOTSTRAP_BACKOFF: Duration = Duration::from_millis(500);
/// Deadline for one reachability attempt. Worst case before giving up is about
/// 22 s: long enough to ride out a database container still starting, short
/// enough that a real outage fails fast instead of looking like a hung process.
const BOOTSTRAP_CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

/// Opens the primary pool the service cannot start without.
///
/// Unlike [`connect_read_replica`] this does not fail open: there is no service
/// without a primary. It does, however, judge reachability on its own terms,
/// because "Postgres was slow for two seconds while four compilers started" is
/// not the same event as "Postgres is unreachable".
///
/// Two phases, because sqlx gives no way to separate them: `connect_with` bounds
/// the whole first connection by the pool's own `acquire_timeout` *and* stores
/// that value for the pool's lifetime. So a probe pool carries the generous
/// deadline, and the pool the service keeps carries the operator's strict one.
/// Widening the real pool instead would quietly loosen every request.
pub async fn connect_primary_pool(
    url: &str,
    max_connections: u32,
    acquire_timeout: Duration,
) -> Result<PgPool, sqlx::Error> {
    // Parsed up front so a typo fails in microseconds instead of costing five
    // attempts and two seconds of backoff. No amount of waiting repairs a URL.
    let options = PgConnectOptions::from_str(url)?;

    retry_with_backoff(BOOTSTRAP_ATTEMPTS, BOOTSTRAP_BACKOFF, |attempt| {
        let options = options.clone();
        async move {
            let result = PgPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(BOOTSTRAP_CONNECT_TIMEOUT)
                .connect_with(options)
                .await;
            // Logged after the attempt, not before: logging first makes every
            // clean boot report a failure that never happened.
            if let Err(error) = &result {
                tracing::warn!(attempt, url, error = %error, "postgres connect attempt failed");
            }
            result
        }
    })
    .await?;

    // Postgres answered, so the real pool can start lazily: its first connection
    // is one handshake on whichever request arrives first, inside that request's
    // normal budget. The probe is redundant work, not waste — it is the only way
    // to reach "verified reachable" while keeping the serving pool strict.
    Ok(PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(acquire_timeout)
        .connect_lazy_with(options))
}

/// Retries `attempt` up to `attempts` times, sleeping `backoff` between tries.
///
/// Returns the last error once they are exhausted. Silent by design: the caller
/// owns the logging, because only it knows what "the thing being retried" is.
/// Split out from [`connect_primary_pool`] so the retry behaviour is testable
/// without a database — the whole point of this function is a timing policy, and
/// a policy that can only be asserted against a live Postgres is one nobody will
/// test.
async fn retry_with_backoff<T, E, F, Fut>(
    attempts: u32,
    backoff: Duration,
    mut attempt: F,
) -> Result<T, E>
where
    F: FnMut(u32) -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    let mut last_error: Option<E> = None;
    for index in 1..=attempts {
        match attempt(index).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = Some(error);
                // No sleep after the final attempt: the caller is about to get
                // this error and act on it.
                if index < attempts {
                    tokio::time::sleep(backoff).await;
                }
            }
        }
    }
    Err(last_error.expect("attempts is at least 1, so the loop ran"))
}

/// Connects the optional read replica.
///
/// Fail-open, for the same reason Valkey is: a bad `DATABASE_READ_URL` must
/// degrade to primary reads, never stop the service. `None` means "no replica",
/// which the store treats exactly like the pre-replica case.
///
/// Replica lag is the documented hazard. Since the write path landed it is
/// asymmetric on purpose: every write, and every owner-scoped read, goes to the
/// primary, so a seller always sees their own writes. `GET /products` and
/// `GET /stores/{id}/products` still read from the replica, so the *public*
/// marketplace may show a just-created product only after replica lag. See
/// `ARCHITECTURE.md` §5.
pub async fn connect_read_replica(
    url: &str,
    max_connections: u32,
    acquire_timeout: Duration,
) -> Option<PgPool> {
    let result = PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(acquire_timeout)
        .connect(url)
        .await;
    match result {
        Ok(pool) => Some(pool),
        Err(error) => {
            tracing::warn!(error = %error, "read replica unreachable; reads staying on the primary");
            None
        }
    }
}

pub struct SqlProductStore {
    /// The primary. Serves every write, every user/session lookup, and
    /// `ping` unconditionally, so `/health` keeps detecting a dead primary even
    /// when reads are routed elsewhere.
    pub(crate) pool: PgPool,
    /// An optional read replica. `None` means every query goes to the primary,
    /// which is exactly the behaviour from before this field existed — so local
    /// dev, CI, and the hermetic suite need no replica.
    read_pool: Option<PgPool>,
}

impl SqlProductStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool, read_pool: None }
    }

    pub fn with_read_replica(primary: PgPool, read: PgPool) -> Self {
        Self { pool: primary, read_pool: Some(read) }
    }

    /// Where public reads go. Reads are the only workload this service has, so
    /// a replica takes all of them — but only the ones that are safe to serve
    /// eventually consistently. The owner-scoped reads deliberately do not use
    /// this: a seller reading their own store must not race replica lag.
    fn reads(&self) -> &PgPool {
        self.read_pool.as_ref().unwrap_or(&self.pool)
    }

    /// Metric label for the pool a query actually acquired from. Reports
    /// `primary` until a replica is configured, so the dashboard never shows a
    /// phantom read pool.
    fn read_role(&self) -> &'static str {
        match self.read_pool {
            Some(_) => "read",
            None => "primary",
        }
    }

    /// Acquire from the primary. Used by writes, by user/session lookups, by
    /// the owner-scoped reads, and by `ping` — the four things where a replica
    /// would be answering a question the caller needs answered now.
    pub(crate) async fn acquire_primary(&self) -> Result<PoolConnection<Postgres>, StoreError> {
        Self::acquire(&self.pool, "primary").await
    }

    /// One owner-scoped page against whichever pool the caller's consistency
    /// requirement allows. The four `*_owner`/`*_by_owner` methods below differ
    /// only in which pool they hand here, which is what keeps "who may read
    /// this eventually" a decision made once.
    async fn owned_page(
        &self,
        pool: &PgPool,
        role: &'static str,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        let mut connection = Self::acquire(pool, role).await?;
        let rows: Vec<ProductRow> = sqlx::query_as(LIST_OWNED_QUERY)
            .bind(owner_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&mut *connection)
            .await?;
        Ok(rows.into_iter().map(Product::from).collect())
    }

    /// The owner-scoped `COUNT(*)`, against the same pool as [`Self::owned_page`].
    async fn owned_count(
        &self,
        pool: &PgPool,
        role: &'static str,
        owner_id: &str,
    ) -> Result<i64, StoreError> {
        let mut connection = Self::acquire(pool, role).await?;
        Ok(sqlx::query_scalar(COUNT_OWNED_QUERY).bind(owner_id).fetch_one(&mut *connection).await?)
    }

    /// Explicit acquisition so pool wait time is observable as its own metric
    /// (the proposal's "acquisition time exported" requirement).
    ///
    /// sqlx 0.9 only implements `Executor` for `&mut PgConnection` (and for
    /// `&Pool`), never for `&PoolConnection`, so every query below goes
    /// through `&mut *connection`.
    async fn acquire(
        pool: &PgPool,
        role: &'static str,
    ) -> Result<PoolConnection<Postgres>, StoreError> {
        let started = Instant::now();
        let connection = pool.acquire().await?;
        // The `pool` label is additive: existing `sum by (le)` queries keep
        // working and now cover both pools at once.
        metrics::histogram!("sqlx_pool_acquire_seconds", "pool" => role)
            .record(started.elapsed().as_secs_f64());
        Ok(connection)
    }
}

/// The only product id generator: `prd_` plus 128 bits of CSPRNG output.
/// Fixed ids (`prod-1`, …) belong to the seed; anything created through the
/// API gets one of these.
pub fn generate_product_id() -> String {
    crate::auth::token::opaque_id("prd_")
}

#[async_trait::async_trait]
impl ProductStore for SqlProductStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let rows: Vec<ProductRow> =
            sqlx::query_as(LIST_QUERY).bind(limit).bind(offset).fetch_all(&mut *connection).await?;
        Ok(rows.into_iter().map(Product::from).collect())
    }

    async fn count(&self) -> Result<i64, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let total: i64 = sqlx::query_scalar(COUNT_QUERY).fetch_one(&mut *connection).await?;
        Ok(total)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let row: Option<ProductRow> =
            sqlx::query_as(DETAIL_QUERY).bind(id).fetch_optional(&mut *connection).await?;
        Ok(row.map(Product::from))
    }

    async fn list_page_for_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        self.owned_page(&self.pool, "primary", owner_id, offset, limit).await
    }

    async fn list_public_page_by_owner(
        &self,
        owner_id: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Product>, StoreError> {
        self.owned_page(self.reads(), self.read_role(), owner_id, offset, limit).await
    }

    async fn count_for_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.owned_count(&self.pool, "primary", owner_id).await
    }

    async fn count_public_by_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
        self.owned_count(self.reads(), self.read_role(), owner_id).await
    }

    async fn find_owned_by_id(
        &self,
        owner_id: &str,
        id: &str,
    ) -> Result<Option<Product>, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let row: Option<ProductRow> = sqlx::query_as(DETAIL_OWNED_QUERY)
            .bind(id)
            .bind(owner_id)
            .fetch_optional(&mut *connection)
            .await?;
        Ok(row.map(Product::from))
    }

    async fn create(&self, owner_id: &str, new_product: NewProduct) -> Result<Product, StoreError> {
        let id = generate_product_id();
        let mut connection = self.acquire_primary().await?;
        sqlx::query(INSERT_PRODUCT)
            .bind(&id)
            .bind(&new_product.title)
            .bind(&new_product.description)
            .bind(new_product.price)
            .bind(&new_product.image_url)
            .bind(new_product.stock)
            .bind(chrono::Utc::now().naive_utc())
            .bind(owner_id)
            .execute(&mut *connection)
            .await?;

        // Read back through the same join the list/detail queries use, so the
        // 201 body cannot disagree with what a later GET returns.
        let mut connection = self.acquire_primary().await?;
        let row: ProductRow = sqlx::query_as(DETAIL_OWNED_QUERY)
            .bind(&id)
            .bind(owner_id)
            .fetch_one(&mut *connection)
            .await?;
        Ok(Product::from(row))
    }

    async fn update_owned(
        &self,
        owner_id: &str,
        id: &str,
        patch: ProductPatch,
    ) -> Result<Option<Product>, StoreError> {
        let mut connection = self.acquire_primary().await?;
        // `COALESCE($, column)` per field is what makes this a real PATCH: an
        // absent field leaves the stored value alone. There is no way to
        // distinguish "absent" from "explicitly null" this way, which is a
        // deliberate limit — clearing an image or description is out of scope,
        // and doing it properly needs a per-field presence list.
        let updated = sqlx::query(UPDATE_PRODUCT)
            .bind(id)
            .bind(patch.title.as_deref())
            .bind(patch.description.as_deref())
            .bind(patch.price)
            .bind(patch.image_url.as_deref())
            .bind(patch.stock)
            .bind(owner_id)
            .execute(&mut *connection)
            .await?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }

        let mut connection = self.acquire_primary().await?;
        let row: ProductRow = sqlx::query_as(DETAIL_OWNED_QUERY)
            .bind(id)
            .bind(owner_id)
            .fetch_one(&mut *connection)
            .await?;
        Ok(Some(Product::from(row)))
    }

    async fn delete_owned(&self, owner_id: &str, id: &str) -> Result<bool, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let deleted =
            sqlx::query(DELETE_PRODUCT).bind(id).bind(owner_id).execute(&mut *connection).await?;
        Ok(deleted.rows_affected() > 0)
    }

    async fn ping(&self) -> Result<(), StoreError> {
        let mut connection = self.acquire_primary().await?;
        // One round trip against the primary, so a cold connection shows up as
        // a failed health check rather than a silent success. Deliberately not
        // the read pool: a lagging but reachable replica must not mask a dead
        // primary.
        sqlx::query("SELECT 1").execute(&mut *connection).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    #[test]
    fn product_ids_are_unique_and_prefixed() {
        let ids: std::collections::HashSet<String> =
            (0..64).map(|_| generate_product_id()).collect();
        assert_eq!(ids.len(), 64);
        assert!(ids.iter().all(|id| id.starts_with("prd_")));
    }

    #[test]
    fn an_empty_patch_changes_nothing() {
        assert!(ProductPatch::default().is_empty());
        assert!(!ProductPatch { stock: Some(0), ..ProductPatch::default() }.is_empty());
    }

    /// Backs off and succeeds — the case that was killing `pnpm dev`: Postgres
    /// slow for a couple of seconds while four compilers started.
    #[tokio::test]
    async fn a_bootstrap_connect_that_is_slow_at_first_still_succeeds() {
        let calls = AtomicU32::new(0);
        let result: Result<&str, sqlx::Error> =
            retry_with_backoff(5, Duration::from_millis(1), |attempt| {
                calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    if attempt < 3 {
                        Err(sqlx::Error::PoolTimedOut)
                    } else {
                        Ok("connected")
                    }
                }
            })
            .await;

        assert_eq!(result.ok(), Some("connected"));
        assert_eq!(calls.load(Ordering::SeqCst), 3, "stops retrying once it connects");
    }

    #[tokio::test]
    async fn a_healthy_bootstrap_connect_does_not_retry() {
        let calls = AtomicU32::new(0);
        let result: Result<(), sqlx::Error> =
            retry_with_backoff(10, Duration::from_millis(1), |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                async { Ok(()) }
            })
            .await;

        assert!(result.is_ok());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    /// Postgres genuinely unreachable must still surface the error rather than
    /// looping forever: it is the one hard dependency.
    #[tokio::test]
    async fn an_unreachable_bootstrap_connect_gives_up_with_the_last_error() {
        let calls = AtomicU32::new(0);
        let result: Result<(), sqlx::Error> =
            retry_with_backoff(3, Duration::from_millis(1), |_| {
                calls.fetch_add(1, Ordering::SeqCst);
                async { Err(sqlx::Error::PoolTimedOut) }
            })
            .await;

        assert!(matches!(result, Err(sqlx::Error::PoolTimedOut)));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    /// No sleep after the final attempt: the caller gets the error immediately
    /// rather than sitting through one more backoff it cannot use.
    #[tokio::test]
    async fn the_backoff_is_skipped_after_the_last_attempt() {
        let backoff = Duration::from_millis(200);
        let started = std::time::Instant::now();
        let result: Result<(), sqlx::Error> =
            retry_with_backoff(1, backoff, |_| async { Err(sqlx::Error::PoolTimedOut) }).await;
        assert!(result.is_err());
        assert!(started.elapsed() < backoff, "slept after the final attempt");

        let started = std::time::Instant::now();
        let result: Result<(), sqlx::Error> =
            retry_with_backoff(2, backoff, |_| async { Err(sqlx::Error::PoolTimedOut) }).await;
        assert!(result.is_err());
        assert!(started.elapsed() >= backoff, "should sleep between attempts, not after them");
    }

    /// The guarantee the retry exists for: an unreachable primary must still stop
    /// the boot, in bounded time, rather than looping forever or hanging.
    ///
    /// `start_paused` because a refused port does *not* fail fast in sqlx — an
    /// attempt burns its whole deadline before reporting — so in real time this
    /// test would sit through the entire budget. Tokio auto-advances instead,
    /// making it instant while still proving the loop terminates on its own.
    #[tokio::test(start_paused = true)]
    async fn an_unreachable_primary_still_stops_the_boot_within_its_budget() {
        let attempts = BOOTSTRAP_ATTEMPTS;
        let budget = attempts * BOOTSTRAP_CONNECT_TIMEOUT + (attempts - 1) * BOOTSTRAP_BACKOFF;
        assert!(budget <= Duration::from_secs(30), "budget grew past what a dev can sit through");

        let started = tokio::time::Instant::now();
        let result = connect_primary_pool(
            "postgresql://rnw:rnw@127.0.0.1:1/nope",
            4,
            Duration::from_millis(50),
        )
        .await;
        assert!(result.is_err(), "a refused primary must not yield a usable pool");
        // Virtual time jumps each sleep and each attempt deadline, so this lands
        // just past the budget rather than under it.
        assert!(
            started.elapsed() >= budget,
            "gave up after {:?}, before the {:?} budget was spent",
            started.elapsed(),
            budget
        );
    }

    /// A malformed URL is a configuration mistake, not a transient failure. Waiting
    /// cannot repair one, so it must fail immediately rather than burn the whole
    /// retry budget — and it must fail even though the real pool starts lazily.
    #[tokio::test(start_paused = true)]
    async fn a_malformed_database_url_fails_at_once_without_retrying() {
        let started = tokio::time::Instant::now();
        let result = connect_primary_pool("not-a-database-url", 4, Duration::from_millis(50)).await;
        assert!(result.is_err());
        assert!(started.elapsed() < BOOTSTRAP_BACKOFF, "retried a permanent error");
    }
}
