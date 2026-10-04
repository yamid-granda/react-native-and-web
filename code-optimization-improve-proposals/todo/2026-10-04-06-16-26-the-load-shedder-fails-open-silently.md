# The load shedder fails open silently, and leaks a Valkey key every time it does

## Problem / opportunity

`api-rs` names its own scaling threat and its own mitigation, and the mitigation
is one file:

> `ARCHITECTURE.md:50` — "**X4** Connection/pool exhaustion | Concurrency is
> unbounded, so a burst turns into a connection pile-up and acquire waits."

> `ARCHITECTURE.md:102` — "**C4 Deliberate load shedding** | X4, X7 |
> `middleware/rate_limit.rs`: concurrency semaphores (503) + Valkey rps windows
> (429)"

`src/middleware/rate_limit.rs` (364 lines) is therefore not ordinary middleware;
it is the only thing standing between a burst and a primary pool of
`DB_MAX_CONNECTIONS = 10` per instance (`src/config.rs:68`). `ARCHITECTURE.md`'s
own §6 flowchart (`:258-276`) is the design document for it.

It has **five** distinct degradation states. Four of them produce **no metric and
no log**, one of them leaks a permanent key into the very store whose absence
disables the limiter, and the file's core arithmetic has **zero** unit coverage
because it is welded to a concrete socket type. The root cause is uniform: every
fail-open decision here was written as a bare `return` or an `if let` rather than
as a named, counted, testable state.

### 1. The limiter has four outcomes and only three of them are instrumented

`check()` (`rate_limit.rs:84-109`) has three arms, and `enforce` (`:255-271`)
signals two of them:

```rust
// rate_limit.rs:261-269
Verdict::Shed(scope) => {
    metrics::counter!("http_load_shed_total", "scope" => scope).increment(1);
    tracing::warn!(scope, ip = %ip, "shedding load");
    shed_response()
}
Verdict::Limited(scope) => {
    metrics::counter!("http_rate_limited_total", "scope" => scope).increment(1);
    limited_response()
}
```

But there is a **fourth** outcome, and it is silent:

```rust
// rate_limit.rs:89-93
let ip_permit = match self.ip_slots.acquire(ip).await {
    IpPermit::Acquired(permit) => Some(permit),
    IpPermit::Saturated     => return Verdict::Shed("ip-concurrency"),
    IpPermit::Untracked     => None,          // ← no permit, no metric, no log
};
```

`Untracked` (`:183`) is returned from exactly one place:

```rust
// rate_limit.rs:196-199
None => {
    if slots.len() >= self.max_tracked {
        return IpPermit::Untracked;
    }
```

`max_tracked` is a hardcoded `100_000` at `:78` — not a `Config` field, not in the
README env table (`api-rs/README.md:152-177`). Once the registry is full, **every
IP not already in the map gets no per-IP concurrency permit at all**, and the
request proceeds. The per-IP bound is `per_ip_concurrency_limit = 64`
(`config.rs:76`) — the number that exists so one client cannot monopolise the
10-connection pool — and it is simply gone.

The design decision is documented. `ARCHITECTURE.md:289-292` states the cap, the
verdict, and the reasoning ("Registering every spoofed IP would turn a flood of
distinct addresses into blanket 503s for everyone"), and the flowchart labels it
at `:270` ("acquired, or Untracked (cap hit → fail open)"). **What is not
documented and not instrumented is that the state is silent and can persist for
the life of the process.** It appears in no metric, no alert, and no dashboard
panel — `monitoring/grafana/dashboards/api-red.json` charts
`http_rate_limited_total` (`:123`), `http_load_shed_total` (`:128`) and
`rate_limit_errors_total` (`:152`), and `monitoring/rules.yml` has four rules, none
of which can see it. `IpConcurrency` is also never pruned: unlike
`cache/singleflight.rs` (which has both an opportunistic `Drop` reclaim at
`:97-115` and a threshold sweep at `:47-54`), `slots` (`:171`) only ever grows,
so **the cap is one-way** — a process that has been full once stays full for
every new IP until restart.

### 2. Three independent limits key on one client-controlled header

`ip` is computed once per request (`:257`, `:277`) and then used as the key for
three separate limits:

| limit | key | line |
| --- | --- | --- |
| per-IP concurrency semaphore | `slots.insert(ip.to_string(), …)` | `:201` |
| per-IP rps window | `format!("ip:{ip}")` | `:102` |
| login throttle | `format!("auth:{ip}")` | `:116` |

And `ip` comes from a function with **no trusted-proxy check**:

```rust
// rate_limit.rs:216-232
pub fn client_ip(headers: &HeaderMap, peer: Option<&SocketAddr>) -> String {
    if let Some(value) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        …
        return trimmed.to_string();
    }
    if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = value.split(',').next() { … }
    }
    peer.map(|p| p.ip().to_string()).unwrap_or_else(|| "unknown".to_string())
}
```

Both headers are client-supplied. There is no allowlist of trusted proxies and no
comparison against the socket peer, so **rotating one header resets the per-IP
semaphore, the per-IP rps window, and the login throttle simultaneously.** This is
also the mechanism that reaches the §1 cap: the comment at `:291-292` names
"a flood of distinct (possibly spoofed) client IPs" (`:178-179`) as the reason the
cap exists, so the anticipated attack is the one that both fills the registry and
disables the per-IP bound for everyone.

**Stated honestly, this is not a total bypass.** The global semaphore
(`:85-87`, `GLOBAL_CONCURRENCY_LIMIT = 1024` at `config.rs:75`) and the global rps
window (`:96-99`) are keyed on the literal `"global"` and survive header
rotation — `rate_limit_global_rps` defaults to `0`, i.e. disabled
(`config.rs:77`), so in the default configuration the surviving bound is the 1024
global semaphore. The concrete loss is that the two per-IP numbers, 64 and 100,
can be reset by one header, and the login throttle
(`AUTH_LOGIN_ATTEMPTS_PER_MIN = 10`, `config.rs:80`) can be reset by one header.

The `"unknown"` fallback at `:231` deserves one sentence of accuracy rather than
overclaim: `main.rs:69` serves via `into_make_service_with_connect_info::<SocketAddr>()`,
so over TCP `peer` is normally `Some` and `"unknown"` is not reached in production.
It is reached when `ConnectInfo` is absent — i.e. the in-process router the unit
tests build (`app.rs:197-199`), which means those tests all share one bucket by
accident rather than by design.

### 3. `INCR` ok + `EXPIRE` fail leaves a permanent Valkey key — and the bucket changes every second

```rust
// rate_limit.rs:142-160
match count {
    Ok(count) => {
        if count == 1 {
            let expire: redis::RedisResult<redis::Value> = redis::cmd("EXPIRE")
                .arg(&full_key).arg(seconds * 2).query_async(&mut conn).await;
            if let Err(error) = expire {
                record_redis_error("expire", &error);   // recorded, then ignored
            }
        }
        count as u64 > limit
    }
    Err(error) => { record_redis_error("incr", &error); false }
}
```

`full_key` is `format!("api-rs:rl:{key}:{}", now / seconds)` (`:138`). If `INCR`
succeeds and `EXPIRE` fails, that key has **no TTL and never will**. Because the
last component is `now / seconds`, the next request mints a *different* key. So a
sustained `EXPIRE` failure — precisely the degraded-Valkey state the fail-open
matrix is built around — produces **one permanent Valkey key per request per
client per window**, forever, with no reclamation path anywhere in the crate.

The error *is* counted, but the count cannot distinguish this from a transient:

```rust
// rate_limit.rs:163-166
fn record_redis_error(op: &str, error: &redis::RedisError) {
    tracing::warn!(op, error = %error, "rate limiter failed open");
    metrics::counter!("rate_limit_errors_total").increment(1);
}
```

`op` is a **log field, not a metric label**. Compare the sibling in the cache
tier, which does it the other way:

```rust
// cache/l2.rs:117-120
fn record_error(&self, op: &str, error: &redis::RedisError) {
    tracing::warn!(op, error = %error, "L2 cache operation failed; falling through");
    metrics::counter!("cache_l2_errors_total", "op" => op.to_string()).increment(1);
}
```

And the repository's own dashboard agrees — this is the sharpest single citation
in the document, because it shows the omission rather than the intent:

```
monitoring/grafana/dashboards/api-red.json:147  sum by (op) (rate(cache_l2_errors_total[1m]))
monitoring/grafana/dashboards/api-red.json:152  sum(rate(rate_limit_errors_total[1m]))
```

One panel aggregates `by (op)`; the other has nothing to aggregate by. The
`ApiRsValkeyUnavailable` alert (`monitoring/rules.yml:28-31`) watches
`cache_l2_errors_total`, and `ARCHITECTURE.md:312` relies on the `op` label being
present (`cache_l2_errors_total{op="incr-generation"}`). For the limiter, an
operator watching `rate_limit_errors_total` cannot tell a key leak from a single
timed-out `INCR`. The information is collected at `:164` and dropped at the metric
boundary.

### 4. No Valkey means no rate limiting at all, for the life of the process

Both window checks are inside a connection match:

```rust
// rate_limit.rs:95-106
if let Some(conn) = &self.conn {
    if self.global_rps > 0 && window_exceeded(…) { … }
    if self.per_ip_rps  > 0 && window_exceeded(…) { … }
}
```
```rust
// rate_limit.rs:113-121
pub async fn check_auth(&self, ip: &str) -> AuthVerdict {
    let limited = match &self.conn {
        Some(conn) if self.auth_per_min > 0 => window_exceeded(…).await,
        _ => false,
    };
```

With `conn == None` the global window, the per-IP window and **the login
throttle** are all skipped. Only the two in-process semaphores survive. That part
*is* documented — `ARCHITECTURE.md:304` row 1 and `README.md:18` both say so, and
`main.rs:83, 90` warn at boot. What is missing is narrower and real: there is **no
metric** for "this instance is running with no rate limiting", so an operator who
missed one boot line has no way to discover the state later, and §7's row 1 alert
column says "a `warn` log" where every other row names a counter.

There is also **no reconnect**. `RateLimiter.conn` is an `Option<ConnectionManager>`
field (`:30`) built exactly once at `app.rs:50` from `AppState::new`, and never
reassigned anywhere in the crate. A Valkey blip at deploy time silently disables
shared limiting until the process is replaced.

### 5. Five unit tests, all built with `conn = None`, so the limiter's arithmetic has no unit coverage

`rate_limit.rs:286-364` holds five tests. Three construct the limiter with no
connection (`:297`, `:310`, `:321`); the fourth exercises `IpConcurrency` directly
with `max_tracked = 1` (`:332`); the fifth tests `client_ip` precedence (`:345`).
What that leaves untouched:

| symbol | line | unit-tested? |
| --- | --- | --- |
| `window_exceeded` | `:130` | **no** |
| `Verdict::Limited` | `:40` | **no** |
| `check_auth` | `:113` | **no** |
| `AuthVerdict` | `:60` | **no** |
| `limited_response` body shape | `:234` | **no** |
| `shed_response` body shape | `:243` | **no** |
| fail-open branch, `EXPIRE` | `:150` | **no** |
| fail-open branch, `INCR` | `:156` | **no** |

`ARCHITECTURE.md:375` claims `cargo test --lib` proves "limiter verdicts". It
proves two of the three `Verdict` variants, and only the two that need no Valkey.
The one test that does exercise the window — `valkey_backed_rate_limit_returns_429`
(`tests/e2e_products.rs:95-111`), which is the only place the 429 body is asserted
byte-for-byte — is Docker-gated.

**This is a missing test seam, not missing tests.** `window_exceeded` takes
`&ConnectionManager` (`:131`), a concrete type. There is no trait to substitute,
so pure window arithmetic — the `now / seconds` bucketing at `:138`, the
`count as u64 > limit` boundary at `:154` that makes request N+1 the first
rejection, the `seconds * 2` TTL at `:147`, the pre-epoch clock at `:137` — is only
reachable through a real socket. `cache/l2.rs` has the same concrete-`conn` shape
and also has no test module, but there the fail-open is the whole point and the
counters at least carry labels.

### 6. One clock edge, for completeness

`rate_limit.rs:137` — `SystemTime::now().duration_since(UNIX_EPOCH)…unwrap_or(0)`
collapses a pre-epoch clock to bucket `0`, which would put every request into the
same window forever. Not reachable in practice; listed because it is the same
`unwrap_or` pattern as `:150`/`:156` and costs nothing to make explicit while
this file is open.

## Proposed approach

Keep both limits, both verdicts, both windows, the fail-open posture, and
`ARCHITECTURE.md`'s §6 ordering. Change three things: make each degradation state a
named, counted verdict; put a trait behind the Valkey handle so the arithmetic is
testable; and say which proxies are trusted.

### 1. Make `Untracked` a first-class, counted outcome

`Verdict` (`:38-42`) gains a variant, so `enforce` (`:259-270`) signals it the way
it already signals the other two:

```rust
pub enum Verdict {
    Allowed(Permits),
    Shed(&'static str),
    Limited(&'static str),
    /// The per-IP registry is full, so this request ran with no per-IP permit.
    /// Counted, not logged per request: at the cap this is every request.
    Untracked,
}
```

`check()` returns `Verdict::Untracked` instead of falling through to `Allowed`
(`:92`), and `enforce` increments `http_load_shed_total{scope="ip-untracked"}` —
reusing the existing counter so the existing panel (`api-red.json:128`) and the
existing `ApiRsLoadShed` alert (`rules.yml:37`) both start covering it with **no
dashboard or rules change**. That is deliberate: a new metric name would need a new
panel and a new rule, and the operational question ("is the per-IP bound
applying?") is already answered by a panel that exists.

Also make the cap reachable and documented: promote `max_tracked` from the literal
at `:78` to a `Config` field with a row in `api-rs/README.md:152-177`, following
the existing pattern (`config.rs` field + `Default` + `from_env` + `ENV_KEYS` at
`:215-236` + README + a `set(...)`/`assert_eq!` pair in
`from_env_reads_every_documented_key` at `:306-351`).

**And decide the registry's lifetime.** `slots` (`:171`) only grows. Two options,
both defensible, and the reviewer should pick rather than inherit:

- **Reap on idle.** Drop entries whose semaphore has no waiters and no permits
  held, on the same opportunistic-then-threshold pattern `singleflight.rs` already
  uses twice (`:97-115` and `:47-54`). This makes the cap a high-water mark rather
  than a permanent state, which is what makes `Untracked` an *event* instead of a
  *mode*.
- **Keep it one-way and document it as such.** Then §7 gains a row saying the
  per-IP bound is permanently off after the cap is first reached, and
  `ARCHITECTURE.md:289-292` stops reading as a transient safeguard.

Reaping is the better end state and reuses a mechanism this crate has already
written and tested (`dead_entries_are_pruned_once_the_map_grows`,
`singleflight.rs:270`). Say which was chosen.

### 2. Give `window_exceeded` a seam, and label the error counter

Two changes, in this order.

**(a) One trait for "increment a counter, maybe set a TTL".** The window function
uses exactly two commands (`INCR` at `:141`, `EXPIRE` at `:145-148`). Introduce
the narrowest possible interface — narrower than `L2Cache`'s, and deliberately not
a general cache trait:

```rust
/// The two commands `window_exceeded` needs. Narrow on purpose: this is not a
/// cache, and giving it a `get` would invite caching a counter.
#[async_trait]
pub trait CounterStore: Send + Sync + 'static {
    /// `INCR key`, then `EXPIRE key ttl` when this call created the key.
    /// Returns the value *after* increment. `Err` means fail open.
    async fn incr_with_ttl(&self, key: &str, ttl: Duration) -> redis::RedisResult<u64>;
}
```

`ConnectionManager` gets a blanket impl (or a thin newtype wrapping it), so
production behaviour is byte-identical and the E2E test at `tests/e2e_products.rs:95`
still exercises the real path unchanged. A test double returns scripted
`Ok(n)`/`Err` sequences.

That single seam makes five currently-unreachable behaviours assertable under
`cargo test --lib`, with no Docker:

1. request N passes and request N+1 is the first rejection (`count as u64 > limit`, `:154`);
2. `EXPIRE` is issued only on `count == 1` (`:144`) — i.e. the TTL is not refreshed
   on every hit, which is what makes the window a *fixed* window;
3. the key contains `now / seconds`, not `now` (`:138`), and the TTL is
   `seconds * 2` (`:147`);
4. **`EXPIRE` failure does not change the verdict** (`:150-153`) — but see (b);
5. `INCR` failure returns `false`, fail-open (`:156-159`).

**(b) Turn the `EXPIRE`-failure key leak into a named, alerted condition.** This is
the one place where a behaviour change is proposed rather than a label. Today an
`EXPIRE` failure is logged and dropped (`:150-153`), and the key it orphaned has no
TTL. Two options:

- **Preferred — one round trip instead of two.** Replace the `INCR` + conditional
  `EXPIRE` with a single `SET key 1 EX ttl NX` followed by `INCR` when `NX` failed,
  or use `INCR` + `EXPIRE` in one pipeline. A pipelined `INCR`+`EXPIRE` on **every**
  hit (not only `count == 1`) makes the "no TTL" window disappear entirely: the TTL
  is refreshed to `seconds * 2` from the last hit, which for a fixed window keyed
  by bucket is harmless because the key's identity already encodes the bucket. This
  is one extra command on a path that already does two, and it makes the leak
  structurally impossible rather than merely counted.
- **Minimal — count it distinctly.** Add the `op` label the log already carries:
  `metrics::counter!("rate_limit_errors_total", "op" => op)`. Then
  `api-red.json:152` becomes `sum by (op)`, matching `:147`, and an operator can
  separate `op="expire"` from `op="incr"`. Add a `for: 5m` alert on
  `rate_limit_errors_total{op="expire"}` in `monitoring/rules.yml`, separate from
  the existing `ApiRsValkeyUnavailable`.

Take both: (a)'s pipeline removes the leak, (b)'s label makes any future
`EXPIRE`-class failure visible. If the reviewer prefers to change no wire traffic,
(b) alone is still worth landing and is a three-line diff.

### 3. Say which proxies are trusted

`client_ip` (`:216-232`) currently trusts two headers unconditionally. Make the
trust explicit rather than implicit, following the shape
`config.rs` already uses for everything else:

- New `TRUSTED_PROXY_HEADER` (or `TRUST_PROXY_HEADERS`) in `Config`, default
  `"cf-connecting-ip,x-forwarded-for"` so **today's behaviour is the default** and
  nothing changes for an existing deployment.
- When unset/empty, use the socket peer only. This is the correct posture for a
  direct-to-origin deployment, which is what `docker-compose.yml` and local dev
  are.
- Add a `WEB_APPLICATION`/deploy note to `api-rs/README.md` recording that behind
  Cloudflare the header must be trusted *and* that origin access must be locked to
  Cloudflare's ranges, because the header is only meaningful if the edge is the
  only thing that can reach the origin. **This second half is the part that
  actually closes the hole** and it is an operator responsibility, not code.

What this proposal explicitly does **not** claim: that header rotation is an
unbounded bypass. It is not — the global semaphore (`:85`) and the global window
(`:96`) survive, and §2's honest bound is that the *per-IP* limits
(`per_ip_concurrency_limit = 64`, `rate_limit_per_ip_rps = 100`) and
`AUTH_LOGIN_ATTEMPTS_PER_MIN = 10` are all keyed on the same attacker-chosen
string. The global numbers still cap the process.

### 4. Correct the verification claim

`ARCHITECTURE.md:375` lists `cargo test --lib` as proving "limiter verdicts". After
§2 it will be true; today it proves two of three. Either way, the new tests belong
in `rate_limit.rs`'s existing `mod tests` (`:286`) beside
`tracking_cap_fails_open_instead_of_shedding` (`:330`), which is the nearest
neighbour and already establishes the vocabulary.

## Impact

**Scalability — the reason this is worth doing.** `ARCHITECTURE.md:50` names pool
exhaustion as the threat and `:102` names this file as the only mitigation. Today
the mitigation can be removed from under the service four ways — cap reached (`:198`),
Valkey absent at boot (`main.rs:83, 90`), `EXPIRE` failing so keys accumulate
(`:150`), or a client rotating one header (`:217`) — and in three of the four there
is no signal that it happened. The pool itself is `DB_MAX_CONNECTIONS = 10`
(`config.rs:68`), which `ARCHITECTURE.md` makes an explicit operator budgeting
responsibility; this file is the mechanism that budget depends on.

**Consistency.** `rate_limit_errors_total` stops being the only counter in the
crate that discards the `op` it already has in its log line, and
`monitoring/grafana/dashboards/api-red.json:152` stops being the only protection
panel in the repo that cannot break a series down — `:147`, forty-five lines above
it, already does exactly that for the cache tier.

**Testability.** This is the structural gain. `window_exceeded`, `Verdict::Limited`,
`check_auth`, both response-body constructors and both fail-open branches go from
"reachable only with a Docker daemon" to `cargo test --lib`, using a two-command
trait rather than a mock of the whole cache. The nearest precedent is in this
crate: `CountingStore` (`handlers/products.rs:424-425`) already proved the
"instrument the dependency, reach the branch" pattern, and
`2026-10-03-22-37-46-make-the-store-contract-executable.md` step 1 proposes
generalising it.

**Maintainability / AI-developer cost.** Every fail-open branch in this file is
currently a bare `return false` or an `Option` test. An agent asked to "make the
rate limiter stricter" or "audit the load shedding" has to derive all five states
by reading control flow, then decide independently whether each one is
observable — and the answer for four of them is no, which is not discoverable from
the code. After this, the states are enum variants, the same way
`Verdict` already is.

**Performance.** §2(b)'s preferred option adds one pipelined command to a path that
already issues two, on the rps check — negligible next to the query it guards, and
only on requests that pass the concurrency semaphores first. Everything else is
instrumentation: one counter increment on the `Untracked` path, one label on an
existing counter. **No new round trip is added to any hot path**, and this proposal
does not claim a latency win.

**What does not improve.** The fixed-window algorithm keeps its boundary burst —
`window_exceeded`'s doc comment (`:124-129`) says the design out loud, and a
client can send `limit` at the end of one bucket plus `limit` at the start of the
next. A sliding window or token bucket is a different proposal. `main.rs` still
has no reconnect: a Valkey blip at boot still disables shared limiting for the
process, and §2 does not add reconnection — it makes the state countable.
`rate_limit_global_rps` still defaults to `0`, so the global rps window is off by
default and the surviving global bound is the 1024 semaphore. The 429 and 503
bodies still carry no `Retry-After` (`:240`, `:249`). `cache/l2.rs` has the same
concrete-`conn` shape and the same absence of tests and is **not** touched here.
Nothing in `web-application`, `mobile-application` or `components-library` changes,
so no frontend suite is evidence either way.

## Risks / trade-offs

- **The `CounterStore` trait is a new abstraction in a crate that has been very
  careful about its abstractions.** It is deliberately narrower than `L2Cache`'s
  surface — two commands, no `get`, with the reason in the doc comment — but a
  reviewer may reasonably prefer to leave `window_exceeded` alone and accept
  Docker-only coverage, given that `tests/e2e_products.rs:95-111` already asserts
  the real 429 path end to end. The argument for the trait is that the uncovered
  behaviours are not the 429; they are the two fail-open arms and the key format,
  and none of those are what that E2E test exercises.
- **Pipelining `EXPIRE` on every hit is a wire-behaviour change** to a live code
  path. It is strictly safer than today (a TTL is refreshed instead of possibly
  absent) but it is not free: it makes every request issue two commands where the
  steady state issues one after the first hit in a bucket. Take it as its own
  commit, after the label, and measure `rate_limit_errors_total` before and after.
  If it regresses, the label alone still closes the observability half.
- **`Untracked` becoming `Verdict::Untracked` is technically a behaviour change**:
  `enforce` must decide what to do with it. Recommended: **allow the request and
  count it**, which is today's behaviour plus a counter — not a new 503. Returning
  503 would reintroduce exactly the blanket-shedding the cap exists to avoid
  (`ARCHITECTURE.md:291-292`).
- **Reaping `IpConcurrency` is a behaviour change to a live lock map.** It must
  never remove an entry whose semaphore still has permits held or waiters queued,
  or an in-flight request loses its permit accounting. Reuse the two-part
  `singleflight.rs` shape (`strong_count()`-style liveness at `:109-113`, threshold
  sweep at `:48-50`) rather than inventing a third mechanism. **If this is judged
  too risky, keep the one-way map and take the §7 documentation row instead** —
  the observability half stands on its own.
- **Making proxy trust configurable adds a config key**, which per
  `config.rs:197-216` is five edits in three files plus a README row. The default
  must be today's behaviour or this becomes a silent security tightening on
  deployments that have not thought about it.
- **"Close the origin to Cloudflare's ranges" is an operator action this
  repository cannot verify.** It should be written into `api-rs/README.md`, and the
  proposal should be explicit that the code change alone does not achieve it.
- **Scope.** The 408 body bypassing `ErrorBody` (`app.rs:97`), the
  `error.rs` status/body two-match drift, the missing `Cache-Control` metric
  descriptions in `telemetry.rs:65-82`, and `cache/l1.rs`/`l2.rs` having no test
  modules are all real, all separate, and none of them belongs here.

## Validation

1. `pnpm --filter @rnw/api-rs test` — the cheapest gate, and the one this proposal
   exists to move. The five existing tests in `rate_limit.rs:286-364` must pass
   **unchanged**; the new `CounterStore`-backed tests for window arithmetic, the
   `EXPIRE`-only-on-`count == 1` rule, the key's bucket component, and both
   fail-open arms must pass. Before the trait lands, in a scratch branch, confirm
   each of those five is genuinely unreachable — that is the baseline claim.
2. **Negative check**, in a scratch branch: make `EXPIRE` always fail in the
   double and confirm (a) the verdict is unchanged (today's behaviour, `:150-153`)
   and (b) `rate_limit_errors_total{op="expire"}` fires while
   `rate_limit_errors_total{op="incr"}` does not. If both ops report the same
   number, the label is not doing its job.
3. **Negative check for §1**, in a scratch branch: construct a `RateLimiter` whose
   `max_tracked` is 1, hold the first IP, then request a second IP and assert
   `http_load_shed_total{scope="ip-untracked"}` increments **and the response is
   still 200**. The 200 is the half that matters: it proves the instrumentation did
   not turn a fail-open into a blanket shed.
4. `pnpm --filter @rnw/api-rs test:e2e` (needs Docker) — run this **first**, not
   last, because `tests/parity.rs` byte-compares committed goldens and
   `tests/e2e_products.rs:95-111` asserts the 429 body exactly. `e2e_auth.rs:198-258`
   covers the login throttle scoped and fail-open. These three must pass **unchanged**
   through steps 2(a) and 2(b) — they are the check that the trait and the pipeline
   are behaviour-preserving on the real socket.
5. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings`. A new `#[async_trait]` trait plus a
   `redis::RedisResult` in its signature is clippy-relevant.
6. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate must still pass.
   `rate_limit.rs` is 364 lines of which `window_exceeded` + `check_auth` + both
   response constructors are currently exercised only by Docker-gated tests, so
   this should *rise* once the double exists.
7. **Mechanical checks, before and after** — the same shape as the evidence above:
   ```bash
   grep -n 'metrics::counter!\|tracing::warn!' api-rs/src/middleware/rate_limit.rs
   grep -n '"expr"' monitoring/grafana/dashboards/api-red.json | grep -i 'rate_limit\|errors'
   grep -c 'tokio::test\|#\[test\]' api-rs/src/middleware/rate_limit.rs
   ```
   Success is not "zero warnings": it is that every degradation branch in
   `rate_limit.rs` appears in the first command's output, that both error panels
   aggregate `by (op)`, and that the test count goes from 5 to ~12.
8. `pnpm --filter @rnw/api-rs bench` before and after step 2(b) — the pipeline adds
   one command to the rps path, and `benches/handlers.rs` does not exercise
   `rate_limit.rs`, so **do not expect this number to move**. Say so rather than
   reading a flat result as proof.
9. `k6 run load-tests/k6/spike.js` — optional, not a gate, and honestly scoped:
   no scenario in `load-tests/k6/` sets or asserts on rate limiting, so this will
   not observe any of the above. It is listed only to record that the change was
   not load-tested, rather than implying it was.
10. Not required, and honestly so: nothing here touches `web-application`,
    `mobile-application` or `components-library`, so no frontend suite is evidence
    either way.

## Related proposals

- **None is superseded, and none claims this.** The novelty grep is
  ```bash
  grep -rin "rate_limit\|rate limit\|429\|load shed\|load-shed\|X-Forwarded\|CF-Connecting\|client_ip" \
    code-optimization-improve-proposals/ improve-proposals/
  ```
  and it returns ~19 hits across 6 documents. Seventeen are incidental — `429` inside
  `OFFSET 4294967276`, "429s" as a k6 target, "rate limiting" as a feature in the
  Rust rewrite. **Two are substantive prior use of this file, and neither claims
  anything in this document:**
  - `2026-10-04-04-06-14-the-session-table-has-no-reaper.md:312` cites
    `rate_limit.rs:163-166` as the *shape* of fail-open logging to imitate. This
    proposal says that same function is where an `op` label goes missing — a claim
    about it, not a use of it (cited again below).
  - `improve-proposals/2026-10-03-seller-storefronts-my-store.md:115` cites
    `rate_limit.rs:199-215` and `client_ip` at `rate_limit.rs:160` as
    pre-existing infrastructure it reused in order to add `enforce_auth`. It is
    the only prior proposal to *edit* this file. It claims none of §1–§5: the
    `Untracked` silence, the `EXPIRE` key leak, the three-limits-one-header keying,
    and the missing test seam are all untouched by it. Worth noting that its two
    line citations are now stale — the window is at `:130` and `client_ip` at
    `:216` in the 364-line file — which is this proposal's own thesis in miniature
    and is not counted as a finding.
- **`2026-10-04-04-06-14-the-session-table-has-no-reaper.md` — the closest
  structural precedent, and it deferred this without evidence.** Its Risks section
  names `middleware/session.rs`'s single-error 401 and `api-rs`'s
  `auth_login_total` metric as "real and separate", and its Impact section makes
  the argument this document then makes about a *different* file: "**three separate
  files describe a reaper that does not exist**", with the conclusion that this is
  "the expensive kind of knowledge for an agent". This document finds the same
  shape in `rate_limit.rs` — `ARCHITECTURE.md:289-292`, the §6 flowchart at `:270`
  and the doc comment at `:178-179` all describe an `Untracked` state that nothing
  can observe — and reaches for the same remedy. Neither file is touched by the
  other; ordering does not matter.
- **`2026-10-03-22-37-46-make-the-store-contract-executable.md` — related, not
  superseded, and its step 1 is the pattern this proposal reuses.** Its item 1
  generalises `CountingStore`'s private failure switches (`handlers/products.rs:424-425`)
  onto the shared double so `/health`'s unreachable arms become unit-testable. This
  proposal does the same thing one layer out: a narrow trait so the limiter's
  unreachable arms become unit-testable. **Neither claims the other's file** —
  `store/memory.rs` is not touched here, and no `CountingStore` edit is needed.
  That proposal's claim that "274 lines of double are tested by using them" is the
  same argument this one makes about why the concrete `ConnectionManager` at `:131`
  is the problem.
- **`2026-10-03-22-34-46-one-read-path-for-the-product-lists.md` — related, not
  superseded, and the only document that cites anything in this file.** Its
  Impact section cites `rate_limit.rs:163-166` once, purely as a *shape reference*
  for what fail-open logging already looks like — the `tracing::warn!` plus counter
  pair. This proposal says that same function is where an `op` label goes missing,
  which is a claim about it rather than a use of it. Its proposed
  `product_headers` `pub(crate)` change and optional pre-parsed `Config`
  `HeaderValue` are adjacent in spirit (config parsed once, not per request) and
  both are unaffected.
- **`2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`,
  `2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`,
  `2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`,
  `2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`,
  `2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`,
  `2026-10-04-05-04-58-the-design-tokens-have-no-owner.md` — unrelated surfaces**
  (per-app route files, platform splits, bundler/test config, client react-query
  cache, persisted zustand stores, design tokens). None touches `api-rs` server
  middleware. `2026-10-04-02-19-04-…`'s step 3 hoists `MyStoreApi` into each app's
  api module and notes the app-module boundary is "the same boundary this proposal
  crosses from the other side" as the token proposal; that is about client/server
  package boundaries, not middleware.
- **`improve-proposals/implemented/2026-10-02-23-01-api-rs-deferred-scale-gaps.md`
  — unrelated, with one shared precedent.** Item 1 built the singleflight that
  this proposal's optional `IpConcurrency` reaping would mirror, and its item 2.3
  read-replica work is untouched. Its §"Non-goals" rule — "no cached value,
  counter, or limiter is worth a failed request" — is exactly the fail-open
  posture this proposal preserves rather than tightens. The authentication-limit
  scope rule it and `2026-10-03-seller-storefronts-my-store.md:116` both state
  ("a per-*account* throttle is not available on an unauthenticated endpoint
  without already telling the caller which accounts exist") is why §3 changes the
  *trust* in the key rather than proposing an account-keyed limit.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md` — related, not
  superseded.** Its §3 specified the `AUTH_LOGIN_ATTEMPTS_PER_MIN` scope rule and
  the fail-open posture recorded at `:116`; this proposal does not reopen either,
  it makes the second one countable and the key's trust explicit.