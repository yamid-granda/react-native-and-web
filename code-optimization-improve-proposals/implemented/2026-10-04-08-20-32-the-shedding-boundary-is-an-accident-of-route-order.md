# The shedding boundary is an accident of route order, so unmatched URLs reach the service with no load protection at all

## Problem / opportunity

`api-rs` mounts its two process-wide middlewares with `route_layer`, which in axum
wraps **only the routes registered before the call**. The 404 handler is registered
*after* it. So every request whose path matches no declared route skips the rate
limiter entirely — not the Valkey rps windows, not the per-IP semaphore, and not the
global concurrency semaphore.

```rust
// api-rs/src/app.rs:91-101
.route("/metrics", get(metrics_handler))
// Order: metrics wraps rate limiting so shed/limited responses are
// counted in RED too. route_layer keeps MatchedPath available.
.route_layer(middleware::from_fn_with_state(state.clone(), rate_limit::enforce))  // :94
.route_layer(middleware::from_fn(http_metrics))                                    // :95
.fallback(fallback)                                                               // :96  ← outside both
.layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, timeout))       // :97  ← inside all four
.layer(cors_layer(&state.config))                                                  // :98
.layer(CompressionLayer::new())                                                    // :99
.layer(TraceLayer::new_for_http())                                                 // :100
```

Those four `.layer()` calls are declared *after* `.fallback()` at `:96`, and axum's
`Router::layer` wraps the fallback as well as the routes. The two `route_layer` calls
at `:94` and `:95` are declared *before* it, and axum's `Router::route_layer` does not.
So the 404 path is inside the timeout, CORS, compression and trace stack and outside
the load-shedding and RED-metrics stack. That is not a subtle ordering; it is one line
of the builder chain, and it is the difference between the service's only process-level
backstop existing and not existing.

### 1. What the bypass removes

All of `RateLimiter::check` (`api-rs/src/middleware/rate_limit.rs:84-109`) is skipped:

| protection | where | default | applies to `/nope`? |
| --- | --- | --- | --- |
| global concurrency semaphore → 503 | `rate_limit.rs:85-87`, `config.rs:75` | `1024` | **no** |
| per-IP concurrency semaphore → 503 | `rate_limit.rs:89-93`, `config.rs:76` | `64` | **no** |
| per-IP rps window → 429 | `rate_limit.rs:101-104`, `config.rs:77` | `100`/s | **no** |
| global rps window → 429 | `rate_limit.rs:96-100`, `config.rs:77` | `0` (off) | **no** |

`RATE_LIMIT_PER_IP_RPS` is the **only** limit enabled by default, because
`rate_limit_global_rps` ships as `0` (`api-rs/src/config.rs:77`). Unmatched paths do
not get it. The remaining two are the in-process semaphores, which cost nothing to
evaluate and are the only thing bounding in-flight work — `ARCHITECTURE.md:284` calls
that out as the design statement: *"Shed first protects the process."*

The paths that reach the fallback are exactly the ones an unauthenticated internet
scanner generates by default. `GET /`, `GET /wp-admin/setup.php`, and any probe for a
path this service does not have.

### 2. Measured, not inferred

I did not want to assert axum's `route_layer` semantics from memory, so I read them in
the pinned dependency (`api-rs/Cargo.lock:236-238` → axum 0.8.9) and then reproduced
the exact builder shape of `app.rs:91-101` in a scratch crate outside this repository,
with two middlewares that record whether they ran:

```rust
path_router: this.path_router.route_layer(layer),   // axum-0.8.9/src/routing/mod.rs:311-316 — `layer` also wraps
fallback_router: this.fallback_router,               //   fallback_router + catch_all_fallback…
default_fallback: this.default_fallback,             // axum-0.8.9/src/routing/mod.rs:321-336 — `route_layer` passes
catch_all_fallback: this.catch_all_fallback,         //   all three straight through, untouched
```

```
declared route (GET)          uri=/products           status=200   limiter_hit=1 metrics_hit=1
UNMATCHED path (GET)          uri=/nope               status=404   limiter_hit=0 metrics_hit=0
UNMATCHED path (GET, root)    uri=/                   status=404   limiter_hit=0 metrics_hit=0
UNMATCHED nested path         uri=/a/b/c/d            status=404   limiter_hit=0 metrics_hit=0
scanner-shaped path           uri=/wp-admin/setup.php status=404   limiter_hit=0 metrics_hit=0
WRONG METHOD, declared route  uri=/products           status=404   limiter_hit=1 metrics_hit=1
```

The mechanism, end to end: `Router::fallback` (`axum-0.8.9/src/routing/mod.rs:344-355`)
registers the handler into `fallback_router` at `/` and at `/{*__private__axum_fallback}`
(`mod.rs:400-405` → `path_router.rs:33-37`, constant at `mod.rs:111`), and
`call_with_state` tries `path_router` then `fallback_router` then `catch_all_fallback`
(`mod.rs:417-434`). `route_layer` wraps only the first.

### 3. `ARCHITECTURE.md` documents this bypass and gets its scope wrong

`api-rs/ARCHITECTURE.md:275` draws the edge:

```
fb["unmatched path or wrong method"] -.->|"bypasses route_layers"| fb404["404 …"]
```

**"or wrong method" is wrong, and the measurement above is why.** A wrong method on a
declared route is served by that route's own `MethodRouter` fallback, which lives
*inside* the endpoint `PathRouter::route_layer` wraps
(`axum-0.8.9/src/routing/path_router.rs:308-330` → `method_routing.rs:990`, where
`MethodRouter::layer` maps its own `fallback`). `POST /products` hits
`limiter_hit=1`. So the one place in the repository that mentions this bypass
overstates it, and the surrounding prose states it too narrowly:

> `ARCHITECTURE.md:254-256` — "`route_layer` runs only for matched routes — which is
> why `app::fallback` increments its own counter: an unmatched request has no
> `MatchedPath`."

The consequence given is a missing metric label. The consequence not given anywhere is
that the **load shedder is not on that path**. Meanwhile `:280-282` ("Metrics wrap the
limiter"), `:284` ("Shed first protects the process"), `:102` (the C4 row) and the §7
matrix at `:309-310` all present the semaphores and windows as unconditional process
protection, with no exception carved out.

### 4. The manual counter in `fallback` is evidence someone hit this wall and patched the wrong half

```rust
// api-rs/src/app.rs:162-171
pub async fn fallback(request: Request) -> Response {
    let (parts, _body) = request.into_parts();
    metrics::counter!("http_requests_total", "method" => …, "route" => "unmatched", "status" => "404")
        .increment(1);
```

`http_metrics` is the other `route_layer` at `:95`, so it also misses the fallback — and
`app.rs:122` already carries the matching fallback arm:

```rust
.unwrap_or_else(|| "unmatched".to_owned());
```

That arm is **unreachable today**. `MatchedPath` is inserted by `path_router` at match
time for non-fallback routers (`axum-0.8.9/src/routing/path_router.rs:392-400`), and
every request that reaches a `route_layer` necessarily matched. So the file contains a
dead branch for the unmatched case *and* a hand-rolled counter for it, and the two
disagree about which half of the problem mattered.

### 5. Nothing can fail on this

Both rate-limit tests in the repository request **declared** routes:
`api-rs/tests/e2e_products.rs:95-112` sets `rate_limit_per_ip_rps = 2` and hammers
`/products`; `api-rs/tests/e2e_auth.rs:198-235` hammers `/auth/login`. There is no test
anywhere that requests an unmatched path through a limiter, and `app.rs:215-225`
(`unmatched_route_returns_cannot_method_url_404`) asserts only the 404 body. The
omission is invisible to `cargo test`, to `test:e2e`, and to the coverage gate.

### 6. Why this is expensive for an agent

The protection boundary is expressed as *position in a builder chain*. Adding a route
above `app.rs:94` silently opts it **into** rate limiting; adding one below `:96`
silently opts it **out**. There is no type that says "this route is load-protected", no
compiler diagnostic, and no test that fails either way. An agent asked to "add a route",
"tighten rate limiting", or "make load shedding cover everything" has to recall
`route_layer` vs `layer` semantics, and cannot verify the result without Docker.

## Proposed approach

Make the protection boundary explicit and router-wide, and keep the one deliberate
scoping decision scoped.

### 1. Move the two process-wide middlewares from `route_layer` to `layer`

In `api-rs/src/app.rs`, delete `:94-95` and re-declare them as `.layer()` calls
**after** `.fallback()`, innermost-first, so the executed order is unchanged:

```rust
.fallback(fallback)
.layer(middleware::from_fn_with_state(state.clone(), rate_limit::enforce))
.layer(middleware::from_fn(http_metrics))
.layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, timeout))
.layer(cors_layer(&state.config))
.layer(CompressionLayer::new())
.layer(TraceLayer::new_for_http())
.with_state(state)
```

Because the last `.layer()` declared is the outermost, that yields
`trace › compress › CORS › timeout › metrics › limiter › handler` — byte-for-byte the
order the flowchart at `ARCHITECTURE.md:260-274` already documents for matched routes.
This is a pure scope widening: no matched request changes which middleware runs or in
what order. The trait bounds on `Router::layer` and `Router::route_layer` are identical
(`axum-0.8.9/src/routing/mod.rs:304-309` and `:322-329`), so the existing
`from_fn_with_state` layers are type-compatible as written.

`MatchedPath` still resolves for matched routes (it is inserted *inside* every layer),
and `app.rs:122`'s `"unmatched"` arm becomes the live path instead of dead code.

### 2. Delete the hand-rolled counter in `fallback` — in the same commit

**This is the trap.** Once `http_metrics` covers the fallback, keeping
`app.rs:164-170` double-counts every 404: `http_metrics` emits
`http_requests_total{method, route="unmatched", status="404"}` from `:130-136`, and so
does the manual `increment(1)`, with identical label sets. `http_metrics` also begins
recording `http_requests_duration_seconds` for 404s, which it never has. Remove
`:164-170` and the `metrics::counter!` import usage with it; keep the 404 body and the
`json_response` call unchanged, so `app.rs:215-225` and the `parity.rs` goldens are
untouched.

### 3. Leave `enforce_auth` as a `route_layer`, and say why at both sites

The scoping at `app.rs:59-67` is deliberate and already explained: `route_layer`
applies to routes registered before the call, which is how the credential throttle is
confined to `/auth/register` and `/auth/login`. That intent must survive this change,
so add a two-line comment at the `enforce` call site recording that it must be a
`layer` (process-wide) and that `enforce_auth` must stay a `route_layer` (two routes),
because today the only comment on the subject is on the one that is *not* at risk.

### 4. Record the decision, including the part that is a judgement call

Whether 404s *should* be metered is a product/ops decision, not a refactor. Two honest
endings:

- **Recommended:** meter them. A 404 storm is load, the per-IP rps window is the only
  limit on by default, and 404s are cheap enough that the window's cost is worth the
  bound. This is what step 1 implements.
- **Also defensible:** leave the fallback outside the limiter deliberately, and say so
  in `ARCHITECTURE.md` next to the arrow at `:275`. If that is the choice, step 2 still
  applies (the metrics gap is not a choice), and the limiter stays `route_layer` while
  `http_metrics` moves to `layer`.

What is *not* an acceptable outcome is leaving it as an accident, which is the state
today.

### 5. Correct `ARCHITECTURE.md`

- `:275` — the node label becomes `"unmatched path"`. Drop "or wrong method": the
  measurement in §2 above shows `POST /products` *is* limited.
- `:254-256` — the prose names only the missing `MatchedPath`. Replace it with the
  actual post-change statement: `.layer()` wraps the fallback, `route_layer` does not,
  and that is why the limiter and the RED metrics are declared as `.layer()` while the
  credential throttle is a `route_layer`.
- Add one line to §7 stating that unmatched paths are rate-limited like every other
  request, so the matrix at `:309-310` has no silent exception.

## Impact

**Correctness of a stated invariant.** The service documents process-wide load
protection in four places and delivers it on every path but one. After this, "every
request in this service passes through the load shedder" is true and testable.

**Scalability / availability.** The in-flight bound on the 404 path goes from unbounded
to `GLOBAL_CONCURRENCY_LIMIT` (1024) globally and `PER_IP_CONCURRENCY_LIMIT` (64) per
IP, with a 429 at `RATE_LIMIT_PER_IP_RPS` (100/s). The blast radius stays bounded
because unmatched requests never touch Postgres or Valkey, so this cannot exhaust the
database pool — it bounds process CPU, memory and Tokio task occupancy on a path that
is cheap per request and trivially easy to generate.

**Observability.** 404s gain `http_requests_duration_seconds` samples, so a 404 flood
becomes visible as latency and not only as a request count. Today only the count exists,
via the manual counter.

**Maintainability / AI-developer cost.** The protection boundary stops being a line
number. The comment at the `enforce` site, plus the corrected flowchart, is what an
agent reads before adding a route; and the new test in step 6 below means a change that
re-narrows the boundary fails a check instead of passing review.

**Performance.** No measurable change on matched routes — the middleware set and order
are identical. On unmatched routes, `enforce` gains two in-process semaphore
`try_acquire` calls and, when Valkey is configured, two `INCR` round trips per request
that previously made zero. That is the deliberate cost of the bound, and it is the same
cost every other request already pays.

**What does not improve, stated plainly.**

- **The database is no safer.** Unmatched requests reach no query. If the concern is
  pool exhaustion, this proposal does nothing for it.
- **A 404 flood is already countable today.** `api-rs/src/app.rs:164-170` feeds
  `http_requests_total{route="unmatched"}`, so the dashboard and the 5xx/error-rate
  alerts see it. What is missing is the ability to shed it and its latency, not the
  ability to notice it.
- **Nothing changes for the Valkey fail-open posture.** With no Valkey the windows are
  skipped on every path (`rate_limit.rs:95`); the semaphores still bound 404s.
- **This does not touch the four other degradation states in the load shedder.**
  `Untracked` at the 100 000-IP cap, the `INCR`/`EXPIRE` key leak, the missing
  reconnect, and the absence of a metric for "running with no rate limiting" are all
  `code-optimization-improve-proposals/todo/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md`
  and are untouched here.
- **No client code changes.** `web-application`, `mobile-application` and
  `components-library` are untouched; no response body, status code or header changes.

## Risks / trade-offs

- **Double-counting 404s if step 2 is skipped.** The single most likely way to land this
  badly. `http_metrics` and the manual counter emit identical label sets, so the
  regression is invisible in a smoke test and shows up later as a doubled error rate.
  Steps 1 and 2 must be one commit, and step 3 of Validation is the gate.
- **It changes the meaning of a documented line.** `ARCHITECTURE.md:275` currently says
  the fallback bypasses the `route_layer`s. That stays true of `enforce_auth`'s
  `route_layer`; it stops being true of the two moved to `.layer()`. A reviewer who
  reads only the diff and not step 5 will think a documented guarantee was weakened. It
  was not — it was previously wrong about wrong methods and silent about shedding.
- **Metering 404s is a judgement call** (step 4). An operator who wants scanner traffic
  to get a free 404 keeps the limiter as a `route_layer` and takes the documentation
  row instead. That is a legitimate outcome, not a failure of this proposal.
- **`http_requests_total` series gains no new label values** — `route` stays the literal
  `"unmatched"`, so there is no cardinality cost and no dashboard change.
- **A hermetic test of "the limiter ran" is not available**, and I am not going to
  pretend otherwise. With `conn: None` the Valkey windows are skipped entirely
  (`rate_limit.rs:95`), leaving only the semaphores, whose 503 is racy to provoke
  against a fallback that returns instantly. The real regression gate is the Docker E2E
  test in step 1 of Validation. A genuinely hermetic seam would be a `CounterStore`
  trait over the window counters — which is precisely the abstraction
  `todo/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md` proposes and defers to
  its own follow-up. Take the two together if both are wanted; this proposal does not
  need it and does not pre-empt it.
- **Scope.** The `enforce_auth` scoping, the `middleware/session.rs` 401, the
  `Retry-After` absence on the 429/503 bodies, the fixed-window boundary burst, and the
  trusted-proxy question are all real and all separate. None belongs in this diff.

## Validation

1. **The regression gate — Docker required.** In `api-rs/tests/e2e_products.rs`, beside
   `valkey_backed_rate_limit_returns_429` (`:95-112`), add the same stack with the same
   `rate_limit_per_ip_rps = 2` and drive it at an unmatched path:

   ```rust
   let url = format!("{}/no-such-path", stack.base_url);
   assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::NOT_FOUND);
   assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::NOT_FOUND);
   assert_eq!(client.get(&url).send().await.unwrap().status(), StatusCode::TOO_MANY_REQUESTS);
   ```

   Before this change the third assertion fails (404); after it, it passes. Run with
   `pnpm --filter @rnw/api-rs test:e2e`. Not run during this analysis run — it needs
   Docker.
2. **The double-count gate — Docker required, same file.** With the limiter moved, every
   404 must still increment `http_requests_total{route="unmatched"}` exactly **once**.
   Scrape `/metrics` before and after three unmatched requests and assert the counter
   moved by 3. If step 2 was skipped this reports 6. This is the check that makes the
   risk above survivable.
3. **Hermetic gate.** `pnpm --filter @rnw/api-rs test` — `cargo test --lib`. Must pass
   unchanged, including `app::tests::unmatched_route_returns_cannot_method_url_404`
   (`:215-225`) and `wrong_method_returns_404_not_405` (`:227-245`), which together pin
   the 404 body for both the unmatched and the wrong-method shapes. If step 2 deletes the
   manual counter and this test fails, the fallback's response changed, which it must
   not.
4. **Parity gate — Docker required.** `tests/parity.rs` must pass byte-identical. No
   response body, status or header changes on any declared route; a golden that needs
   regeneration means the middleware order changed, which is not supposed to have
   happened.
5. **Order check, mechanical.** Re-run the middleware-order derivation against the new
   chain: last `.layer()` declared is outermost, so the executed order must still be
   `trace › compress › CORS › timeout › http_metrics › enforce › handler`, matching
   `ARCHITECTURE.md:260-274`. If `http_metrics` ends up inside `enforce`, the stated
   reason at `app.rs:92-93` ("Metrics wrap the limiter, so shed and limited responses
   appear in RED") is false again.
6. **Negative check.** In a scratch branch, move the `enforce` `.layer()` back above
   `.fallback()` and confirm the step-1 E2E test fails. If it still passes, the test is
   not asserting the boundary. Then restore.
7. **Lint and types.** `pnpm --filter @rnw/api-rs lint` (fmt + clippy) and
   `pnpm --filter @rnw/api-rs typecheck`. Watch for an unused-import warning on the
   `metrics::counter!` removed with `:164-170`.
8. **Not runnable here, and honestly so.** `pnpm --filter @rnw/web-application test:e2e`
   and `pnpm --filter @rnw/mobile-application test:e2e` need a live seeded api-rs and a
   native build with a simulator respectively. Neither is affected by this change — no
   client file moves — but they are the repo's end-to-end gates and I did not run them.

## Related proposals

- **`code-optimization-improve-proposals/todo/2026-10-04-06-16-26-the-load-shedder-fails-open-silently.md`
  — closest relative, different file, and it does not cover this.** It analyses
  `middleware/rate_limit.rs` exhaustively: the `Untracked` fail-open at the 100 000-IP
  cap, the `INCR`/`EXPIRE` key leak, the absent reconnect, the unlabelled
  `rate_limit_errors_total`, and the missing test seam behind `window_exceeded` taking a
  concrete `&ConnectionManager`. Its subject is the limiter's **internal** degradation
  states; it treats the limiter as applied to the whole request path and never mentions
  the router, `route_layer`, or the fallback. Its only `app.rs` citation is the 408 body
  bypassing `ErrorBody`, which is a different question. This proposal changes no line of
  `rate_limit.rs`. Where the two touch: if its `CounterStore` trait lands, it is also the
  seam that would let step 1's regression test run without Docker, as noted in Risks.
- **`code-optimization-improve-proposals/todo/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  and `code-optimization-improve-proposals/todo/2026-10-04-07-05-49-the-http-boundary-is-duplicated-and-untested.md`
  — unrelated surfaces.** The first is the api-rs cached read path; the second is the two per-app
  TypeScript fetch wrappers. Neither touches `app.rs`'s builder chain. No file this
  proposal edits appears in either.
- **`ARCHITECTURE.md:275` is prior art in the repository but not a prior *proposal*.**
  Read across all four lifecycle folders — `todo/` (10 entries), `in-progress/` (1:
  `2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`),
  `implemented/` (empty) and `rejected/` (empty) — plus `improve-proposals/` and its
  `implemented/`, nothing raises the `route_layer`/`layer` distinction or the
  unmatched-path bypass. The architecture diagram is the only prior mention, it states
  the consequence incorrectly (it includes wrong methods, which are in fact covered), and
  it omits the load-shedding consequence entirely. This proposal therefore **sharpens and
  corrects** an existing doc line rather than restating a finding.
- **Nothing is superseded.** Steps 1 and 2 preserve every guarantee the fallback has
  today and add the one it lacks. If a reviewer prefers the alternative in step 4 —
  limiter stays a `route_layer`, metrics moves to `layer` — that is a strictly smaller
  version of this change, not a different proposal.

---

## Implementation notes (added when this proposal was applied)

**The finding holds. Step 1 as written does not, and neither does the step 4
alternative, because both move `http_metrics` to a router-wide `.layer()`.**

`MatchedPath` is inserted by `PathRouter::call_with_state` when it matches
(`axum-0.8.9/src/routing/path_router.rs:388-399`). That is *inside* every layer, so a
`.layer()` runs before matching and reads no `MatchedPath` at all. Step 1's assurance
that "`MatchedPath` still resolves for matched routes (it is inserted *inside* every
layer)" has the insertion point backwards: being inside every layer is precisely why a
`layer` cannot see it. Promoting `http_metrics` would have left `app.rs:122`'s
`unwrap_or_else` as the only reachable arm and relabelled **every** request in the
service `route="unmatched"`.

So the position each middleware needs is not a style preference — it is forced, and the
two of them need opposite positions:

| middleware | needs | why |
| --- | --- | --- |
| `http_metrics` | `route_layer` | labels by `MatchedPath`, readable only after matching |
| `rate_limit::enforce` | must reach the fallback | `route_layer` cannot reach the router's fallback |

`.layer()` always wraps `route_layer`, so moving only the limiter would have put
`enforce` outside `http_metrics` and undone the "metrics wrap the limiter" invariant at
`ARCHITECTURE.md:280-282`.

### What was implemented instead

The fallback is served by `fallback_service`, a router carrying its own copy of the same
two middlewares:

```rust
.fallback_service(
    Router::new()
        .fallback(fallback)
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit::enforce))
        .layer(middleware::from_fn(http_metrics)),
)
```

`MatchedPath` is absent there by design, which is correct: for an unmatched path
`"unmatched"` is the label we want anyway. This delivers every outcome step 1 and step 2
were after, and the step 4 judgement call resolves to the recommended ending:

- unmatched paths are shed by the same `enforce`, so the bound is now
  `GLOBAL_CONCURRENCY_LIMIT` / `PER_IP_CONCURRENCY_LIMIT` / `RATE_LIMIT_PER_IP_RPS`
- the manual counter in `fallback` is deleted, and 404s are counted exactly once
- 404s gain `http_requests_duration_seconds` samples
- shed and limited responses appear in RED on the 404 path too
- `app.rs:122`'s `"unmatched"` arm becomes the live path instead of dead code
- **no matched route changes** which middleware runs, in what order, or with what labels

### Deviations from the Validation section

- The "regression gate" is hermetic, not Docker-only. `unmatched_paths_are_load_shed`
  holds the single global permit (`global_concurrency_limit: 1`) and asserts a 503 on
  `/nope`. Confirmed to fail with 404 before the change and pass after. `cargo test
  --lib`, no Docker. The proposal's own Risks section doubted such a seam existed for the
  *Valkey window*; it does exist for the semaphores.
- The Docker E2E test (`unmatched_paths_are_rate_limited_too`) was added as specified
  and does cover the rps window.
- The "double-count gate" (scrape `/metrics` for a delta of 3) was **not** added: the
  test stack installs no metrics recorder, so `/metrics` returns 503 under
  `tests/common/`. Counting is instead argued structurally — a wrong method is answered
  by the route's own `MethodRouter` fallback, inside the `route_layer`s, and never
  reaches `fallback_service`, so no request is metered twice.
- Validation step 6 (the negative check) was run: reverting the `fallback_service`
  reproduces 404, so the test does assert the boundary.

### Corrections this run confirmed

The measurement in §2 that a wrong method on a declared route *is* limited is correct.
`wrong_method_is_load_shed` passes both before and after the change. The `ARCHITECTURE.md`
arrow was wrong about that, and is now corrected.