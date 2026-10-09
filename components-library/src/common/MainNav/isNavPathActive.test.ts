import { describe, expect, it } from "vitest"
import { isNavPathActive } from "./isNavPathActive"

describe("isNavPathActive", () => {
  it("marks Home for the catalogue, including product and store detail pages", () => {
    expect(isNavPathActive("/", "/")).toBe(true)
    expect(isNavPathActive("/product/42", "/")).toBe(true)
    expect(isNavPathActive("/stores/7", "/")).toBe(true)
  })

  it("never marks Home for every other route", () => {
    expect(isNavPathActive("/cart", "/")).toBe(false)
    expect(isNavPathActive("/my-store", "/")).toBe(false)
  })

  it("matches a section by exact path or its child routes", () => {
    expect(isNavPathActive("/cart", "/cart")).toBe(true)
    expect(isNavPathActive("/cart/checkout", "/cart")).toBe(true)
    expect(isNavPathActive("/wishlist", "/cart")).toBe(false)
  })

  it("does not match a sibling that only shares a prefix", () => {
    expect(isNavPathActive("/carts", "/cart")).toBe(false)
  })

  it("is inactive when there is no pathname yet", () => {
    expect(isNavPathActive("", "/")).toBe(false)
    expect(isNavPathActive("", "/cart")).toBe(false)
  })
})
