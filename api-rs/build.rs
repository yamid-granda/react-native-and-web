// Without this, adding or editing a migration recompiles nothing — the
// `sqlx::migrate!` proc macro only re-runs when a Rust file changes — so the
// binary would silently keep serving stale migrations.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
