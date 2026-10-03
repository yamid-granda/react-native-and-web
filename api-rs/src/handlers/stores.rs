//! `/stores/*`: the public face of a seller.
//!
//! Deliberately unauthenticated. A storefront is a catalogue page, and the
//! marketplace itself is public — requiring a token here would make a seller's
//! products unreachable for the shoppers they exist for.
//!
//! The products page is the same read path as `GET /products`, with a different
//! key and the same list generation folded in, so a create or an edit retires it
//! in the same `INCR` that retires the marketplace.

use axum::extract::{Path, Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use serde::Serialize;

use crate::app::AppState;
use crate::cache::{HitSource, Kind};
use crate::error::{json_response, AppError, NO_STORE};
use crate::handlers::products::{parse_page, ProductJson, ProductsPageJson};
use crate::serde_js::prisma_datetime;
use crate::store::PAGE_SIZE;

#[derive(Serialize)]
pub struct StoreJson {
    id: String,
    #[serde(rename = "storeName")]
    store_name: String,
    #[serde(rename = "createdAt", serialize_with = "prisma_datetime")]
    created_at: chrono::NaiveDateTime,
}

pub async fn detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let user = state
        .store
        .find_user_by_id(&id)
        .await?
        .ok_or_else(|| AppError::StoreNotFound(id.clone()))?;
    let bytes = serde_json::to_vec(&StoreJson {
        id: user.id,
        store_name: user.store_name,
        created_at: user.created_at,
    })?;
    // `no-store`, not the product cache headers: a store is one row by primary
    // key, so there is nothing to gain from an edge cache and a rename later
    // would have to invalidate a key it cannot enumerate.
    Ok(json_response(StatusCode::OK, bytes, &[NO_STORE], None))
}

pub async fn products(
    State(state): State<AppState>,
    Path(id): Path<String>,
    request: Request,
) -> Result<Response, AppError> {
    let (parts, _body) = request.into_parts();
    let query = parse_page(parts.uri.query())?;
    let conditional = Some((&parts.method, &parts.headers));

    // A 404 is not cached: an id that has no store today may have one tomorrow,
    // and the page is the only way a shopper finds out.
    if state.store.find_user_by_id(&id).await?.is_none() {
        return Err(AppError::StoreNotFound(id));
    }

    let key =
        format!("stores:{id}:products:list:{}:{}", state.cache.generation(), query.page.to_bits());

    if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
        return Ok(json_response(
            StatusCode::OK,
            bytes.to_vec(),
            &store_headers(&state, Some(source)),
            conditional,
        ));
    }

    let flight = state.cache.flights().for_key(Kind::List, &key).await;
    let _fill = flight.lock().await;
    if let Some((bytes, source)) = state.cache.get(Kind::List, &key).await {
        return Ok(json_response(
            StatusCode::OK,
            bytes.to_vec(),
            &store_headers(&state, Some(source)),
            conditional,
        ));
    }

    // Reads from the replica, like `GET /products`: this is a public page, so
    // read-your-writes is not a promise it makes. The seller's own `GET
    // /my-store/products` is the one that does.
    let items = state.store.list_owned_page(&id, query.offset, PAGE_SIZE).await?;
    let total = state.store.count_owned(&id).await?;
    let item_count = items.len() as f64;
    let body = ProductsPageJson {
        items: items.into_iter().map(ProductJson::from).collect(),
        page: query.page,
        limit: PAGE_SIZE,
        total,
        has_next_page: (query.skip + item_count) < total as f64,
    };
    let bytes = serde_json::to_vec(&body)?;
    state.cache.set(Kind::List, &key, axum::body::Bytes::copy_from_slice(&bytes)).await;

    Ok(json_response(StatusCode::OK, bytes, &store_headers(&state, None), conditional))
}

/// The same additive headers `GET /products` sends, minus `no-store`.
fn store_headers(state: &AppState, source: Option<HitSource>) -> Vec<(HeaderName, HeaderValue)> {
    let cache_control = HeaderValue::from_str(&state.config.edge_cache_control)
        .unwrap_or_else(|_| HeaderValue::from_static("public"));
    let x_cache = HeaderValue::from_static(source.map_or("miss", HitSource::header_value));
    vec![
        (axum::http::header::CACHE_CONTROL, cache_control),
        (HeaderName::from_static("x-cache"), x_cache),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_store_shape_is_id_name_created_at() {
        let json = serde_json::to_string(&StoreJson {
            id: "usr_1".to_string(),
            store_name: "Corner Shop".to_string(),
            created_at: chrono::NaiveDateTime::parse_from_str(
                "2026-01-01 00:00:00.000",
                "%Y-%m-%d %H:%M:%S%.3f",
            )
            .unwrap(),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"id":"usr_1","storeName":"Corner Shop","createdAt":"2026-01-01T00:00:00.000Z"}"#
        );
    }
}
