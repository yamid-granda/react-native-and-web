import { en, type DictKey } from "./en"
import { es } from "./es"
import type { Locale } from "./resolveLocale"

const dictionaries = { en, es } as const

export type TVars = Record<string, string | number>

/** Looks up `key` in `locale` (English fallback) and fills `{placeholders}`. */
export function translate(locale: Locale, key: DictKey, vars?: TVars): string {
  const dict = dictionaries[locale] ?? en
  let template: string = dict[key] ?? en[key]
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      template = template.replaceAll(`{${name}}`, String(value))
    }
  }
  return template
}
