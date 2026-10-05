use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::Instant;

use tokio::sync::{Mutex, MutexGuard, OwnedMutexGuard};

use super::Kind;

/// Dead entries are only pruned once this many keys are live-or-dead in the
/// map. Singleflight keys are per list page and per product id, so an
/// unreferenced entry is small, but it is also unbounded over a long uptime.
const PRUNE_THRESHOLD: usize = 1024;

/// Collapses concurrent fills of the same cache key into one.
///
/// Without it a burst on an expired key is N independent store calls — for
/// `/products` that is N identical paged `SELECT`s against the same offset. The
/// concurrency limiter bounds the total damage but does not deduplicate the
/// work.
///
/// Scope is per instance on purpose. Cross-instance warming is already Valkey's
/// job (an L2 hit repopulates L1 without touching Postgres at all), and a
/// distributed lock would put a network round trip on the miss path — the one
/// path that must stay fail-open. With a few instances the worst case is a few
/// cold fills instead of N×; revisit if per-instance collapse stops being
/// enough.
///
/// The map holds `Weak` references so a finished flight leaves nothing behind,
/// and it is wrapped in an `Arc` because [`super::CacheTier`] is cloned into
/// every request's `AppState` — a per-clone map would deduplicate nothing.
#[derive(Clone, Default)]
pub struct Singleflight {
    flights: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
}

impl Singleflight {
    /// The guard for one fill of `key`. Holding it exclusively is what makes a
    /// request the leader; everyone else waits and then re-reads the cache.
    pub async fn for_key(&self, kind: Kind, key: &str) -> Flight {
        let flight_key = cache_key(kind, key);
        let mut flights = self.flights.lock().await;

        let existing = flights.get(&flight_key).and_then(Weak::upgrade);
        let leader = existing.is_none();
        let lock = match existing {
            Some(lock) => lock,
            None => {
                if flights.len() >= PRUNE_THRESHOLD {
                    flights.retain(|_, entry| entry.strong_count() > 0);
                }
                let lock = Arc::new(Mutex::new(()));
                flights.insert(flight_key.clone(), Arc::downgrade(&lock));
                lock
            }
        };
        drop(flights);

        // Counted here rather than at lock time: joining a flight that is
        // already in progress is what "follower" means, and that is decided
        // before anyone can block. A late arrival that the leader finished
        // ahead of is still a follower, and still saves the duplicate query via
        // the caller's cache re-check.
        metrics::counter!(
            if leader { "cache_singleflight_leader_total" } else { "cache_singleflight_follower_total" },
            "kind" => kind.as_str(),
        )
        .increment(1);

        Flight { lock, _flights: Arc::clone(&self.flights), flight_key }
    }
}

/// Held across the store call, serialization, and cache write. Dropping it —
/// including because the request future was cancelled by the `TimeoutLayer` or
/// a client disconnect — releases the next waiter, which then re-checks the
/// cache and may become the new leader. There is no cached failure to poison
/// and no leader election to recover from.
pub struct Flight {
    lock: Arc<Mutex<()>>,
    /// Kept so the entry can be retired as soon as the last holder is gone.
    _flights: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
    flight_key: String,
}

impl Flight {
    pub async fn lock(&self) -> MutexGuard<'_, ()> {
        let started = Instant::now();
        let guard = self.lock.lock().await;
        Self::record_wait(started);
        guard
    }

    /// The same lock, owned rather than borrowed.
    ///
    /// [`Self::lock`] ties the guard to the `Flight` that handed it out, which
    /// is right for a caller that fills one key and releases it. A caller that
    /// has to hold a whole *set* of fills open at once — `GET /products/by-ids`
    /// resolves the ids it missed under one batched statement, so it must stay
    /// the leader for every one of them while that statement runs — cannot keep
    /// a borrowed guard per key: the `Flight`s would have to outlive the guards
    /// and the borrow would pin them in place.
    ///
    /// The returned guard owns its `Arc`, so it is `'static` and can be moved
    /// into any collection. It keeps the metric above, and it is the same mutex:
    /// a guard from `lock` and one from `owned_lock` exclude each other exactly
    /// as two of either do.
    pub async fn owned_lock(&self) -> OwnedMutexGuard<()> {
        let started = Instant::now();
        let guard = Arc::clone(&self.lock).lock_owned().await;
        Self::record_wait(started);
        guard
    }

    fn record_wait(started: Instant) {
        // Follower wait time, i.e. how long a collapsed request was kept
        // waiting on the leader's store call.
        metrics::histogram!("cache_singleflight_wait_seconds")
            .record(started.elapsed().as_secs_f64());
    }
}

impl Drop for Flight {
    fn drop(&mut self) {
        // Synchronous by necessity: `Drop` cannot await, so this only reclaims
        // the map slot opportunistically. Failing to take the lock only means
        // another request is registering a flight right now, and that request
        // upgrades or replaces the same entry.
        //
        // The count is `1`, not `0`: `Drop` runs before this flight's own `Arc`
        // is released, so `self.lock` is always still counted here. One strong
        // reference therefore means "this flight is the last holder", whereas
        // the leader plus its followers all hold clones of the same `Arc` and
        // keep the entry alive until the final one leaves.
        if let Ok(mut flights) = self._flights.try_lock() {
            if flights.get(&self.flight_key).is_some_and(|entry| entry.strong_count() == 1) {
                flights.remove(&self.flight_key);
            }
        }
    }
}

/// Namespaced by tier so `products:list:<bits>` and `products:detail:<id>` can
/// never share a flight even if either naming scheme changes later.
fn cache_key(kind: Kind, key: &str) -> String {
    format!("{}:{key}", kind.as_str())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    use super::*;

    /// A flight that was ever handed out must never be a *different* flight
    /// for the same key, however the two calls interleave.
    #[tokio::test]
    async fn concurrent_callers_share_one_flight() {
        let singleflight = Singleflight::default();
        let barrier = Arc::new(tokio::sync::Barrier::new(8));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let singleflight = singleflight.clone();
                let barrier = Arc::clone(&barrier);
                tokio::spawn(async move {
                    let flight = singleflight.for_key(Kind::List, "products:list:bits").await;
                    barrier.wait().await;
                    // Compared by address: the raw pointer itself is not `Send`,
                    // and the flight is still alive here.
                    Arc::as_ptr(&flight.lock) as usize
                })
            })
            .collect();

        let mut locks = Vec::new();
        for handle in handles {
            locks.push(handle.await.unwrap());
        }
        let first = locks[0];
        assert!(locks.iter().all(|lock| *lock == first), "flights diverged");
        locks.clear();
    }

    /// The whole point: one fill, not one per waiter.
    #[tokio::test]
    async fn only_the_first_waiter_runs_the_work() {
        let singleflight = Singleflight::default();
        let fills = Arc::new(AtomicUsize::new(0));
        let filled = Arc::new(AtomicBool::new(false));
        let ready = Arc::new(tokio::sync::Barrier::new(16));

        let tasks: Vec<_> = (0..16)
            .map(|_| {
                let singleflight = singleflight.clone();
                let fills = Arc::clone(&fills);
                let filled = Arc::clone(&filled);
                let ready = Arc::clone(&ready);
                tokio::spawn(async move {
                    ready.wait().await;
                    // Exactly the handler's sequence: take the flight, then
                    // re-check, because the leader we waited behind may have
                    // already done the work.
                    let flight = singleflight.for_key(Kind::List, "k").await;
                    let _guard = flight.lock().await;
                    if filled.swap(true, Ordering::SeqCst) {
                        return;
                    }
                    fills.fetch_add(1, Ordering::SeqCst);
                    // Long enough for the other 15 to pile up behind the lock.
                    tokio::time::sleep(Duration::from_millis(25)).await;
                })
            })
            .collect();

        for task in tasks {
            task.await.unwrap();
        }
        assert_eq!(fills.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn distinct_keys_are_not_serialised() {
        let singleflight = Singleflight::default();
        let held = singleflight.for_key(Kind::List, "page-1").await;
        let _guard = held.lock().await;
        // A different key must not queue behind the one already being filled.
        let other = singleflight.for_key(Kind::List, "page-2").await;
        assert!(tokio::time::timeout(Duration::from_millis(50), other.lock()).await.is_ok());
    }

    #[tokio::test]
    async fn kinds_never_share_a_flight() {
        let singleflight = Singleflight::default();
        let list = singleflight.for_key(Kind::List, "same").await;
        let detail = singleflight.for_key(Kind::Detail, "same").await;
        assert!(!Arc::ptr_eq(&list.lock, &detail.lock));
    }

    /// A leader that fails must not leave the key stuck or replay a failure:
    /// the next caller becomes the new leader and runs the work itself.
    #[tokio::test]
    async fn a_failed_fill_leaves_the_key_usable() {
        let singleflight = Singleflight::default();
        let attempts = Arc::new(AtomicUsize::new(0));

        for expected in 1..=2 {
            let flight = singleflight.for_key(Kind::List, "k").await;
            let _guard = flight.lock().await;
            attempts.fetch_add(1, Ordering::SeqCst);
            // First attempt "fails": the guard is dropped by the unwind and
            // nothing is cached, exactly as a 500 leaving the handler looks.
            assert_eq!(attempts.load(Ordering::SeqCst), expected);
        }
    }

    /// Cancellation safety: dropping the leader mid-flight must hand the key on
    /// rather than wedging it, which is the property that rules out a std lock.
    #[tokio::test]
    async fn a_cancelled_leader_does_not_wedge_the_key() {
        let singleflight = Singleflight::default();
        let taken = Arc::new(tokio::sync::Notify::new());

        let leader = {
            let singleflight = singleflight.clone();
            let taken = Arc::clone(&taken);
            tokio::spawn(async move {
                let flight = singleflight.for_key(Kind::List, "k").await;
                let _guard = flight.lock().await;
                taken.notify_one();
                // Parked here forever, then dropped when the task is aborted.
                std::future::pending::<()>().await;
            })
        };

        taken.notified().await;
        leader.abort();
        let _ = leader.await;

        let flight = singleflight.for_key(Kind::List, "k").await;
        assert!(tokio::time::timeout(Duration::from_millis(100), flight.lock()).await.is_ok());
    }

    /// `owned_lock` is the same lock, not a second one: a guard taken through it
    /// has to exclude a guard taken through `lock`, or the batching that needs it
    /// would race the singleflight it replaced.
    #[tokio::test]
    async fn an_owned_guard_excludes_a_borrowed_one() {
        let singleflight = Singleflight::default();
        let flight = Arc::new(singleflight.for_key(Kind::Detail, "k").await);
        let owned = flight.owned_lock().await;

        let mut follower = {
            let flight = Arc::clone(&flight);
            tokio::spawn(async move {
                let borrowed = flight.lock().await;
                drop(borrowed);
            })
        };

        // The follower is queued, not through: it cannot get in while `owned` is
        // held. Dropping is what hands it on.
        assert!(tokio::time::timeout(Duration::from_millis(50), &mut follower).await.is_err());
        drop(owned);
        assert!(tokio::time::timeout(Duration::from_millis(100), follower).await.unwrap().is_ok());
    }

    /// A set of owned guards can be held at once, which is the whole reason the
    /// method exists: one request that resolved several ids keeps every one of
    /// them locked for the length of a single batched statement.
    #[tokio::test]
    async fn many_owned_guards_can_be_held_at_once() {
        let singleflight = Singleflight::default();
        let keys = ["a", "b", "c", "d", "e"];

        let mut guards = Vec::new();
        for key in keys {
            let flight = singleflight.for_key(Kind::Detail, key).await;
            guards.push(flight.owned_lock().await);
        }

        assert_eq!(guards.len(), keys.len());
        // Still exclusive while all of them are held, and released on drop.
        let probe = singleflight.for_key(Kind::Detail, "c").await;
        assert!(tokio::time::timeout(Duration::from_millis(50), probe.lock()).await.is_err());
        drop(guards);
        let probe = singleflight.for_key(Kind::Detail, "c").await;
        assert!(tokio::time::timeout(Duration::from_millis(100), probe.lock()).await.is_ok());
    }

    #[tokio::test]
    async fn entries_are_retired_when_the_last_holder_drops() {
        let singleflight = Singleflight::default();
        {
            let _flight = singleflight.for_key(Kind::List, "k").await;
            assert_eq!(singleflight.flights.lock().await.len(), 1);
        }
        assert_eq!(singleflight.flights.lock().await.len(), 0);
    }

    #[tokio::test]
    async fn dead_entries_are_pruned_once_the_map_grows() {
        let singleflight = Singleflight::default();
        // Held throughout, so it must survive the sweep.
        let live = singleflight.for_key(Kind::List, "live").await;
        {
            // The entry a drop cannot remove: a `Weak` whose flight is already
            // gone, which is what a `try_lock` failure under contention leaves.
            let mut flights = singleflight.flights.lock().await;
            for index in 0..PRUNE_THRESHOLD {
                let gone = Arc::new(Mutex::new(()));
                flights.insert(format!("stale-{index}"), Arc::downgrade(&gone));
            }
        }

        // The next insert sweeps everything with no holder left behind.
        let trigger = singleflight.for_key(Kind::List, "trigger").await;
        assert_eq!(singleflight.flights.lock().await.len(), 2, "only the live entries survive");
        drop(trigger);
        drop(live);
    }
}
