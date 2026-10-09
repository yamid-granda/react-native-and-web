import { createContext, useContext, type ReactNode } from "react"
import type { DictKey } from "./en"
import type { Locale } from "./resolveLocale"
import { translate, type TVars } from "./translate"

const LocaleContext = createContext<{ locale: Locale }>({ locale: "en" })

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={{ locale }}>{children}</LocaleContext.Provider>
}

/** Current detected locale (`en` when no provider — keeps existing tests green). */
export function useLocale(): { locale: Locale } {
  return useContext(LocaleContext)
}

export type TFunction = (key: DictKey, vars?: TVars) => string

/** Bound translator for the current locale. */
export function useT(): TFunction {
  const { locale } = useLocale()
  return (key, vars) => translate(locale, key, vars)
}
