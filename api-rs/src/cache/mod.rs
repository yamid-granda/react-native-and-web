pub mod l1;
pub mod l2;
pub mod singleflight;

use std::time::Duration;

use axum::body::Bytes;
pub use l1::{Kind, L1Cache};
pub use l2::L2Cache;
pub use singleflight::Singleflight;

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
}

impl CacheTier {
    pub fn new(l1: L1Cache, l2: Option<L2Cache>) -> Self {
        Self { l1, l2, flights: Singleflight::default() }
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
}
