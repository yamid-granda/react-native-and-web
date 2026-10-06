use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::Response;
use chrono::NaiveDateTime;
use serde::Serialize;
use tokio::sync::OwnedMutexGuard;

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
/// recently-viewed rail, and it bounds the request at one statement over at most
/// 50 indexed primary-key lookups however long the query string gets.
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
    //
    // Two passes, because the two concerns have different shapes. Every cache
    // decision is per-id and stays that way, so the first pass walks the ids in
    // caller order and resolves whatever is already cached. What is left over
    // leaves in a single batched statement — one query, one pool acquisition for
    // the whole set, which is the guarantee `useProductLookup.ts` documents and
    // the one `find_by_id`-per-id could not keep.
    let mut resolved: Vec<Option<String>> = vec![None; ids.len()];
    let mut missing: Vec<String> = Vec::new();
    let mut wanted: Vec<usize> = Vec::new();
    // Held across the batched read and the writes below, not released per id.
    let mut _fill: Vec<OwnedMutexGuard<()>> = Vec::new();
    // The ids that missed, each with the key it missed on.
    let mut misses: Vec<(String, usize)> = Vec::new();

    // First pass: the cache read, in caller order. Whatever is already cached is
    // resolved here and never reaches the store.
    for (index, id) in ids.iter().enumerate() {
        let key = cache::detail_key(id);

        if let Some((bytes, _source)) = state.cache.get(Kind::Detail, &key).await {
            resolved[index] = Some(String::from_utf8_lossy(&bytes).into_owned());
        } else {
            misses.push((key, index));
        }
    }

    // Second pass: the same two-phase check `detail` does, in one global order
    // rather than the caller's. The first screen of a cold cart is exactly the
    // burst the flight exists to collapse, so a second request for the same id
    // waits here and then finds the entry this one wrote, instead of racing a
    // store call it does not need.
    //
    // Taking the fills in key order is load-bearing, not cosmetic. Holding a *set*
    // of them is only safe if every request takes them in the same order: in the
    // caller's order a request holds the locks it has already taken while it
    // waits for the next one, so two requests over the same ids in opposite
    // orders — `ids=b,a` and `ids=a,b` — each wait for the lock the other is
    // holding and neither ever reaches the statement. Sorting by key gives every
    // request the same sequence, and no cycle can form in it — so this ordering is
    // the safety argument, not a detail to be tidied back into caller order.
    //
    // Ids are de-duplicated by `parse_lookup_ids`, so the keys are distinct and a
    // request never queues on itself.
    misses.sort_unstable();
    for (key, index) in misses {
        let flight = state.cache.flights().for_key(Kind::Detail, &key).await;
        let guard = flight.owned_lock().await;
        if let Some((bytes, _source)) = state.cache.get(Kind::Detail, &key).await {
            resolved[index] = Some(String::from_utf8_lossy(&bytes).into_owned());
            continue;
        }

        _fill.push(guard);
        wanted.push(index);
    }

    // The fills were taken in key order; the response is in the caller's. `wanted`
    // holds first-seen positions, and `parse_lookup_ids` de-duplicates, so they are
    // distinct — sorting restores caller order for both the batch and `missing`,
    // which the wire contract depends on.
    wanted.sort_unstable();

    // One statement for the whole set. `find_by_ids` promises no order, so the
    // result is keyed by id and each id is placed by the index it already has —
    // first-seen order is the response order, and the caller zips `items` back
    // onto its own list.
    let fetched = if wanted.is_empty() {
        HashMap::new()
    } else {
        let batch: Vec<String> = wanted.iter().map(|index| ids[*index].clone()).collect();
        state
            .store
            .find_by_ids(&batch)
            .await?
            .into_iter()
            .map(|product| (product.id.clone(), product))
            .collect()
    };

    for index in wanted {
        let id = &ids[index];
        let key = cache::detail_key(id);
        match fetched.get(id) {
            Some(product) => {
                let bytes = serde_json::to_vec(&ProductJson::from(product.clone()))?;
                // Written under the detail key so the next lookup *and* the
                // detail route share one entry rather than filling it twice.
                state.cache.set(Kind::Detail, &key, Bytes::copy_from_slice(&bytes)).await;
                resolved[index] = Some(String::from_utf8_lossy(&bytes).into_owned());
            }
            // Not an error: a deleted product is the answer this route exists to
            // give. It also deliberately leaves no cache entry, so a seller who
            // re-publishes the same id is visible on the next lookup.
            None => missing.push(id.clone()),
        }
    }

    let bodies: Vec<String> = resolved.into_iter().flatten().collect();

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
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::Duration;

    use chrono::NaiveDateTime;
    use tower::ServiceExt;

    use crate::app::router;
    use crate::config::Config;
    use crate::store::testdouble::{
        base_config, body_of, counting_state, get, get_all, CountingStore,
    };
    use crate::store::{InMemoryStore, Product, StoreOp};

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

    /// The spy plus a handle on the store behind it, so a test can make a
    /// surface fail. Cloning an `InMemoryStore` shares its state, so the switch
    /// the test sets is the one the spy reads through.
    ///
    /// The spy is [`CountingStore`], which lives in `store::testdouble` and is
    /// shared with `handlers::stores`: one type, holding the counters and the
    /// delay that make concurrent requests collide on a single fill instead of
    /// racing past it.
    fn counting_store(products: usize) -> (CountingStore, InMemoryStore) {
        let inner = InMemoryStore::new(
            (0..products).map(|index| product(&format!("prod-{index}"), 10.0)).collect(),
        );
        (CountingStore::new(inner.clone()), inner)
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
    ///
    /// Counted in batches, not singular lookups. The claim here is that the cache
    /// collapsed the repeat — two requests, one fill — and one fill is one batch
    /// call, so this is `2` and was never going to be anything else.
    #[tokio::test]
    async fn a_repeated_batch_is_served_from_the_detail_cache() {
        let (store, _inner) = counting_store(200);
        let batch_calls = Arc::clone(&store.batch_calls);
        let find_calls = Arc::clone(&store.find_calls);
        let app = router(counting_state(store));

        for _ in 0..2 {
            let response =
                app.clone().oneshot(get("/products/by-ids?ids=prod-7,prod-8")).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(body_of(response).await["items"].as_array().unwrap().len(), 2);
        }

        assert_eq!(batch_calls.load(Ordering::SeqCst), 1, "two requests, one batch, not two");
        assert_eq!(find_calls.load(Ordering::SeqCst), 0, "the batch never fans out to find_by_id");
    }

    /// The one the suite had no way to say: a cold batch of *n* ids is **one**
    /// store call, not *n*.
    ///
    /// This is the assertion that makes the doc comment in
    /// `useProductLookup.ts` checkable rather than aspirational. It fails at `n`
    /// against the per-id loop it replaces, so it cannot pass by accident if the
    /// batching is undone later.
    #[tokio::test]
    async fn a_cold_batch_of_n_ids_is_one_store_call() {
        const IDS: usize = 12;
        let (store, _inner) = counting_store(200);
        let batch_calls = Arc::clone(&store.batch_calls);
        let find_calls = Arc::clone(&store.find_calls);
        let app = router(counting_state(store));

        let query: Vec<String> = (0..IDS).map(|index| format!("prod-{index}")).collect();
        let response =
            app.oneshot(get(&format!("/products/by-ids?ids={}", query.join(",")))).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = body_of(response).await;
        assert_eq!(body["items"].as_array().unwrap().len(), IDS, "every id resolved");
        assert_eq!(body["missing"], serde_json::json!([]));

        assert_eq!(batch_calls.load(Ordering::SeqCst), 1, "{IDS} ids, one batched query");
        assert_eq!(find_calls.load(Ordering::SeqCst), 0, "and no singular reads behind it");
    }

    /// A *partly* warm batch still asks once — for only the ids that missed.
    ///
    /// The one-query claim is about a request, not about a store method, so a
    /// batch that has cached some of its ids must not fall back to a query per
    /// remaining id. This is the shape a real second screen of a cart has: some
    /// entries fresh, the rest cold.
    #[tokio::test]
    async fn a_warm_batch_queries_only_the_ids_it_is_missing() {
        let (store, _inner) = counting_store(200);
        let batch_calls = Arc::clone(&store.batch_calls);
        let app = router(counting_state(store));

        let cold =
            app.clone().oneshot(get("/products/by-ids?ids=prod-1,prod-2,prod-3")).await.unwrap();
        assert_eq!(cold.status(), StatusCode::OK);
        assert_eq!(batch_calls.load(Ordering::SeqCst), 1, "three cold ids, one query");

        let mixed =
            app.oneshot(get("/products/by-ids?ids=prod-1,prod-2,prod-9,prod-10")).await.unwrap();
        assert_eq!(mixed.status(), StatusCode::OK);
        let body = body_of(mixed).await;
        assert_eq!(
            body["items"].as_array().unwrap().len(),
            4,
            "the cached pair plus the two new ids"
        );

        assert_eq!(batch_calls.load(Ordering::SeqCst), 2, "one more query, for the two new ids");
    }

    /// First-seen order is the response order, and `= ANY($1)` does not preserve
    /// it. The reversed case is the one that matters: an id order that happens to
    /// match insertion order would pass against a shuffled result.
    #[tokio::test]
    async fn a_batch_answers_in_the_order_the_caller_asked() {
        let app = router(lookup_state());

        let response =
            app.clone().oneshot(get("/products/by-ids?ids=prod-2,deleted-1,prod-1")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = body_of(response).await;
        let items = body["items"].as_array().unwrap();
        assert_eq!(items[0]["id"], "prod-2", "the caller's order, not the store's");
        assert_eq!(items[1]["id"], "prod-1");
        assert_eq!(body["missing"], serde_json::json!(["deleted-1"]));
    }

    /// Concurrent batches over one id set, in rotated orders, all complete.
    ///
    /// A batch holds a fill guard per missed id across one statement, so a request
    /// holds several of the singleflight locks at once — which is only safe because
    /// it takes them in one global (key) order. Taken in the caller's order instead,
    /// two batches wanting the same keys in different relative orders each wait for
    /// the lock the other is holding, and neither reaches the store. That is a real
    /// production hazard and this is *not* the test that catches it: the handler's
    /// only await between two acquisitions is `cache.get`, and these runs carry no
    /// L2, so nothing yields there and the cycle cannot form in-process. The
    /// ordering comment at the acquisition site is the actual defence.
    ///
    /// What this does pin is the surrounding contract: six simultaneous batches over
    /// one key set all finish, all answer 200, and none is starved by the guards its
    /// neighbours are holding. Time is paused so a regression that *does* stall
    /// advances the clock into the timeout and fails here instead of hanging the run.
    #[tokio::test(start_paused = true)]
    async fn concurrent_batches_over_one_id_set_all_complete() {
        let (store, _inner) = counting_store(200);
        let app = router(counting_state(store));

        // One id set, six rotations of it: any two that are not rotations of one
        // another want the same keys in different relative orders.
        let ids: Vec<String> = (1..=6).map(|index| format!("prod-{index}")).collect();
        let mut uris: Vec<String> = Vec::new();
        for shift in 0..ids.len() {
            let mut rotated = ids.clone();
            rotated.rotate_left(shift);
            uris.push(format!("/products/by-ids?ids={}", rotated.join(",")));
        }

        let statuses = tokio::time::timeout(Duration::from_millis(500), get_all(app, &uris))
            .await
            .expect("batches over one id set in rotated orders must not starve each other's fills");

        assert!(statuses.iter().all(|status| *status == StatusCode::OK), "{statuses:?}");
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
