use axum::body::Bytes;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use chrono::NaiveDateTime;
use serde::Serialize;

use crate::app::AppState;
use crate::cache::{HitSource, Kind};
use crate::error::{json_response, AppError};
use crate::serde_js::{js_number, js_number_or_nan, prisma_datetime};
use crate::store::{Product, PAGE_SIZE};

/// Field order and value encoding mirror what the Prisma client hands to
/// `res.json` in the NestJS API: schema field order, `JSON.stringify` number
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
        }
    }
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

pub struct PageQuery {
    pub page: f64,
    /// The float `skip` exactly as the NestJS controller computes it.
    /// `hasNextPage` is derived from this value, so it stays unwrapped.
    pub skip: f64,
    /// What Prisma actually sends as `OFFSET` — see [`prisma_offset`].
    pub offset: i64,
}

/// Mirrors `Number(page) || 1` in `products.controller.ts` and the narrowing
/// Prisma applies to `skip` before it reaches Postgres. Measured against the
/// running NestJS service rather than assumed, because the interesting cases
/// are not the ones the Prisma types suggest:
///
/// | `?page=` | `skip` | NestJS result |
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
        // Express hands repeated params to Number() as an array; arrays with
        // more than one element coerce to NaN, which `|| 1` turns into 1.
        _ => f64::NAN,
    };
    // `|| 1`: NaN and (negative) zero are falsy.
    let page = if parsed.is_nan() || parsed == 0.0 { 1.0 } else { parsed };

    let skip = (page - 1.0) * (PAGE_SIZE as f64);
    let offset = prisma_offset(skip)?;

    Ok(PageQuery { page, skip, offset })
}

/// Prisma keeps 15 significant digits, truncates toward zero, rejects a
/// negative result or one that will not fit an i64 (both surface as Nest's
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
    let key = format!("products:list:{}", query.page.to_bits());
    let conditional = Some((&parts.method, &parts.headers));

    if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
        return Ok(json_response(
            StatusCode::OK,
            bytes.to_vec(),
            &product_headers(&state, Some(source)),
            conditional,
        ));
    }

    let (products, total) = state.store.list_page(query.offset, PAGE_SIZE).await?;
    let item_count = products.len() as f64;
    let body = ProductsPageJson {
        items: products.into_iter().map(ProductJson::from).collect(),
        page: query.page,
        limit: PAGE_SIZE,
        total,
        // `skip + items.length < total` in float arithmetic, on the unwrapped
        // skip, exactly as `ProductsService.findAll` evaluates it.
        has_next_page: (query.skip + item_count) < total as f64,
    };
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
    let key = format!("products:detail:{id}");
    let conditional = Some((&parts.method, &parts.headers));

    if let Some((bytes, source)) = state.cache.get(Kind::Detail, &key).await {
        return Ok(json_response(
            StatusCode::OK,
            bytes.to_vec(),
            &product_headers(&state, Some(source)),
            conditional,
        ));
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

/// `Cache-Control` for the Cloudflare edge tier plus an operational `X-Cache`
/// marker. Additive headers only — bodies stay byte-identical to Nest's.
fn product_headers(state: &AppState, source: Option<HitSource>) -> Vec<(HeaderName, HeaderValue)> {
    let cache_control = HeaderValue::from_str(&state.config.edge_cache_control)
        .unwrap_or_else(|_| HeaderValue::from_static("public"));
    let x_cache = HeaderValue::from_static(source.map_or("miss", HitSource::header_value));
    vec![(header::CACHE_CONTROL, cache_control), (HeaderName::from_static("x-cache"), x_cache)]
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDateTime;

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
        }
    }

    #[test]
    fn page_param_matches_nest_coercion() {
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
        // Express: repeated params become an array → Number([...]) is NaN → 1.
        assert_eq!(parse_page(Some("page=4&page=5")).unwrap().page, 1.0);
    }

    #[test]
    fn prisma_skip_validation_matches_nest() {
        let ok = |q: &str| parse_page(Some(&format!("page={q}"))).unwrap();
        // Negative skips Prisma refuses, which Nest answers with a 500.
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
            r#"{"id":"prod-1","title":"Test","description":null,"price":18,"currency":"USD","imageUrl":null,"stock":0,"createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }

    #[test]
    fn page_envelope_matches_service_shape() {
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
}
