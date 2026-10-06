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

// The key scheme itself, in one place.
//
// These three builders are the only place a cache key is spelled out. The byte
// format is load-bearing — they are live Valkey keys across a fleet, and the
// format is what lets one `INCR` retire every cached page — so this moves
// *where* the string is built, never what it is.

/// `handlers::products::detail` writes this entry and
/// [`CacheTier::invalidate_detail`] retires it. Two spellings of this string
/// would make every write keep answering 201/200 while serving a pre-write body
/// until the detail TTL expired, with nothing failing.
pub fn detail_key(id: &str) -> String {
    format!("products:detail:{id}")
}

/// The catalog list key: namespace generation, then the page's float bits.
///
/// The generation is what makes a write path possible at all. Page keys cannot
/// be enumerated — `products:list:<bits>` over every page a shopper has ever
/// asked for is not a list anyone can walk — so a price change would otherwise
/// leave every cached page stale until its 5 s TTL ran out. Folding in a counter
/// that a write bumps retires all of them at once, with one `INCR` and no
/// `SCAN` (see `ARCHITECTURE.md` §12).
pub fn list_key(generation: i64, page: f64) -> String {
    format!("products:list:{generation}:{}", page.to_bits())
}

/// A public storefront's list key: the same scheme under a per-store namespace,
/// so one write retires a seller's page along with the marketplace's.
pub fn store_list_key(generation: i64, store_id: &str, page: f64) -> String {
    format!("stores:{store_id}:products:list:{generation}:{}", page.to_bits())
}

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

/// The default ceiling on one cached body.
///
/// The entry ceiling (`l1::DEFAULT_MAX_ENTRIES`) cannot see what it is storing:
/// a 400-byte list page and a 40 MB one both cost "1 of 50,000". This is the
/// other half of the bound, and it is deliberately well above any real body
/// rather than tight — with `MAX_DESCRIPTION_LENGTH` and `MAX_IMAGE_URL_LENGTH`
/// in place a page is at most `PAGE_SIZE × 6 KiB`, so this only ever catches
/// something the field caps missed. It exists because the failure it prevents
/// is disproportionate: one oversized entry evicts the hot set around it.
pub const DEFAULT_MAX_VALUE_BYTES: usize = 1024 * 1024;

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
    /// Refuses an oversized body before either tier sees it. Held here rather
    /// than on `L1Cache` because one bound has to cover both tiers: the shared
    /// store is also where the rate-limit counters live, so a multi-megabyte
    /// value is a bad citizen there for a different reason than in an LRU.
    max_value_bytes: usize,
}

impl CacheTier {
    pub fn new(l1: L1Cache, l2: Option<L2Cache>, max_value_bytes: usize) -> Self {
        Self {
            l1,
            l2,
            flights: Singleflight::default(),
            generation: Arc::new(AtomicI64::new(0)),
            max_value_bytes,
        }
    }

    /// Uncached tier for tests/benchmarks that must exercise the store path.
    pub fn disabled() -> Self {
        Self::new(
            L1Cache::new(Duration::ZERO, Duration::ZERO, l1::DEFAULT_MAX_ENTRIES),
            None,
            DEFAULT_MAX_VALUE_BYTES,
        )
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
                // Not `self.l1.insert`, and this is the reason the seam below
                // exists rather than a check inline in `set`: the shared tier is
                // writable by every instance in the fleet, so an L2 hit can hand
                // back a body this instance would never have written — a rolling
                // deploy past a pre-bound instance is enough, and so is anything
                // still inside `L2_TTL_SECS` from before the bound shipped.
                self.fill_l1(kind, key, bytes.clone()).await;
                return Some((bytes, HitSource::L2));
            }
        }
        None
    }

    /// The one seam where anything enters L1, so it is also where the size of an
    /// entry is decided. Both routes in — a fill from the handler and an L2 hit
    /// repopulating a cold tier — go through here, so neither can be the one that
    /// forgets the ceiling.
    ///
    /// An oversized body is refused rather than stored and evicted later: a 40 MB
    /// value in an LRU evicts the entire hot set to make room for itself.
    /// Refusing is fail-open in the same direction as every other failure here —
    /// both callers are already holding the bytes, so the caller is unaffected
    /// and the next request re-renders the page from Postgres.
    ///
    /// The size of what is *stored* is recorded, not the size of what was
    /// offered: the histogram describes the cache's contents, and the refusal
    /// counter describes the gap between them.
    async fn fill_l1(&self, kind: Kind, key: &str, bytes: Bytes) {
        if self.is_oversized(&bytes) {
            metrics::counter!("cache_l1_oversize_total", "kind" => kind.as_str()).increment(1);
            return;
        }
        metrics::histogram!("cache_entry_size_bytes", "kind" => kind.as_str())
            .record(bytes.len() as f64);
        self.l1.insert(kind, key.to_string(), bytes).await;
    }

    /// The one ceiling, asked in one place. [`Self::set`] needs it for the L2
    /// decision and [`Self::fill_l1`] for the L1 one, and the two must not be
    /// able to drift apart and start disagreeing about what "oversized" means.
    fn is_oversized(&self, bytes: &Bytes) -> bool {
        bytes.len() > self.max_value_bytes
    }

    /// Writes a body to both tiers.
    ///
    /// The L1 half is applied by [`Self::fill_l1`] and the L2 half here, because
    /// the tiers refuse for different reasons — an LRU evicts its neighbours,
    /// while the shared store competes with the `api-rs:rl:*` rate-limit keys
    /// that hold load shedding up — even though both measure against the same
    /// `max_value_bytes`.
    pub async fn set(&self, kind: Kind, key: &str, bytes: Bytes) {
        let oversized = self.is_oversized(&bytes);
        self.fill_l1(kind, key, bytes.clone()).await;
        if let Some(l2) = &self.l2 {
            if oversized {
                metrics::counter!("cache_l2_oversize_total", "kind" => kind.as_str()).increment(1);
            } else {
                l2.set(kind, key, &bytes).await;
            }
        }
    }

    pub async fn invalidate_detail(&self, id: &str) {
        let key = detail_key(id);
        self.l1.remove(Kind::Detail, &key).await;
        if let Some(l2) = &self.l2 {
            l2.remove(&key).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tier that really caches, for the tests below that need a hit — as
    /// opposed to `disabled()`, whose zero TTLs make every read a miss. It uses
    /// the production bounds rather than stand-ins so no test can pass against a
    /// limit the service does not actually run with.
    fn caching() -> CacheTier {
        tier_limited_to(DEFAULT_MAX_VALUE_BYTES)
    }

    /// The same, with a value ceiling small enough for a test to cross.
    fn tier_limited_to(max_value_bytes: usize) -> CacheTier {
        CacheTier::new(
            L1Cache::new(Duration::from_secs(60), Duration::from_secs(60), l1::DEFAULT_MAX_ENTRIES),
            None,
            max_value_bytes,
        )
    }

    /// The bound is a bound: a body over `max_value_bytes` is never stored,
    /// rather than stored and then evicted once it has displaced the hot set
    /// around it. Both kinds are covered because a list page and a detail entry
    /// are filled from different call sites and either could regress alone.
    #[tokio::test]
    async fn an_oversized_body_is_refused_rather_than_stored() {
        let limit = 1024;
        let cache = tier_limited_to(limit);
        let oversized = Bytes::from(vec![b'x'; limit + 1]);
        for kind in [Kind::List, Kind::Detail] {
            cache.set(kind, "big", oversized.clone()).await;
            assert!(cache.get(kind, "big").await.is_none(), "{kind:?} stored an oversized body");
        }
    }

    /// The boundary is inclusive, or the constant would quietly be one byte
    /// smaller than the number names.
    #[tokio::test]
    async fn a_body_at_exactly_the_limit_is_stored() {
        let limit = 1024;
        let cache = tier_limited_to(limit);
        for kind in [Kind::List, Kind::Detail] {
            cache.set(kind, "exact", Bytes::from(vec![b'x'; limit])).await;
            assert!(
                cache.get(kind, "exact").await.is_some(),
                "{kind:?} refused a body at the limit"
            );
        }
    }

    /// The same bound, asked of the seam itself rather than through `set`, because
    /// `get` reaches L1 by a second route: an L2 hit repopulating a cold tier. The
    /// shared tier is writable by every instance in the fleet, so that route can
    /// be handed a body this instance would refuse to write — a rolling deploy
    /// past a pre-bound instance, or anything still inside `L2_TTL_SECS` from
    /// before the bound shipped. Exercising it through `get` needs a live Valkey
    /// (`L2Cache` holds a concrete `ConnectionManager` with no test seam), so the
    /// seam is pinned directly: `get` calling it unconditionally is what this is
    /// defending, and a `l1.insert` reintroduced on that path would pass every
    /// test here.
    #[tokio::test]
    async fn the_seam_refuses_an_oversized_body_whoever_offers_it() {
        let limit = 1024;
        let cache = tier_limited_to(limit);
        for kind in [Kind::List, Kind::Detail] {
            cache.fill_l1(kind, "big", Bytes::from(vec![b'x'; limit + 1])).await;
            assert!(
                cache.get(kind, "big").await.is_none(),
                "{kind:?} the seam stored an oversized body"
            );
            cache.fill_l1(kind, "exact", Bytes::from(vec![b'x'; limit])).await;
            assert!(
                cache.get(kind, "exact").await.is_some(),
                "{kind:?} the seam refused the limit itself"
            );
        }
    }

    /// A refusal is fail-open in the same direction as every other failure in
    /// this module: the handler already holds its serialized body, so declining
    /// to cache it changes nothing for the caller — and it must not poison the
    /// key the smaller body uses.
    #[tokio::test]
    async fn refusing_an_oversized_body_leaves_the_tier_working() {
        let cache = tier_limited_to(1024);
        cache.set(Kind::Detail, "big", Bytes::from(vec![b'x'; 1025])).await;
        cache.set(Kind::Detail, "small", Bytes::from_static(b"body")).await;
        assert!(cache.get(Kind::Detail, "small").await.is_some());
    }

    #[tokio::test]
    async fn l1_hit_short_circuits() {
        let cache = caching();
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
        let cache = caching();
        assert_eq!(cache.generation(), 0);
    }

    /// The property the whole design rests on: bumping renames the namespace, so
    /// every page written under the old one becomes unreachable.
    #[tokio::test]
    async fn a_bump_makes_previously_cached_list_pages_unreachable() {
        let cache = caching();
        // The builder under test, not a literal copy of its format: a literal
        // here would keep passing if the scheme changed underneath it.
        let key = |generation: i64| list_key(generation, 1.0);
        cache.set(Kind::List, &key(cache.generation()), Bytes::from_static(b"before")).await;
        assert!(cache.get(Kind::List, &key(cache.generation())).await.is_some());

        cache.bump_list_generation().await;

        assert_eq!(cache.generation(), 1);
        assert!(cache.get(Kind::List, &key(cache.generation())).await.is_none());
    }

    /// The key scheme is the correctness mechanism for write-driven
    /// invalidation, so its byte format is pinned here rather than left to a
    /// reader of the handlers.
    #[test]
    fn the_key_scheme_keeps_its_format() {
        assert_eq!(detail_key("prod-1"), "products:detail:prod-1");
        assert_eq!(list_key(7, 1.0), format!("products:list:7:{}", 1.0f64.to_bits()));
        assert_eq!(
            store_list_key(7, "usr-1", 1.0),
            format!("stores:usr-1:products:list:7:{}", 1.0f64.to_bits())
        );
        // Distinct pages and distinct stores are distinct keys — the property
        // singleflight and retirement both rest on.
        assert_ne!(list_key(7, 1.0), list_key(7, 2.0));
        assert_ne!(store_list_key(7, "usr-1", 1.0), store_list_key(7, "usr-2", 1.0));
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
        let cache = caching();
        cache.set(Kind::List, &list_key(0, 1.0), Bytes::from_static(b"list")).await;
        cache.set(Kind::Detail, &detail_key("prod-1"), Bytes::from_static(b"detail")).await;

        cache.invalidate_detail("prod-1").await;

        assert!(cache.get(Kind::Detail, &detail_key("prod-1")).await.is_none());
        assert!(
            cache.get(Kind::List, &list_key(0, 1.0)).await.is_some(),
            "list pages are retired by the generation, not per key"
        );
    }
}
