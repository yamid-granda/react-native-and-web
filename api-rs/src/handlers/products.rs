use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::Response;
use chrono::NaiveDateTime;
use serde::Serialize;

use crate::app::AppState;
use crate::cache::{self, HitSource, Kind};
use crate::error::{json_response, AppError};
use crate::serde_js::{js_number, js_number_or_nan, prisma_datetime};
use crate::store::{Product, PAGE_SIZE};

/// Field order and value encoding match the marketplace contract the web and
/// mobile clients parse: schema field order, `JSON.stringify` number
/// formatting, and `toISOString()` datetimes.
#[derive(Serialize)]
pub struct ProductJson {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(serialize_with = "js_number")]
    pub price: f64,
    pub currency: String,
    #[serde(rename = "imageUrl")]
    pub image_url: Option<String>,
    pub stock: i32,
    #[serde(rename = "createdAt", serialize_with = "prisma_datetime")]
    pub created_at: NaiveDateTime,
    /// Always present, `null` for a seeded or imported product. Not optional:
    /// `skip_serializing_if` is an error-body convention (see [`ErrorBody`]), and
    /// a key that appears and disappears between responses is a client bug
    /// waiting to happen.
    #[serde(rename = "storeId")]
    pub store_id: Option<String>,
    #[serde(rename = "storeName")]
    pub store_name: Option<String>,
}

impl From<Product> for ProductJson {
    fn from(product: Product) -> Self {
        Self {
            id: product.id,
            title: product.title,
            description: product.description,
            price: product.price,
            currency: product.currency,
            image_url: product.image_url,
            stock: product.stock,
            created_at: product.created_at,
            store_id: product.owner_id,
            store_name: product.store_name,
        }
    }
}

/// `GET /products/by-ids`: the products a client remembered, resolved live, plus
/// the ids it no longer has.
///
/// `missing` is a result rather than an error, and that is the point of the
/// route. Every id a shopper remembers comes from a client-side store — a cart,
/// a wishlist, a recently-viewed rail — and a product the seller has since
/// deleted has to be *reportable* for that store to ever drop it. A 404 could
/// only ever answer one id at a time, which is why there is no
/// `GET /products?ids=` to lean on instead.
#[derive(Serialize)]
pub struct ProductsByIdsJson {
    pub items: Vec<ProductJson>,
    pub missing: Vec<String>,
}

#[derive(Serialize)]
pub struct ProductsPageJson {
    pub items: Vec<ProductJson>,
    #[serde(serialize_with = "js_number")]
    pub page: f64,
    pub limit: i64,
    pub total: i64,
    #[serde(rename = "hasNextPage")]
    pub has_next_page: bool,
}

impl ProductsPageJson {
    /// The one place a list page's envelope is built, for every route that
    /// returns one.
    ///
    /// Taking `Vec<Product>` rather than a slice is what keeps the conversion
    /// from growing a second spelling: there is no `iter()` here to reach for
    /// when the caller still owns the page.
    pub fn from_page(items: Vec<Product>, query: &PageQuery, total: i64) -> Self {
        let item_count = items.len() as f64;
        Self {
            items: items.into_iter().map(ProductJson::from).collect(),
            page: query.page,
            limit: PAGE_SIZE,
            total,
            // `skip + items.length < total` in float arithmetic, on the unwrapped
            // skip, exactly as `ProductsService.findAll` evaluates it.
            has_next_page: (query.skip + item_count) < total as f64,
        }
    }
}

pub struct PageQuery {
    pub page: f64,
    /// The float `skip` exactly as the page calculation produces it.
    /// `hasNextPage` is derived from this value, so it stays unwrapped.
    pub skip: f64,
    /// What Prisma actually sends as `OFFSET` — see [`prisma_offset`].
    pub offset: i64,
}

/// `Number(page) || 1` plus the narrowing Prisma applies to `skip` before it
/// reaches Postgres. Verified against a running service rather than assumed,
/// because the interesting cases are not the ones the Prisma types suggest:
///
/// | `?page=` | `skip` | Result |
/// |---|---|---|
/// | `2.5` | `30` | `OFFSET 30`, 200 |
/// | `2.3` | `25.999999999999996` | `OFFSET 26`, 200 — *not* a validation error |
/// | `0.975` | `-0.5000000000000004` | truncates to `-0`, `OFFSET 0`, 200 |
/// | `0.95` | `-1.0000000000000009` | "Value can only be positive", 500 |
/// | `2147483648` | `42949672940` | wraps into a u32: `OFFSET 4294967276`, 200 |
/// | `Infinity`, `1e21` | `Infinity`, `2e22` | does not fit an i64, 500 |
pub fn parse_page(raw_query: Option<&str>) -> Result<PageQuery, AppError> {
    let values: Vec<String> = form_urlencoded::parse(raw_query.unwrap_or("").as_bytes())
        .filter(|(key, _)| key == "page")
        .map(|(_, value)| value.into_owned())
        .collect();

    let parsed = match values.len() {
        0 => 1.0,
        1 => js_number_or_nan(&values[0]),
        // Repeated `page` params are handed to `Number()` as an array; arrays
        // with more than one element coerce to NaN, which `|| 1` turns into 1.
        _ => f64::NAN,
    };
    // `|| 1`: NaN and (negative) zero are falsy.
    let page = if parsed.is_nan() || parsed == 0.0 { 1.0 } else { parsed };

    let skip = (page - 1.0) * (PAGE_SIZE as f64);
    let offset = prisma_offset(skip)?;

    Ok(PageQuery { page, skip, offset })
}

/// Prisma keeps 15 significant digits, truncates toward zero, rejects a
/// negative result or one that will not fit an i64 (both surface as the
/// generic 500), then narrows what is left into a u32 — which is where huge
/// page numbers wrap instead of failing.
fn prisma_offset(skip: f64) -> Result<i64, AppError> {
    if !skip.is_finite() {
        return Err(AppError::InvalidPagination);
    }
    // Exact integers (every realistic request) skip the decimal rounding.
    let skip = if skip.fract() == 0.0 { skip } else { round_to_significant_digits(skip, 15) };
    let truncated = skip.trunc();
    // `-0.0 < 0.0` is false, matching Prisma accepting a skip of `-0.5`.
    if truncated < 0.0 || truncated > i64::MAX as f64 {
        return Err(AppError::InvalidPagination);
    }
    Ok((truncated as i64) as u32 as i64)
}

fn round_to_significant_digits(value: f64, digits: i32) -> f64 {
    if value == 0.0 {
        return 0.0;
    }
    let magnitude = value.abs().log10().floor() as i32;
    let factor = 10f64.powi(digits.saturating_sub(1) - magnitude);
    (value * factor).round() / factor
}

pub async fn list(State(state): State<AppState>, request: Request) -> Result<Response, AppError> {
    let (parts, _body) = request.into_parts();
    let query = parse_page(parts.uri.query())?;
    let key = cache::list_key(state.cache.generation(), query.page);
    let conditional = Some((&parts.method, &parts.headers));

    if let Some(response) = cached(&state, Kind::List, &key, conditional).await {
        return Ok(response);
    }

    // Stampede protection. The ordering is the whole design: check, then take
    // the flight, then check *again*, because the leader we waited behind may
    // have just populated the cache.
    let flight = state.cache.flights().for_key(Kind::List, &key).await;
    let _fill = flight.lock().await;
    if let Some(response) = cached(&state, Kind::List, &key, conditional).await {
        return Ok(response);
    }

    let products = state.store.list_page(query.offset, PAGE_SIZE).await?;
    let total = catalog_total(&state).await?;
    let body = ProductsPageJson::from_page(products, &query, total);
    let bytes = serde_json::to_vec(&body)?;
    state.cache.set(Kind::List, &key, Bytes::copy_from_slice(&bytes)).await;

    Ok(json_response(StatusCode::OK, bytes, &product_headers(&state, None), conditional))
}

pub async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Request,
) -> Result<Response, AppError> {
    let (parts, _body) = request.into_parts();
    let key = cache::detail_key(&id);
    let conditional = Some((&parts.method, &parts.headers));

    if let Some(response) = cached(&state, Kind::Detail, &key, conditional).await {
        return Ok(response);
    }

    // Same two-phase check as `list`: a viral product link fans out exactly the
    // way a hot page does.
    let flight = state.cache.flights().for_key(Kind::Detail, &key).await;
    let _fill = flight.lock().await;
    if let Some(response) = cached(&state, Kind::Detail, &key, conditional).await {
        return Ok(response);
    }

    match state.store.find_by_id(&id).await? {
        Some(product) => {
            let bytes = serde_json::to_vec(&ProductJson::from(product))?;
            state.cache.set(Kind::Detail, &key, Bytes::copy_from_slice(&bytes)).await;
            Ok(json_response(StatusCode::OK, bytes, &product_headers(&state, None), conditional))
        }
        None => Err(AppError::ProductNotFound(id)),
    }
}

/// How many ids one `/products/by-ids` request will resolve.
///
/// A cap, not a validation error: the callers are client stores whose size this
/// service does not control, and answering the first N is more useful than
/// refusing the whole cart. 50 is roughly five screens' worth of a cart plus a
/// recently-viewed rail, and it bounds the request at 50 indexed primary-key
/// lookups however long the query string gets.
const MAX_LOOKUP_IDS: usize = 50;

/// The requested ids, de-duplicated, first-seen order, capped.
///
/// Repeated `ids` params and commas inside one param are both accepted, because
/// a caller building the string in JS reaches for `ids.join(",")` and one
/// building it by hand reaches for `?ids=a&ids=b`, and neither should get a
/// different answer. Blank segments (`?ids=a,,b`, a trailing comma) are dropped
/// rather than looked up, so a trailing comma cannot read as a deleted product.
fn parse_lookup_ids(raw_query: Option<&str>) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for (_key, value) in form_urlencoded::parse(raw_query.unwrap_or("").as_bytes()) {
        if _key != "ids" {
            continue;
        }
        for segment in value.split(',') {
            let id = segment.trim();
            if id.is_empty() || ids.iter().any(|seen| seen == id) {
                continue;
            }
            ids.push(id.to_string());
            if ids.len() == MAX_LOOKUP_IDS {
                return ids;
            }
        }
    }
    ids
}

pub async fn by_ids(State(state): State<AppState>, request: Request) -> Result<Response, AppError> {
    let (parts, _body) = request.into_parts();
    let ids = parse_lookup_ids(parts.uri.query());
    let conditional = Some((&parts.method, &parts.headers));

    // The response body is assembled from each id's *existing* detail bytes
    // rather than re-serialized, so a row served here is byte-identical to what
    // `GET /products/{id}` serves for the same id — one cache entry, one
    // serialization, and no second shape to drift when `ProductJson` changes.
    let mut bodies: Vec<String> = Vec::with_capacity(ids.len());
    let mut missing: Vec<String> = Vec::new();

    for id in &ids {
        let key = cache::detail_key(id);

        if let Some((bytes, _source)) = state.cache.get(Kind::Detail, &key).await {
            bodies.push(String::from_utf8_lossy(&bytes).into_owned());
            continue;
        }

        // Same two-phase check as `detail`: the first screen of a cold cart is
        // exactly the burst the flight exists to collapse.
        let flight = state.cache.flights().for_key(Kind::Detail, &key).await;
        let _fill = flight.lock().await;
        if let Some((bytes, _source)) = state.cache.get(Kind::Detail, &key).await {
            bodies.push(String::from_utf8_lossy(&bytes).into_owned());
            continue;
        }

        match state.store.find_by_id(id).await? {
            Some(product) => {
                let bytes = serde_json::to_vec(&ProductJson::from(product))?;
                // Written under the detail key so the next lookup *and* the
                // detail route share one entry rather than filling it twice.
                state.cache.set(Kind::Detail, &key, Bytes::copy_from_slice(&bytes)).await;
                bodies.push(String::from_utf8_lossy(&bytes).into_owned());
            }
            // Not an error: a deleted product is the answer this route exists to
            // give. It also deliberately leaves no cache entry, so a seller who
            // re-publishes the same id is visible on the next lookup.
            None => missing.push(id.clone()),
        }
    }

    // Built by hand rather than through `ProductsByIdsJson`, because `items` is
    // already-serialized JSON. Ids go through `serde_json::to_string` so a
    // crafted query cannot break out of the string it is quoted into.
    let mut body = format!("{{\"items\":[{}],\"missing\":[", bodies.join(","));
    for (index, id) in missing.iter().enumerate() {
        if index > 0 {
            body.push(',');
        }
        body.push_str(&serde_json::to_string(id)?);
    }
    body.push_str("]}");

    Ok(json_response(StatusCode::OK, body.into_bytes(), &lookup_headers(&state), conditional))
}

/// Headers for `/products/by-ids`.
///
/// `product_headers` hands out the catalogue directive —
/// `public, max-age=0, s-maxage=30, stale-while-revalidate=60` — which is the
/// right trade for a list of products nobody is about to be charged for. It is
/// the wrong trade for this route, and not by a small margin: `max-age=0` marks
/// the response stale the instant it is stored, and `stale-while-revalidate=60`
/// then permits a browser or shared cache to **serve those stale bytes anyway**
/// for the next minute while it revalidates in the background.
///
/// That is precisely the bug this route exists to remove. A cart that had already
/// resolved an id keeps totalling the price from before the seller's edit, and no
/// client-side policy can catch it: `useProductLookup`'s `staleTime: 0` governs
/// when the client *asks*, not what it is handed when it does. Only the response
/// directive closes that gap.
///
/// `no-store` gives up nothing that was doing any work. The expensive part is
/// still done once and still deduplicated — in the L1/L2 detail cache and the
/// singleflight this handler reads through and fills, both of which a seller
/// write already retires — so this is one conditional round trip instead of a
/// stored copy, not N round trips instead of one.
fn lookup_headers(state: &AppState) -> Vec<(HeaderName, HeaderValue)> {
    let mut headers = product_headers(state, None);
    // Replaces the catalogue directive rather than adding to it: the two
    // directives are contradictory, and `no-store` is the one that has to win.
    headers.retain(|(name, _)| name != header::CACHE_CONTROL);
    headers.push((header::CACHE_CONTROL, HeaderValue::from_static("no-store")));
    headers
}

/// A cached response, or `None` on a miss. The `X-Cache` header reports where
/// it came from, so a follower served here honestly reads as a hit.
///
/// Shared rather than reimplemented: `GET /stores/{id}/products` runs the same
/// two-phase check through this helper, which is also what gives it the tested
/// stampede ordering instead of an uncommented copy of it.
pub(crate) async fn cached(
    state: &AppState,
    kind: Kind,
    key: &str,
    conditional: Option<(&Method, &HeaderMap)>,
) -> Option<Response> {
    let (bytes, source) = state.cache.get(kind, key).await?;
    Some(json_response(
        StatusCode::OK,
        bytes.to_vec(),
        &product_headers(state, Some(source)),
        conditional,
    ))
}

/// Cache key for the catalog-wide `total`. Its own entry rather than a field of
/// the page entry, because the count is identical for every page and every
/// request — caching it per page would still re-run `COUNT(*)` once per page
/// per TTL window. It carries the generation too: `total` is the field a new
/// product changes most visibly, so a retired entry here is the one a shopper
/// would actually notice.
const COUNT_KEY_PREFIX: &str = "products:count";

fn count_key(state: &AppState) -> String {
    format!("{COUNT_KEY_PREFIX}:{}", state.cache.generation())
}

/// `total` for the envelope, evaluated at most once per cache TTL window.
///
/// Fail-open in the same shape as every other cache read: an unreachable tier
/// or an unreadable entry falls through to the store rather than failing the
/// page. A genuine store error still surfaces as the same 500 it always did.
/// The flight stops a cold burst across *different* pages from turning into one
/// `COUNT(*)` per page.
async fn catalog_total(state: &AppState) -> Result<i64, AppError> {
    let key = count_key(state);
    let flight = state.cache.flights().for_key(Kind::List, &key).await;
    let _fill = flight.lock().await;

    if let Some((bytes, _source)) = state.cache.get(Kind::List, &key).await {
        // Only ever written by the `to_string` below, but a hand-edited or
        // truncated entry must not become a 500.
        if let Ok(total) = std::str::from_utf8(&bytes).unwrap_or_default().trim().parse::<i64>() {
            return Ok(total);
        }
        tracing::warn!("discarding unreadable cached product count");
    }

    let total = state.store.count().await?;
    state.cache.set(Kind::List, &key, Bytes::from(total.to_string())).await;
    Ok(total)
}

/// `Cache-Control` for the Cloudflare edge tier plus an operational `X-Cache`
/// marker. Additive headers only — bodies stay byte-identical.
///
/// Shared with `GET /stores/{id}/products`, which sent a byte-identical copy
/// under a name claiming a `no-store` difference it did not have.
pub(crate) fn product_headers(
    state: &AppState,
    source: Option<HitSource>,
) -> Vec<(HeaderName, HeaderValue)> {
    let cache_control = HeaderValue::from_str(&state.config.edge_cache_control)
        .unwrap_or_else(|_| HeaderValue::from_static("public"));
    let x_cache = HeaderValue::from_static(source.map_or("miss", HitSource::header_value));
    vec![(header::CACHE_CONTROL, cache_control), (HeaderName::from_static("x-cache"), x_cache)]
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use axum::body::Body;
    use axum::Router;
    use chrono::NaiveDateTime;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::app::router;
    use crate::config::Config;
    use crate::store::{
        DelegatingStore, InMemoryStore, Product, ProductStore, StoreError, StoreOp,
    };

    use super::*;

    fn product(id: &str, price: f64) -> Product {
        Product {
            id: id.to_string(),
            title: "Test".to_string(),
            description: None,
            price,
            currency: "USD".to_string(),
            image_url: None,
            stock: 0,
            created_at: NaiveDateTime::parse_from_str(
                "2026-01-01 00:00:00.000",
                "%Y-%m-%d %H:%M:%S%.3f",
            )
            .unwrap(),
            owner_id: None,
            store_name: None,
        }
    }

    #[test]
    fn page_param_follows_js_coercion() {
        // `parse_page` takes a raw query string, so the value has to be
        // wrapped in `page=` — otherwise it is parsed as an unrelated key and
        // every case below would silently degrade to the "no page" default.
        let ok = |q: &str| parse_page(Some(&format!("page={q}"))).unwrap();
        assert_eq!(parse_page(None).unwrap().page, 1.0);
        assert_eq!(parse_page(Some("")).unwrap().page, 1.0);
        assert_eq!(ok("").page, 1.0);
        assert_eq!(ok("2").page, 2.0);
        assert_eq!(ok("2").offset, 20);
        assert_eq!(ok("abc").page, 1.0);
        assert_eq!(ok("0").page, 1.0);
        assert_eq!(ok("-0").page, 1.0);
        assert_eq!(ok(" 3 ").offset, 40);
        assert_eq!(ok("1e2").page, 100.0);
        assert_eq!(ok("2.0").page, 2.0);
        // Repeated params become an array → Number([...]) is NaN → 1.
        assert_eq!(parse_page(Some("page=4&page=5")).unwrap().page, 1.0);
    }

    #[test]
    fn prisma_skip_validation_rejects_out_of_range_offsets() {
        let ok = |q: &str| parse_page(Some(&format!("page={q}"))).unwrap();
        // Negative skips Prisma refuses, which we answer with a 500.
        assert!(matches!(parse_page(Some("page=-1")), Err(AppError::InvalidPagination)));
        assert!(matches!(parse_page(Some("page=0.5")), Err(AppError::InvalidPagination)));
        assert!(matches!(parse_page(Some("page=0.95")), Err(AppError::InvalidPagination)));
        assert!(matches!(parse_page(Some("page=Infinity")), Err(AppError::InvalidPagination)));
        assert!(matches!(parse_page(Some("page=1e21")), Err(AppError::InvalidPagination)));
        // Fractional skips are truncated, not rejected.
        assert_eq!(ok("2.5").offset, 30);
        assert_eq!(ok("2.3").offset, 26);
        assert_eq!(ok("1.5").offset, 10);
        assert_eq!(ok("2.7").offset, 34);
        // `-0.5` truncates to negative zero, which Prisma still accepts.
        assert_eq!(ok("0.975").offset, 0);
        // Huge pages wrap into Prisma's u32 rather than failing.
        assert_eq!(ok("2147483648").offset, 4_294_967_276);
        assert_eq!(ok("107374184").offset, 2_147_483_660);
        // `skip` stays the raw float so `hasNextPage` matches the service.
        assert_eq!(ok("2.3").skip, 25.999999999999996);
        assert_eq!(ok("0.975").skip, -0.5000000000000004);
    }

    #[test]
    fn product_json_matches_prisma_shape() {
        let json = serde_json::to_string(&ProductJson::from(product("prod-1", 18.0))).unwrap();
        assert_eq!(
            json,
            r#"{"id":"prod-1","title":"Test","description":null,"price":18,"currency":"USD","imageUrl":null,"stock":0,"createdAt":"2026-01-01T00:00:00.000Z","storeId":null,"storeName":null}"#
        );
    }

    #[test]
    fn a_product_with_a_seller_names_the_store_in_the_payload() {
        let mut owned = product("prod-9", 4.0);
        owned.owner_id = Some("usr_7".to_string());
        owned.store_name = Some("Corner Shop".to_string());
        assert_eq!(
            serde_json::to_string(&ProductJson::from(owned)).unwrap(),
            r#"{"id":"prod-9","title":"Test","description":null,"price":4,"currency":"USD","imageUrl":null,"stock":0,"createdAt":"2026-01-01T00:00:00.000Z","storeId":"usr_7","storeName":"Corner Shop"}"#
        );
    }

    #[test]
    fn the_page_envelope_keeps_its_shape_with_the_new_trailing_keys() {
        let page = ProductsPageJson {
            items: vec![ProductJson::from(product("prod-1", 89.5))],
            page: 1.0,
            limit: PAGE_SIZE,
            total: 1,
            has_next_page: false,
        };
        let json = serde_json::to_string(&page).unwrap();
        assert!(json.starts_with(
            r#"{"items":[{"id":"prod-1","title":"Test","description":null,"price":89.5,"#
        ));
        assert!(json.ends_with(r#""page":1,"limit":20,"total":1,"hasNextPage":false}"#));
    }

    /// The generation is what a write bumps, so a page cached under one must
    /// become unreachable under the next.
    #[tokio::test]
    async fn a_bump_changes_the_list_key() {
        let (store, _inner) = counting_store(1);
        let state = counting_state(store);
        let before = cache::list_key(state.cache.generation(), 1.0);
        state.cache.bump_list_generation().await;
        let after = cache::list_key(state.cache.generation(), 1.0);
        assert_ne!(before, after);
        assert!(before.starts_with("products:list:0:"), "{before}");
        assert!(after.starts_with("products:list:1:"), "{after}");
        assert_ne!(count_key(&state), format!("{COUNT_KEY_PREFIX}:0"));
    }

    /// The write path and the detail handler must address one key. If they
    /// drifted, `invalidate_after_write` would keep bumping the generation and
    /// keep answering 200 while `GET /products/{id}` served a pre-write body
    /// until the detail TTL ran out — and no assertion here would fail.
    #[tokio::test]
    async fn invalidating_a_detail_retires_the_entry_the_handler_wrote() {
        let (store, _inner) = counting_store(200);
        let find_calls = Arc::clone(&store.find_calls);
        let state = counting_state(store);
        let app = router(state.clone());

        for _ in 0..2 {
            let response = app.clone().oneshot(get("/products/prod-7")).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
        assert_eq!(find_calls.load(Ordering::SeqCst), 1, "the second read is a cache hit");

        state.cache.invalidate_detail("prod-7").await;

        let response = app.oneshot(get("/products/prod-7")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(find_calls.load(Ordering::SeqCst), 2, "the retired key has to be refilled");
    }

    /// Wraps [`InMemoryStore`] to count the queries that actually reach the
    /// database, and to make each one slow enough that concurrent requests
    /// genuinely collide on a single fill instead of racing past it.
    ///
    /// Only the three read methods are instrumented; everything else is
    /// [`DelegatingStore`]'s forwarding, so a new trait method costs no edits
    /// here. The failure switches moved to the store itself, which is what
    /// `/health` needs and what keeps the mechanism in one place.
    #[derive(Clone)]
    struct CountingStore {
        inner: DelegatingStore,
        list_calls: Arc<AtomicUsize>,
        count_calls: Arc<AtomicUsize>,
        find_calls: Arc<AtomicUsize>,
        delay: Duration,
    }

    impl CountingStore {
        fn new(inner: InMemoryStore) -> Self {
            Self {
                inner: DelegatingStore::new(Arc::new(inner)),
                list_calls: Arc::new(AtomicUsize::new(0)),
                count_calls: Arc::new(AtomicUsize::new(0)),
                find_calls: Arc::new(AtomicUsize::new(0)),
                delay: Duration::from_millis(30),
            }
        }
    }

    /// The spy plus a handle on the store behind it, so a test can make a
    /// surface fail. Cloning an `InMemoryStore` shares its state, so the switch
    /// the test sets is the one the spy reads through.
    fn counting_store(products: usize) -> (CountingStore, InMemoryStore) {
        let inner = InMemoryStore::new(
            (0..products).map(|index| product(&format!("prod-{index}"), 10.0)).collect(),
        );
        (CountingStore::new(inner.clone()), inner)
    }

    #[async_trait::async_trait]
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

        async fn ping(&self) -> Result<(), StoreError> {
            self.inner.ping().await
        }

        // The owner-scoped and write paths are pass-throughs too: the tests in
        // this module are about the read path's cache behaviour, and
        // `handlers/my_store.rs` is where a mutation is asserted. Rust has no
        // partial trait impl, so these stay and the compiler keeps naming the
        // site.
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
            self.inner.list_public_page_by_owner(owner_id, offset, limit).await
        }

        async fn count_for_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
            self.inner.count_for_owner(owner_id).await
        }

        async fn count_public_by_owner(&self, owner_id: &str) -> Result<i64, StoreError> {
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
            new_product: crate::store::NewProduct,
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
    }

    // `AppState` holds one `Arc<dyn MarketplaceStore>` rather than three handles,
    // so `CountingStore` still has to be a `UserStore` and a `SessionStore` —
    // but it forwards them instead of writing them, which is the 39 lines that
    // used to live here.
    #[async_trait::async_trait]
    impl crate::store::UserStore for CountingStore {
        async fn find_user_by_email(
            &self,
            email: &str,
        ) -> Result<Option<crate::store::UserRecord>, StoreError> {
            self.inner.find_user_by_email(email).await
        }

        async fn find_user_by_id(
            &self,
            id: &str,
        ) -> Result<Option<crate::store::StoreUser>, StoreError> {
            self.inner.find_user_by_id(id).await
        }

        async fn create_user(
            &self,
            new_user: crate::store::NewUser,
        ) -> Result<crate::store::StoreUser, StoreError> {
            self.inner.create_user(new_user).await
        }
    }

    #[async_trait::async_trait]
    impl crate::store::SessionStore for CountingStore {
        async fn find_valid_session(
            &self,
            token_hash: &str,
        ) -> Result<Option<crate::store::Session>, StoreError> {
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

        async fn list_sessions(
            &self,
            user_id: &str,
        ) -> Result<Vec<crate::store::Session>, StoreError> {
            self.inner.list_sessions(user_id).await
        }
    }

    /// The concurrency limiter is a confounder in these tests: they assert how
    /// many queries reach the database, not that load was shed.
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

    fn get(uri: &str) -> axum::http::Request<Body> {
        axum::http::Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    /// Drives `uris` as genuinely concurrent requests. Cloning the `Router`
    /// clones the `AppState`, which is the point: the singleflight map has to
    /// be shared across those clones to deduplicate anything.
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

    async fn body_of(response: Response) -> serde_json::Value {
        let bytes: Bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    /// The stampede this replaces: 64 concurrent requests on a cold key issued
    /// 64 identical page queries plus 64 identical `COUNT(*)`.
    #[tokio::test]
    async fn concurrent_cold_page_requests_fill_once() {
        let (store, _inner) = counting_store(200);
        let list_calls = Arc::clone(&store.list_calls);
        let count_calls = Arc::clone(&store.count_calls);
        let app = router(counting_state(store));

        let statuses = get_all(app, &vec!["/products".to_string(); 64]).await;

        assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
        assert_eq!(list_calls.load(Ordering::SeqCst), 1, "one page query, not 64");
        assert_eq!(count_calls.load(Ordering::SeqCst), 1, "one COUNT(*), not 64");
    }

    #[tokio::test]
    async fn concurrent_cold_detail_requests_fill_once() {
        let (store, _inner) = counting_store(200);
        let find_calls = Arc::clone(&store.find_calls);
        let app = router(counting_state(store));

        let statuses = get_all(app, &vec!["/products/prod-7".to_string(); 64]).await;

        assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
        assert_eq!(find_calls.load(Ordering::SeqCst), 1);
    }

    /// The other half of the contract: collapsing must not serialise unrelated
    /// keys into one queue.
    #[tokio::test]
    async fn distinct_pages_are_not_serialised() {
        let (store, _inner) = counting_store(200 * PAGE_SIZE as usize);
        let list_calls = Arc::clone(&store.list_calls);
        let app = router(counting_state(store));

        let uris: Vec<String> = (1..=64).map(|page| format!("/products?page={page}")).collect();
        let statuses = get_all(app, &uris).await;

        assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
        assert_eq!(list_calls.load(Ordering::SeqCst), 64, "each page is its own key");
    }

    /// A leader whose store call fails must leave nothing behind: no cached
    /// failure, no stuck key, no need for a dead-letter path.
    #[tokio::test]
    async fn a_failed_fill_is_retried_rather_than_replayed() {
        let (store, inner) = counting_store(5);
        // One-shot, so the retry below reaches the store and succeeds.
        inner.fail_once(StoreOp::Products);
        let list_calls = Arc::clone(&store.list_calls);
        let app = router(counting_state(store));

        let failed = get_all(app.clone(), &["/products".to_string()]).await;
        assert_eq!(failed, vec![StatusCode::INTERNAL_SERVER_ERROR]);

        let recovered = get_all(app, &["/products".to_string()]).await;
        assert_eq!(recovered, vec![StatusCode::OK]);
        assert_eq!(list_calls.load(Ordering::SeqCst), 2, "the failure must not be cached");
    }

    /// A client disconnect or the request timeout drops the future mid-fill.
    /// The guard goes with it, so the key must not stay locked.
    #[tokio::test]
    async fn a_cancelled_request_does_not_wedge_the_key() {
        let (store, _inner) = counting_store(200);
        let app = router(counting_state(store));

        let in_flight = tokio::spawn({
            let app = app.clone();
            async move { app.oneshot(get("/products")).await.unwrap().status() }
        });
        // Well inside the store's 30 ms, i.e. holding the fill lock.
        tokio::time::sleep(Duration::from_millis(5)).await;
        in_flight.abort();
        let _ = in_flight.await;

        let statuses = get_all(app, &["/products".to_string()]).await;
        assert_eq!(statuses, vec![StatusCode::OK], "the key must still be fillable");
    }

    /// `total` is per-catalog, so it is cached across pages rather than
    /// recomputed per request.
    #[tokio::test]
    async fn the_catalog_total_is_counted_once_per_ttl_window() {
        let (store, _inner) = counting_store(200);
        let count_calls = Arc::clone(&store.count_calls);
        let app = router(counting_state(store));

        for page in [1, 2, 1, 2] {
            let uris = vec![format!("/products?page={page}"); 8];
            let statuses = get_all(app.clone(), &uris).await;
            assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
        }

        assert_eq!(count_calls.load(Ordering::SeqCst), 1, "COUNT(*) is per catalog, not per page");
    }

    #[tokio::test]
    async fn an_expired_total_is_recomputed_not_served_stale() {
        let (store, _inner) = counting_store(200);
        let count_calls = Arc::clone(&store.count_calls);
        // A zero list TTL means the count entry can never be read back, which
        // is the "expired between check and use" case.
        let state = AppState::new(
            Config { l1_list_ttl: Duration::ZERO, ..base_config() },
            Arc::new(store),
            None,
            None,
        );
        let app = router(state);

        for _ in 0..2 {
            let response = app.clone().oneshot(get("/products")).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(body_of(response).await["total"], 200);
            // moka expiry is lazy; the existing zero-TTL test waits for it too.
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(count_calls.load(Ordering::SeqCst), 2, "an expired total is recomputed");
    }

    /// Fail-open: a cache entry that cannot be read costs a recompute, never a
    /// failed page.
    #[tokio::test]
    async fn an_unreadable_cached_total_degrades_to_the_store() {
        let (store, _inner) = counting_store(200);
        let count_calls = Arc::clone(&store.count_calls);
        let state = counting_state(store);
        state.cache.set(Kind::List, &count_key(&state), Bytes::from_static(b"not-a-number")).await;

        let response = router(state).oneshot(get("/products")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_of(response).await["total"], 200);
        assert_eq!(count_calls.load(Ordering::SeqCst), 1);
    }

    /// Fail-*closed* only where it always was: a genuine store failure still
    /// surfaces as the contract 500 rather than a page with a wrong `total`.
    #[tokio::test]
    async fn a_store_count_failure_still_fails_the_page() {
        let (store, inner) = counting_store(200);
        // Sticky: nothing retries this one, and a page with a wrong `total`
        // would be worse than a failure.
        inner.fail_always(StoreOp::Count);
        let app = router(counting_state(store));

        let response = app.oneshot(get("/products")).await.unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    // --- GET /products/by-ids ---

    /// Three products, so a batch can mix a hit with a miss. `counting_state`
    /// rather than a bare `InMemoryStore` so the store path is the one exercised.
    fn lookup_state() -> AppState {
        counting_state(counting_store(3).0)
    }

    fn ids_of(raw_query: &str) -> Vec<String> {
        parse_lookup_ids(Some(raw_query))
    }

    /// Every way a caller can spell the query reaches the same id list, and a
    /// blank segment is never read as a deleted product.
    #[test]
    fn the_ids_param_accepts_commas_repeats_and_trailing_blanks() {
        assert_eq!(ids_of("ids=prod-1,prod-2"), ["prod-1", "prod-2"]);
        assert_eq!(ids_of("ids=prod-1&ids=prod-2"), ["prod-1", "prod-2"]);
        assert_eq!(ids_of("ids=prod-1,prod-1,prod-2"), ["prod-1", "prod-2"]);
        assert_eq!(ids_of("ids=prod-1,,prod-2,"), ["prod-1", "prod-2"]);
        assert_eq!(ids_of("ids=%20prod-1%20"), ["prod-1"]);
        assert!(ids_of("ids=").is_empty());
        assert!(ids_of("").is_empty());
        assert!(parse_lookup_ids(None).is_empty());
        assert!(ids_of("page=2").is_empty());
        // First-seen order is the response order, so the caller can zip `items`
        // back onto its own list.
        assert_eq!(ids_of("ids=prod-2,prod-1"), ["prod-2", "prod-1"]);
    }

    #[test]
    fn the_id_list_is_capped_rather_than_refused() {
        let query = format!(
            "ids={}",
            (0..MAX_LOOKUP_IDS + 20).map(|i| format!("prod-{i},")).collect::<String>()
        );
        let ids = parse_lookup_ids(Some(&query));
        assert_eq!(ids.len(), MAX_LOOKUP_IDS);
        assert_eq!(ids[0], "prod-0");
    }

    #[tokio::test]
    async fn a_batch_resolves_products_and_names_the_ones_that_are_gone() {
        let app = router(lookup_state());

        let response =
            app.clone().oneshot(get("/products/by-ids?ids=prod-1,deleted-1,prod-2")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = body_of(response).await;
        let items = body["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["id"], "prod-1");
        assert_eq!(items[1]["id"], "prod-2");
        assert_eq!(body["missing"], serde_json::json!(["deleted-1"]));

        // Byte-identical to what the detail route serves for the same id: the
        // batch body is assembled from those bytes, not a second encoding.
        let detail = body_of(app.oneshot(get("/products/prod-1")).await.unwrap()).await;
        assert_eq!(items[0], detail);
    }

    #[tokio::test]
    async fn a_batch_of_nothing_is_an_empty_result_not_a_404() {
        let app = router(lookup_state());
        for uri in ["/products/by-ids", "/products/by-ids?ids="] {
            let response = app.clone().oneshot(get(uri)).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
            assert_eq!(body_of(response).await, serde_json::json!({"items": [], "missing": []}));
        }
    }

    /// The route's whole reason for existing: an id the server no longer has has
    /// to be *nameable*, because that is what lets a persisted store drop it. A
    /// 404 could only ever answer one id at a time.
    #[tokio::test]
    async fn an_all_missing_batch_is_still_a_200() {
        let response = router(lookup_state())
            .oneshot(get("/products/by-ids?ids=gone-a,gone-b"))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            body_of(response).await,
            serde_json::json!({"items": [], "missing": ["gone-a", "gone-b"]})
        );
    }

    /// The directive is the fix, so it is pinned here.
    ///
    /// The catalogue's `max-age=0, s-maxage=30, stale-while-revalidate=60` lets a
    /// browser or shared cache serve a *stale* body for up to a minute while it
    /// revalidates, which would hand a cart the price from before the seller's
    /// edit — the exact failure this route removes, and one no client-side
    /// `staleTime` can catch. `no-store` says what the route actually is.
    #[tokio::test]
    async fn a_batch_is_never_left_for_a_cache_to_replay() {
        let response =
            router(lookup_state()).oneshot(get("/products/by-ids?ids=prod-1")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        // The internal cache report is untouched: `no-store` is about what leaves
        // this process, not about the deduplicated work behind it.
        assert_eq!(response.headers()["x-cache"], "miss");
    }

    /// A repeated batch must not re-query: the ids it resolves are the same
    /// detail entries the detail route fills, so the second read is a cache hit
    /// and the mixed batch fills each of them once.
    #[tokio::test]
    async fn a_repeated_batch_is_served_from_the_detail_cache() {
        let (store, _inner) = counting_store(200);
        let find_calls = Arc::clone(&store.find_calls);
        let app = router(counting_state(store));

        for _ in 0..2 {
            let response =
                app.clone().oneshot(get("/products/by-ids?ids=prod-7,prod-8")).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(body_of(response).await["items"].as_array().unwrap().len(), 2);
        }

        assert_eq!(find_calls.load(Ordering::SeqCst), 2, "two ids, two lookups, not four");
    }

    /// The ids are echoed into the body, so a crafted query has to survive being
    /// quoted into a JSON string. `"` and `\` percent-encoded, because a comma
    /// would legitimately split into two ids.
    #[tokio::test]
    async fn an_id_cannot_break_out_of_the_missing_string() {
        let id = "\"\\";
        let response =
            router(lookup_state()).oneshot(get("/products/by-ids?ids=%22%5C")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_of(response).await["missing"], serde_json::json!([id]));
    }
}
