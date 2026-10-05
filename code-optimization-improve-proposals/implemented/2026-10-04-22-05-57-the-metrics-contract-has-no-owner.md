# The metrics contract has no owner, so `/metrics` emits `# TYPE` for 21 series and `# HELP` for none

## Problem / opportunity

`GET /metrics` is the only machine-readable contract api-rs has with its
operators. What it contains is decided by **string literals at 21 emission sites
in Rust**. Its two consumers restate 14 of those names, plus six label names, in
two files of two other formats. Nothing checks either direction, and the one
attempt to give a metric an owner is dispatched to a no-op recorder and thrown
away.

`docker-compose.yml:30-60` runs Prometheus and Grafana in the local stack
precisely so this surface is watchable, and `monitoring/prometheus.yml` plus
`monitoring/rules.yml` are mounted into the Prometheus container
(`docker-compose.yml:42-43`). The stack is real. The contract it consumes is not
owned by anything.

### 1. The one `describe_*` in the crate can never reach `/metrics`

```rust
// api-rs/src/telemetry.rs:65-82
pub fn init_metrics() -> Option<PrometheusHandle> {
    // Described up front so the series exists — at zero — before the first login
    // ever happens. A brute-force attempt is invisible until someone looks, and
    // "the counter is missing" and "nobody has tried to log in" must not look the
    // same on a dashboard. This is the reason the per-IP login throttle exists.
    metrics::describe_counter!(
        "auth_login_total",
        metrics::Unit::Count,
        "Password login attempts by outcome: result=ok|invalid"
    );
    match PrometheusBuilder::new().install_recorder() {
```

`describe_counter!` runs at `:70`, `install_recorder()` at `:75`. In the pinned
dependency that ordering loses the description. `metrics-0.24.6`
(`api-rs/Cargo.lock` → `metrics 0.24.6`) resolves the recorder eagerly at the
call site:

```rust
// metrics-0.24.6/src/recorder/mod.rs:227-241
pub fn with_recorder<T>(f: impl FnOnce(&dyn Recorder) -> T) -> T {
    LOCAL_RECORDER.with(|local_recorder| {
        if let Some(recorder) = local_recorder.get() { … }
        else if let Some(global_recorder) = GLOBAL_RECORDER.try_load() { f(global_recorder) }
        else { f(&NOOP_RECORDER) }        // ← :238, nothing is installed yet
    })
}
```

and `NOOP_RECORDER`'s `describe_counter` is an empty body
(`metrics-0.24.6/src/recorder/mod.rs:379-385`). The description goes nowhere.

The exporter side closes the loop. `metrics-exporter-prometheus 0.18.3` writes
`# HELP` from a map owned by the recorder instance:

```rust
// metrics-exporter-prometheus-0.18.3/src/recorder.rs:142-153
fn render_to_write(&self, output: &mut impl io::Write) -> io::Result<()> {
    let Snapshot { mut counters, … } = self.get_recent_metrics();
    self.commit_outstanding_description_writes();
    let descriptions = self.read_handle();                       // :148
    for (name, mut by_labels) in counters.drain() {
        let unit = descriptions.get_one(name.as_str()).and_then(|entry| {
            let (desc, unit) = &*entry;
            write_help_line(&mut intermediate, name.as_str(), unit, …, desc);   // :153
```

`read_handle()` (`:319-324`) reads `descriptions_rd`, and `describe_counter`
(`:370-372`) writes `descriptions_wr` through `add_description_if_missing`
(`:344-360`). Both handles are constructed **inside** `install_recorder()`
(`exporter/builder.rs:610`, `:624-625`). They are two halves of one pair owned by
one instance. A description handed to a different recorder — or to none — can
never appear in `render()`.

**So `/metrics` today emits `# TYPE` for every series and `# HELP` for none.**
`grep -rn 'describe_' api-rs/src api-rs/tests` returns exactly one hit,
`telemetry.rs:70`.

### 2. The comment at `telemetry.rs:66-69` is false three ways, and its goal is unreachable

Read against the same exporter source:

| the comment says | the exporter does |
|---|---|
| "Described up front so the series exists — at zero" | `add_description_if_missing` (`:344-360`) writes only to `descriptions_wr`. It never touches the counters registry — `register_counter` (`:382-385`) is what does. So a described counter is **not** rendered until something increments it, even with the ordering fixed. |
| "'the counter is missing' and 'nobody has tried to log in' must not look the same" | The two are indistinguishable, and describing does not change that: absent series and zero-value series are the same absence. The distinction this comment wants needs either an initialised-at-zero registration or a rule, not a description. |
| "This is the reason the per-IP login throttle exists" | `auth_login_total` (`handlers/auth.rs:118`, `:121`) is referenced **nowhere** in `monitoring/` — verified: `grep -rn 'auth_login' monitoring/` returns no hits. Not on a panel, not in a rule. |

The third row is the sharpest. `improve-proposals/2026-10-03-seller-storefronts-my-store.md:118`
asked for that counter and gave the reason: *"the reason the limiter exists is to
be observable"*. The counter shipped; the observability did not; and the comment
in `telemetry.rs` is the only place that says so, in the wrong direction.

### 3. Twenty-one names in Rust, fourteen in monitoring, and no check in either direction

Reproduce with step 1 in **Validation**:

| | count |
| --- | --- |
| distinct metric names emitted by `api-rs/src` | **21** |
| distinct names referenced by `monitoring/` | **14** |
| emitted but referenced by nothing | **7** |
| referenced but emitted by nothing | **0** |

The seven with no consumer: `auth_login_total`, `cache_l2_writes_total`,
`cache_list_generation_bumps_total`, `cache_singleflight_leader_total`,
`cache_singleflight_follower_total`, `cache_singleflight_wait_seconds`,
`session_cleanup_errors_total`.

The last number is the one that keeps this honest: **there is no dead panel
today.** Every name `api-red.json` and `rules.yml` reference exists in Rust, so
this is not a broken dashboard. The asymmetry runs one way, and the direction it
runs is that new instrumentation is invisible to operators by default.

### 4. Label names are the same unowned contract, and drifting them fails silently

`rules.yml` and `api-red.json` select and aggregate on six label names, and every
one is declared only at a Rust call site:

| consumer | depends on | declared at |
| --- | --- | --- |
| `rules.yml:13` — `http_requests_total{status=~"5.."}` | `status` | `app.rs:163`, `:170` |
| `rules.yml:40` — `rate_limit_errors_total{op="expire"}` | `op` | `rate_limit.rs:247` |
| `api-red.json:36`, `:41` — `by (le, route)` | `route` | `app.rs:162`, `:169` |
| `api-red.json:118` — `by (status)` | `status` | `app.rs:163` |
| `api-red.json:123`, `:128` — `by (scope)` | `scope` | `rate_limit.rs:358`, `:363`, `:371`, `:387` |
| `api-red.json:147`, `:152` — `by (op)` | `op` | `l2.rs:119`, `rate_limit.rs:247` |

Rename `"status"` to `"code"` at `app.rs:163` and `ApiRsHighErrorRate`
(`rules.yml:12-18`, `severity: critical`) stops matching anything. The expression
does not error, the rule does not fire, no test fails, and the dashboard's error
panels silently go flat. Nothing in the repository would notice — which is a
worse failure mode than the `# HELP` line, because a missing `# HELP` is visible
in a scrape and a dead alert is not.

### 5. `/metrics` has exactly one test, and it asserts the 503

```rust
// api-rs/src/app.rs:449-455
#[tokio::test]
async fn metrics_endpoint_unavailable_without_recorder() {
    let response = router(test_state()).oneshot(…uri("/metrics")…).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
```

That is the only `/metrics` assertion in the repository, and it covers
`metrics_handler`'s `None` arm (`app.rs:182-184`). Every harness passes
`metrics: None` — `tests/common/mod.rs:223`, `:336`, `:357` and
`benches/handlers.rs:45`, `:55` — so the `Some` arm (`:178-181`) is unreachable
from any test. No assertion anywhere covers a metric name, a label set, a
`# HELP` line, or a counter value.

This is a recorded fact, not a new complaint:
`implemented/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md:447-448`
states that its double-count gate "was **not** added: the test stack installs no
metrics recorder, so `/metrics` returns 503 under `tests/common/`". That proposal
had to leave a verification step undone because of this gap. It is the seam.

### 6. Two of the twenty-one names are not literals at the emission site

```rust
// api-rs/src/cache/l1.rs:43-44
let name = if hit.is_some() { "cache_l1_hits_total" } else { "cache_l1_misses_total" };
metrics::counter!(name, "kind" => kind.as_str()).increment(1);
```

```rust
// api-rs/src/cache/singleflight.rs:63-66
metrics::counter!(
    if leader { "cache_singleflight_leader_total" } else { "cache_singleflight_follower_total" },
    "kind" => kind.as_str(),
)
```

Both pairs are on the dashboard (`api-red.json` charts `cache_l1_hits_total` and
`cache_l1_misses_total`). A parity check has to read these rather than grep for a
literal at the macro, and this is called out now so the check is written for it
rather than discovered by it.

### Why this is the expensive kind of knowledge

An agent asked to *"add a counter for X"* — which three queued feature proposals
want (`improve-proposals/2026-09-29-product-ratings-and-reviews.md` invalidation
visibility, `…-order-history.md`, `…-15-22-coupon-discount-codes.md`) — writes a
`metrics::counter!` at a call site, sees `pnpm --filter @rnw/api-rs test` green,
and reports the metric as shipped. It is not observable. Making it observable
requires knowing that `monitoring/grafana/dashboards/api-red.json` and
`monitoring/rules.yml` are the consumer side, that a panel *and* possibly a rule
must be added, and that nothing will fail if that is forgotten.

The inverse is worse. An agent asked to *"rename `status` to `code` on the HTTP
metrics"* has no way to discover that `rules.yml:13` filters on it and that a
critical alert depends on the spelling. This is the repository's own established
failure class — a contract stated in one place and relied on in another with
nothing connecting them — and it is the eighth instance. The common remedy is
already recorded in
`implemented/2026-10-04-11-38-54-the-web-storage-fallback-is-written-but-never-read.md:226-227`:
*make the contradiction a test failure instead of a comment.*

## Proposed approach

Keep all 21 emission sites where they are, keep every metric name and label value
byte-identical, keep both monitoring files as files. Change two things: who owns
the names, and whether the one owner that was tried actually reaches the exporter.

### 1. `api-rs/src/telemetry.rs` — make the description reach the exporter, and say what it actually does

Move the `describe_counter!` **after** `install_recorder()` succeeds, so it is
dispatched to the recorder that renders. Because `install_recorder()` can fail
(`:76-80`), the honest shape is:

```rust
pub fn init_metrics() -> Option<PrometheusHandle> {
    match PrometheusBuilder::new().install_recorder() {
        Ok(handle) => {
            describe_api_metrics();
            Some(handle)
        }
        Err(error) => { eprintln!("metrics recorder not installed: {error}"); None }
    }
}

/// Every series `/metrics` can emit, in one place.
///
/// Descriptions are dispatched to whichever recorder is installed *at the time
/// this runs*, so this must be called after `install_recorder()` — the exporter
/// keeps its description map per recorder instance, and a description handed to
/// the no-op recorder is discarded. It is not dropped silently.
fn describe_api_metrics() {
    metrics::describe_counter!("auth_login_total", metrics::Unit::Count,
        "Password login attempts by outcome: result=ok|invalid");
    …
}
```

**The `telemetry.rs:66-69` comment must be rewritten, not moved.** As established
in §2, describing a counter does not create a zero-valued series in this
exporter, so the comment's stated goal needs a different mechanism. Two honest
options, and the reviewer should pick rather than inherit:

- **(a) Recommended — delete the "exists at zero" claim** and state the real one:
  the description documents `auth_login_total` on `/metrics` for anyone reading
  a scrape, and the reason a brute-force attempt must be *alarmed on* rather than
  merely described is §2's fourth row: add a panel (step 2).
- **(b) Make the claim true** by registering the counter at zero. This needs
  `metrics::counter!("auth_login_total").increment(0)` after the recorder is
  installed, which is a real idiom but should be verified against this exporter
  before being relied on — `register_counter` (`:382-385`) creates the series, so
  one `increment(0)` should be enough. If it works it is strictly better, and the
  comment stays true.

### 2. Give `auth_login_total` a consumer, or record that it has none

`improve-proposals/2026-10-03-seller-storefronts-my-store.md:118` asked for this
counter *because* the login throttle must be observable. Today it is in no panel
and no rule, so the feature proposal's own stated purpose is unmet.

- **Add a panel** to `api-red.json` next to the other two limiter panels
  (`:123`, `:128`): `sum by (result) (rate(auth_login_total{result="invalid"}[5m]))`.
- **Consider a rule** — a sustained `result="invalid"` rate is the signal the
  throttle exists to bound, and `rules.yml` already has six rules with no login
  coverage. **This is an operational decision, not a refactor**: the right
  threshold is a judgement call, and `rules.yml` is where that judgement is
  recorded. Say which was chosen; if no rule is added, say so in the comment
  rather than leaving the counter's purpose asserted and unmet.

### 3. One owner for the names, and one parity check — the shape this repo has already chosen twice

New `api-rs/src/metrics_names.rs`, **strings and arrays only**, no crate imports,
so it is loadable from a test and from nothing else:

```rust
/// Every metric name api-rs emits, and the label keys each one carries.
///
/// Two owners exist for this contract and they are 21 Rust call sites away from
/// each other: the `metrics::counter!` / `gauge!` / `histogram!` macros, and
/// `monitoring/grafana/dashboards/api-red.json` + `monitoring/rules.yml`. A
/// rename in one place silently stops a Prometheus rule matching, so the names
/// live here and the parity test below compares both sides against this list.
///
/// The `cache_l1_*` and `cache_singleflight_*` pairs are selected at runtime
/// (`cache/l1.rs:43`, `cache/singleflight.rs:64`) — both spellings are listed.
pub struct Metric { pub name: &'static str, pub labels: &'static [&'static str] }

pub const HTTP_REQUESTS: Metric = Metric { name: "http_requests_total",
    labels: &["method", "route", "status"] };
…
```

Then, at each emission site, replace the literal with the constant
(`metrics::counter!(HTTP_REQUESTS.name, …)` is not possible without a macro, so
either a tiny `counter!` wrapper or the constant's `.name`). **Decision belongs in
review**: if the ergonomics are worse than the literal, keep the literals and
ship only the test in step 4 — a test that catches the drift, with no new owner
to drift. That is the same fallback
`implemented/2026-10-04-05-04-58-the-design-tokens-have-no-owner.md:365-368`
takes for its `tokens.ts`.

### 4. The parity check, in the discipline `Button.centralization.test.ts` already models

New `api-rs/tests/metrics_contract.rs` (a `tests/` integration target, so it
compiles under `cargo test --all-targets` and can read the repository's own files
by path — the pattern `Button.centralization.test.ts:15-24` uses for its
allowlist). Four assertions, each unwritable today:

1. **Every metric name in `api-rs/src` is in the owner's list**, and every entry
   in the list appears in `api-rs/src`. Bidirectional, so neither a new metric
   nor a deleted one can pass unnoticed. This assertion must handle the two
   runtime-selected pairs of §6 — read the file text, not just the macro
   arguments.
2. **Every label key each metric declares is in the owner's list.** This is the
   assertion that catches a `status` → `code` rename, which §4 shows would
   silently kill a critical alert.
3. **Every metric name referenced by `monitoring/` is emitted by `api-rs/src`,
   and every name in `monitoring/`'s PromQL appears in the owner's list.** This
   is the one that fails today if the owner is written from the monitoring side
   first, and it is the assertion that would have caught the seven unreferenced
   names — as an **allowlist with a reason per entry**, the
   `Button.centralization.test.ts:15-24` shape, plus the companion assertion from
   `:63-70` that no entry has gone stale.
4. **`auth_login_total` is referenced by `monitoring/`.** One line, and it is the
   assertion that makes step 2 permanent rather than a one-time edit. If a
   reviewer decides the counter legitimately has no panel, this assertion becomes
   the single documented allowlist entry instead of disappearing.

### 5. Make the `Some` arm of `metrics_handler` reachable, or state that it is not

`app.rs:176-186` renders or 503s, and every harness passes `None`. Two options:

- **Recommended — a hermetic test in `app.rs`'s own `mod tests`**, beside
  `:449-455`: build a state whose `metrics` is `Some(handle)` from a
  `PrometheusBuilder::new().install_recorder().unwrap()`, emit one counter, and
  assert the rendered body contains the name. **Caveat that must be checked
  first, and it is the reason this is step 5 and not step 1:** `install_recorder()`
  installs a *process-global* recorder and fails if one is already installed, so
  this test cannot coexist with any other in the same binary. Verify, and if it
  cannot, keep the assertion in `tests/metrics_contract.rs` as a separate target.
- **Or state the limit** in `app.rs`'s doc comment and leave `:449-455` as the
  only `/metrics` test. Weaker, and should be recorded rather than assumed.

### What this deliberately does not do

- **No metric is renamed, added or removed.** No label value changes. Every
  name in this document survives the change byte-identical, so no dashboard or
  rule needs editing except the additions in step 2.
- **No new dashboard panel beyond `auth_login_total`, and no new alert rule**
  without an explicit decision. Steps 3-4 make the *existing* surface safe.
- **`monitoring/prometheus.yml` and `monitoring/otel-collector.yml` are
  untouched.** They are scrape config and an OTel pipeline, not a metric-name
  contract, and `cloudflare.md` is documentation.
- **The 80% coverage gate, the goldens, and every response body are
  unaffected.** No request path changes.
- **This does not make `monitoring/` generated.** It makes the two sides
  comparable, which is the weaker and more durable guarantee — the same trade
  `implemented/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md:298-312`
  makes when it derives seven goldens instead of generating the dashboard.

## Impact

**Observability — the reason this is worth doing.** Twenty-one metric names and
six label names stop being a contract asserted in Rust and hoped for in YAML and
JSON. A rename that would silently disable `ApiRsHighErrorRate`
(`rules.yml:12-18`, `severity: critical`) becomes a red test. A counter that is
invisible to operators becomes one an assertion will not let you ship.

**Consistency.** `# HELP` goes from zero series to all of them, so a `/metrics`
scrape is self-describing — which matters more here than usual, because the
scrape is the artifact a Grafana Cloud free-tier deploy and a local
`docker compose` stack both consume, and neither carries documentation of what
the names mean.

**Maintainability / AI-developer cost — the point of this exercise.** The answer
to "is this metric actually observable?" is currently "grep `monitoring/` and
hope", spread across a Rust macro call site and two configuration files, with a
`describe_counter!` in between that looks like it would have told you. After
this it is one list plus one test, and the three queued feature proposals that
want to add counters get an answerable question instead of a silent default.

**Performance.** None, and none is claimed. One extra map write per described
metric at boot (21 entries, once, in a function that already installs a recorder).
No request-path work, no allocation on the hot path, no change to what
`render()` produces for any existing series.

**What does not improve, stated plainly.**

- **Seven metrics still have no consumer.** This proposal makes the asymmetry
  *visible* and lets step 4's allowlist record a reason per entry; it does not
  add seven panels. `cache_list_generation_bumps_total` and
  `cache_singleflight_wait_seconds` arguably should have one, and deciding that
  is an ops call, not a refactor.
- **No test can see an actual counter value in production.** The parity check
  compares names and label keys as text. It proves the contract is consistent,
  not that a number is right — that still needs a scrape.
- **The global-recorder constraint in step 5 may make the `Some`-arm test
  impossible** in the `api-rs` test binary. If so, `/metrics` keeps exactly one
  assertion, and the honest outcome is to say so in `app.rs` rather than to
  pretend otherwise.
- **`mobile-application` still has no unit test runner**, so no half of this is
  verifiable there. Nothing in this proposal touches `web-application`,
  `mobile-application` or `components-library`, so no frontend suite is evidence
  either way.
- **The `# HELP` for the two runtime-selected pairs is registered twice** if the
  owner lists both spellings, which is correct but slightly redundant. The
  alternative — a description per resolved name at the call site — puts the
  description back where the name is chosen, and is defensible.

## Risks / trade-offs

- **Step 1 changes what `/metrics` emits**, which is a behaviour change on an
  operator-visible surface. It is additive (`# HELP` lines appear where there
  were none) and cannot change any sample value, but it *will* change the bytes
  of a scrape, so anything diffing scrape output byte-for-byte would notice.
  Nothing in the repository does.
- **Reading the owner's list into emission sites (§3) can be ergonomically
  worse than the literal.** A `&'static str` constant in a macro argument is
  fine; a struct with a label array may need a wrapper macro. **If it is worse,
  keep the literals and ship only step 4's test.** A test with no new owner is
  strictly better than today and strictly weaker than an owner plus a test, and
  the choice should be recorded either way.
- **Step 4's assertion 3 will fail on day one** if the owner is written from the
  Rust side, because seven names are unreferenced. That is the finding, not a
  broken test — but it means the allowlist must land *with* the test, with a
  reason per entry, or the suite ships red and gets disabled. Say which of the
  seven get a panel, which get a documented "instrumented for future use", and
  which are genuinely dead.
- **This touches `monitoring/`, which no proposal has ever proposed changing.**
  The load-shedder proposal cites `api-red.json:147-152` and `rules.yml` eight
  times as *evidence* and, in its implementation, added
  `ApiRsRateLimitWindowTtlFailing` (`rules.yml:36-45`) as a consequence of its
  own step 2(b). So the files are not sacred — but this is the first proposal
  whose *subject* they are, and a reviewer should hold it to that.
- **`install_recorder()` is process-global and one-shot.** Any step-1 test that
  calls it will make every other test in the same binary see a different global
  recorder. This is why step 5 is last and why its caveat is stated first.
- **Scope.** The `Untracked` fail-open state, the fixed-window boundary burst, the
  absent reconnect and the 429/503 `Retry-After` header are
  `implemented/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md`'s and
  are closed. `ProductCard`'s composite-control naming is
  `todo/2026-10-04-20-47-50-the-label-component-does-not-label-the-input.md`'s
  excluded scope. The `MAX_TITLE_LENGTH` mirror, the `Request`/`Response` body
  limit on `by-ids`, and `ProductPatch::is_empty`'s second death are all real
  and all separate. None of them belongs in this diff.

## Validation

1. **Reproduce §3, before any change.** This is the command that produces the
   21 / 14 / 7 / 0 table, and it is the premise of the whole proposal:
   ```bash
   cd /Users/yami/Desktop/projects/react-native-and-web
   grep -rhoE '"(http|cache|auth|rate_limit|sqlx|session|process)_[a-z0-9_]+"' api-rs/src \
     | tr -d '"' | sort -u > /tmp/emitted.txt
   grep -rhoE '\b(http|cache|auth|rate_limit|sqlx|session|process)_[a-z0-9_]+' monitoring/ \
     | sed -E 's/_(bucket|count|sum)$//' | sort -u > /tmp/monitored.txt
   wc -l /tmp/emitted.txt /tmp/monitored.txt          # 21 and 14 today
   comm -23 /tmp/emitted.txt /tmp/monitored.txt       # the 7 unreferenced
   comm -13 /tmp/emitted.txt /tmp/monitored.txt       # empty today — say so
   ```
   If the last command is *not* empty, the finding is worse than stated and the
   proposal should say so rather than be reworded.
2. **Reproduce §1, and the fix.** In a scratch branch, after step 1, run the
   service and `curl -s localhost:3001/metrics | grep -c '^# HELP'`. **Before:
   `0`.** After: one line per described metric. If it is still `0`, the ordering
   is not the mechanism and the diagnosis is wrong — stop and re-derive it from
   `exporter/builder.rs:610`.
3. **The premise check for §2's first row**, in a scratch branch: with the
   description correctly ordered, `curl /metrics` **before any login has
   happened** and confirm `auth_login_total` is still absent. That proves
   describing does not create a zero series, and it is what forces the
   `telemetry.rs:66-69` comment to be rewritten rather than moved. If the series
   *is* present, option (b) of step 1 is unnecessary — say so.
4. `pnpm --filter @rnw/api-rs test` — `cargo test --lib`. The new
   `tests/metrics_contract.rs` assertions run here (integration tests do not need
   Docker), and every existing suite must pass unchanged, notably
   `app.rs`'s `metrics_endpoint_unavailable_without_recorder` (`:449-455`).
5. **Negative checks, in a scratch branch**, because a test that cannot fail is
   worse than no test — and these are the checks the §4 table predicts:
   - rename the `"status"` label at `app.rs:163` to `"code"` and confirm
     assertion 2 fails;
   - delete `"cache_l1_misses_total"` from the owner list and confirm assertion 1
     fails;
   - add `"brand_new_counter"` to the owner list and confirm assertion 1 fails
     (the bidirectional half);
   - point a copy of `rules.yml` at a metric nothing emits and confirm
     assertion 3 fails.
   If any passes, the parity test is not asserting the thing this proposal is
   about.
6. `pnpm --filter @rnw/api-rs test:e2e` (needs Docker) — `tests/parity.rs`
   byte-compares committed goldens and none of them is a `/metrics` body, so it
   must pass **unchanged**; that is the check that no response body moved. Run it
   first.
7. `pnpm --filter @rnw/api-rs lint` — `cargo fmt --check` and
   `cargo clippy --all-targets -- -D warnings`. A `&'static [Metric]` table and
   any new test target are `--all-targets` clippy surface.
8. `pnpm --filter @rnw/api-rs typecheck` — `cargo check --all-targets` compiles
   the new test target and `metrics_names.rs`.
9. `pnpm --filter @rnw/api-rs coverage` — the 80% line gate must still pass. One
  new module of constants and one test target; the denominator rises slightly and
  the new module is trivially covered.
10. **The check no automated test replaces**, and it is the whole of step 1's
    value: with the local stack up (`docker-compose.yml:30-60`), load
    `monitoring/grafana/dashboards/api-red.json`, confirm the `auth_login_total`
    panel renders and responds to a real `POST /auth/login` with a bad password,
    and confirm the panel is flat when `install_recorder()` has failed (which is
    the `None` arm). Record what was observed either way.
11. Not required, and honestly so: nothing here touches `web-application`,
    `mobile-application` or `components-library`, so no frontend suite is
    evidence. `pnpm --filter @rnw/mobile-application test:e2e` needs a native
    build and a simulator and is doubly irrelevant to a server metric name.

## Related proposals

Read across all four lifecycle folders at the time of writing — `todo/` (1),
`in-progress/` (1), `implemented/` (15), `rejected/` (README only) — plus
`improve-proposals/` and its `implemented/`. **Nothing claims this.**
`telemetry.rs` is named in exactly three of those documents and in all three it is
a scope *exclusion*, never a subject.

- **`todo/2026-10-04-20-47-50-the-label-component-does-not-label-the-input.md` —
  it names this exact defect and excludes it, at `:376-379`:** *"`api-rs`'s
  discarded `describe_counter!` at `telemetry.rs:70` (a real and separate
  finding — a `metrics` description dispatched to the no-op recorder before
  `install_recorder()` at `:75`, so the `# HELP` line never reaches `/metrics`)
  … excluded."* That paragraph is the entire prior art for §1 and §2, and it is a
  deferral, not a proposal. This document supplies the analysis §1 confirms in
  the pinned dependency versions, the two further facts that paragraph does not
  have (describing does not create a zero series; `auth_login_total` has no
  consumer), and a remedy. Different module; no file overlap.
- **`implemented/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md` —
  related, not superseded; the closest precedent and the one that named the
  remedy.** Its §2(b) is the first time a label was added to a metric for an
  operator reason, and it delivered both halves: `"op" => op` at
  `rate_limit.rs:247` *and* `api-red.json:152` becoming `sum by (op)`. That is
  this proposal's shape, applied once, by hand, for one metric. Its Risks section
  (`:295-299`) records that the `/metrics` double-count gate "was not added:
  the test stack installs no metrics recorder, so `/metrics` returns 503 under
  `tests/common/`" — §5 is that gap. Its scope note at `:513` lists "the missing
  `Cache-Control` metric descriptions in `telemetry.rs:65-82`" as real and
  separate. **This proposal does not touch `rate_limit.rs`;** it generalises the
  two moves that proposal had to make by hand.
- **`implemented/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`
  — related, not superseded; the structural precedent.** It solves the identical
  shape — "several tools answer the same question and they do not give the same
  answer" — for bundler and test resolution, and lands one owner
  (`web-resolution.ts`, strings and arrays only, importable from configs with no
  module graph) plus one parity test (`svgWebEntryParity.web.test.tsx`) with an
  allowlist. Step 3 copies that shape exactly, including the
  dependency-free constraint. `implemented/2026-10-04-17-42-28-the-wire-contract-goldens-have-an-unowned-generator.md:392-394`
  counts itself as the third instance; this is the fourth, on a different seam.
- **`implemented/2026-10-04-05-04-58-the-design-tokens-have-no-owner.md` —
  related, not superseded; the allowlist discipline step 4 reuses.** Its
  `tokens.parity.test.ts` is "make the contradiction a test failure instead of a
  comment" applied to CSS custom properties, and its Risks at `:365-368` sets the
  precedent this proposal's step 3 leans on: if the generated owner is not
  landing in the same change, ship the test alone rather than a new owner that
  can drift. Its eight `describe_*` / allowlist assertions are the nearest
  existing template.
- **`implemented/2026-10-04-08-20-32-the-shedding-boundary-is-an-accident-of-route-order.md`
  — adjacent; it moved `/metrics`'s position in the middleware chain.** Its
  `fallback_service` (`app.rs:120-125`) now meters 404s, so `http_requests_total`
  gains `route="unmatched"` samples. Correct, and unaffected: this proposal
  changes no emission site's label *values*, only where the names are owned.
  Its `:322` validation step — "scrape `/metrics` before and after three
  unmatched requests and assert the counter moved by 3" — is the exact check
  §5 says this repository cannot run. Nothing here blocks it; if step 5's
  hermetic test proves reachable, that gate becomes writable for it too.
- **`in-progress/2026-10-04-20-11-10-the-list-tiebreaker-depends-on-the-databases-collation.md`
  — unrelated surface.** `api-rs/migrations/`, `store/products.rs`,
  `store/memory.rs`, `store/contract.rs`. No file overlap with
  `telemetry.rs`, `app.rs` or `monitoring/`.
- **`implemented/2026-10-04-04-06-14-the-session-table-has-no-reaper.md`,
  `implemented/2026-10-04-17-18-57-clearing-a-product-text-field-is-silently-discarded.md`,
  `implemented/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`,
  `implemented/2026-10-04-03-05-32-persisted-product-snapshots-have-no-owner.md`
  — emit metrics this proposal's owner list will contain, and change none of
  them.** The reaper added `session_cleanup_errors_total` (`auth.rs:163`), one of
  the seven unreferenced names; the PATCH proposal is the fourth document to name
  `telemetry.rs`'s missing descriptions as out of scope (`:426`). Neither is
  affected.
- **`implemented/2026-10-03-22-37-46-make-the-store-contract-executable.md`,
  `implemented/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`,
  `implemented/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`,
  `implemented/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`,
  `implemented/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  — unrelated surfaces** (api-rs store traits and read paths; per-app route
  files; platform splits; the TypeScript transport). None touches `telemetry.rs`
  or `monitoring/`.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md:118` — the
  proposal that asked for `auth_login_total` and gave the reason this proposal
  quotes.** It also lists `api-rs/src/telemetry.rs` among files to edit (`:227`),
  and the edit landed. What did not land is the second half of its own sentence
  — the observability. Related, not superseded: this proposal closes that half
  and reopens nothing else in it. The transport duplication (`:172`), the
  generation counter (`:128`) and the 404-not-403 rule (`:88`) all stay.
- **`improve-proposals/implemented/2026-10-01-marketplace-api-high-traffic-performance.md`
  — the origin of the metrics plane, and the reason the gap matters.** Its `:99`
  names `metrics` + `metrics-exporter-prometheus` with "`/metrics` scrape
  endpoint + distributed traces + structured logs" and `:179` states *"Every
  instance exposes `/metrics` … so a scrape cannot be the thing that fails."*
  This proposal is about the content of that scrape being undocumented and
  unchecked. Its `critcmp` regression gate (`:490`) watches `src/store/` and
  `src/handlers/`, not `src/telemetry.rs`, so nothing in CI would catch the
  ordering bug either.
- **Nothing is superseded.** No proposal in any folder changes a metric name, a
  label name, a label value, `telemetry.rs`, or `monitoring/`.
---

## Implementation record

Written when the proposal was applied. Every "decision belongs in review" and
"say which was chosen" below had no reviewer — this run was unattended — so each
choice is recorded here with its reason instead of being left to inheritance.

### Step 1 — option (b), and the premise checked first

`describe_counter!` moved after `install_recorder()`, into `describe_api_metrics()`,
which now documents **all 21** series rather than one. The counter is also
registered at zero:

```rust
metrics::counter!("auth_login_total", "result" => "ok").increment(0);
metrics::counter!("auth_login_total", "result" => "invalid").increment(0);
```

Option (b) was chosen over (a) because §2's first row is true and was verified
rather than assumed: describing does not create a series. The pair is registered
rather than the bare name so the series carries the `result` label the emission
site uses, with no unlabelled twin in every scrape. The comment was rewritten,
not moved — it now says what registering does, why it is the login counter
specifically, and where the counter is charted.

Measured on a real service against throwaway Postgres 17 + Valkey 8, same binary
before and after, 13 series in the scrape after three `/products` requests and one
failed login:

| | `# TYPE` | `# HELP` | `auth_login_total` before any login |
| --- | --- | --- | --- |
| before (`origin/main`) | 13 | **0** | absent |
| after | 13 | **13** | `0` for both `result` values |

So §1's diagnosis was right, and §2's first row is why the zero-registration was
needed rather than optional.

### Step 2 — a panel, and deliberately no rule

`sum by (result) (rate(auth_login_total{result="invalid"}[1m]))` added to
`api-red.json` panel 6, beside the other two limiter panels. Verified live: the
series is `0` from boot and moves to `1` after a real `POST /auth/login` with a
wrong password.

**No alert rule was added.** The threshold for "sustained failed logins" is an
operational judgement, and `rules.yml` is where that judgement belongs; guessing
one unattended would be worse than not having it. This is the same call the
`http_rate_limited_total` row of the fail-open matrix already makes — expected
client behaviour lives on the dashboard, not in a page. Recorded in the
`telemetry.rs` comment and corrected in `ARCHITECTURE.md` §7, which listed
`auth_login_total` in the "Alert" column while no rule existed.

### Step 3 — the owner list exists; the emission sites keep their literals

`api-rs/src/metrics_names.rs` holds `Metric { name, labels }` and the `METRICS`
table, and nothing at runtime imports it. This is the fallback the Risks section
sets out, taken deliberately: substituting `HTTP_REQUESTS.name` into the
`metrics` macros would put the request hot path in `app.rs` behind this module for
no behavioural gain, and the drift this file exists to catch is caught by the
tests either way. The names are unchanged and byte-identical, so no dashboard or
rule needed editing.

### Step 4 — five assertions, and in `src/` rather than `tests/`

The parity test is `src/metrics_names.rs`'s own `#[cfg(test)] mod tests`, not
`tests/metrics_contract.rs`. **The proposal's validation step 4 is wrong about
this:** `pnpm --filter @rnw/api-rs test` is `cargo test --lib`, which does not
build `tests/` targets at all — they run under `test:e2e`, which is the
Docker-requiring script. A contract test filed there would not have gated
anything on a machine without Docker, which is the exact failure this proposal
exists to end. Colocated, it runs in `pnpm test`, `pnpm lint` and
`pnpm typecheck`. `env!("CARGO_MANIFEST_DIR")` works there, as `tests/parity.rs`
already does.

The four assertions are as specified, plus a fifth: every declared series is
passed to a `describe_*` macro. Without it the description list could drift from
the owner list and reintroduce this proposal's own failure class inside its fix.

The source is read as text with comments blanked first, so a commented-out
`metrics::counter!` cannot register a phantom series. Label keys are told apart
from series names by position relative to `=>`, which is what makes
`"result" => "invalid"` one key and no series while
`"method" => method.clone(), "route" => route.clone()` keeps both keys. The two
runtime-selected pairs are resolved from their preceding `let` binding.

`INSTRUMENTED_WITHOUT_A_CONSUMER` has **six** entries, not seven: `auth_login_total`
left the list when step 2 gave it a panel. Each carries a reason, and a companion
assertion fails if an entry becomes monitored, so the allowlist cannot quietly
become a place to hide a metric that should have a panel.

**Negative checks, all five passing** — each mutation was made, the suite was
confirmed to fail on the predicted assertion, and the mutation was reverted:

| mutation | assertion that failed |
| --- | --- |
| `status` → `code` at `app.rs:163` | `declared_label_keys_are_the_keys_each_series_is_emitted_with` |
| drop `cache_l1_misses_total` from `METRICS` | bidirectional names + `monitoring_only_reads_series_this_service_emits` |
| add a phantom `brand_new_counter` to `METRICS` | bidirectional names |
| point `rules.yml` at `cache_l2_nonexistent_total` | `monitoring_only_reads_series_this_service_emits` |
| emit an undeclared `cache_undeclared_probe_total` | bidirectional names + the allowlist check |

### Step 5 — the `Some` arm is reachable

`app::tests::metrics_endpoint_renders_described_and_boot_registered_series`
installs the recorder through the production `init_metrics()`, builds an
`AppState` with `metrics: Some(handle)`, and asserts a rendered scrape carries
`# HELP auth_login_total`, `# TYPE auth_login_total counter`,
`auth_login_total{result="invalid"}` before any login, and `http_requests_total`
after a request through the router. Hermetic: `InMemoryStore`, no Docker, no
Postgres, no Valkey.

**The global-recorder caveat is real and is now documented in the test.** One
recorder per process, so this is the only test in the `api-rs` lib binary that
may install one; a second would need to assert against this one's handle. The
existing `metrics_endpoint_unavailable_without_recorder` still passes unchanged —
it exercises the `None` arm, which no recorder affects.

The gate `implemented/2026-10-04-08-20-32-…` recorded as unwritable — "scrape
`/metrics` before and after three unmatched requests and assert the counter moved
by 3" — is now writable, since the render path is reachable from `cargo test --lib`.
It was not written here: that proposal's verification, not this one's.

### Also changed

`ARCHITECTURE.md` §7's fail-open matrix said `auth_login_total` was an alert; it
is a panel. §8 gained a paragraph on the name contract and a verification row;
§10's code map gained `src/metrics_names.rs`.

### Not done, stated plainly

- **The Grafana UI was not loaded.** Validation step 10 asks for a human-visible
  panel check. What was verified instead is the substance: the panel's PromQL
  references a series the service really emits (asserted), and that series really
  moves on a real failed login (measured). Whether Grafana renders the tile is
  not something an unattended run can usefully establish.
- **No mobile simulator**, and nothing in `mobile-application` was touched.
- **`pnpm format:check` fails on 79 pre-existing diagnostics**, all in
  `components-library` / `web-application` / `mobile-application` TypeScript and
  `commitlint.config.js`. None is a file this change touches and `monitoring/` is
  outside biome's scope. Not fixed here; not this proposal's business.
- **The dev database has migration drift** (`VersionMismatch(20261003120100)`) that
  predates this change. The live verification used throwaway containers on unused
  ports instead, and they were removed afterwards.
