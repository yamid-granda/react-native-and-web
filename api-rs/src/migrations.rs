use sqlx::migrate::Migrator;

/// The schema, embedded at compile time so the binary carries its own
/// migration history and no SQL files have to ship beside it.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Applies every pending migration. Safe to call concurrently: sqlx takes a
/// Postgres advisory lock for the duration, so only one caller migrates and the
/// rest wait and then see nothing to do.
pub async fn run(pool: &sqlx::PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}
