/**
 * Folds `text` for accent- and case-insensitive search: Unicode NFKD
 * decomposition (UTS #15), drop the combining marks, lowercase. `bebé` and
 * `bebe` both fold to `bebe`; `bañera` and `banera` both fold to `banera`.
 *
 * This is the client-side twin of the server search: api-rs folds `?q=` with
 * the same NFKD step (`store/search.rs`) and folds the columns with
 * Postgres `unaccent()`. The three agree on the Latin range, so a row the
 * server returns for `?q=bebe` survives this filter over the fetched pages —
 * folding only the query, or only the rows, would hide results.
 *
 * The mark range is the Combining Diacritical Marks block (U+0300–U+036F),
 * which is where every Latin accent lands after NFKD (`é` → `e` + U+0301,
 * `ñ` → `n` + U+0303, `ç` → `c` + U+0327). Marks from other scripts keep
 * their base character unfolded, exactly as on the server for that range.
 *
 * The `normalize` guard is for JS engines predating `String.normalize`:
 * they keep the old lowercase-only behaviour instead of throwing.
 */
export function normalizeSearchText(text: string): string {
  const lowercased = text.toLowerCase()
  if (typeof lowercased.normalize !== "function") return lowercased
  return lowercased.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
}
