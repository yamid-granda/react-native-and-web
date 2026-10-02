use std::time::Duration;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{key} is invalid: {reason}")]
    Invalid { key: &'static str, reason: String },
}

impl ConfigError {
    fn invalid(key: &'static str, reason: impl std::fmt::Display) -> Self {
        Self::Invalid { key, reason: reason.to_string() }
    }
}

type Result<T> = std::result::Result<T, ConfigError>;

/// Prisma-only `DATABASE_URL` query params that sqlx's URL parser rejects, so
/// both services can share one env value.
const PRISMA_ONLY_PARAMS: &[&str] =
    &["schema", "connection_limit", "pool_timeout", "pgbouncer", "sslaccept", "channel_binding"];

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub valkey_url: Option<String>,
    pub db_max_connections: u32,
    pub db_acquire_timeout: Duration,
    pub request_timeout: Duration,
    pub l1_list_ttl: Duration,
    pub l1_detail_ttl: Duration,
    pub l2_ttl: Duration,
    pub global_concurrency_limit: usize,
    pub per_ip_concurrency_limit: usize,
    /// Requests per second across all instances; 0 disables the check.
    pub rate_limit_global_rps: u64,
    /// Requests per second per client IP; 0 disables the check.
    pub rate_limit_per_ip_rps: u64,
    pub edge_cache_control: String,
    pub cors_origin: String,
    pub health_ping_timeout_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 3001,
            database_url: "postgresql://rnw:rnw@localhost:5432/rnw_dev".to_string(),
            valkey_url: Some("redis://127.0.0.1:6379".to_string()),
            db_max_connections: 10,
            db_acquire_timeout: Duration::from_millis(2000),
            request_timeout: Duration::from_millis(10_000),
            l1_list_ttl: Duration::from_secs(5),
            l1_detail_ttl: Duration::from_secs(60),
            l2_ttl: Duration::from_secs(60),
            global_concurrency_limit: 1024,
            per_ip_concurrency_limit: 64,
            rate_limit_global_rps: 0,
            rate_limit_per_ip_rps: 100,
            edge_cache_control: "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
                .to_string(),
            cors_origin: "http://localhost:3000".to_string(),
            health_ping_timeout_ms: 1000,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let mut config = Self::default();

        if let Some(raw) = env_str("DATABASE_URL") {
            config.database_url = strip_prisma_only_params(&raw);
        }
        if let Some(raw) = env_str("PORT") {
            config.port = raw.parse().map_err(|e| ConfigError::invalid("PORT", e))?;
        }
        if let Some(raw) = env_str("VALKEY_URL") {
            config.valkey_url = match raw.to_ascii_lowercase().as_str() {
                "off" | "none" => None,
                _ => Some(raw),
            };
        }
        if let Some(raw) = env_str("DB_MAX_CONNECTIONS") {
            config.db_max_connections =
                raw.parse().map_err(|e| ConfigError::invalid("DB_MAX_CONNECTIONS", e))?;
        }
        config.db_acquire_timeout =
            env_duration_ms("DB_ACQUIRE_TIMEOUT_MS")?.unwrap_or(config.db_acquire_timeout);
        config.request_timeout =
            env_duration_ms("REQUEST_TIMEOUT_MS")?.unwrap_or(config.request_timeout);
        config.l1_list_ttl = env_duration_secs("L1_LIST_TTL_SECS")?.unwrap_or(config.l1_list_ttl);
        config.l1_detail_ttl =
            env_duration_secs("L1_DETAIL_TTL_SECS")?.unwrap_or(config.l1_detail_ttl);
        config.l2_ttl = env_duration_secs("L2_TTL_SECS")?.unwrap_or(config.l2_ttl);
        if let Some(raw) = env_str("GLOBAL_CONCURRENCY_LIMIT") {
            config.global_concurrency_limit =
                raw.parse().map_err(|e| ConfigError::invalid("GLOBAL_CONCURRENCY_LIMIT", e))?;
        }
        if let Some(raw) = env_str("PER_IP_CONCURRENCY_LIMIT") {
            config.per_ip_concurrency_limit =
                raw.parse().map_err(|e| ConfigError::invalid("PER_IP_CONCURRENCY_LIMIT", e))?;
        }
        if let Some(raw) = env_str("RATE_LIMIT_GLOBAL_RPS") {
            config.rate_limit_global_rps =
                raw.parse().map_err(|e| ConfigError::invalid("RATE_LIMIT_GLOBAL_RPS", e))?;
        }
        if let Some(raw) = env_str("RATE_LIMIT_PER_IP_RPS") {
            config.rate_limit_per_ip_rps =
                raw.parse().map_err(|e| ConfigError::invalid("RATE_LIMIT_PER_IP_RPS", e))?;
        }
        if let Some(raw) = env_str("EDGE_CACHE_CONTROL") {
            config.edge_cache_control = raw;
        }
        if let Some(raw) = env_str("CORS_ORIGIN") {
            config.cors_origin = raw;
        }
        if let Some(raw) = env_str("HEALTH_PING_TIMEOUT_MS") {
            config.health_ping_timeout_ms =
                raw.parse().map_err(|e| ConfigError::invalid("HEALTH_PING_TIMEOUT_MS", e))?;
        }

        Ok(config)
    }
}

pub fn strip_prisma_only_params(url: &str) -> String {
    let Some((base, query)) = url.split_once('?') else { return url.to_string() };
    let kept: Vec<String> = form_urlencoded::parse(query.as_bytes())
        .filter(|(key, _)| !PRISMA_ONLY_PARAMS.contains(&key.as_ref()))
        .map(|(key, value)| format!("{key}={value}"))
        .collect();
    if kept.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", kept.join("&"))
    }
}

fn env_str(key: &'static str) -> Option<String> {
    std::env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn env_duration_ms(key: &'static str) -> Result<Option<Duration>> {
    match env_str(key) {
        Some(raw) => {
            let ms: u64 = raw.parse().map_err(|e| ConfigError::invalid(key, e))?;
            Ok(Some(Duration::from_millis(ms)))
        }
        None => Ok(None),
    }
}

fn env_duration_secs(key: &'static str) -> Result<Option<Duration>> {
    match env_str(key) {
        Some(raw) => {
            let secs: f64 = raw.parse().map_err(|e| ConfigError::invalid(key, e))?;
            if !secs.is_finite() || secs < 0.0 {
                return Err(ConfigError::invalid(key, "must be a non-negative number"));
            }
            Ok(Some(Duration::from_secs_f64(secs)))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_prisma_only_params() {
        assert_eq!(
            strip_prisma_only_params("postgresql://u:p@localhost:5432/db?schema=public"),
            "postgresql://u:p@localhost:5432/db"
        );
        assert_eq!(
            strip_prisma_only_params("postgresql://u:p@h/db?schema=public&sslmode=require"),
            "postgresql://u:p@h/db?sslmode=require"
        );
        assert_eq!(strip_prisma_only_params("postgresql://u:p@h/db"), "postgresql://u:p@h/db");
    }

    #[test]
    fn defaults_match_contract() {
        let config = Config::default();
        assert_eq!(config.port, 3001);
        assert_eq!(config.rate_limit_per_ip_rps, 100);
        assert_eq!(config.health_ping_timeout_ms, 1000);
    }
}
