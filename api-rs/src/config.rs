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

/// Params that were only ever meaningful to the retired Prisma client. Existing
/// `.env` files and deployment configs still carry them, and sqlx's URL parser
/// rejects the whole connection string over one unknown param.
const PRISMA_ONLY_PARAMS: &[&str] =
    &["schema", "connection_limit", "pool_timeout", "pgbouncer", "sslaccept", "channel_binding"];

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    /// Optional read replica. Unset means reads go to the primary, which is the
    /// pre-replica behaviour and what local dev and CI run.
    pub database_read_url: Option<String>,
    pub valkey_url: Option<String>,
    pub db_max_connections: u32,
    /// A budget of its own: `DB_MAX_CONNECTIONS` is per-pool, so two pools
    /// against one server need arithmetic the operator does deliberately.
    pub db_read_max_connections: u32,
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
    /// How long a session token stays valid. Long enough that a seller is not
    /// signed out mid-edit, short enough that a leaked token expires on its own
    /// even if `POST /auth/logout` is never reached.
    pub session_ttl_secs: u64,
    /// Login and registration attempts per client IP per minute. A second
    /// window on top of `rate_limit_per_ip_rps`, because a password guess is
    /// cheap to make and expensive to serve (see `src/auth/password.rs`).
    pub auth_login_attempts_per_min: u64,
    pub edge_cache_control: String,
    pub cors_origin: String,
    pub health_ping_timeout_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 3001,
            database_url: "postgresql://rnw:rnw@localhost:5432/rnw_dev".to_string(),
            database_read_url: None,
            valkey_url: Some("redis://127.0.0.1:6379".to_string()),
            db_max_connections: 10,
            db_read_max_connections: 10,
            db_acquire_timeout: Duration::from_millis(2000),
            request_timeout: Duration::from_millis(10_000),
            l1_list_ttl: Duration::from_secs(5),
            l1_detail_ttl: Duration::from_secs(60),
            l2_ttl: Duration::from_secs(60),
            global_concurrency_limit: 1024,
            per_ip_concurrency_limit: 64,
            rate_limit_global_rps: 0,
            rate_limit_per_ip_rps: 100,
            session_ttl_secs: 7 * 24 * 60 * 60,
            auth_login_attempts_per_min: 10,
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
        // Same Prisma-param stripping: operators copy one URL and edit the host,
        // and a leftover `?schema=public` would fail sqlx's parser at startup.
        if let Some(raw) = env_str("DATABASE_READ_URL") {
            config.database_read_url = Some(strip_prisma_only_params(&raw));
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
        if let Some(raw) = env_str("DB_READ_MAX_CONNECTIONS") {
            config.db_read_max_connections =
                raw.parse().map_err(|e| ConfigError::invalid("DB_READ_MAX_CONNECTIONS", e))?;
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
        if let Some(raw) = env_str("SESSION_TTL_SECS") {
            config.session_ttl_secs =
                raw.parse().map_err(|e| ConfigError::invalid("SESSION_TTL_SECS", e))?;
        }
        if let Some(raw) = env_str("AUTH_LOGIN_ATTEMPTS_PER_MIN") {
            config.auth_login_attempts_per_min =
                raw.parse().map_err(|e| ConfigError::invalid("AUTH_LOGIN_ATTEMPTS_PER_MIN", e))?;
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
    use std::ffi::OsString;
    use std::sync::Mutex;

    use super::*;

    /// Every key `from_env` reads. Each test clears all of them so an ambient
    /// environment — a developer's shell, a CI runner, a `.env` that
    /// `dotenvy` never loads in tests — cannot change the result.
    const ENV_KEYS: &[&str] = &[
        "DATABASE_URL",
        "DATABASE_READ_URL",
        "PORT",
        "VALKEY_URL",
        "DB_MAX_CONNECTIONS",
        "DB_READ_MAX_CONNECTIONS",
        "DB_ACQUIRE_TIMEOUT_MS",
        "REQUEST_TIMEOUT_MS",
        "L1_LIST_TTL_SECS",
        "L1_DETAIL_TTL_SECS",
        "L2_TTL_SECS",
        "GLOBAL_CONCURRENCY_LIMIT",
        "PER_IP_CONCURRENCY_LIMIT",
        "RATE_LIMIT_GLOBAL_RPS",
        "RATE_LIMIT_PER_IP_RPS",
        "SESSION_TTL_SECS",
        "AUTH_LOGIN_ATTEMPTS_PER_MIN",
        "EDGE_CACHE_CONTROL",
        "CORS_ORIGIN",
        "HEALTH_PING_TIMEOUT_MS",
    ];

    /// `from_env` reads process-global state and the test harness runs tests in
    /// parallel threads, so every test that touches the environment holds this
    /// for its whole body. A poisoned lock only means some other env test
    /// panicked, which must not cascade into silent skips here.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Runs `body` with every api-rs env key unset, then restores what was
    /// there — including for the tests that set keys themselves.
    fn with_clean_env<T>(body: impl FnOnce() -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let saved: Vec<(&'static str, Option<OsString>)> =
            ENV_KEYS.iter().map(|key| (*key, std::env::var_os(key))).collect();
        for key in ENV_KEYS {
            std::env::remove_var(key);
        }
        let result = body();
        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        result
    }

    fn set(key: &str, value: &str) {
        std::env::set_var(key, value);
    }

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
        // A week: long enough for a real editing session, short enough that a
        // token nobody revoked still ages out.
        assert_eq!(config.session_ttl_secs, 604_800);
        assert_eq!(config.auth_login_attempts_per_min, 10);
    }

    #[test]
    fn from_env_without_any_keys_is_the_default() {
        let config = with_clean_env(|| Config::from_env().expect("no env set"));
        assert_eq!(config.port, 3001);
        assert_eq!(config.database_url, Config::default().database_url);
        assert_eq!(config.database_read_url, None, "no replica unless one is configured");
        assert_eq!(config.db_max_connections, 10);
        assert_eq!(config.db_read_max_connections, 10);
        assert_eq!(config.db_acquire_timeout, Duration::from_millis(2000));
        assert_eq!(config.l1_list_ttl, Duration::from_secs(5));
        assert_eq!(config.cors_origin, "http://localhost:3000");
    }

    #[test]
    fn from_env_reads_every_documented_key() {
        let config = with_clean_env(|| {
            set("DATABASE_URL", "postgresql://u:p@h:5432/db?schema=public&sslmode=require");
            set("DATABASE_READ_URL", "postgresql://u:p@replica:5432/db?schema=public");
            set("PORT", "8080");
            set("VALKEY_URL", "redis://cache:6379");
            set("DB_MAX_CONNECTIONS", "25");
            set("DB_READ_MAX_CONNECTIONS", "26");
            set("DB_ACQUIRE_TIMEOUT_MS", "1500");
            set("REQUEST_TIMEOUT_MS", "9000");
            set("L1_LIST_TTL_SECS", "7");
            set("L1_DETAIL_TTL_SECS", "8");
            set("L2_TTL_SECS", "9");
            set("GLOBAL_CONCURRENCY_LIMIT", "11");
            set("PER_IP_CONCURRENCY_LIMIT", "12");
            set("RATE_LIMIT_GLOBAL_RPS", "13");
            set("RATE_LIMIT_PER_IP_RPS", "14");
            set("SESSION_TTL_SECS", "3600");
            set("AUTH_LOGIN_ATTEMPTS_PER_MIN", "3");
            set("EDGE_CACHE_CONTROL", "public, max-age=60");
            set("CORS_ORIGIN", "https://example.test");
            set("HEALTH_PING_TIMEOUT_MS", "1500");
            Config::from_env().expect("all keys valid")
        });

        assert_eq!(config.database_url, "postgresql://u:p@h:5432/db?sslmode=require");
        assert_eq!(config.database_read_url.as_deref(), Some("postgresql://u:p@replica:5432/db"));
        assert_eq!(config.port, 8080);
        assert_eq!(config.valkey_url.as_deref(), Some("redis://cache:6379"));
        assert_eq!(config.db_max_connections, 25);
        assert_eq!(config.db_read_max_connections, 26);
        assert_eq!(config.db_acquire_timeout, Duration::from_millis(1500));
        assert_eq!(config.request_timeout, Duration::from_millis(9000));
        assert_eq!(config.l1_list_ttl, Duration::from_secs(7));
        assert_eq!(config.l1_detail_ttl, Duration::from_secs(8));
        assert_eq!(config.l2_ttl, Duration::from_secs(9));
        assert_eq!(config.global_concurrency_limit, 11);
        assert_eq!(config.per_ip_concurrency_limit, 12);
        assert_eq!(config.rate_limit_global_rps, 13);
        assert_eq!(config.rate_limit_per_ip_rps, 14);
        assert_eq!(config.session_ttl_secs, 3600);
        assert_eq!(config.auth_login_attempts_per_min, 3);
        assert_eq!(config.edge_cache_control, "public, max-age=60");
        assert_eq!(config.cors_origin, "https://example.test");
        assert_eq!(config.health_ping_timeout_ms, 1500);
    }

    #[test]
    fn valkey_off_and_none_disable_the_shared_tiers() {
        for raw in ["off", "OFF", "none", "None"] {
            let config = with_clean_env(|| {
                set("VALKEY_URL", raw);
                Config::from_env().expect("valid valkey url")
            });
            assert_eq!(config.valkey_url, None, "{raw:?} should disable Valkey");
        }
    }

    #[test]
    fn surrounding_whitespace_and_blank_values_are_normalised() {
        let config = with_clean_env(|| {
            // A `.env` file routinely quotes or pads values; a padded port must
            // still parse, and a blank one must fall back to the default rather
            // than fail as an invalid number.
            set("PORT", "  8080  ");
            set("CORS_ORIGIN", "   ");
            set("RATE_LIMIT_GLOBAL_RPS", "");
            Config::from_env().expect("padded and blank values tolerated")
        });

        assert_eq!(config.port, 8080);
        assert_eq!(config.cors_origin, "http://localhost:3000");
        assert_eq!(config.rate_limit_global_rps, 0);
    }

    #[test]
    fn fractional_seconds_are_accepted_for_ttls() {
        let config = with_clean_env(|| {
            set("L1_LIST_TTL_SECS", "0.5");
            Config::from_env().expect("fractional seconds")
        });
        assert_eq!(config.l1_list_ttl, Duration::from_millis(500));
    }

    #[test]
    fn invalid_values_name_the_offending_key() {
        let cases = [
            ("PORT", "not-a-port"),
            ("DB_MAX_CONNECTIONS", "-1"),
            ("DB_READ_MAX_CONNECTIONS", "many"),
            ("GLOBAL_CONCURRENCY_LIMIT", "many"),
            ("PER_IP_CONCURRENCY_LIMIT", "1.5"),
            ("RATE_LIMIT_GLOBAL_RPS", "fast"),
            ("RATE_LIMIT_PER_IP_RPS", "fast"),
            ("SESSION_TTL_SECS", "forever"),
            ("AUTH_LOGIN_ATTEMPTS_PER_MIN", "many"),
            ("HEALTH_PING_TIMEOUT_MS", "soon"),
            ("DB_ACQUIRE_TIMEOUT_MS", "later"),
            ("REQUEST_TIMEOUT_MS", "later"),
            ("L1_LIST_TTL_SECS", "soon"),
            ("L1_DETAIL_TTL_SECS", "soon"),
            ("L2_TTL_SECS", "soon"),
        ];

        for (key, bad) in cases {
            let error = with_clean_env(|| {
                set(key, bad);
                Config::from_env().expect_err("invalid value must be rejected")
            });
            assert!(
                matches!(&error, ConfigError::Invalid { key: reported, .. } if *reported == key),
                "{key}={bad:?} reported {error:?} instead of naming the key"
            );
        }
    }

    #[test]
    fn ttl_seconds_reject_negative_and_non_finite_values() {
        // Durations cannot be negative or infinite, so these are refused at the
        // boundary rather than producing a nonsensical Duration.
        for bad in ["-1", "NaN", "inf", "-inf"] {
            let error = with_clean_env(|| {
                set("L2_TTL_SECS", bad);
                Config::from_env().expect_err("non-positive TTL must be rejected")
            });
            assert!(
                error.to_string().contains("non-negative"),
                "L2_TTL_SECS={bad:?} reported {error:?}"
            );
        }
    }
}
