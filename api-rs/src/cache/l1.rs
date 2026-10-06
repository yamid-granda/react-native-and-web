use std::time::Duration;

use axum::body::Bytes;
use moka::future::Cache;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    List,
    Detail,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::List => "list",
            Self::Detail => "detail",
        }
    }
}

/// Default entry ceiling for one L1 tier, per kind.
///
/// A ceiling in entries, not bytes: it bounds the *number* of pages and never
/// their size. [`super::DEFAULT_MAX_VALUE_BYTES`] is the other half, and the two
/// are what together make this a memory bound rather than a bookkeeping one.
pub const DEFAULT_MAX_ENTRIES: u64 = 50_000;

/// In-process hot set. List pages get a short TTL (they repeat across
/// shoppers and bound staleness), detail entries a longer one.
#[derive(Clone)]
pub struct L1Cache {
    list: Cache<String, Bytes>,
    detail: Cache<String, Bytes>,
}

impl L1Cache {
    pub fn new(list_ttl: Duration, detail_ttl: Duration, max_entries: u64) -> Self {
        Self { list: build(list_ttl, max_entries), detail: build(detail_ttl, max_entries) }
    }

    fn for_kind(&self, kind: Kind) -> &Cache<String, Bytes> {
        match kind {
            Kind::List => &self.list,
            Kind::Detail => &self.detail,
        }
    }

    pub async fn get(&self, kind: Kind, key: &str) -> Option<Bytes> {
        let hit = self.for_kind(kind).get(key).await;
        let name = if hit.is_some() { "cache_l1_hits_total" } else { "cache_l1_misses_total" };
        metrics::counter!(name, "kind" => kind.as_str()).increment(1);
        hit
    }

    pub async fn insert(&self, kind: Kind, key: String, value: Bytes) {
        self.for_kind(kind).insert(key, value).await;
    }

    pub async fn remove(&self, kind: Kind, key: &str) {
        self.for_kind(kind).remove(key).await;
    }
}

fn build(ttl: Duration, max_entries: u64) -> Cache<String, Bytes> {
    Cache::builder().time_to_live(ttl).max_capacity(max_entries).build()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ceiling is now a constructor argument rather than a literal, so what
    /// needs pinning is that the argument reaches moka. Without this a refactor
    /// back to a hardcoded `max_capacity` would compile and change every
    /// instance's memory ceiling at once, silently.
    #[tokio::test]
    async fn the_entry_ceiling_is_the_one_it_was_given() {
        let ceiling = 4;
        let cache = L1Cache::new(Duration::from_secs(60), Duration::from_secs(60), ceiling);
        for index in 0..(ceiling * 8) {
            cache.insert(Kind::Detail, format!("k{index}"), Bytes::from_static(b"body")).await;
        }
        // moka applies the policy from a write buffer, so the pending tasks have
        // to be drained before the eviction is visible. Without this the
        // assertion would be about the timing of the test rather than the
        // ceiling.
        cache.detail.run_pending_tasks().await;
        assert!(cache.detail.entry_count() <= ceiling, "ceiling not applied");
    }

    /// Both tiers get the same ceiling, which is what makes one operator-facing
    /// number enough. A page and a detail entry differ in size, not in how many
    /// of them are worth keeping.
    #[tokio::test]
    async fn both_kinds_share_one_ceiling() {
        let cache = L1Cache::new(Duration::from_secs(60), Duration::from_secs(60), 1);
        for kind in [Kind::List, Kind::Detail] {
            for index in 0..8 {
                cache.insert(kind, format!("k{index}"), Bytes::from_static(b"body")).await;
            }
        }
        cache.list.run_pending_tasks().await;
        cache.detail.run_pending_tasks().await;
        assert!(cache.list.entry_count() <= 1);
        assert!(cache.detail.entry_count() <= 1);
    }
}
