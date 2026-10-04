//! Password hashing.
//!
//! argon2id, because a password is a guessable secret and a fast hash is the
//! wrong primitive for one: sha256/bcrypt-era thinking ("just hash it") turns a
//! leaked table into a wordlist attack measured in seconds. The cost parameters
//! are the library defaults; the only seam is [`use_cheap_params_for_tests`],
//! which exists so the unit-test suite does not pay production hash cost on
//! every handler test.

use argon2::{Argon2, Params, PasswordHash, PasswordHasher, PasswordVerifier};

/// The parameters in force for the rest of this process.
///
/// Production is `Params::default()` (m=19 MiB, t=2, p=1), which costs tens of
/// milliseconds of pure CPU — fine once per login, catastrophic as a
/// synchronous step inside an async worker. `#[cfg(test)]` only: there is no
/// production path that can lower these, which is deliberate, because "cheaper
/// hashes in some builds" is exactly the kind of config that ends up in a
/// deployment by accident.
#[cfg(not(test))]
fn params() -> Params {
    Params::default()
}

#[cfg(test)]
fn params() -> Params {
    TEST_OVERRIDE.get().cloned().unwrap_or_default()
}

#[cfg(test)]
static TEST_OVERRIDE: std::sync::OnceLock<Params> = std::sync::OnceLock::new();

/// Drops this process to `m=64 KiB, t=1, p=1`. Call once, from a test.
///
/// A real password must never be hashed with these: m=64 KiB is roughly 300x
/// cheaper to attack than the defaults. The point is that `cargo test --lib`
/// performs dozens of hashes, and at production cost every handler test would pay
/// for it.
///
/// Process-wide and therefore not itself unit-tested — the tests in this binary
/// run in parallel, so whether a given test sees the cheap parameters is a race.
/// The property that *is* tested below is the one that makes the override safe:
/// a hash carries its own parameters, so it verifies regardless.
#[cfg(test)]
pub fn use_cheap_params_for_tests() {
    let _ = TEST_OVERRIDE.set(Params::new(64, 1, 1, None).expect("cheap test params are valid"));
}

fn hasher() -> Argon2<'static> {
    Argon2::from(params())
}

/// Hashes a password. Never returns the input, and never logs it.
///
/// `PasswordHasher::hash_password` generates the salt from the OS RNG and embeds
/// it, along with the algorithm, version and parameters, in the returned PHC
/// string — which is why [`verify_password`] does not need this process's
/// configuration to be the same one that produced the hash.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    hash_with(&hasher(), password)
}

pub fn hash_with(
    argon2: &Argon2<'_>,
    password: &str,
) -> Result<String, argon2::password_hash::Error> {
    Ok(argon2.hash_password(password.as_bytes())?.to_string())
}

/// True when `password` produced `stored_hash`.
///
/// A malformed stored hash is `false`, not an error: it must be
/// indistinguishable from a wrong password, so a corrupted row cannot be used to
/// tell "no such account" from "bad credential".
pub fn verify_password(stored_hash: &str, password: &str) -> bool {
    verify_with(&hasher(), stored_hash, password)
}

pub fn verify_with(argon2: &Argon2<'_>, stored_hash: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored_hash) else { return false };
    argon2.verify_password(password.as_bytes(), &parsed).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Production cost, deliberately: a test that hashed a dozen times at the
    /// defaults would itself become the slowest thing in the suite, and the point
    /// of this file is that one hash is affordable.
    #[test]
    fn a_password_round_trips_through_argon2() {
        let hash = hash_password("correct horse battery staple").expect("hash");
        assert!(verify_password(&hash, "correct horse battery staple"));
        assert!(!verify_password(&hash, "correct horse battery stapl"));
    }

    #[test]
    fn the_hash_is_a_phc_string_and_never_contains_the_password() {
        let hash = hash_password("hunter42").expect("hash");
        assert!(hash.starts_with("$argon2id$v=19$"), "{hash}");
        assert!(!hash.contains("hunter42"));
        // The parameters travel inside the string, which is what lets a hash
        // outlive a change to this process's configuration.
        assert!(hash.contains("m=") && hash.contains(",t=") && hash.contains(",p="), "{hash}");
    }

    #[test]
    fn two_hashes_of_one_password_differ() {
        // The salt is per-hash; without it a table of equal passwords would be
        // one rainbow-table lookup away from fully cracked.
        let first = hash_password("same").expect("hash");
        let second = hash_password("same").expect("hash");
        assert_ne!(first, second);
        assert!(verify_password(&first, "same") && verify_password(&second, "same"));
    }

    #[test]
    fn a_malformed_stored_hash_is_a_miss_not_an_error() {
        assert!(!verify_password("not-a-phc-string", "anything"));
        assert!(!verify_password("", "anything"));
    }

    #[test]
    fn an_empty_password_does_not_verify_against_a_hash_of_it() {
        let hash = hash_password("").expect("hash");
        assert!(verify_password(&hash, ""));
        assert!(!verify_password(&hash, " "));
    }

    /// What makes the cheap-params test override safe, and what makes a
    /// parameter change a non-event: the PHC string carries its own parameters,
    /// so verification never depends on the hasher that is currently configured.
    #[test]
    fn a_hash_verifies_under_a_hasher_with_different_parameters() {
        let cheap = Argon2::from(Params::new(64, 1, 1, None).expect("cheap params are valid"));
        let hash = hash_with(&cheap, "portable").expect("hash");
        assert!(hash.contains("m=64"), "{hash}");

        let production = Argon2::default();
        assert!(verify_with(&production, &hash, "portable"));
        assert!(!verify_with(&production, &hash, "portable "));
        // And symmetrically: a production hash verifies under the cheap hasher.
        let production_hash = hash_with(&production, "portable").expect("hash");
        assert!(verify_with(&cheap, &production_hash, "portable"));
    }
}
