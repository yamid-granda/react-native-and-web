use chrono::NaiveDateTime;
use serde::Serializer;

/// Mirrors `JSON.stringify` for JS numbers: integral values print without a
/// fractional part (Prisma `Float` 18 serializes as `18`, not `18.0`) and
/// non-finite values print as `null`. Otherwise serde_json's shortest
/// round-trip encoding matches V8's; exponential-notation thresholds differ
/// but are unreachable for this API's value ranges.
pub fn js_number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    let value = *value;
    if !value.is_finite() {
        return serializer.serialize_unit();
    }
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        serializer.serialize_i64(value as i64)
    } else {
        serializer.serialize_f64(value)
    }
}

/// Prisma serializes `DateTime` columns as `toISOString()`: UTC with exactly
/// three fraction digits. The `TIMESTAMP(3)` column maps 1:1.
pub fn prisma_datetime<S: Serializer>(
    value: &NaiveDateTime,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.collect_str(&value.format("%Y-%m-%dT%H:%M:%S%.3fZ"))
}

/// `Number(string)` coercion as used by `Number(page) || 1` in
/// `products.controller.ts`: whitespace-trimmed, empty string is 0, and
/// decimal/hex/binary/octal/Infinity literals are accepted; anything else is
/// NaN. Rust's own f64 parser is close but accepts spellings JS rejects
/// (`inf`) and rejects ones JS accepts (`0x10`), hence the manual pass.
pub fn js_number_or_nan(raw: &str) -> f64 {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    let lower = trimmed.to_ascii_lowercase();
    let (sign, magnitude) = match lower.strip_prefix('-') {
        Some(rest) => (-1.0, rest),
        None => (1.0, lower.strip_prefix('+').unwrap_or(&lower)),
    };
    if magnitude == "infinity" {
        return sign * f64::INFINITY;
    }
    if magnitude == "nan" || magnitude == "inf" {
        return f64::NAN;
    }
    if let Some(digits) = magnitude.strip_prefix("0x") {
        return u64::from_str_radix(digits, 16).map(|v| sign * v as f64).unwrap_or(f64::NAN);
    }
    if let Some(digits) = magnitude.strip_prefix("0b") {
        return u64::from_str_radix(digits, 2).map(|v| sign * v as f64).unwrap_or(f64::NAN);
    }
    if let Some(digits) = magnitude.strip_prefix("0o") {
        return u64::from_str_radix(digits, 8).map(|v| sign * v as f64).unwrap_or(f64::NAN);
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDateTime;
    use serde::Serialize;

    use super::*;

    #[derive(Serialize)]
    struct Wrapper {
        #[serde(serialize_with = "js_number")]
        value: f64,
    }

    #[derive(Serialize)]
    struct Timestamp<'a> {
        #[serde(serialize_with = "prisma_datetime")]
        value: &'a NaiveDateTime,
    }

    fn js(value: f64) -> String {
        serde_json::to_string(&Wrapper { value }).unwrap()
    }

    #[test]
    fn integral_floats_print_like_js() {
        assert_eq!(js(18.0), r#"{"value":18}"#);
        assert_eq!(js(-0.0), r#"{"value":0}"#);
        assert_eq!(js(129.99), r#"{"value":129.99}"#);
        assert_eq!(js(89.5), r#"{"value":89.5}"#);
        assert_eq!(js(0.1 + 0.2), r#"{"value":0.30000000000000004}"#);
    }

    #[test]
    fn non_finite_floats_print_as_null_like_js() {
        assert_eq!(js(f64::NAN), r#"{"value":null}"#);
        assert_eq!(js(f64::INFINITY), r#"{"value":null}"#);
    }

    #[test]
    fn datetimes_print_like_prisma() {
        let dt = NaiveDateTime::parse_from_str("2026-01-01 12:30:05.100", "%Y-%m-%d %H:%M:%S%.3f")
            .unwrap();
        // `prisma_datetime` is the function under test and the one
        // `ProductJson::createdAt` uses. Serializing the `NaiveDateTime`
        // directly would bypass it and pick up chrono's own representation,
        // which lacks the trailing `Z` the contract requires.
        assert_eq!(
            serde_json::to_string(&Timestamp { value: &dt }).unwrap(),
            r#"{"value":"2026-01-01T12:30:05.100Z"}"#
        );
    }

    #[test]
    fn js_number_parsing_matches_coercion() {
        assert!(js_number_or_nan("2").eq(&2.0));
        assert!(js_number_or_nan(" 3 ").eq(&3.0));
        assert!(js_number_or_nan("").eq(&0.0));
        assert!(js_number_or_nan("   ").eq(&0.0));
        assert!(js_number_or_nan("abc").is_nan());
        assert!(js_number_or_nan("inf").is_nan());
        assert!(js_number_or_nan("nan").is_nan());
        assert_eq!(js_number_or_nan("Infinity"), f64::INFINITY);
        assert_eq!(js_number_or_nan("-Infinity"), f64::NEG_INFINITY);
        assert!(js_number_or_nan("0x10").eq(&16.0));
        assert!(js_number_or_nan("0b101").eq(&5.0));
        assert!(js_number_or_nan("0o17").eq(&15.0));
        assert!(js_number_or_nan("1e2").eq(&100.0));
        assert!(js_number_or_nan(".5").eq(&0.5));
        assert!(js_number_or_nan("5.").eq(&5.0));
        assert!(js_number_or_nan("+7").eq(&7.0));
        assert!(js_number_or_nan("-2.5").eq(&-2.5));
    }
}
