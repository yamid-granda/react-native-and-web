pub mod l1;
pub mod l2;
pub mod singleflight;

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
pub use l1::{Kind, L1Cache};
pub use l2::L2Cache;
pub use singleflight::Singleflight;

/// The namespace counter that retires every cached list page at once.
///
/// `ARCHITECTURE.md` §12 sketched reading this from Valkey on every list
/// request. That is one round trip in front of the hottest L1 hit path in the
/// service, so the value is held in process instead: seeded at startup,
/// refreshed in the background, written through by [`CacheTier::bump_list_generation`]
/// on the instance that did the write. The price is bounded staleness on *other*
/// instances, spelled out on [`CacheTier::generation`].
const GENERATION_KEY: &str = "products:list:gen";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HitSource {
    L1,
    L2,
}

impl HitSource {
    pub fn header_value(self) -> &'static str {
        match self {
            Self::L1 => "hit-l1",
            Self::L2 => "hit-l2",
        }
    }
}

/// Read-through tiering: L1 (in-process moka) first, then L2 (shared Valkey).
/// An L2 hit repopulates L1. Every failure mode here is fail-open — a miss or
/// an error just falls through to Postgres. `Singleflight` sits alongside the
/// tiers rather than inside them: the tiers stay pure read-through, and the
/// handler keeps ownership of the store call, serialization, and headers.
#[derive(Clone)]
pub struct CacheTier {
    l1: L1Cache,
    l2: Option<L2Cache>,
    flights: Singleflight,
    /// Shared across `CacheTier` clones, like `flights`: axum hands every
    /// request its own `AppState`, and the generation is fleet-wide state.
    generation: Arc<AtomicI64>,
}

impl CacheTier {
    pub fn new(l1: L1Cache, l2: Option<L2Cache>) -> Self {
        Self { l1, l2, flights: Singleflight::default(), generation: Arc::new(AtomicI64::new(0)) }
    }

    /// Uncached tier for tests/benchmarks that must exercise the store path.
    pub fn disabled() -> Self {
        Self::new(L1Cache::new(Duration::ZERO, Duration::ZERO), None)
    }

    /// In-flight fill registry. Shared across `CacheTier` clones rather than
    /// per-clone, because axum hands every request its own `AppState`.
    pub fn flights(&self) -> &Singleflight {
        &self.flights
    }

    /// The current list namespace, folded into every list key.
    ///
    /// Synchronous by design: a relaxed atomic read, not a cache lookup. Zero
    /// is the default everywhere — Valkey off, benches, unit tests — so those
    /// paths have exactly one list namespace and no way to be wrong about it.
    ///
    /// The staleness this buys: an instance that did not perform a write picks
    /// the new counter up within one refresh interval, so for that window it can
    /// still serve a list page filled before the write. The window is bounded by
    /// `L2_TTL_SECS` plus the entry's own remaining TTL, which is why the
    /// refresher interval is tied to the L2 TTL rather than to the 5 s list TTL.
    pub fn generation(&self) -> i64 {
        self.generation.load(Ordering::Relaxed)
    }

    /// Re-reads the shared counter into this process. Driven by the background
    /// refresher rather than by a request.
    ///
    /// Fail-open like every other Valkey consumer: an unreachable tier leaves the
    /// local value alone rather than resetting it to 0, which would address the
    /// *pre-write* namespace and serve a page that was just retired.
    pub async fn refresh_generation(&self) {
        let Some(l2) = &self.l2 else { return };
        if let Some(generation) = l2.get_generation().await {
            self.generation.store(generation, Ordering::Relaxed);
        }
    }

    /// Retires every cached list page — in both tiers, and across the fleet —
    /// with one `INCR`. Old keys are simply never addressed again and expire on
    /// their own TTL: no enumeration, no `SCAN`.
    ///
    /// Order matters at the call site: `invalidate_detail(id)` first, then this,
    /// so a reader can never pair a fresh detail entry with a list that was
    /// filled before the write.
    pub async fn bump_list_generation(&self) {
        let generation = match &self.l2 {
            Some(l2) => l2.bump_generation().await.unwrap_or_else(|| self.generation() + 1),
            // No Valkey: the counter is local-only and still retires every list
            // page this process has, which is the entire list-caching surface a
            // single-process deployment has.
            None => self.generation() + 1,
        };
        self.generation.store(generation, Ordering::Relaxed);
        metrics::counter!("cache_list_generation_bumps_total").increment(1);
    }

    /// Keeps this process's view of the shared counter fresh.
    ///
    /// Spawned from `main.rs` rather than from `new`, because `AppState::new` is
    /// synchronous and is also called by unit tests and benches that have no use
    /// for a background task.
    pub fn spawn_generation_refresher(&self, interval: Duration) {
        let cache = self.clone();
        let period = interval.max(Duration::from_secs(1));
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(period);
            // tokio's first tick fires immediately; skip it, so a freshly
            // started process cannot race its own first write.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                cache.refresh_generation().await;
            }
        });
    }

    pub async fn get(&self, kind: Kind, key: &str) -> Option<(Bytes, HitSource)> {
        if let Some(bytes) = self.l1.get(kind, key).await {
            return Some((bytes, HitSource::L1));
        }
        if let Some(l2) = &self.l2 {
            if let Some(bytes) = l2.get(kind, key).await {
                self.l1.insert(kind, key.to_string(), bytes.clone()).await;
                return Some((bytes, HitSource::L2));
            }
        }
        None
    }

    pub async fn set(&self, kind: Kind, key: &str, bytes: Bytes) {
        self.l1.insert(kind, key.to_string(), bytes.clone()).await;
        if let Some(l2) = &self.l2 {
            l2.set(kind, key, &bytes).await;
        }
    }

    pub async fn invalidate_detail(&self, id: &str) {
        let key = format!("products:detail:{id}");
        self.l1.remove(Kind::Detail, &key).await;
        if let Some(l2) = &self.l2 {
            l2.remove(&key).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn l1_hit_short_circuits() {
        let cache =
            CacheTier::new(L1Cache::new(Duration::from_secs(60), Duration::from_secs(60)), None);
        assert!(cache.get(Kind::List, "k").await.is_none());
        cache.set(Kind::List, "k", Bytes::from_static(b"body")).await;
        let (bytes, source) = cache.get(Kind::List, "k").await.unwrap();
        assert_eq!(bytes, "body");
        assert_eq!(source, HitSource::L1);
    }

    #[tokio::test]
    async fn zero_ttl_never_hits() {
        let cache = CacheTier::disabled();
        cache.set(Kind::Detail, "k", Bytes::from_static(b"body")).await;
        // moka expiry is async; a ZERO TTL entry is never returned as a hit.
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(cache.get(Kind::Detail, "k").await.is_none());
    }

    #[tokio::test]
    async fn the_generation_starts_at_zero() {
        assert_eq!(CacheTier::disabled().generation(), 0);
        let cache =
            CacheTier::new(L1Cache::new(Duration::from_secs(60), Duration::from_secs(60)), None);
        assert_eq!(cache.generation(), 0);
    }

    /// The property the whole design rests on: bumping renames the namespace, so
    /// every page written under the old one becomes unreachable.
    #[tokio::test]
    async fn a_bump_makes_previously_cached_list_pages_unreachable() {
        let cache =
            CacheTier::new(L1Cache::new(Duration::from_secs(60), Duration::from_secs(60)), None);
        let key = |generation: i64| format!("products:list:{generation}:{}", 1.0f64.to_bits());
        cache.set(Kind::List, &key(cache.generation()), Bytes::from_static(b"before")).await;
        assert!(cache.get(Kind::List, &key(cache.generation())).await.is_some());

        cache.bump_list_generation().await;

        assert_eq!(cache.generation(), 1);
        assert!(cache.get(Kind::List, &key(cache.generation())).await.is_none());
    }

    #[tokio::test]
    async fn a_bump_without_valkey_is_a_local_increment() {
        let cache = CacheTier::disabled();
        cache.bump_list_generation().await;
        assert_eq!(cache.generation(), 1);
        cache.bump_list_generation().await;
        assert_eq!(cache.generation(), 2);
        // Refreshing is a no-op with no shared tier, so it cannot invent a value.
        cache.refresh_generation().await;
        assert_eq!(cache.generation(), 2);
    }

    /// A bump must be visible to the clones every request holds, or one request
    /// would keep addressing the retired namespace.
    #[tokio::test]
    async fn the_generation_is_shared_across_clones() {
        let cache = CacheTier::disabled();
        let clone = cache.clone();
        cache.bump_list_generation().await;
        assert_eq!(clone.generation(), 1);
    }

    #[tokio::test]
    async fn invalidate_detail_only_touches_the_detail_key() {
        let cache =
            CacheTier::new(L1Cache::new(Duration::from_secs(60), Duration::from_secs(60)), None);
        cache.set(Kind::List, "products:list:0:1", Bytes::from_static(b"list")).await;
        cache.set(Kind::Detail, "products:detail:prod-1", Bytes::from_static(b"detail")).await;

        cache.invalidate_detail("prod-1").await;

        assert!(cache.get(Kind::Detail, "products:detail:prod-1").await.is_none());
        assert!(
            cache.get(Kind::List, "products:list:0:1").await.is_some(),
            "list pages are retired by the generation, not per key"
        );
    }
}
