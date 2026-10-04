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

/// One seller's dead rows, and nothing else. Scoped to `"userId"` rather than a
/// global `expiresAt` sweep so the statement is bounded by one seller and only
/// runs on a login — the trait method says why the global shape is not this one.
///
/// Literal rather than `format!`, like [`INSERT_SESSION`]: sqlx only accepts
/// constant SQL without an explicit injection audit.
const DELETE_EXPIRED_FOR_USER: &str =
    r#"DELETE FROM "Session" WHERE "userId" = $1 AND "expiresAt" <= $2"#;

/// Newest first. `expiresAt` is creation order under a constant
/// `SESSION_TTL_SECS`, which is what lets it stand in for the `createdAt` this
/// projection does not select.
const LIST_SESSIONS: &str = r#"SELECT "userId", "expiresAt" FROM "Session" WHERE "userId" = $1 AND "expiresAt" > $2 ORDER BY "expiresAt" DESC"#;

#[async_trait]
pub trait SessionStore: Send + Sync + 'static {
    /// `find_valid` folds the expiry check into the lookup rather than
    /// filtering afterwards: an expired row is not a session, and treating it as
    /// one would make a sweep mandatory for correctness. It is not — correctness
    /// never needed one. [`SessionStore::delete_expired_for_user`] is about the
    /// table's cost, not its answers.
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

    /// Delete every row for `user_id` whose `expiresAt` is in the past, and
    /// return how many went.
    ///
    /// Separate from [`SessionStore::delete_session`] on purpose: that one
    /// revokes a credential the caller is already holding a token for, this one
    /// is the housekeeping that keeps the table from only growing. Every login
    /// and every registration adds a row, and before this method existed nothing
    /// ever removed one except a logout or an account deletion.
    ///
    /// **An `Err` here is not a reason to fail the caller's request.** The row
    /// about to be minted is unaffected, and a row already past its expiry cannot
    /// authenticate whether or not this ran, so a cleanup that fails only leaves
    /// dead weight behind. Callers warn and count — the same shape as the rate
    /// limiter's `record_redis_error`, and §7's fail-open posture applies to
    /// housekeeping exactly as it does to the limiter.
    async fn delete_expired_for_user(&self, user_id: &str) -> Result<u64, StoreError>;

    /// Every live row for `user_id`, newest first.
    ///
    /// The read half of "sign out everywhere" and of an active-devices list.
    /// Neither is expressible without it, because no other method here can
    /// enumerate a seller's sessions — so the multi-device behaviour that
    /// `login_issues_a_new_token_each_time` pins as intended has never been
    /// inspectable from the store layer.
    ///
    /// Never a token: `Session` carries the hash and nothing else, which is the
    /// right shape and stays.
    async fn list_sessions(&self, user_id: &str) -> Result<Vec<Session>, StoreError>;
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

    async fn delete_expired_for_user(&self, user_id: &str) -> Result<u64, StoreError> {
        let mut connection = self.acquire_primary().await?;
        // Read the clock once and bind it once: a predicate evaluated against two
        // reads of `now()` makes the boundary row flicker in and out.
        let now = chrono::Utc::now().naive_utc();
        let result = sqlx::query(DELETE_EXPIRED_FOR_USER)
            .bind(user_id)
            .bind(now)
            .execute(&mut *connection)
            .await?;
        Ok(result.rows_affected())
    }

    async fn list_sessions(&self, user_id: &str) -> Result<Vec<Session>, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let rows: Vec<SessionRow> = sqlx::query_as(LIST_SESSIONS)
            .bind(user_id)
            .bind(chrono::Utc::now().naive_utc())
            .fetch_all(&mut *connection)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| Session { user_id: row.user_id, expires_at: row.expires_at })
            .collect())
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

    async fn delete_expired_for_user(&self, user_id: &str) -> Result<u64, StoreError> {
        self.gate(super::memory::StoreOp::Sessions).await?;
        let now = chrono::Utc::now().naive_utc();
        let mut sessions = self.sessions().lock().expect("in-memory sessions");
        let before = sessions.len();
        sessions.retain(|_, session| session.user_id != user_id || session.expires_at > now);
        Ok((before - sessions.len()) as u64)
    }

    async fn list_sessions(&self, user_id: &str) -> Result<Vec<Session>, StoreError> {
        self.gate(super::memory::StoreOp::Sessions).await?;
        let now = chrono::Utc::now().naive_utc();
        let mut live: Vec<Session> = self
            .sessions()
            .lock()
            .expect("in-memory sessions")
            .values()
            .filter(|session| session.user_id == user_id && session.expires_at > now)
            .cloned()
            .collect();
        live.sort_by_key(|session| std::cmp::Reverse(session.expires_at));
        Ok(live)
    }
}
