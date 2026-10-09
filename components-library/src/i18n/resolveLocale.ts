/** Supported locales: English default, Spanish. No switcher — detected only. */
export type Locale = "en" | "es"

/**
 * Normalises a device/browser language tag to a supported locale.
 * `es`, `es-ES`, `es-MX`… → `es`; anything else (including undefined) → `en`.
 */
export function resolveLocale(tag?: string | null): Locale {
  if (!tag) return "en"
  return tag.toLowerCase().startsWith("es") ? "es" : "en"
}

/** `Intl` locale tag for number/currency formatting. */
export function localeTag(locale: Locale): string {
  return locale === "es" ? "es-ES" : "en-US"
}
