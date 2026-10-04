use async_trait::async_trait;
use chrono::NaiveDateTime;
use sqlx::FromRow;

use super::memory::InMemoryStore;
use super::products::{SqlProductStore, StoreError};

/// A live session, as stored. `token_hash` is the SHA-256 of the token the
/// client holds — see [`crate::auth::token`].
#[derive(Clone, Debug, PartialEq)]
pub struct Session {
    pub user_id: String,
    pub expires_at: NaiveDateTime,
}

#[derive(FromRow)]
struct SessionRow {
    #[sqlx(rename = "userId")]
    user_id: String,
    #[sqlx(rename = "expiresAt")]
    expires_at: NaiveDateTime,
}

const INSERT_SESSION: &str =
    r#"INSERT INTO "Session" ("tokenHash", "userId", "expiresAt") VALUES ($1, $2, $3)"#;

#[async_trait]
pub trait SessionStore: Send + Sync + 'static {
    /// `find_valid` folds the expiry check into the lookup rather than
    /// filtering afterwards: an expired row is not a session, and treating it as
    /// one would make every reaper sweep mandatory for correctness.
    async fn find_valid_session(&self, token_hash: &str) -> Result<Option<Session>, StoreError>;
    async fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: NaiveDateTime,
    ) -> Result<(), StoreError>;
    /// `Ok(false)` when there was no such row — logging out twice is not an
    /// error, and the client cannot tell the difference anyway.
    async fn delete_session(&self, token_hash: &str) -> Result<bool, StoreError>;
}

#[async_trait]
impl SessionStore for SqlProductStore {
    async fn find_valid_session(&self, token_hash: &str) -> Result<Option<Session>, StoreError> {
        let mut connection = self.acquire_primary().await?;
        // Literal rather than `format!`: sqlx only accepts constant SQL without
        // an explicit injection audit.
        let row: Option<SessionRow> = sqlx::query_as(
            r#"SELECT "userId", "expiresAt" FROM "Session" WHERE "tokenHash" = $1 AND "expiresAt" > $2"#,
        )
        .bind(token_hash)
        .bind(chrono::Utc::now().naive_utc())
        .fetch_optional(&mut *connection)
        .await?;
        Ok(row.map(|row| Session { user_id: row.user_id, expires_at: row.expires_at }))
    }

    async fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: NaiveDateTime,
    ) -> Result<(), StoreError> {
        let mut connection = self.acquire_primary().await?;
        sqlx::query(INSERT_SESSION)
            .bind(token_hash)
            .bind(user_id)
            .bind(expires_at)
            .execute(&mut *connection)
            .await?;
        Ok(())
    }

    async fn delete_session(&self, token_hash: &str) -> Result<bool, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let result = sqlx::query(r#"DELETE FROM "Session" WHERE "tokenHash" = $1"#)
            .bind(token_hash)
            .execute(&mut *connection)
            .await?;
        Ok(result.rows_affected() > 0)
    }
}

#[async_trait]
impl SessionStore for InMemoryStore {
    async fn find_valid_session(&self, token_hash: &str) -> Result<Option<Session>, StoreError> {
        self.gate(super::memory::StoreOp::Sessions).await?;
        let sessions = self.sessions().lock().expect("in-memory sessions");
        Ok(sessions
            .get(token_hash)
            .filter(|session| session.expires_at > chrono::Utc::now().naive_utc())
            .cloned())
    }

    async fn create_session(
        &self,
        token_hash: &str,
        user_id: &str,
        expires_at: NaiveDateTime,
    ) -> Result<(), StoreError> {
        self.gate(super::memory::StoreOp::Sessions).await?;
        self.sessions()
            .lock()
            .expect("in-memory sessions")
            .insert(token_hash.to_string(), Session { user_id: user_id.to_string(), expires_at });
        Ok(())
    }

    async fn delete_session(&self, token_hash: &str) -> Result<bool, StoreError> {
        self.gate(super::memory::StoreOp::Sessions).await?;
        Ok(self.sessions().lock().expect("in-memory sessions").remove(token_hash).is_some())
    }
}
