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

/// In-process hot set. List pages get a short TTL (they repeat across
/// shoppers and bound staleness), detail entries a longer one.
#[derive(Clone)]
pub struct L1Cache {
    list: Cache<String, Bytes>,
    detail: Cache<String, Bytes>,
}

impl L1Cache {
    pub fn new(list_ttl: Duration, detail_ttl: Duration) -> Self {
        Self { list: build(list_ttl), detail: build(detail_ttl) }
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

fn build(ttl: Duration) -> Cache<String, Bytes> {
    Cache::builder().time_to_live(ttl).max_capacity(50_000).build()
}
