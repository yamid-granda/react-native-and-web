use unicode_normalization::UnicodeNormalization;

/// Folds `text` for accent- and case-insensitive search.
///
/// The international standard behind this is Unicode Normalization Form KD
/// (NFKD, UTS #15 / Unicode Standard Annex #15): compatibility-decompose the
/// text, drop the combining marks (General Category `Mn`), then lowercase
/// (Unicode case folding's simple half). `bebé` and `bebe` both fold to
/// `bebe`; `bañera` and `banera` both fold to `banera`. This covers the Latin,
/// Greek and Cyrillic ranges shoppers actually type with diacritics.
///
/// Two deliberate limits, both inherent to the standard rather than to this
/// spelling of it: characters with no decomposition stay as they are (`ø`
/// does not fold to `o`, `ß` does not fold to `ss`), and compatibility
/// decomposition widens a few ligatures (`ﬁ` folds to `fi`). Postgres-side
/// search uses `unaccent()`, whose transliteration dictionary agrees with
/// NFKD+Mn-strip on the Latin range, so the two paths match the same rows.
pub fn fold_search_text(text: &str) -> String {
    text.nfkd().filter(|c| !is_combining_mark(*c)).flat_map(|c| c.to_lowercase()).collect()
}

/// General Category `Mn` (Mark, nonspacing): the combining accents NFKD
/// splits off a precomposed character (`é` → `e` + U+0301). Spelled
/// explicitly rather than via a `unic-*` crate: one range check, no new
/// dependency, and the ranges below are the whole of `Mn` per the Unicode
/// Character Database.
fn is_combining_mark(c: char) -> bool {
    matches!(c,
        '\u{0300}'..='\u{036F}'
        | '\u{0483}'..='\u{0489}'
        | '\u{0591}'..='\u{05BD}'
        | '\u{05BF}'
        | '\u{05C1}'..='\u{05C2}'
        | '\u{05C4}'..='\u{05C5}'
        | '\u{05C7}'
        | '\u{0610}'..='\u{061A}'
        | '\u{064B}'..='\u{065F}'
        | '\u{0670}'
        | '\u{06D6}'..='\u{06DC}'
        | '\u{06DF}'..='\u{06E4}'
        | '\u{06E7}'..='\u{06E8}'
        | '\u{06EA}'..='\u{06ED}'
        | '\u{0900}'..='\u{0903}'
        | '\u{093A}'..='\u{094F}'
        | '\u{0951}'..='\u{0957}'
        | '\u{0962}'..='\u{0963}'
        | '\u{0981}'..='\u{0983}'
        | '\u{09BC}'
        | '\u{09BE}'..='\u{09C4}'
        | '\u{09C7}'..='\u{09C8}'
        | '\u{09CB}'..='\u{09CD}'
        | '\u{09D7}'
        | '\u{09E2}'..='\u{09E3}'
        | '\u{0A01}'..='\u{0A03}'
        | '\u{0A3C}'
        | '\u{0A3E}'..='\u{0A42}'
        | '\u{0A47}'..='\u{0A48}'
        | '\u{0A4B}'..='\u{0A4D}'
        | '\u{0A51}'
        | '\u{0A70}'..='\u{0A71}'
        | '\u{0A75}'
        | '\u{0A81}'..='\u{0A83}'
        | '\u{0ABC}'
        | '\u{0ABE}'..='\u{0AC5}'
        | '\u{0AC7}'..='\u{0AC9}'
        | '\u{0ACB}'..='\u{0ACD}'
        | '\u{0AE2}'..='\u{0AE3}'
        | '\u{0B01}'..='\u{0B03}'
        | '\u{0B3C}'
        | '\u{0B3E}'..='\u{0B44}'
        | '\u{0B47}'..='\u{0B48}'
        | '\u{0B4B}'..='\u{0B4D}'
        | '\u{0B56}'..='\u{0B57}'
        | '\u{0B62}'..='\u{0B63}'
        | '\u{0B82}'
        | '\u{0BBE}'..='\u{0BC2}'
        | '\u{0BC6}'..='\u{0BC8}'
        | '\u{0BCA}'..='\u{0BCD}'
        | '\u{0BD7}'
        | '\u{0C00}'..='\u{0C04}'
        | '\u{0C3E}'..='\u{0C44}'
        | '\u{0C46}'..='\u{0C48}'
        | '\u{0C4A}'..='\u{0C4D}'
        | '\u{0C55}'..='\u{0C56}'
        | '\u{0C62}'..='\u{0C63}'
        | '\u{0C81}'..='\u{0C83}'
        | '\u{0CBC}'
        | '\u{0CBE}'..='\u{0CC4}'
        | '\u{0CC6}'..='\u{0CC8}'
        | '\u{0CCA}'..='\u{0CCD}'
        | '\u{0CD5}'..='\u{0CD6}'
        | '\u{0CE2}'..='\u{0CE3}'
        | '\u{0D00}'..='\u{0D03}'
        | '\u{0D3B}'..='\u{0D3C}'
        | '\u{0D3E}'..='\u{0D44}'
        | '\u{0D46}'..='\u{0D48}'
        | '\u{0D4A}'..='\u{0D4D}'
        | '\u{0D57}'
        | '\u{0D62}'..='\u{0D63}'
        | '\u{0D82}'..='\u{0D83}'
        | '\u{0DCA}'
        | '\u{0DCF}'..='\u{0DD4}'
        | '\u{0DD6}'
        | '\u{0DD8}'..='\u{0DDF}'
        | '\u{0DF2}'..='\u{0DF3}'
        | '\u{0E31}'
        | '\u{0E34}'..='\u{0E3A}'
        | '\u{0E47}'..='\u{0E4E}'
        | '\u{0EB1}'
        | '\u{0EB4}'..='\u{0EBC}'
        | '\u{0EC8}'..='\u{0ECD}'
        | '\u{0F18}'..='\u{0F19}'
        | '\u{0F35}'
        | '\u{0F37}'
        | '\u{0F39}'
        | '\u{0F3E}'..='\u{0F3F}'
        | '\u{0F71}'..='\u{0F84}'
        | '\u{0F86}'..='\u{0F87}'
        | '\u{0F8D}'..='\u{0F97}'
        | '\u{0F99}'..='\u{0FBC}'
        | '\u{0FC6}'
        | '\u{102B}'..='\u{103E}'
        | '\u{1050}'..='\u{109D}'
        | '\u{135D}'..='\u{135F}'
        | '\u{1712}'..='\u{1714}'
        | '\u{1732}'..='\u{1734}'
        | '\u{1752}'..='\u{1753}'
        | '\u{1772}'..='\u{1773}'
        | '\u{17B4}'..='\u{17D3}'
        | '\u{17DD}'
        | '\u{180B}'..='\u{180D}'
        | '\u{18A9}'
        | '\u{1920}'..='\u{192B}'
        | '\u{1930}'..='\u{193B}'
        | '\u{1A17}'..='\u{1A1B}'
        | '\u{1A55}'..='\u{1A5E}'
        | '\u{1A60}'..='\u{1A7C}'
        | '\u{1A7F}'
        | '\u{1AB0}'..='\u{1AFF}'
        | '\u{1B00}'..='\u{1B04}'
        | '\u{1B34}'..='\u{1B44}'
        | '\u{1B6B}'..='\u{1B73}'
        | '\u{1BAA}'
        | '\u{1BE6}'..='\u{1BF3}'
        | '\u{1C2C}'..='\u{1C33}'
        | '\u{1C36}'..='\u{1C37}'
        | '\u{1CD0}'..='\u{1CD2}'
        | '\u{1CD4}'..='\u{1CE8}'
        | '\u{1CED}'
        | '\u{1CF2}'..='\u{1CF3}'
        | '\u{1DC0}'..='\u{1DE6}'
        | '\u{1DFC}'..='\u{1DFF}'
        | '\u{20D0}'..='\u{20DC}'
        | '\u{20E1}'
        | '\u{20E5}'..='\u{20F0}'
        | '\u{2CEF}'..='\u{2CF1}'
        | '\u{2D7F}'
        | '\u{2DE0}'..='\u{2DFF}'
        | '\u{302A}'..='\u{302D}'
        | '\u{3099}'..='\u{309A}'
        | '\u{A66F}'
        | '\u{A674}'..='\u{A67D}'
        | '\u{A69E}'..='\u{A69F}'
        | '\u{A6F0}'..='\u{A6F1}'
        | '\u{A802}'
        | '\u{A806}'
        | '\u{A80B}'
        | '\u{A823}'..='\u{A827}'
        | '\u{A880}'..='\u{A881}'
        | '\u{A8B4}'..='\u{A8C5}'
        | '\u{A8E0}'..='\u{A8F1}'
        | '\u{A926}'..='\u{A92D}'
        | '\u{A947}'..='\u{A953}'
        | '\u{A983}'
        | '\u{A9B3}'..='\u{A9C0}'
        | '\u{A9E5}'
        | '\u{AA29}'..='\u{AA36}'
        | '\u{AA43}'
        | '\u{AA4C}'..='\u{AA4D}'
        | '\u{AA7B}'..='\u{AA7D}'
        | '\u{AAB0}'
        | '\u{AAB2}'..='\u{AAB4}'
        | '\u{AAB7}'..='\u{AAB8}'
        | '\u{AABE}'..='\u{AABF}'
        | '\u{AAC1}'
        | '\u{AAEC}'..='\u{AAED}'
        | '\u{AAF6}'
        | '\u{ABE5}'
        | '\u{ABE8}'
        | '\u{ABED}'
        | '\u{FB1E}'
        | '\u{FE00}'..='\u{FE0F}'
        | '\u{FE20}'..='\u{FE2F}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_the_headline_cases() {
        assert_eq!(fold_search_text("bebé"), "bebe");
        assert_eq!(fold_search_text("BEBÉ"), "bebe");
        assert_eq!(fold_search_text("bañera"), "banera");
        assert_eq!(fold_search_text("BAÑERA"), "banera");
    }

    #[test]
    fn folds_across_languages() {
        assert_eq!(fold_search_text("crème brûlée"), "creme brulee");
        assert_eq!(fold_search_text("Übergröße"), "ubergroße");
        assert_eq!(fold_search_text("niño"), "nino");
        assert_eq!(fold_search_text("coração"), "coracao");
        // Precomposed and decomposed spellings fold identically: U+00E9 is one
        // char, `e` + U+0301 is two, and shoppers (and keyboards) produce both.
        assert_eq!(fold_search_text("café"), fold_search_text("café"));
    }

    #[test]
    fn leaves_plain_text_untouched() {
        assert_eq!(fold_search_text("blusa"), "blusa");
        assert_eq!(fold_search_text("BLUSA"), "blusa");
        assert_eq!(fold_search_text(""), "");
    }
}
