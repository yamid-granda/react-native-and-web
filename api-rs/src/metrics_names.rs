//! The metric-name contract, in one list.
//!
//! `/metrics` has two owners that are 21 Rust call sites and two files of two
//! other formats apart: the `metrics::counter!` / `gauge!` / `histogram!`
//! invocations under `src/`, and `monitoring/grafana/dashboards/api-red.json`
//! plus `monitoring/rules.yml`. A rename in one place silently stops a
//! Prometheus rule from matching — `http_requests_total{status=~"5.."}` feeding
//! `ApiRsHighErrorRate` (`severity: critical`) is a live example — and nothing
//! in either language notices.
//!
//! So the names live here, and the tests at the bottom of this file compare
//! both sides against this list in both directions. A new metric, a deleted
//! metric, a renamed metric, a renamed label, and a dashboard or rule pointing
//! at a series nothing emits are all test failures rather than surprises.
//!
//! Two conventions this list has to keep:
//!
//! - **Label keys are declared per metric, not globally.** `status` is declared
//!   by two series and means the HTTP status code in both, but a shared
//!   vocabulary would let a rename on one side pass while breaking the other.
//! - **The runtime-selected pairs are two entries.** `cache/l1.rs` picks
//!   between `cache_l1_hits_total` and `cache_l1_misses_total` with an `if`, and
//!   `cache/singleflight.rs` does the same for leader/follower, so a check that
//!   only read a macro's first argument would miss them.
//!
//! The emission sites still spell their names as literals rather than reading
//! them from here. Substituting a constant into the `metrics` macros would make
//! the request hot path in `app.rs` depend on this module for no behavioural
//! gain, and every drift this file exists to catch is caught by the tests below
//! either way — so the list stays a checked reference rather than a second place
//! to update. Wiring the constants in is a reasonable follow-up; moving them
//! without a reason to is not.

/// One series `/metrics` can emit: its name and the label keys it carries.
pub struct Metric {
    pub name: &'static str,
    pub labels: &'static [&'static str],
}

/// Every series api-rs emits, sorted by name so a diff is readable.
///
/// Labels are in the order the emission site passes them, which is not always
/// alphabetical (`http_requests_total` is `method, route, status`).
pub const METRICS: &[Metric] = &[
    Metric { name: "auth_login_total", labels: &["result"] },
    Metric { name: "cache_l1_hits_total", labels: &["kind"] },
    Metric { name: "cache_l1_misses_total", labels: &["kind"] },
    Metric { name: "cache_l1_oversize_total", labels: &["kind"] },
    Metric { name: "cache_l2_errors_total", labels: &["op"] },
    Metric { name: "cache_l2_hits_total", labels: &["kind"] },
    Metric { name: "cache_l2_misses_total", labels: &["kind"] },
    Metric { name: "cache_l2_oversize_total", labels: &["kind"] },
    Metric { name: "cache_l2_writes_total", labels: &["kind"] },
    Metric { name: "cache_entry_size_bytes", labels: &["kind"] },
    Metric { name: "cache_list_generation_bumps_total", labels: &[] },
    Metric { name: "cache_singleflight_follower_total", labels: &["kind"] },
    Metric { name: "cache_singleflight_leader_total", labels: &["kind"] },
    Metric { name: "cache_singleflight_wait_seconds", labels: &[] },
    Metric { name: "http_load_shed_total", labels: &["scope"] },
    Metric { name: "http_rate_limited_total", labels: &["scope"] },
    Metric { name: "http_requests_duration_seconds", labels: &["method", "route", "status"] },
    Metric { name: "http_requests_total", labels: &["method", "route", "status"] },
    Metric { name: "process_resident_memory_bytes", labels: &[] },
    Metric { name: "rate_limit_errors_total", labels: &["op"] },
    Metric { name: "session_cleanup_errors_total", labels: &[] },
    Metric { name: "sqlx_pool_acquire_seconds", labels: &["pool"] },
    Metric { name: "sqlx_pool_idle", labels: &["pool"] },
    Metric { name: "sqlx_pool_size", labels: &["pool"] },
];

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::{Metric, METRICS};

    /// The repository root, so the checks below read the same files a reviewer
    /// reads rather than a copy cargo happens to have staged. `CARGO_MANIFEST_DIR`
    /// rather than a relative path, because the working directory `cargo test`
    /// picks is not something to depend on.
    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    fn crate_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    /// Metric names this repository mints, and nothing else. Every name api-rs
    /// emits starts with one of these, which is what lets the monitoring side be
    /// scanned with the same rule as the Rust side. `le` is the histogram bucket
    /// label Prometheus adds and `up`/`scrape_*` belong to the exporter.
    const NAME_PREFIXES: &[&str] =
        &["auth_", "cache_", "http_", "process_", "rate_limit_", "session_", "sqlx_"];

    /// Matches a bare metric name wherever it appears — a string literal in
    /// Rust, an identifier inside PromQL, a key in JSON — without matching the
    /// `_bucket` / `_count` / `_sum` series the exporter derives from a
    /// histogram, which is why those are stripped afterwards.
    ///
    /// Only used on the `monitoring/` side. The Rust side is read through the
    /// macros instead, because a name can be chosen at runtime there and no
    /// amount of text matching recovers that reliably.
    fn find_names(haystack: &str) -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        let bytes = haystack.as_bytes();

        // `char_indices` rather than a byte loop: the dashboard and the rules
        // are full of em dashes and arrow characters, and every slice below is
        // indexed by byte.
        for (start, character) in haystack.char_indices() {
            if !NAME_PREFIXES.iter().any(|prefix| haystack[start..].starts_with(prefix)) {
                let _ = character;
                continue;
            }

            let mut end = start;
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }

            // A prefix must begin a word. Without this, `sqlx_pool_size` inside
            // `my_sqlx_pool_size` would be reported as a name of its own. A byte
            // of a multi-byte character is never alphanumeric, so this stays
            // correct without decoding it.
            let preceded_by_word =
                start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_');
            if !preceded_by_word {
                let name = &haystack[start..end];
                let base = name
                    .strip_suffix("_bucket")
                    .or_else(|| name.strip_suffix("_count"))
                    .or_else(|| name.strip_suffix("_sum"))
                    .unwrap_or(name);
                names.insert(base.to_string());
            }
        }

        names
    }

    /// Comments blanked out, byte-for-byte the same length and with every
    /// newline left in place, so an offset or a line number computed on the
    /// result still addresses the original source.
    ///
    /// Needed because both scanners below look for macro *names* in source text,
    /// and a macro name appears in this repository's own comments: a
    /// commented-out `metrics::counter!` would register a series nothing emits,
    /// and this file's own notes about the macros would register themselves.
    fn strip_comments(source: &str) -> String {
        let bytes = source.as_bytes();
        let mut blanked = bytes.to_vec();
        let mut index = 0;
        let mut in_string = false;

        while index < bytes.len() {
            if in_string {
                match bytes[index] {
                    // Step over an escaped byte so `\"` does not end the literal.
                    b'\\' => index = (index + 2).min(bytes.len()),
                    b'"' => {
                        in_string = false;
                        index += 1;
                    }
                    _ => index += 1,
                }
                continue;
            }

            match (bytes[index], bytes.get(index + 1)) {
                (b'"', _) => {
                    in_string = true;
                    index += 1;
                }
                (b'/', Some(b'/')) => {
                    while index < bytes.len() && bytes[index] != b'\n' {
                        blanked[index] = b' ';
                        index += 1;
                    }
                }
                (b'/', Some(b'*')) => {
                    while index < bytes.len() {
                        if bytes[index] == b'\n' {
                            index += 1;
                        } else if bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/') {
                            blanked[index] = b' ';
                            blanked[index + 1] = b' ';
                            index += 2;
                            break;
                        } else {
                            blanked[index] = b' ';
                            index += 1;
                        }
                    }
                }
                _ => index += 1,
            }
        }

        String::from_utf8(blanked).expect("blanking comments preserves UTF-8")
    }

    /// One `metrics::…!` invocation: the series names it registers and the label
    /// keys it attaches to them.
    struct Invocation {
        line: usize,
        names: Vec<String>,
        labels: Vec<String>,
    }

    /// The `metrics` macros whose first argument is a series name. `describe_*`
    /// is excluded: it documents a name, it does not emit one.
    const EMIT_MACROS: &[&str] = &["metrics::counter!", "metrics::gauge!", "metrics::histogram!"];

    /// The `metrics` macros that document one. Their first argument is the same
    /// series name; the last is prose.
    const DESCRIBE_MACROS: &[&str] =
        &["metrics::describe_counter!", "metrics::describe_gauge!", "metrics::describe_histogram!"];

    /// The argument list of every `metrics::{counter,gauge,histogram}!` in
    /// `source`, as (line, series names, label keys). `source` must already have
    /// had its comments blanked — see `strip_comments`.
    fn find_invocations(source: &str) -> Vec<Invocation> {
        let mut found = Vec::new();

        for macro_name in EMIT_MACROS {
            let mut search_from = 0;
            while let Some(offset) = source[search_from..].find(macro_name) {
                let open = search_from + offset + macro_name.len();
                search_from = open;
                // A macro name inside a string literal — this file's own
                // `EMIT_MACROS` array, for one — is not an invocation.
                if source.as_bytes().get(open) != Some(&b'(') {
                    continue;
                }

                let Some(args) = balanced_args(source, open) else {
                    continue;
                };

                // Inside a macro's arguments a string literal is one of three
                // things, and telling them apart is most of what this parser
                // does:
                //
                //   "http_requests_total"     the series
                //   "method" => method.clone() a label key
                //   "result"  => "invalid"     …and this literal, its value
                //
                // A key is the literal immediately before `=>`. The literal after
                // it is that key's value unless it is itself a key, which is how
                // `"method" => method.clone(), "route" => route.clone()` keeps
                // both keys while `"result" => "invalid"` yields one key and no
                // series named `invalid`.
                let mut names = Vec::new();
                let mut labels = Vec::new();
                let mut previous_was_key = false;
                for literal in string_literals(args) {
                    let is_key = args[literal.end..].trim_start().starts_with("=>");
                    if is_key {
                        labels.push(literal.value);
                    } else if !previous_was_key {
                        names.push(literal.value);
                    }
                    previous_was_key = is_key;
                }

                // `cache/l1.rs` binds the name first and passes the binding:
                // `let name = if hit.is_some() { "…hits_total" } else { "…misses_total" };`
                // then `metrics::counter!(name, "kind" => …)`. Resolving that
                // binding is why this reads the file rather than grepping the
                // macro's first argument.
                if names.is_empty() {
                    if let Some(ident) = leading_identifier(args) {
                        names = bound_literals(source, open, &ident);
                    }
                }

                found.push(Invocation { line: source[..open].lines().count(), names, labels });
            }
        }

        found
    }

    struct Literal {
        value: String,
        /// Byte offset just past the closing quote, within the slice searched.
        end: usize,
    }

    /// Every `"…"` in `haystack`, which must already have had its comments
    /// blanked. A literal that never closes means the slice is not what this
    /// parser assumes — returning what was found beats panicking inside a test,
    /// and the callers assert on an empty result rather than trusting it.
    fn string_literals(haystack: &str) -> Vec<Literal> {
        let bytes = haystack.as_bytes();
        let mut literals = Vec::new();
        let mut index = 0;

        while index < bytes.len() {
            if bytes[index] == b'"' {
                let start = index + 1;
                let mut end = start;
                while end < bytes.len() && bytes[end] != b'"' {
                    if bytes[end] == b'\\' {
                        end += 1;
                    }
                    end += 1;
                }
                if end >= bytes.len() {
                    break;
                }
                literals.push(Literal { value: haystack[start..end].to_string(), end: end + 1 });
                index = end + 1;
            } else {
                index += 1;
            }
        }

        literals
    }

    /// The argument list starting at the `(` in `open`, through its matching `)`.
    fn balanced_args(source: &str, open: usize) -> Option<&str> {
        let bytes = source.as_bytes();
        let mut depth = 0usize;
        let mut index = open;

        while index < bytes.len() {
            match bytes[index] {
                b'"' => {
                    // Step over the literal so a paren inside a description
                    // cannot close the argument list early.
                    index += 1;
                    while index < bytes.len() && bytes[index] != b'"' {
                        if bytes[index] == b'\\' {
                            index += 1;
                        }
                        index += 1;
                    }
                }
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&source[open + 1..index]);
                    }
                }
                _ => {}
            }
            index += 1;
        }

        None
    }

    /// The bare identifier the macro's first argument is, if it is one.
    fn leading_identifier(args: &str) -> Option<String> {
        let ident: String =
            args.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        if ident.is_empty() || ident.starts_with(|c: char| c.is_ascii_digit()) {
            None
        } else {
            Some(ident)
        }
    }

    /// The string literals bound to `ident` on the nearest preceding `let` in
    /// `source` before `before`. Both runtime-selected pairs are a one-line `if`
    /// binding immediately above the macro, so "nearest preceding" is enough and
    /// a whole-file binding analysis would be more machinery than the two sites
    /// can justify.
    fn bound_literals(source: &str, before: usize, ident: &str) -> Vec<String> {
        let prefix = &source[..before];
        let needle = format!("let {ident}");
        let Some(start) = prefix.rfind(&needle) else {
            return Vec::new();
        };

        let binding = match prefix[start..].find('\n') {
            Some(end) => &prefix[start..start + end],
            None => &prefix[start..],
        };

        string_literals(binding).into_iter().map(|literal| literal.value).collect()
    }

    fn rust_sources(dir: &Path, into: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_sources(&path, into);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                into.push(path);
            }
        }
    }

    /// Every series `api-rs/src` registers, mapped to the label keys it
    /// registers them with, plus where each was found so a failure names a file
    /// and a line rather than just a metric.
    fn emitted_metrics() -> (BTreeMap<String, BTreeSet<String>>, BTreeMap<String, String>) {
        let mut sources = Vec::new();
        rust_sources(&crate_root().join("src"), &mut sources);
        sources.sort();

        let mut labels: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut sites: BTreeMap<String, String> = BTreeMap::new();

        for path in &sources {
            let source = fs::read_to_string(path).unwrap_or_else(|error| {
                panic!("{}: {error}", path.display());
            });
            let relative = path.strip_prefix(crate_root()).unwrap_or(path).display().to_string();
            let code = strip_comments(&source);

            for invocation in find_invocations(&code) {
                assert!(
                    !invocation.names.is_empty(),
                    "{}:{}: could not read a series name out of a metrics macro — \
                     extend this file's parser rather than skipping the site",
                    relative,
                    invocation.line,
                );
                for name in invocation.names {
                    labels
                        .entry(name.clone())
                        .or_default()
                        .extend(invocation.labels.iter().cloned());
                    sites.entry(name).or_insert_with(|| format!("{relative}:{}", invocation.line));
                }
            }
        }

        (labels, sites)
    }

    /// Series names `monitoring/` reads, from the dashboard's PromQL and the
    /// alert rules. Read from the repository's own files rather than from a
    /// generated copy, because the drift this catches *is* the drift between
    /// these files and Rust.
    fn monitored_metrics() -> (BTreeSet<String>, BTreeMap<String, String>) {
        let monitoring = repo_root().join("monitoring");
        let mut names = BTreeSet::new();
        let mut sites = BTreeMap::new();
        let mut paths = Vec::new();
        collect_files(&monitoring, &mut paths);
        paths.sort();

        for path in paths {
            let Ok(contents) = fs::read_to_string(&path) else {
                continue;
            };
            let relative = path.strip_prefix(repo_root()).unwrap_or(&path).display().to_string();
            for name in find_names(&contents) {
                sites.entry(name.clone()).or_insert_with(|| relative.clone());
                names.insert(name);
            }
        }

        (names, sites)
    }

    fn collect_files(dir: &Path, into: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_files(&path, into);
            } else {
                into.push(path);
            }
        }
    }

    fn owner() -> BTreeMap<&'static str, BTreeSet<String>> {
        METRICS
            .iter()
            .map(|Metric { name, labels }| {
                (*name, labels.iter().map(|l| (*l).to_string()).collect())
            })
            .collect()
    }

    /// Series api-rs registers but nothing in `monitoring/` reads, with the
    /// reason each one is allowed to be there.
    ///
    /// This is an allowlist, not a wish list. Every entry is a deliberate
    /// decision to instrument without charting, and the companion test below
    /// fails if an entry stops being true — so an entry cannot quietly become a
    /// place to hide a metric that *should* have a panel. Adding a panel is the
    /// way to remove an entry.
    ///
    /// - `cache_l2_writes_total` — the write side of the L2 tier. Read together
    ///   with the hit ratio on the dashboard rather than on its own: what an
    ///   operator asks of a cache is whether it is being used, and a rising write
    ///   count with a flat hit ratio is the same line as a warm cache.
    /// - `cache_list_generation_bumps_total` — how often a write retires the
    ///   list namespace. Deliberately not charted: it is a function of the write
    ///   rate, which `http_requests_total{status=~"2.."}` on `/my-store/products`
    ///   already shows, and charting it would invite reading cache behaviour into
    ///   it.
    /// - `cache_singleflight_leader_total` and
    ///   `cache_singleflight_follower_total` — kept as a pair because the
    ///   interesting value is the *ratio*, and the ratio is only readable if both
    ///   halves exist even before a stampede has happened.
    /// - `cache_singleflight_wait_seconds` — the wait a collapsed request
    ///   actually paid. Zero in normal operation by design, so a chart of it is
    ///   a flat line that only means something during the incident it was added
    ///   for; the p95 latency panel is the standing signal.
    /// - `session_cleanup_errors_total` — the expired-session delete failing.
    ///   Fail-open and warned, and its blast radius is one stale row per seller
    ///   per `SESSION_TTL_SECS`, which `Session` row count would show far more
    ///   directly than a rate of housekeeping errors.
    const INSTRUMENTED_WITHOUT_A_CONSUMER: &[(&str, &str)] = &[
        ("cache_l2_writes_total", "read with the L2 hit ratio, not on its own"),
        (
            "cache_list_generation_bumps_total",
            "a function of the write rate, which is already charted",
        ),
        ("cache_singleflight_follower_total", "only meaningful as a ratio with its leader half"),
        ("cache_singleflight_leader_total", "only meaningful as a ratio with its follower half"),
        ("cache_singleflight_wait_seconds", "flat by design; standing signal is the latency panel"),
        ("session_cleanup_errors_total", "fail-open housekeeping; row count is the better signal"),
    ];

    #[test]
    fn every_emitted_series_is_declared_here_and_every_declaration_is_emitted() {
        let (labels, sites) = emitted_metrics();
        let owner = owner();

        let undeclared: Vec<String> = labels
            .keys()
            .filter(|name| !owner.contains_key(name.as_str()))
            .map(|name| format!("{name} ({})", sites[name]))
            .collect();
        assert_eq!(
            undeclared,
            Vec::<String>::new(),
            "emitted by api-rs/src but not declared in metrics_names::METRICS — \
             add the series and its label keys there"
        );

        let unemitted: Vec<&str> =
            owner.keys().filter(|name| !labels.contains_key(**name)).copied().collect();
        assert_eq!(
            unemitted,
            Vec::<&str>::new(),
            "declared in metrics_names::METRICS but never emitted by api-rs/src — \
             delete the entry, or emit it"
        );
    }

    /// The assertion that catches a `status` → `code` rename, which would
    /// silently stop `ApiRsHighErrorRate` matching anything.
    #[test]
    fn declared_label_keys_are_the_keys_each_series_is_emitted_with() {
        let (labels, sites) = emitted_metrics();
        let owner = owner();
        let mut mismatches = Vec::new();

        for (name, declared) in &owner {
            let Some(emitted) = labels.get(*name) else {
                // Covered by the bidirectional test above; skip rather than
                // report the same problem twice.
                continue;
            };
            if emitted != declared {
                mismatches.push(format!(
                    "{name} ({}): emitted with {:?}, declared as {:?}",
                    sites[*name], emitted, declared
                ));
            }
        }

        assert_eq!(
            mismatches,
            Vec::<String>::new(),
            "label keys drifted between the emission site and metrics_names::METRICS. \
             A dashboard or alert rule selecting on the old key keeps matching \
             nothing, and neither language errors."
        );
    }

    #[test]
    fn monitoring_only_reads_series_this_service_emits() {
        let (labels, _) = emitted_metrics();
        let (monitored, sites) = monitored_metrics();

        let not_emitted: Vec<String> = monitored
            .iter()
            .filter(|name| !labels.contains_key(*name))
            .map(|name| format!("{name} ({})", sites[name]))
            .collect();
        assert_eq!(
            not_emitted,
            Vec::<String>::new(),
            "monitoring/ reads a series api-rs never emits — a dead panel or a dead alert"
        );

        let owner = owner();
        let not_declared: Vec<String> = monitored
            .iter()
            .filter(|name| !owner.contains_key(name.as_str()))
            .map(|name| format!("{name} ({})", sites[name]))
            .collect();
        assert_eq!(
            not_declared,
            Vec::<String>::new(),
            "monitoring/ reads a series missing from metrics_names::METRICS"
        );
    }

    #[test]
    fn the_series_with_no_consumer_are_the_documented_ones() {
        let (labels, _) = emitted_metrics();
        let (monitored, _) = monitored_metrics();

        let unreferenced: BTreeSet<String> =
            labels.keys().filter(|name| !monitored.contains(*name)).cloned().collect();
        let allowlisted: BTreeSet<String> =
            INSTRUMENTED_WITHOUT_A_CONSUMER.iter().map(|(name, _)| (*name).to_string()).collect();

        assert_eq!(
            unreferenced, allowlisted,
            "the set of emitted-but-unread series changed. Either give the new one a \
             panel or a rule, or add it to INSTRUMENTED_WITHOUT_A_CONSUMER with a \
             reason; either way, do not leave it unremarked."
        );
    }

    /// The allowlist cannot go stale: an entry that has become monitored is
    /// dead weight pretending to permit something, and the entry above would pass
    /// with it still there.
    #[test]
    fn no_allowlist_entry_has_become_monitored() {
        let (monitored, sites) = monitored_metrics();

        let stale: Vec<String> = INSTRUMENTED_WITHOUT_A_CONSUMER
            .iter()
            .filter(|(name, _)| monitored.contains(*name))
            .map(|(name, _)| format!("{name} ({})", sites[*name]))
            .collect();
        assert_eq!(
            stale,
            Vec::<String>::new(),
            "these are allowlisted as unmonitored but monitoring/ now reads them — \
             remove the entry"
        );
    }

    /// `improve-proposals/2026-10-03-seller-storefronts-my-store.md` asked for
    /// this counter because the login throttle has to be observable. It shipped
    /// with no panel and no rule, so its stated purpose was unmet; this is the
    /// line that keeps it from happening again quietly.
    #[test]
    fn auth_login_total_has_a_consumer() {
        let (monitored, _) = monitored_metrics();
        assert!(
            monitored.contains("auth_login_total"),
            "auth_login_total is the reason the per-IP login throttle exists, and \
             nothing in monitoring/ reads it — add it to api-red.json or rules.yml"
        );
    }

    /// `/metrics` is self-describing only if the description list and the
    /// emission list are the same list. `telemetry::init_metrics` used to carry
    /// exactly one `describe_*` and it was dispatched to the no-op recorder, so
    /// `/metrics` emitted `# TYPE` for everything and `# HELP` for nothing.
    #[test]
    fn every_declared_series_is_described() {
        let described = find_described();

        let owner = owner();
        let undocumented: Vec<&str> =
            owner.keys().filter(|name| !described.contains(**name)).copied().collect();
        assert_eq!(
            undocumented,
            Vec::<&str>::new(),
            "declared in metrics_names::METRICS but never passed to a \
             metrics::describe_* macro in telemetry.rs — /metrics would emit \
             # TYPE with no # HELP"
        );

        let undeclared: Vec<&str> = described
            .iter()
            .filter(|name| !owner.contains_key(name.as_str()))
            .map(String::as_str)
            .collect();
        assert_eq!(
            undeclared,
            Vec::<&str>::new(),
            "described in telemetry.rs but not declared in metrics_names::METRICS"
        );
    }

    /// The names passed to `metrics::describe_*` anywhere under `src/`, which is
    /// `telemetry.rs` today and is not assumed to stay that way.
    fn find_described() -> BTreeSet<String> {
        let mut sources = Vec::new();
        rust_sources(&crate_root().join("src"), &mut sources);

        let mut names = BTreeSet::new();
        for path in sources {
            let source = fs::read_to_string(&path).unwrap_or_else(|error| {
                panic!("{}: {error}", path.display());
            });
            let code = strip_comments(&source);

            for macro_name in DESCRIBE_MACROS {
                let mut search_from = 0;
                while let Some(offset) = code[search_from..].find(macro_name) {
                    let open = search_from + offset + macro_name.len();
                    search_from = open;
                    // The macro name can also appear inside a string literal —
                    // this file's own list of them — which is not a call.
                    if code.as_bytes().get(open) != Some(&b'(') {
                        continue;
                    }
                    let Some(args) = balanced_args(&code, open) else {
                        continue;
                    };
                    // The series name is the first argument; the description is
                    // the last and is prose, so only the first is taken.
                    if let Some(literal) = string_literals(args).into_iter().next() {
                        names.insert(literal.value);
                    }
                }
            }
        }

        names
    }

    /// `find_names` is the rule both sides are read with, so it is worth its own
    /// check: a prefix match that ignored word boundaries, or a histogram suffix
    /// that was not stripped, would quietly change what every assertion above
    /// believes.
    #[test]
    fn name_scanning_takes_whole_words_and_strips_histogram_series() {
        assert_eq!(
            find_names("sum by (le) (rate(http_requests_duration_seconds_bucket[5m]))"),
            BTreeSet::from(["http_requests_duration_seconds".to_string()])
        );
        assert_eq!(
            find_names("\"my_sqlx_pool_size\" and sqlx_pool_size"),
            BTreeSet::from(["sqlx_pool_size".to_string()])
        );
        assert_eq!(
            find_names("process_resident_memory_bytes"),
            BTreeSet::from(["process_resident_memory_bytes".to_string()])
        );
        // Label names and units are not series and must not be mistaken for some.
        assert_eq!(find_names("by (route) (status=~\"5..\") (op) (scope) (le)"), BTreeSet::new());
    }
}
