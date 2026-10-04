//! Session tokens: generation and storage-hash.
//!
//! An opaque 256-bit random string beats a JWT here for one reason — revocation.
//! A JWT is valid until it expires no matter what the database says; this
//! scheme is one `DELETE` away from invalid everywhere, which is what
//! `POST /auth/logout` needs.

use base64::Engine as _;
use rand::rngs::SysRng;
use rand::TryRng as _;
use sha2::{Digest as _, Sha256};

/// 32 bytes of CSPRNG output. The security of the scheme is entirely this
/// number: 256 bits cannot be brute-forced, so an attacker who somehow guesses
/// a token is not brute-forcing, they are reading the database.
const TOKEN_BYTES: usize = 32;

/// A fresh session token, URL-safe so it survives a header, a query string and
/// a JSON body without escaping.
pub fn generate_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    fill(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// A prefixed 128-bit identifier, for rows whose id is not itself a secret
/// (`User`, `Product`). Shorter than a token on purpose: it is a primary key the
/// client may see, not a credential.
pub fn opaque_id(prefix: &str) -> String {
    let mut bytes = [0u8; 12];
    fill(&mut bytes);
    format!("{prefix}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn fill(bytes: &mut [u8]) {
    SysRng
        .try_fill_bytes(bytes)
        .expect("the OS RNG is the only source of a session token or an id");
}

/// What actually goes in the `Session` table.
///
/// SHA-256 — not argon2, and not because argon2 would be wrong. The input is
/// 256 bits of CSPRNG output, so there is nothing to brute-force and a slow
/// KDF would only tax every authenticated request. The hash exists for exactly
/// one reason: a database leak must not hand the attacker live sessions.
pub fn hash_token(token: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_256_bits_and_url_safe() {
        let token = generate_token();
        // 32 bytes base64url without padding.
        assert_eq!(token.len(), 43);
        assert!(token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
    }

    #[test]
    fn tokens_do_not_repeat() {
        let tokens: std::collections::HashSet<String> = (0..64).map(|_| generate_token()).collect();
        assert_eq!(tokens.len(), 64);
    }

    #[test]
    fn hashing_is_stable_and_never_echoes_the_token() {
        let token = generate_token();
        let hash = hash_token(&token);
        assert_eq!(hash, hash_token(&token));
        assert_ne!(hash, token);
        assert!(!hash.contains(&token));
        // 32 bytes of digest, same encoding as the token itself.
        assert_eq!(hash.len(), 43);
    }

    #[test]
    fn a_different_token_hashes_differently() {
        assert_ne!(hash_token("a"), hash_token("b"));
    }
}
