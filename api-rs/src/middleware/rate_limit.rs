use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use redis::aio::ConnectionManager;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

use crate::app::AppState;
use crate::config::Config;
use crate::error::{json_response, ErrorBody};

/// Load protection, deliberately shed before the database can be taken down:
/// in-process concurrency semaphores (global + per-IP) return 503 when
/// saturated, and Valkey-backed fixed-window counters return 429 past the
/// configured rps. Counters live in Valkey so limits are consistent across
/// instances. Every Valkey failure is fail-open (allow + count the error).
#[derive(Clone)]
pub struct RateLimiter {
    conn: Option<ConnectionManager>,
    global_rps: u64,
    per_ip_rps: u64,
    global_slots: Arc<Semaphore>,
    ip_slots: Arc<IpConcurrency>,
}

pub enum Verdict {
    Allowed(Permits),
    Shed(&'static str),
    Limited(&'static str),
}

pub struct Permits {
    _global: Option<OwnedSemaphorePermit>,
    _ip: Option<OwnedSemaphorePermit>,
}

impl RateLimiter {
    pub fn new(config: &Config, conn: Option<ConnectionManager>) -> Self {
        Self {
            conn,
            global_rps: config.rate_limit_global_rps,
            per_ip_rps: config.rate_limit_per_ip_rps,
            global_slots: Arc::new(Semaphore::new(config.global_concurrency_limit.max(1))),
            ip_slots: Arc::new(IpConcurrency::new(config.per_ip_concurrency_limit.max(1), 100_000)),
        }
    }

    /// Runs every protection check for one request. Permits in the `Allowed`
    /// verdict must be held until the response is produced.
    pub async fn check(&self, ip: &str) -> Verdict {
        let Ok(global) = self.global_slots.clone().try_acquire_owned() else {
            return Verdict::Shed("global-concurrency");
        };

        let ip_permit = match self.ip_slots.acquire(ip).await {
            IpPermit::Acquired(permit) => Some(permit),
            IpPermit::Saturated => return Verdict::Shed("ip-concurrency"),
            IpPermit::Untracked => None,
        };

        if let Some(conn) = &self.conn {
            if self.global_rps > 0 && window_exceeded(conn, "global", self.global_rps).await {
                return Verdict::Limited("global");
            }
            if self.per_ip_rps > 0
                && window_exceeded(conn, &format!("ip:{ip}"), self.per_ip_rps).await
            {
                return Verdict::Limited("ip");
            }
        }

        Verdict::Allowed(Permits { _global: Some(global), _ip: ip_permit })
    }
}

/// One fixed 1-second window per key. INCR creates the key on first hit, and
/// EXPIRE is set then so stale windows clean themselves up.
async fn window_exceeded(conn: &ConnectionManager, key: &str, limit: u64) -> bool {
    let window = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let full_key = format!("api-rs:rl:{key}:{window}");
    let mut conn = conn.clone();
    let count: redis::RedisResult<i64> =
        redis::cmd("INCR").arg(&full_key).query_async(&mut conn).await;
    match count {
        Ok(count) => {
            if count == 1 {
                let expire: redis::RedisResult<redis::Value> =
                    redis::cmd("EXPIRE").arg(&full_key).arg(2).query_async(&mut conn).await;
                if let Err(error) = expire {
                    record_redis_error("expire", &error);
                }
            }
            count as u64 > limit
        }
        Err(error) => {
            record_redis_error("incr", &error);
            false
        }
    }
}

fn record_redis_error(op: &str, error: &redis::RedisError) {
    tracing::warn!(op, error = %error, "rate limiter failed open");
    metrics::counter!("rate_limit_errors_total").increment(1);
}

/// Per-IP semaphore registry, capped so a flood of unique IPs can't grow the
/// map without bound.
pub struct IpConcurrency {
    slots: Mutex<HashMap<String, Arc<Semaphore>>>,
    per_ip: usize,
    max_tracked: usize,
}

/// Outcome of the per-IP concurrency check. `Untracked` is the deliberate
/// fail-open case once the tracking cap is full: the request still faces the
/// global semaphore and the rps windows, which is better than turning a flood
/// of distinct (possibly spoofed) client IPs into blanket 503s.
pub enum IpPermit {
    Acquired(OwnedSemaphorePermit),
    Saturated,
    Untracked,
}

impl IpConcurrency {
    pub fn new(per_ip: usize, max_tracked: usize) -> Self {
        Self { slots: Mutex::new(HashMap::new()), per_ip, max_tracked }
    }

    async fn acquire(&self, ip: &str) -> IpPermit {
        let semaphore = {
            let mut slots = self.slots.lock().await;
            match slots.get(ip) {
                Some(existing) => existing.clone(),
                None => {
                    if slots.len() >= self.max_tracked {
                        return IpPermit::Untracked;
                    }
                    let created = Arc::new(Semaphore::new(self.per_ip));
                    slots.insert(ip.to_string(), created.clone());
                    created
                }
            }
        };
        match semaphore.try_acquire_owned() {
            Ok(permit) => IpPermit::Acquired(permit),
            Err(_) => IpPermit::Saturated,
        }
    }
}

/// Client IP for per-IP limits. Behind Cloudflare the true client is in
/// `CF-Connecting-IP`; fall back to the first `X-Forwarded-For` hop, then the
/// socket peer.
pub fn client_ip(headers: &HeaderMap, peer: Option<&SocketAddr>) -> String {
    if let Some(value) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = value.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    peer.map(|p| p.ip().to_string()).unwrap_or_else(|| "unknown".to_string())
}

pub fn limited_response() -> Response {
    let body = ErrorBody {
        message: "Too Many Requests".to_string(),
        error: Some("Too Many Requests"),
        status_code: 429,
    };
    json_response(StatusCode::TOO_MANY_REQUESTS, body.to_vec(), &[], None)
}

pub fn shed_response() -> Response {
    let body = ErrorBody {
        message: "Service Unavailable".to_string(),
        error: Some("Service Unavailable"),
        status_code: 503,
    };
    json_response(StatusCode::SERVICE_UNAVAILABLE, body.to_vec(), &[], None)
}

/// The axum middleware wiring the checks above into the request path.
/// Concurrency permits are held until the response is produced, so the
/// limits bound requests actually in flight.
pub async fn enforce(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let peer = request.extensions().get::<ConnectInfo<SocketAddr>>().map(|info| info.0);
    let ip = client_ip(request.headers(), peer.as_ref());

    match state.limiter.check(&ip).await {
        Verdict::Allowed(_permits) => next.run(request).await,
        Verdict::Shed(scope) => {
            metrics::counter!("http_load_shed_total", "scope" => scope).increment(1);
            tracing::warn!(scope, ip = %ip, "shedding load");
            shed_response()
        }
        Verdict::Limited(scope) => {
            metrics::counter!("http_rate_limited_total", "scope" => scope).increment(1);
            limited_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn config() -> Config {
        Config { global_concurrency_limit: 2, per_ip_concurrency_limit: 1, ..Config::default() }
    }

    #[tokio::test]
    async fn global_concurrency_sheds_when_saturated() {
        let limiter = RateLimiter::new(&config(), None);
        let first = limiter.check("1.2.3.4").await;
        assert!(matches!(first, Verdict::Allowed(_)));
        let second = limiter.check("1.2.3.5").await;
        assert!(matches!(second, Verdict::Allowed(_)));
        match limiter.check("1.2.3.6").await {
            Verdict::Shed(scope) => assert_eq!(scope, "global-concurrency"),
            other => panic!("expected shed, got {:?}", verdict_name(&other)),
        }
    }

    #[tokio::test]
    async fn per_ip_concurrency_sheds_second_parallel_request() {
        let limiter = RateLimiter::new(&config(), None);
        let first = limiter.check("9.9.9.9").await;
        assert!(matches!(first, Verdict::Allowed(_)));
        match limiter.check("9.9.9.9").await {
            Verdict::Shed(scope) => assert_eq!(scope, "ip-concurrency"),
            other => panic!("expected shed, got {:?}", verdict_name(&other)),
        }
    }

    #[tokio::test]
    async fn dropping_permits_frees_slots() {
        let limiter = RateLimiter::new(&config(), None);
        let first = limiter.check("8.8.8.8").await;
        assert!(matches!(first, Verdict::Allowed(_)));
        drop(first);
        let again = limiter.check("8.8.8.8").await;
        assert!(matches!(again, Verdict::Allowed(_)));
    }

    #[tokio::test]
    async fn tracking_cap_fails_open_instead_of_shedding() {
        // One tracked slot: the second distinct IP cannot be registered.
        let slots = IpConcurrency::new(1, 1);
        // The permit has to stay bound, otherwise it is released at the end of
        // the statement and the "saturated" case below would find a free slot.
        let held = slots.acquire("1.1.1.1").await;
        assert!(matches!(held, IpPermit::Acquired(_)));
        assert!(matches!(slots.acquire("2.2.2.2").await, IpPermit::Untracked));
        // The tracked IP stays bounded by its own semaphore.
        assert!(matches!(slots.acquire("1.1.1.1").await, IpPermit::Saturated));
        drop(held);
        // Releasing it frees the slot again.
        assert!(matches!(slots.acquire("1.1.1.1").await, IpPermit::Acquired(_)));
    }

    #[test]
    fn client_ip_prefers_edge_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "5.5.5.5, 6.6.6.6".parse().unwrap());
        assert_eq!(client_ip(&headers, None), "5.5.5.5");
        headers.insert("cf-connecting-ip", "7.7.7.7".parse().unwrap());
        assert_eq!(client_ip(&headers, None), "7.7.7.7");
        let peer: SocketAddr = "9.9.9.9:1234".parse().unwrap();
        assert_eq!(client_ip(&HeaderMap::new(), Some(&peer)), "9.9.9.9");
        assert_eq!(client_ip(&HeaderMap::new(), None), "unknown");
    }

    fn verdict_name(verdict: &Verdict) -> &'static str {
        match verdict {
            Verdict::Allowed(_) => "allowed",
            Verdict::Shed(_) => "shed",
            Verdict::Limited(_) => "limited",
        }
    }
}
