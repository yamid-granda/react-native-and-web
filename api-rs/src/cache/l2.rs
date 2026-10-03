use std::time::Duration;

use axum::body::Bytes;
use redis::aio::ConnectionManager;

use super::Kind;

const KEY_PREFIX: &str = "api-rs:";

/// Shared read cache (Valkey). Every operation is fail-open: connection or
/// command errors degrade to a cache miss and are counted, never surfaced.
#[derive(Clone)]
pub struct L2Cache {
    conn: ConnectionManager,
    ttl_secs: u64,
}

impl L2Cache {
    pub async fn connect(url: &str, ttl: Duration) -> redis::RedisResult<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self::new(conn, ttl))
    }

    pub fn new(conn: ConnectionManager, ttl: Duration) -> Self {
        Self { conn, ttl_secs: ttl.as_secs().max(1) }
    }

    fn prefixed(key: &str) -> String {
        format!("{KEY_PREFIX}{key}")
    }

    pub async fn get(&self, kind: Kind, key: &str) -> Option<Bytes> {
        let mut conn = self.conn.clone();
        let result: redis::RedisResult<Option<Vec<u8>>> =
            redis::cmd("GET").arg(Self::prefixed(key)).query_async(&mut conn).await;
        match result {
            Ok(Some(bytes)) => {
                metrics::counter!("cache_l2_hits_total", "kind" => kind.as_str()).increment(1);
                Some(Bytes::from(bytes))
            }
            Ok(None) => {
                metrics::counter!("cache_l2_misses_total", "kind" => kind.as_str()).increment(1);
                None
            }
            Err(error) => {
                self.record_error("get", &error);
                None
            }
        }
    }

    pub async fn set(&self, kind: Kind, key: &str, value: &[u8]) {
        let mut conn = self.conn.clone();
        let result: redis::RedisResult<redis::Value> = redis::cmd("SET")
            .arg(Self::prefixed(key))
            .arg(value)
            .arg("EX")
            .arg(self.ttl_secs)
            .query_async(&mut conn)
            .await;
        if let Err(error) = result {
            self.record_error("set", &error);
        } else {
            metrics::counter!("cache_l2_writes_total", "kind" => kind.as_str()).increment(1);
        }
    }

    pub async fn remove(&self, key: &str) {
        let mut conn = self.conn.clone();
        let result: redis::RedisResult<redis::Value> =
            redis::cmd("DEL").arg(Self::prefixed(key)).query_async(&mut conn).await;
        if let Err(error) = result {
            self.record_error("del", &error);
        }
    }

    /// The shared list-namespace counter. Absent means 0, so the very first
    /// deployment needs no seeding step.
    pub async fn get_generation(&self) -> Option<i64> {
        let mut conn = self.conn.clone();
        let result: redis::RedisResult<Option<i64>> = redis::cmd("GET")
            .arg(Self::prefixed(super::GENERATION_KEY))
            .query_async(&mut conn)
            .await;
        match result {
            Ok(value) => value,
            Err(error) => {
                self.record_error("get-generation", &error);
                None
            }
        }
    }

    /// `INCR` the counter. Never expires: it is a monotonic counter, not an
    /// entry, and losing it would let every retired list page be addressed
    /// again.
    ///
    /// `None` when Valkey is unreachable. The caller decides the local
    /// fallback, so the single copy of the local value stays on `CacheTier`
    /// where the read side reads it from.
    pub async fn bump_generation(&self) -> Option<i64> {
        let mut conn = self.conn.clone();
        let result: redis::RedisResult<i64> = redis::cmd("INCR")
            .arg(Self::prefixed(super::GENERATION_KEY))
            .query_async(&mut conn)
            .await;
        match result {
            Ok(generation) => Some(generation),
            Err(error) => {
                self.record_error("incr-generation", &error);
                None
            }
        }
    }

    fn record_error(&self, op: &str, error: &redis::RedisError) {
        tracing::warn!(op, error = %error, "L2 cache operation failed; falling through");
        metrics::counter!("cache_l2_errors_total", "op" => op.to_string()).increment(1);
    }
}
