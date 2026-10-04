pub mod auth;
pub mod health;
pub mod my_store;
pub mod products;
pub mod stores;

use axum::body::Body;
use axum::extract::{FromRequest, Json};
use axum::http::Request;
use serde::de::DeserializeOwned;

use crate::error::AppError;

/// `Json<T>` whose rejections come back as [`AppError::Validation`].
///
/// axum's own `JsonRejection` answers `422 Unprocessable Entity` with a
/// `text/plain` body, which would be the only non-JSON error shape on the API.
/// This keeps a malformed or missing field on the same contract as every other
/// client error: `400` and `{"message": …, "error": "Bad Request", …}`.
pub struct JsonBody<T>(pub T);

impl<T, S> FromRequest<S> for JsonBody<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request<Body>, state: &S) -> Result<Self, Self::Rejection> {
        Json::<T>::from_request(req, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|rejection| AppError::Validation(rejection.body_text()))
    }
}
