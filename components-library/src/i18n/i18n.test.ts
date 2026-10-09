import { describe, expect, it } from "vitest"
import { en } from "./en"
import { es } from "./es"
import { localeTag, resolveLocale } from "./resolveLocale"
import { translate } from "./translate"
import { formatPrice } from "../utils/formatPrice"

describe("resolveLocale", () => {
  it("detects Spanish variants and falls back to English", () => {
    expect(resolveLocale("es")).toBe("es")
    expect(resolveLocale("es-ES")).toBe("es")
    expect(resolveLocale("es-MX")).toBe("es")
    expect(resolveLocale("ES-es")).toBe("es")
    expect(resolveLocale("en")).toBe("en")
    expect(resolveLocale("en-US")).toBe("en")
    expect(resolveLocale("fr")).toBe("en")
    expect(resolveLocale(undefined)).toBe("en")
    expect(resolveLocale(null)).toBe("en")
    expect(resolveLocale("")).toBe("en")
  })

  it("maps to Intl tags", () => {
    expect(localeTag("es")).toBe("es-ES")
    expect(localeTag("en")).toBe("en-US")
  })
})

describe("dictionaries", () => {
  it("es carries exactly the en keys (no missed translations, no extras)", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })

  it("no template placeholder is dropped in translation", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(es[key])).toEqual(placeholders(en[key]))
    }
  })

  it("no value is empty", () => {
    for (const value of [...Object.values(en), ...Object.values(es)]) {
      expect(value.trim().length).toBeGreaterThan(0)
    }
  })
})

describe("translate", () => {
  it("interpolates vars and falls back per key", () => {
    expect(translate("en", "cartMissingMany", { count: 3 })).toBe(
      "3 saved items are no longer available.",
    )
    expect(translate("es", "cartMissingMany", { count: 3 })).toBe(
      "3 artículos guardados ya no están disponibles.",
    )
    expect(translate("es", "detailSoldBy", { name: "Ribera" })).toBe("Vendido por Ribera")
  })
})

describe("formatPrice", () => {
  it("formats per locale", () => {
    expect(formatPrice(24.99, "USD", "en-US")).toContain("$24.99")
    expect(formatPrice(24.99, "USD", "es-ES")).toContain("24,99")
  })
})
