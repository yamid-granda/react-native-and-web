use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use redis::aio::ConnectionManager;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

use crate::app::AppState;
use crate::config::Config;
use crate::error::{json_response, ErrorBody};

/// One fixed window per key per scope. The public read path gets a one-second
/// window; the credential endpoints get a minute, because the thing they are
/// bounding is a guess rate rather than a burst.
const GENERAL_WINDOW: Duration = Duration::from_secs(1);
const AUTH_WINDOW: Duration = Duration::from_secs(60);

/// Load protection, deliberately shed before the database can be taken down:
/// in-process concurrency semaphores (global + per-IP) return 503 when
/// saturated, and Valkey-backed fixed-window counters return 429 past the
/// configured limit. Counters live in Valkey so limits are consistent across
/// instances. Every Valkey failure is fail-open (allow + count the error).
#[derive(Clone)]
pub struct RateLimiter {
    conn: Option<Arc<dyn CounterStore>>,
    global_rps: u64,
    per_ip_rps: u64,
    auth_per_min: u64,
    global_slots: Arc<Semaphore>,
    ip_slots: Arc<IpConcurrency>,
    trusted_proxy_headers: Arc<Vec<String>>,
}

pub enum Verdict {
    Allowed(Permits),
    Shed(&'static str),
    Limited(&'static str),
    /// The per-IP registry is full, so this request ran with no per-IP permit.
    /// Counted rather than logged per request, because at the cap this is every
    /// request. Still allowed — it holds the global permit and faces the rps
    /// windows — because shedding here is the blanket-503 outcome the cap exists
    /// to avoid.
    Untracked(Permits),
}

pub struct Permits {
    _global: Option<OwnedSemaphorePermit>,
    _ip: Option<OwnedSemaphorePermit>,
}

/// The credential-endpoint throttle, as its own middleware.
///
/// It checks *only* the per-IP window, not the concurrency semaphores: the
/// outer `rate_limit::enforce` already holds those for this request, and
/// taking a second permit for the same in-flight work would make the two limits
/// disagree about how much load exists.
///
/// Fail-open, like every Valkey consumer here: an unreachable Valkey removes the
/// login throttle, exactly as it removes the read-path L2 cache. A per-*account*
/// limit is not available on an unauthenticated endpoint without first telling
/// the caller which accounts exist, so per-IP is the right bound here.
pub struct AuthVerdict {
    limited: bool,
}

impl AuthVerdict {
    pub fn is_limited(&self) -> bool {
        self.limited
    }
}

impl RateLimiter {
    pub fn new(config: &Config, conn: Option<Arc<dyn CounterStore>>) -> Self {
        Self {
            conn,
            global_rps: config.rate_limit_global_rps,
            per_ip_rps: config.rate_limit_per_ip_rps,
            auth_per_min: config.auth_login_attempts_per_min,
            global_slots: Arc::new(Semaphore::new(config.global_concurrency_limit.max(1))),
            ip_slots: Arc::new(IpConcurrency::new(
                config.per_ip_concurrency_limit.max(1),
                config.rate_limit_max_tracked_ips.max(1),
            )),
            trusted_proxy_headers: Arc::new(config.trusted_proxy_headers.clone()),
        }
    }

    /// The client IP that keys every per-IP limit, resolved through this
    /// instance's configured trusted-proxy headers.
    pub fn client_ip(&self, headers: &HeaderMap, peer: Option<&SocketAddr>) -> String {
        client_ip(headers, peer, &self.trusted_proxy_headers)
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
        // Bound before the window checks, exactly as before: the permits have to
        // stay held across the Valkey round trips, not just until they return.
        let untracked = ip_permit.is_none();
        let permits = Permits { _global: Some(global), _ip: ip_permit };

        if let Some(store) = &self.conn {
            if self.global_rps > 0
                && window_exceeded(store.as_ref(), "global", self.global_rps, GENERAL_WINDOW).await
            {
                return Verdict::Limited("global");
            }
            if self.per_ip_rps > 0
                && window_exceeded(
                    store.as_ref(),
                    &format!("ip:{ip}"),
                    self.per_ip_rps,
                    GENERAL_WINDOW,
                )
                .await
            {
                return Verdict::Limited("ip");
            }
        }

        if untracked {
            return Verdict::Untracked(permits);
        }
        Verdict::Allowed(permits)
    }

    /// The `/auth/*` window: `auth_login_attempts_per_min` per client IP per
    /// minute. `Allowed` costs nothing and holds nothing.
    pub async fn check_auth(&self, ip: &str) -> AuthVerdict {
        let limited = match &self.conn {
            Some(store) if self.auth_per_min > 0 => {
                window_exceeded(
                    store.as_ref(),
                    &format!("auth:{ip}"),
                    self.auth_per_min,
                    AUTH_WINDOW,
                )
                .await
            }
            _ => false,
        };
        AuthVerdict { limited }
    }
}

/// The two commands a fixed window needs, and nothing else.
///
/// Deliberately not a cache and deliberately no `get`: these are counters, and a
/// `get` on this trait would invite caching a count. Two methods rather than one
/// `incr_with_ttl` so the `count == 1` sequencing lives in [`window_exceeded`] —
/// production code — instead of inside the Valkey implementation, where reaching
/// it needs a real socket. That is what makes "the TTL is written once per
/// window" and both fail-open arms assertable under `cargo test --lib`.
#[async_trait]
pub trait CounterStore: Send + Sync + 'static {
    /// `INCR key`, returning the value *after* the increment.
    async fn incr(&self, key: &str) -> redis::RedisResult<u64>;
    /// `EXPIRE key ttl`. The caller records and swallows the error.
    async fn expire(&self, key: &str, ttl: Duration) -> redis::RedisResult<()>;
}

#[async_trait]
impl CounterStore for ConnectionManager {
    async fn incr(&self, key: &str) -> redis::RedisResult<u64> {
        let mut conn = self.clone();
        let count: i64 = redis::cmd("INCR").arg(key).query_async(&mut conn).await?;
        // A negative count is not representable and not reachable; clamping keeps
        // the cast total rather than wrapping a bug into a huge budget.
        Ok(u64::try_from(count).unwrap_or(0))
    }

    async fn expire(&self, key: &str, ttl: Duration) -> redis::RedisResult<()> {
        let mut conn = self.clone();
        redis::cmd("EXPIRE")
            .arg(key)
            .arg(ttl.as_secs())
            .query_async::<redis::Value>(&mut conn)
            .await
            .map(|_| ())
    }
}

/// One fixed window per key, bucketed by `now / window`. `INCR` creates the key
/// on first hit, and `EXPIRE` is set then so stale windows clean themselves up.
///
/// Bucketing rather than "key includes the window start" is what makes a one
/// second window behave exactly as it did before: for a one-second window,
/// `now / 1` *is* the window start.
///
/// The `EXPIRE`-only-on-`count == 1` rule lives here rather than in
/// [`CounterStore`] so it is reachable without a socket. Refreshing the TTL on
/// every hit would keep a key alive indefinitely; because the key's identity
/// already encodes its bucket, setting it once is both correct and the cheapest
/// of the two options.
async fn window_exceeded(
    store: &dyn CounterStore,
    key: &str,
    limit: u64,
    window: Duration,
) -> bool {
    let seconds = window.as_secs().max(1);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let full_key = format!("api-rs:rl:{key}:{}", now / seconds);
    // A TTL one window past the bucket it names, so the last hit before a
    // rollover cannot find the key already gone.
    let ttl = Duration::from_secs(seconds * 2);
    match store.incr(&full_key).await {
        Ok(count) => {
            if count == 1 {
                if let Err(error) = store.expire(&full_key, ttl).await {
                    record_redis_error("expire", &error);
                }
            }
            // `>` rather than `>=`, so request N passes and N+1 is the first
            // rejection: the limit is a budget, not a starting point.
            count > limit
        }
        Err(error) => {
            record_redis_error("incr", &error);
            false
        }
    }
}

fn record_redis_error(op: &str, error: &redis::RedisError) {
    tracing::warn!(op, error = %error, "rate limiter failed open");
    // `op` as a label, not only a log field. `cache_l2_errors_total` already does
    // this, and the two are not interchangeable for an operator: a TTL that never
    // got written leaves one permanent Valkey key per request, which is a
    // different problem from one timed-out `INCR`, and an unlabelled total cannot
    // tell them apart.
    metrics::counter!("rate_limit_errors_total", "op" => op.to_string()).increment(1);
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
                        // The cap is a high-water mark, not a latch. An entry whose
                        // `Arc` has exactly one strong reference — this map's own —
                        // has no permit held, because a permit holds one; and no
                        // waiter queued, because `acquire` only ever clones the
                        // `Arc` for an immediate `try_acquire_owned`. Sweeping only
                        // here, under the cap, keeps the cost off every other
                        // request: at most `global_concurrency_limit` permits can
                        // exist at once, so a full map always has idle entries to
                        // give back and the sweep cannot become the hot path.
                        slots.retain(|_, entry| Arc::strong_count(entry) > 1);
                        if slots.len() >= self.max_tracked {
                            return IpPermit::Untracked;
                        }
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

/// Client IP for per-IP limits, taken from the first configured header that is
/// present, then the socket peer.
///
/// `trusted` is a security setting, not a detail: every per-IP limit keys on this
/// string, so believing a client-supplied header unconditionally lets one header
/// reset the per-IP semaphore, the per-IP rps window and the login throttle at
/// the same time. With `TRUSTED_PROXY_HEADERS` empty the peer is used alone,
/// which is the correct posture for an origin reachable without a trusted edge.
pub fn client_ip(headers: &HeaderMap, peer: Option<&SocketAddr>, trusted: &[String]) -> String {
    for name in trusted {
        let Some(value) = headers.get(name.as_str()).and_then(|v| v.to_str().ok()) else {
            continue;
        };
        // Only the first hop of a list is the client; the rest are proxies.
        if let Some(trimmed) = value.split(',').next().map(str::trim) {
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
    let ip = state.limiter.client_ip(request.headers(), peer.as_ref());

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
        // Counted on the counter the shed panel and the `ApiRsLoadShed` rule
        // already read, so the per-IP bound going missing becomes visible without a
        // new series, a new panel and a new rule. `_permits` is bound, not
        // discarded, so the global permit is held across the request as usual.
        Verdict::Untracked(_permits) => {
            metrics::counter!("http_load_shed_total", "scope" => "ip-untracked").increment(1);
            tracing::debug!(ip = %ip, "per-IP registry full; running without a per-IP permit");
            next.run(request).await
        }
    }
}

/// The credential-endpoint throttle. Scoped with `route_layer` to
/// `/auth/login` and `/auth/register`, so it never sees the marketplace and
/// never sees the unmatched-path fallback. Unlike [`enforce`], which is
/// process-wide, this one deliberately is not.
pub async fn enforce_auth(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let peer = request.extensions().get::<ConnectInfo<SocketAddr>>().map(|info| info.0);
    let ip = state.limiter.client_ip(request.headers(), peer.as_ref());

    if state.limiter.check_auth(&ip).await.is_limited() {
        metrics::counter!("http_rate_limited_total", "scope" => "auth").increment(1);
        return limited_response();
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn config() -> Config {
        Config { global_concurrency_limit: 2, per_ip_concurrency_limit: 1, ..Config::default() }
    }

    /// The headers `Config::default()` trusts, so the precedence test below keeps
    /// asserting the behaviour a default deployment actually has.
    fn trusted() -> Vec<String> {
        Config::default().trusted_proxy_headers
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
        assert_eq!(client_ip(&headers, None, &trusted()), "5.5.5.5");
        headers.insert("cf-connecting-ip", "7.7.7.7".parse().unwrap());
        assert_eq!(client_ip(&headers, None, &trusted()), "7.7.7.7");
        let peer: SocketAddr = "9.9.9.9:1234".parse().unwrap();
        assert_eq!(client_ip(&HeaderMap::new(), Some(&peer), &trusted()), "9.9.9.9");
        assert_eq!(client_ip(&HeaderMap::new(), None, &trusted()), "unknown");
    }

    fn verdict_name(verdict: &Verdict) -> &'static str {
        match verdict {
            Verdict::Allowed(_) => "allowed",
            Verdict::Shed(_) => "shed",
            Verdict::Limited(_) => "limited",
            Verdict::Untracked(_) => "untracked",
        }
    }

    // --- Everything below was unreachable without a Docker daemon. ---

    /// A [`CounterStore`] that answers from a script and records what it was
    /// asked for, so the window arithmetic and both fail-open arms are reachable
    /// under `cargo test --lib`. Deliberately dumb: it makes no decisions about
    /// TTLs or limits, so every assertion is about what `window_exceeded` asked
    /// for rather than about what the double decided.
    #[derive(Default)]
    struct ScriptedStore {
        commands: Mutex<Vec<Command>>,
        counts: Mutex<HashMap<String, u64>>,
        fail_incr: bool,
        fail_expire: bool,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Command {
        Incr(String),
        Expire { key: String, ttl: Duration },
    }

    impl ScriptedStore {
        fn failing_incr() -> Self {
            Self { fail_incr: true, ..Self::default() }
        }

        fn failing_expire() -> Self {
            Self { fail_expire: true, ..Self::default() }
        }

        async fn commands(&self) -> Vec<Command> {
            self.commands.lock().await.clone()
        }
    }

    #[async_trait]
    impl CounterStore for ScriptedStore {
        async fn incr(&self, key: &str) -> redis::RedisResult<u64> {
            self.commands.lock().await.push(Command::Incr(key.to_string()));
            if self.fail_incr {
                return Err(scripted_error("scripted incr failure"));
            }
            let mut counts = self.counts.lock().await;
            let count = counts.entry(key.to_string()).or_default();
            *count += 1;
            Ok(*count)
        }

        async fn expire(&self, key: &str, ttl: Duration) -> redis::RedisResult<()> {
            self.commands.lock().await.push(Command::Expire { key: key.to_string(), ttl });
            if self.fail_expire {
                return Err(scripted_error("scripted expire failure"));
            }
            Ok(())
        }
    }

    fn scripted_error(message: &'static str) -> redis::RedisError {
        redis::RedisError::from((redis::ErrorKind::Io, message))
    }

    fn store(inner: Arc<ScriptedStore>) -> Arc<dyn CounterStore> {
        inner
    }

    /// The proposal's first unreachable behaviour: with a limit of 2, requests 1
    /// and 2 pass and request 3 is the first rejection.
    #[tokio::test]
    async fn window_rejects_the_first_request_past_the_limit() {
        // Global window only, so the verdict under test is the window's and not
        // the per-IP semaphore's.
        let mut config = config();
        config.rate_limit_global_rps = 2;
        config.rate_limit_per_ip_rps = 0;
        let limiter = RateLimiter::new(&config, Some(store(Arc::new(ScriptedStore::default()))));

        for _ in 0..2 {
            let verdict = limiter.check("1.1.1.1").await;
            assert!(matches!(verdict, Verdict::Allowed(_)), "under the limit must pass");
        }
        match limiter.check("1.1.1.1").await {
            Verdict::Limited(scope) => assert_eq!(scope, "global"),
            other => panic!("expected limited, got {:?}", verdict_name(&other)),
        }
    }

    /// The TTL is written once per window, on the creating hit only. Refreshing
    /// it every hit is what would let a key outlive its bucket.
    #[tokio::test]
    async fn expire_is_issued_only_on_the_creating_hit() {
        let scripted = Arc::new(ScriptedStore::default());
        let handle = Arc::clone(&scripted);
        let mut config = config();
        config.rate_limit_global_rps = 10;
        config.rate_limit_per_ip_rps = 0;
        let limiter = RateLimiter::new(&config, Some(store(scripted)));

        for _ in 0..4 {
            limiter.check("1.1.1.1").await;
        }

        let commands = handle.commands().await;
        assert_eq!(commands.iter().filter(|c| matches!(c, Command::Incr(_))).count(), 4);
        assert_eq!(
            commands.iter().filter(|c| matches!(c, Command::Expire { .. })).count(),
            1,
            "the TTL must be written once, not on every hit: {commands:?}"
        );
    }

    /// The key carries the bucket, not the raw timestamp, and the TTL is two
    /// windows so the last hit before a rollover cannot find the key gone.
    #[tokio::test]
    async fn window_key_is_bucketed_and_ttl_outlives_the_bucket() {
        let scripted = Arc::new(ScriptedStore::default());
        let handle = Arc::clone(&scripted);
        let limiter = RateLimiter::new(&config(), Some(store(scripted)));

        limiter.check("1.1.1.1").await;
        let commands = handle.commands().await;

        let (key, ttl) = commands
            .iter()
            .find_map(|c| match c {
                Command::Expire { key, ttl } => Some((key.clone(), *ttl)),
                Command::Incr(_) => None,
            })
            .expect("the creating hit must set a TTL");

        let bucket: u64 = key.rsplit(':').next().expect("a bucket component").parse().unwrap();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        // A one-second window, so the bucket is a recent whole second — and it is
        // the bucketed value, not `now` with a decisecond of drift baked in.
        assert!(bucket <= now && now - bucket <= 2, "bucket {bucket} is not near {now}");
        assert_eq!(ttl, Duration::from_secs(2), "two windows of headroom");
        assert!(key.starts_with("api-rs:rl:ip:1.1.1.1:"), "unexpected key {key}");
    }

    /// A TTL that never gets written leaves the key behind forever. That is a
    /// leak, not a verdict: the request still has to be judged on its count.
    #[tokio::test]
    async fn expire_failure_does_not_change_the_verdict() {
        let mut config = config();
        config.rate_limit_global_rps = 1;
        config.rate_limit_per_ip_rps = 0;
        let limiter =
            RateLimiter::new(&config, Some(store(Arc::new(ScriptedStore::failing_expire()))));

        assert!(matches!(limiter.check("1.1.1.1").await, Verdict::Allowed(_)));
        match limiter.check("1.1.1.1").await {
            Verdict::Limited(scope) => assert_eq!(scope, "global"),
            other => panic!("expected limited, got {:?}", verdict_name(&other)),
        }
    }

    /// `INCR` failing removes the window entirely, so the request is allowed.
    /// A bound is not worth a failed request.
    #[tokio::test]
    async fn incr_failure_fails_open() {
        let mut config = config();
        config.rate_limit_global_rps = 1;
        config.rate_limit_per_ip_rps = 0;
        let limiter =
            RateLimiter::new(&config, Some(store(Arc::new(ScriptedStore::failing_incr()))));

        for _ in 0..5 {
            assert!(matches!(limiter.check("1.1.1.1").await, Verdict::Allowed(_)));
        }
    }

    /// The login throttle keys on its own scope and its own window, so a busy
    /// read path cannot consume the credential budget.
    #[tokio::test]
    async fn check_auth_uses_its_own_scope_and_window() {
        let scripted = Arc::new(ScriptedStore::default());
        let handle = Arc::clone(&scripted);
        let limiter = RateLimiter::new(&config(), Some(store(scripted)));

        assert!(!limiter.check_auth("1.1.1.1").await.is_limited());
        assert!(!limiter.check_auth("1.1.1.1").await.is_limited());

        let commands = handle.commands().await;
        let key = commands
            .iter()
            .find_map(|c| match c {
                Command::Incr(key) => Some(key.clone()),
                Command::Expire { .. } => None,
            })
            .expect("the auth window must increment a key");
        assert!(key.starts_with("api-rs:rl:auth:1.1.1.1:"), "unexpected key {key}");

        // A minute-long window, so the TTL is 120s rather than the read path's 2s.
        let ttl = commands
            .iter()
            .find_map(|c| match c {
                Command::Expire { ttl, .. } => Some(*ttl),
                Command::Incr(_) => None,
            })
            .expect("the creating hit must set a TTL");
        assert_eq!(ttl, AUTH_WINDOW * 2);
    }

    /// The half that matters: instrumenting the cap must not turn a fail-open
    /// into a blanket shed. The request is allowed, and named so it can be
    /// counted.
    #[tokio::test]
    async fn a_full_registry_allows_the_request_as_untracked() {
        let mut config = config();
        config.rate_limit_max_tracked_ips = 1;
        let limiter = RateLimiter::new(&config, None);

        // Hold the one tracked slot for the whole test.
        let held = limiter.check("1.1.1.1").await;
        assert!(matches!(held, Verdict::Allowed(_)));

        match limiter.check("2.2.2.2").await {
            Verdict::Untracked(_) => {}
            other => panic!("expected untracked, got {:?}", verdict_name(&other)),
        }
        // The global permit is still held by an untracked request: the response is
        // served, not shed.
        drop(held);
    }

    /// The cap is a high-water mark, not a latch. Once the held permit is gone
    /// the idle entry is reclaimable and a previously untracked IP gets a real
    /// bound again.
    #[tokio::test]
    async fn the_tracking_cap_is_reclaimed_once_permits_are_released() {
        let slots = IpConcurrency::new(1, 1);
        let held = slots.acquire("1.1.1.1").await;
        assert!(matches!(held, IpPermit::Acquired(_)));
        assert!(matches!(slots.acquire("2.2.2.2").await, IpPermit::Untracked));

        drop(held);

        // The sweep reclaims 1.1.1.1's now-idle entry, so 2.2.2.2 is tracked —
        // which means it is bounded, and the third request from it sheds.
        assert!(matches!(slots.acquire("2.2.2.2").await, IpPermit::Acquired(_)));
    }

    /// A deployment that cannot guarantee a trusted edge must be able to fall
    /// back to the socket peer, so a client cannot rotate a header to reset three
    /// different limits at once.
    #[test]
    fn no_trusted_headers_falls_back_to_the_socket_peer() {
        let mut headers = HeaderMap::new();
        headers.insert("cf-connecting-ip", "7.7.7.7".parse().unwrap());
        headers.insert("x-forwarded-for", "5.5.5.5".parse().unwrap());
        let peer: SocketAddr = "9.9.9.9:1234".parse().unwrap();
        assert_eq!(client_ip(&headers, Some(&peer), &[]), "9.9.9.9");
        assert_eq!(client_ip(&headers, None, &[]), "unknown");

        // Order is the operator's, so a deployment can prefer a different header.
        let only_xff = vec!["x-forwarded-for".to_string()];
        assert_eq!(client_ip(&headers, Some(&peer), &only_xff), "5.5.5.5");
    }
}
