import { createContext, useContext, type ReactNode } from "react"
import type { DictKey } from "./en"
import type { Locale } from "./resolveLocale"
import { translate, type TVars } from "./translate"

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue>({ locale: "en", setLocale: () => {} })

export function LocaleProvider({
  locale,
  onLocaleChange,
  children,
}: {
  locale: Locale
  onLocaleChange?: (locale: Locale) => void
  children: ReactNode
}) {
  return (
    <LocaleContext.Provider value={{ locale, setLocale: onLocaleChange ?? (() => {}) }}>
      {children}
    </LocaleContext.Provider>
  )
}

/** Current locale (`en` when no provider — keeps existing tests green). */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext)
}

export type TFunction = (key: DictKey, vars?: TVars) => string

/** Bound translator for the current locale. */
export function useT(): TFunction {
  const { locale } = useLocale()
  return (key, vars) => translate(locale, key, vars)
}
