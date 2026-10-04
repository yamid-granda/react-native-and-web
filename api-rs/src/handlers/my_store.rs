//! `/my-store/products`: the seller's own CRUD surface.
//!
//! Two things are true of every route here and neither is negotiable. It always
//! requires a session, so a caller's identity comes from the token and never
//! from the body. And every response is `no-store`, because these bodies
//! describe one seller's catalogue rather than the public one.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;

use crate::app::AppState;
use crate::error::{json_response, no_content, AppError, NO_STORE};
use crate::handlers::products::{parse_page, ProductJson, ProductsPageJson};
use crate::handlers::JsonBody;
use crate::middleware::AuthUser;
use crate::store::{NewProduct, ProductPatch, MAX_TITLE_LENGTH, PAGE_SIZE};

#[derive(Deserialize)]
pub struct CreateProductRequest {
    title: String,
    #[serde(default)]
    description: Option<String>,
    price: f64,
    #[serde(rename = "imageUrl", default)]
    image_url: Option<String>,
    #[serde(default)]
    stock: Option<i32>,
}

/// A `PATCH` body. Every field is optional, including all of them at once: an
/// empty patch is a no-op that still returns the current product.
#[derive(Deserialize, Default)]
pub struct UpdateProductRequest {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    price: Option<f64>,
    #[serde(rename = "imageUrl", default)]
    image_url: Option<String>,
    #[serde(default)]
    stock: Option<i32>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    request: axum::extract::Request,
) -> Result<Response, AppError> {
    let query = parse_page(request.uri().query())?;

    // Never cached — not in L1, not in L2, not at the edge. It is per-user, so
    // there is no shared key that could be correct for more than one caller, and
    // it reads from the primary, so a seller sees their own writes at once.
    let products = state.store.list_page_for_owner(&auth.user.id, query.offset, PAGE_SIZE).await?;
    let total = state.store.count_for_owner(&auth.user.id).await?;
    let body = ProductsPageJson::from_page(products, &query, total);
    let bytes = serde_json::to_vec(&body)?;
    Ok(json_response(StatusCode::OK, bytes, &[NO_STORE], None))
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    JsonBody(request): JsonBody<CreateProductRequest>,
) -> Result<Response, AppError> {
    let new_product = NewProduct {
        title: validate_title(request.title)?,
        description: trim_to_none(request.description),
        price: validate_price(request.price)?,
        image_url: trim_to_none(request.image_url),
        stock: validate_stock(request.stock.unwrap_or(0))?,
    };

    let product = state.store.create(&auth.user.id, new_product).await?;
    // No `invalidate_detail`: a brand-new id has no cached entry to retire. The
    // generation bump is what matters, and it retires `products:list`,
    // `products:count` and `stores:{id}:products:list` in one step.
    state.cache.bump_list_generation().await;

    let bytes = serde_json::to_vec(&ProductJson::from(product))?;
    Ok(json_response(StatusCode::CREATED, bytes, &[NO_STORE], None))
}

pub async fn update(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    JsonBody(request): JsonBody<UpdateProductRequest>,
) -> Result<Response, AppError> {
    let patch = ProductPatch {
        title: request.title.map(validate_title).transpose()?,
        description: trim_to_none(request.description),
        price: request.price.map(validate_price).transpose()?,
        image_url: trim_to_none(request.image_url),
        stock: request.stock.map(validate_stock).transpose()?,
    };

    // `None` covers both "no such product" and "not yours", and both answer 404:
    // a 403 would confirm to a stranger that the id exists on a public catalog.
    let Some(product) = state.store.update_owned(&auth.user.id, &id, patch).await? else {
        return Err(AppError::ProductNotFound(id));
    };
    invalidate_after_write(&state, &id).await;

    let bytes = serde_json::to_vec(&ProductJson::from(product))?;
    Ok(json_response(StatusCode::OK, bytes, &[NO_STORE], None))
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    if !state.store.delete_owned(&auth.user.id, &id).await? {
        return Err(AppError::ProductNotFound(id));
    }
    invalidate_after_write(&state, &id).await;
    Ok(no_content())
}

/// The order from `ARCHITECTURE.md` §12, and it matters: retiring the detail
/// entry first means no reader can pair a fresh detail with a list page that was
/// filled before the write. Reversed, that window is real.
async fn invalidate_after_write(state: &AppState, id: &str) {
    state.cache.invalidate_detail(id).await;
    state.cache.bump_list_generation().await;
}

fn validate_title(title: String) -> Result<String, AppError> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Validation("title is required".to_string()));
    }
    if title.chars().count() > MAX_TITLE_LENGTH {
        return Err(AppError::Validation(format!(
            "title must be at most {MAX_TITLE_LENGTH} characters"
        )));
    }
    Ok(title)
}

/// Rejects what the database would otherwise accept: `NaN` and `Infinity` are
/// valid `DOUBLE PRECISION` values, and Postgres would store them happily —
/// leaving `formatPrice` to render `NaN` to a shopper.
fn validate_price(price: f64) -> Result<f64, AppError> {
    if !price.is_finite() {
        return Err(AppError::Validation("price must be a finite number".to_string()));
    }
    if price < 0.0 {
        return Err(AppError::Validation("price must not be negative".to_string()));
    }
    Ok(price)
}

fn validate_stock(stock: i32) -> Result<i32, AppError> {
    if stock < 0 {
        return Err(AppError::Validation("stock must not be negative".to_string()));
    }
    Ok(stock)
}

/// An empty or whitespace-only optional field is stored as `NULL`, so
/// `description: ""` and `description: null` produce the same row instead of a
/// product card with a blank line under the title.
fn trim_to_none(value: Option<String>) -> Option<String> {
    value.map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_is_trimmed_bounded_and_required() {
        assert_eq!(validate_title("  Desk Lamp  ".to_string()).unwrap(), "Desk Lamp");
        assert!(validate_title("   ".to_string()).is_err());
        assert!(validate_title("x".repeat(MAX_TITLE_LENGTH).to_string()).is_ok());
        assert!(validate_title("x".repeat(MAX_TITLE_LENGTH + 1).to_string()).is_err());
    }

    #[test]
    fn prices_must_be_finite_and_non_negative() {
        assert_eq!(validate_price(0.0).unwrap(), 0.0);
        assert_eq!(validate_price(18.5).unwrap(), 18.5);
        // Zero is free, not invalid — the difference matters for a giveaway.
        assert!(validate_price(-0.01).is_err());
        assert!(validate_price(f64::NAN).is_err());
        assert!(validate_price(f64::INFINITY).is_err());
        assert!(validate_price(f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn stock_must_not_be_negative() {
        assert_eq!(validate_stock(0).unwrap(), 0);
        assert_eq!(validate_stock(42).unwrap(), 42);
        assert!(validate_stock(-1).is_err());
    }

    #[test]
    fn blank_optional_fields_collapse_to_null() {
        assert_eq!(trim_to_none(Some("  ".to_string())), None);
        assert_eq!(trim_to_none(Some(" hello ".to_string())), Some("hello".to_string()));
        assert_eq!(trim_to_none(None), None);
    }
}

#[cfg(test)]
mod handler_tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{header, Method, StatusCode};
    use axum::Router;
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    use crate::app::{router, AppState};
    use crate::auth::password;
    use crate::auth::token::{hash_token, opaque_id};
    use crate::config::Config;
    use crate::store::{normalize_email, InMemoryStore, NewUser, SessionStore, UserStore};

    use super::*;

    const PASSWORD: &str = "correct horse battery";

    /// A router with one registered seller and the token that identifies them.
    async fn signed_in() -> (Router, String, String) {
        password::use_cheap_params_for_tests();
        let store = InMemoryStore::default();
        let user = store
            .create_user(NewUser {
                // Unique per call, so two "sellers" in one test really are two.
                id: format!("usr_{}", opaque_id("")),
                email: normalize_email("Seller@Example.com"),
                password_hash: password::hash_password(PASSWORD).expect("hash"),
                store_name: "Riverbend Vintage".to_string(),
            })
            .await
            .expect("create user");

        let token = "seller-token".to_string();
        store
            .create_session(
                &hash_token(&token),
                &user.id,
                chrono::Utc::now().naive_utc() + chrono::Duration::days(1),
            )
            .await
            .expect("create session");

        let state = AppState::new(Config::default(), Arc::new(store), None, None);
        (router(state), token, user.id)
    }

    fn call(
        method: Method,
        uri: &str,
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> axum::http::Request<Body> {
        let mut request = axum::http::Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(value) = body {
            request = request.header(header::CONTENT_TYPE, "application/json");
            return request.body(Body::from(value.to_string())).unwrap();
        }
        request.body(Body::empty()).unwrap()
    }

    async fn body(response: Response) -> serde_json::Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).expect("json body")
    }

    async fn create_product(app: &Router, token: &str) -> serde_json::Value {
        let response = app
            .clone()
            .oneshot(call(
                Method::POST,
                "/my-store/products",
                Some(token),
                Some(json!({
                    "title": "  Leather Weekender  ",
                    "description": "  Full-grain leather.  ",
                    "price": 189,
                    "imageUrl": "https://example.test/bag.png",
                    "stock": 6
                })),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        body(response).await
    }

    /// Every route on this namespace, without a token, is a 401 — including the
    /// ones that would answer 405 for a wrong method.
    #[tokio::test]
    async fn every_route_without_a_token_is_a_401() {
        let (app, _token, _user) = signed_in().await;
        let anonymous = [
            call(Method::GET, "/my-store/products", None, None),
            call(
                Method::POST,
                "/my-store/products",
                None,
                Some(json!({ "title": "x", "price": 1 })),
            ),
            call(Method::PATCH, "/my-store/products/prod-1", None, Some(json!({ "price": 1 }))),
            call(Method::DELETE, "/my-store/products/prod-1", None, None),
        ];
        for request in anonymous {
            let method = request.method().clone();
            let uri = request.uri().clone();
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
            assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        }
    }

    #[tokio::test]
    async fn a_created_product_names_the_sellers_store_and_pins_the_currency() {
        let (app, token, user_id) = signed_in().await;
        let created = create_product(&app, &token).await;
        assert!(created["id"].as_str().expect("id").starts_with("prd_"));
        assert_eq!(created["title"], "Leather Weekender");
        assert_eq!(created["description"], "Full-grain leather.");
        // There is no currency picker in either client, so the write path pins it.
        assert_eq!(created["currency"], "USD");
        assert_eq!(created["stock"], 6);
        assert_eq!(created["storeId"], user_id);
        assert_eq!(created["storeName"], "Riverbend Vintage");
        // `ownerId` is deliberately absent from the public payload.
        assert!(created.get("ownerId").is_none());
    }

    /// The point of owner-scoped reads going to the primary: the seller sees
    /// their own write on the very next request, with no replication lag in
    /// between.
    #[tokio::test]
    async fn a_created_product_is_in_my_store_immediately() {
        let (app, token, _user) = signed_in().await;
        let created = create_product(&app, &token).await;

        let response = app
            .clone()
            .oneshot(call(Method::GET, "/my-store/products", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        // Per-user, so there is no cache header at all — not even the edge's.
        assert!(!response.headers().contains_key("x-cache"));

        let page = body(response).await;
        assert_eq!(page["total"], 1);
        assert_eq!(page["hasNextPage"], false);
        assert_eq!(page["items"][0]["id"], created["id"]);
    }

    /// `?page=` behaves exactly as it does on the public list, including the
    /// float-truncation quirks — the handler reuses `parse_page` rather than
    /// inventing a second pagination dialect.
    #[tokio::test]
    async fn my_store_pagination_matches_the_public_contract() {
        let (app, token, _user) = signed_in().await;
        let response = app
            .clone()
            .oneshot(call(Method::GET, "/my-store/products?page=2.5", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body(response).await["page"], 2.5);

        let response = app
            .clone()
            .oneshot(call(Method::GET, "/my-store/products?page=-1", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn creating_validates_price_stock_and_title() {
        let (app, token, _user) = signed_in().await;
        let cases = [
            (json!({ "title": "x", "price": -1 }), "price"),
            (json!({ "title": "x", "price": f64::NAN }), "price"),
            (json!({ "title": "x", "price": f64::INFINITY }), "price"),
            (json!({ "title": "x", "price": 1, "stock": -1 }), "stock"),
            (json!({ "title": "   ", "price": 1 }), "title"),
            (json!({ "title": "x".repeat(201), "price": 1 }), "title"),
            (json!({ "title": "x", "price": "free" }), "price"),
            (json!({ "price": 1 }), "Failed to deserialize"),
        ];
        for (payload, expected) in cases {
            let label = payload.to_string();
            let response = app
                .clone()
                .oneshot(call(Method::POST, "/my-store/products", Some(&token), Some(payload)))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{expected}: {label}");
            let message = body(response).await["message"].as_str().unwrap_or_default().to_string();
            assert!(message.contains(expected), "{message:?} should mention {expected}");
        }
    }

    #[tokio::test]
    async fn a_free_product_and_a_zero_stock_are_both_valid() {
        let (app, token, _user) = signed_in().await;
        let response = app
            .clone()
            .oneshot(call(
                Method::POST,
                "/my-store/products",
                Some(&token),
                Some(json!({ "title": "Sticker", "price": 0, "stock": 0 })),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(body(response).await["price"], 0);
    }

    /// The central authorization decision: another seller's product is a 404,
    /// not a 403, because a 403 would confirm the id exists on a public catalog.
    #[tokio::test]
    async fn another_sellers_product_is_a_404_not_a_403() {
        let (app, token, _user) = signed_in().await;
        let created = create_product(&app, &token).await;
        let id = created["id"].as_str().expect("id").to_string();

        // A second seller, same app, different store.
        let (other_app, other_token, other_user) = signed_in().await;
        assert_ne!(other_user, _user);
        let _ = other_app;
        // The stranger cannot see it, cannot edit it, cannot delete it.
        for request in [
            call(
                Method::PATCH,
                &format!("/my-store/products/{id}"),
                Some(&other_token),
                Some(json!({ "price": 1 })),
            ),
            call(Method::DELETE, &format!("/my-store/products/{id}"), Some(&other_token), None),
        ] {
            let method = request.method().clone();
            let response = other_app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method}");
            assert_eq!(
                response.headers().get(header::CONTENT_TYPE).unwrap(),
                "application/json; charset=utf-8"
            );
        }
        // And it is still there for its owner.
        let response = app
            .clone()
            .oneshot(call(Method::GET, "/my-store/products", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(body(response).await["total"], 1);
    }

    #[tokio::test]
    async fn a_product_id_that_does_not_exist_is_also_a_404() {
        let (app, token, _user) = signed_in().await;
        for request in [
            call(
                Method::PATCH,
                "/my-store/products/prod-nope",
                Some(&token),
                Some(json!({ "price": 1 })),
            ),
            call(Method::DELETE, "/my-store/products/prod-nope", Some(&token), None),
        ] {
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }
    }

    #[tokio::test]
    async fn patching_touches_only_the_fields_it_carries() {
        let (app, token, _user) = signed_in().await;
        let created = create_product(&app, &token).await;
        let id = created["id"].as_str().expect("id").to_string();

        let response = app
            .clone()
            .oneshot(call(
                Method::PATCH,
                &format!("/my-store/products/{id}"),
                Some(&token),
                Some(json!({ "price": 149.5, "stock": 0 })),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let patched = body(response).await;
        assert_eq!(patched["price"], 149.5);
        assert_eq!(patched["stock"], 0);
        assert_eq!(patched["title"], "Leather Weekender", "absent fields are untouched");
        assert_eq!(patched["description"], "Full-grain leather.");
        assert_eq!(patched["storeName"], "Riverbend Vintage");

        // An empty patch is a no-op that still answers with the current product.
        let response = app
            .clone()
            .oneshot(call(
                Method::PATCH,
                &format!("/my-store/products/{id}"),
                Some(&token),
                Some(json!({})),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body(response).await["price"], 149.5);
    }

    #[tokio::test]
    async fn patching_validates_like_creating() {
        let (app, token, _user) = signed_in().await;
        let created = create_product(&app, &token).await;
        let id = created["id"].as_str().expect("id").to_string();

        for (payload, expected) in [
            (json!({ "price": -1 }), "price"),
            (json!({ "stock": -5 }), "stock"),
            (json!({ "title": "  " }), "title"),
            (json!({ "title": "x".repeat(201) }), "title"),
        ] {
            let response = app
                .clone()
                .oneshot(call(
                    Method::PATCH,
                    &format!("/my-store/products/{id}"),
                    Some(&token),
                    Some(payload),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{expected}");
            assert!(body(response).await["message"]
                .as_str()
                .unwrap_or_default()
                .contains(expected));
        }
        // The rejected patches did not partially apply.
        let response = app
            .clone()
            .oneshot(call(Method::GET, "/my-store/products", Some(&token), None))
            .await
            .unwrap();
        assert_eq!(body(response).await["items"][0]["price"], 189);
    }

    /// A second delete is a 404, not a 500: the row is gone, which is a normal
    /// state, and the caller gets the same answer whether it never existed or
    /// has already been removed.
    #[tokio::test]
    async fn deleting_twice_is_a_404_not_a_500() {
        let (app, token, _user) = signed_in().await;
        let created = create_product(&app, &token).await;
        let id = created["id"].as_str().expect("id").to_string();

        let response = app
            .clone()
            .oneshot(call(Method::DELETE, &format!("/my-store/products/{id}"), Some(&token), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(!response.headers().contains_key(header::CONTENT_TYPE));

        let response = app
            .clone()
            .oneshot(call(Method::DELETE, &format!("/my-store/products/{id}"), Some(&token), None))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let response =
            app.oneshot(call(Method::GET, "/my-store/products", Some(&token), None)).await.unwrap();
        assert_eq!(body(response).await["total"], 0);
    }

    /// The cache-invalidation contract: a write bumps the list generation, so a
    /// page filled before it is no longer addressable.
    #[tokio::test]
    async fn a_write_retires_the_cached_public_list() {
        let (app, token, _user) = signed_in().await;
        let warm = app.clone().oneshot(call(Method::GET, "/products", None, None)).await.unwrap();
        assert_eq!(warm.headers()["x-cache"], "miss");
        assert_eq!(warm.headers()["x-cache"], "miss", "the warm-up must have filled L1");

        create_product(&app, &token).await;

        // The very next list request addresses a new namespace, so it cannot be a
        // stale hit.
        let after = app.clone().oneshot(call(Method::GET, "/products", None, None)).await.unwrap();
        assert_eq!(after.headers()["x-cache"], "miss");
        assert_eq!(body(after).await["total"], 1);

        // And it stays warm from there.
        assert_eq!(
            app.oneshot(call(Method::GET, "/products", None, None)).await.unwrap().headers()
                ["x-cache"],
            "hit-l1"
        );
    }

    #[tokio::test]
    async fn a_write_retires_the_cached_product_detail() {
        let (app, token, _user) = signed_in().await;
        let created = create_product(&app, &token).await;
        let id = created["id"].as_str().expect("id").to_string();
        let uri = format!("/products/{id}");

        let warm = app.clone().oneshot(call(Method::GET, &uri, None, None)).await.unwrap();
        assert_eq!(warm.headers()["x-cache"], "miss", "the 201 does not populate the detail tier");
        assert_eq!(
            app.clone().oneshot(call(Method::GET, &uri, None, None)).await.unwrap().headers()
                ["x-cache"],
            "hit-l1"
        );

        app.clone()
            .oneshot(call(
                Method::PATCH,
                &format!("/my-store/products/{id}"),
                Some(&token),
                Some(json!({ "title": "Renamed" })),
            ))
            .await
            .unwrap();

        let response = app.oneshot(call(Method::GET, &uri, None, None)).await.unwrap();
        assert_eq!(response.headers()["x-cache"], "miss");
        assert_eq!(body(response).await["title"], "Renamed");
    }
}
