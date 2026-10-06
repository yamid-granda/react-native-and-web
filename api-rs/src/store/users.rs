use async_trait::async_trait;
use chrono::NaiveDateTime;
use sqlx::FromRow;

use super::memory::InMemoryStore;
use super::products::{SqlProductStore, StoreError};

/// A seller, as the API exposes it. The password hash is deliberately not a
/// field: it never leaves the store layer, so there is no code path that could
/// serialize one into a response by accident.
#[derive(Clone, Debug, PartialEq)]
pub struct StoreUser {
    pub id: String,
    pub email: String,
    pub store_name: String,
    pub created_at: NaiveDateTime,
}

/// A seller plus their credential: what an auth path needs, and what the
/// public `GET /stores/{id}` must never see.
#[derive(Clone, Debug, PartialEq)]
pub struct UserRecord {
    pub user: StoreUser,
    pub password_hash: String,
}

/// Insert arguments. The caller supplies the id and the already-hashed
/// password — hashing belongs to [`crate::auth::password`], and letting the
/// store do it would fold tens of milliseconds of CPU into a query.
#[derive(Clone, Debug)]
pub struct NewUser {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub store_name: String,
}

#[derive(FromRow)]
struct UserRow {
    id: String,
    email: String,
    #[sqlx(rename = "passwordHash")]
    password_hash: String,
    #[sqlx(rename = "storeName")]
    store_name: String,
    #[sqlx(rename = "createdAt")]
    created_at: NaiveDateTime,
}

impl UserRow {
    fn into_record(self) -> UserRecord {
        UserRecord {
            user: StoreUser {
                id: self.id,
                email: self.email,
                store_name: self.store_name,
                created_at: self.created_at,
            },
            password_hash: self.password_hash,
        }
    }

    fn into_user(self) -> StoreUser {
        self.into_record().user
    }
}

/// Emails are compared case-insensitively, so they are normalised once on the
/// way in and every read is a plain equality lookup on the unique index.
pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

const SELECT_USER_BY_EMAIL: &str = r#"SELECT "id", "email", "passwordHash", "storeName", "createdAt" FROM "User" WHERE "email" = $1"#;
const SELECT_USER_BY_ID: &str =
    r#"SELECT "id", "email", "passwordHash", "storeName", "createdAt" FROM "User" WHERE "id" = $1"#;
const INSERT_USER: &str = r#"INSERT INTO "User" ("id", "email", "passwordHash", "storeName", "createdAt") VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)"#;

#[async_trait]
pub trait UserStore: Send + Sync + 'static {
    async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, StoreError>;
    async fn find_user_by_id(&self, id: &str) -> Result<Option<StoreUser>, StoreError>;
    /// `Err(StoreError::EmailTaken)` when the address is already registered.
    async fn create_user(&self, new_user: NewUser) -> Result<StoreUser, StoreError>;
}

#[async_trait]
impl UserStore for SqlProductStore {
    async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let row: Option<UserRow> = sqlx::query_as(SELECT_USER_BY_EMAIL)
            .bind(email)
            .fetch_optional(&mut *connection)
            .await?;
        Ok(row.map(UserRow::into_record))
    }

    async fn find_user_by_id(&self, id: &str) -> Result<Option<StoreUser>, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let row: Option<UserRow> =
            sqlx::query_as(SELECT_USER_BY_ID).bind(id).fetch_optional(&mut *connection).await?;
        Ok(row.map(UserRow::into_user))
    }

    async fn create_user(&self, new_user: NewUser) -> Result<StoreUser, StoreError> {
        let mut connection = self.acquire_primary().await?;
        let inserted = sqlx::query(INSERT_USER)
            .bind(&new_user.id)
            .bind(&new_user.email)
            .bind(&new_user.password_hash)
            .bind(&new_user.store_name)
            .execute(&mut *connection)
            .await;

        if let Err(error) = inserted {
            return Err(classify_insert(error));
        }

        // Read the row back rather than assembling a response value from the
        // arguments: `createdAt` then comes from the column, so the value in the
        // 201 and the value any later read returns are the same one. On the
        // connection already held above, so a registration parks one permit from
        // a pool sized for one per request rather than two.
        let row: UserRow = sqlx::query_as(SELECT_USER_BY_ID)
            .bind(&new_user.id)
            .fetch_one(&mut *connection)
            .await?;
        Ok(row.into_user())
    }
}

/// Postgres `23505`. Matched on the SQLSTATE rather than the index name so a
/// future migration that adds another unique constraint cannot silently turn a
/// duplicate registration into a 500.
fn classify_insert(error: sqlx::Error) -> StoreError {
    let is_unique_violation =
        matches!(&error, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"));
    if is_unique_violation {
        StoreError::EmailTaken
    } else {
        StoreError::Database(error.to_string())
    }
}

#[async_trait]
impl UserStore for InMemoryStore {
    async fn find_user_by_email(&self, email: &str) -> Result<Option<UserRecord>, StoreError> {
        self.gate(super::memory::StoreOp::Users).await?;
        let users = self.users().lock().expect("in-memory users");
        Ok(users.values().find(|record| record.user.email == email).cloned())
    }

    async fn find_user_by_id(&self, id: &str) -> Result<Option<StoreUser>, StoreError> {
        self.gate(super::memory::StoreOp::Users).await?;
        let users = self.users().lock().expect("in-memory users");
        Ok(users.get(id).map(|record| record.user.clone()))
    }

    async fn create_user(&self, new_user: NewUser) -> Result<StoreUser, StoreError> {
        self.gate(super::memory::StoreOp::Users).await?;
        let mut users = self.users().lock().expect("in-memory users");
        // Production rejects a repeat of *either* unique column, because
        // `classify_insert` maps any 23505 to `EmailTaken`. Inserting over an
        // existing id instead would answer 201 and quietly destroy that
        // seller's store name and password hash — the one way a refused
        // registration could still change the row it collided with.
        if users.values().any(|record| record.user.email == new_user.email)
            || users.contains_key(&new_user.id)
        {
            return Err(StoreError::EmailTaken);
        }
        let user = StoreUser {
            id: new_user.id,
            email: new_user.email,
            store_name: new_user.store_name,
            created_at: chrono::Utc::now().naive_utc(),
        };
        users.insert(
            user.id.clone(),
            UserRecord { user: user.clone(), password_hash: new_user.password_hash },
        );
        Ok(user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails_are_normalised_for_case_insensitive_lookup() {
        assert_eq!(normalize_email("  Seller@Example.COM "), "seller@example.com");
        assert_eq!(normalize_email("seller@example.com"), "seller@example.com");
    }

    #[test]
    fn a_public_user_never_carries_the_credential() {
        let user = StoreUser {
            id: "usr-1".to_string(),
            email: "seller@example.com".to_string(),
            store_name: "Corner Shop".to_string(),
            created_at: chrono::Utc::now().naive_utc(),
        };
        let record = UserRecord { user, password_hash: "$argon2id$secret".to_string() };
        assert!(!format!("{:?}", record.user).contains("argon2"));
        assert!(record.password_hash.contains("argon2"));
    }
}
