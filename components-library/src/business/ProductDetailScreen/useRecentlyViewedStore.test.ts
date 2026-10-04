import { beforeEach, describe, expect, it } from "vitest"
import { useRecentlyViewedStore } from "./useRecentlyViewedStore"

describe("useRecentlyViewedStore", () => {
  beforeEach(() => {
    useRecentlyViewedStore.setState({ ids: [] })
  })

  it("recordView adds an id to the front of the list", () => {
    useRecentlyViewedStore.getState().recordView("1")
    expect(useRecentlyViewedStore.getState().ids).toEqual(["1"])
  })

  it("recordView puts the most recently viewed id first", () => {
    useRecentlyViewedStore.getState().recordView("1")
    useRecentlyViewedStore.getState().recordView("2")
    expect(useRecentlyViewedStore.getState().ids).toEqual(["2", "1"])
  })

  it("recordView moves an already-viewed id to the front instead of duplicating it", () => {
    useRecentlyViewedStore.getState().recordView("1")
    useRecentlyViewedStore.getState().recordView("2")
    useRecentlyViewedStore.getState().recordView("1")
    expect(useRecentlyViewedStore.getState().ids).toEqual(["1", "2"])
  })

  it("caps the list at 10 entries, dropping the oldest", () => {
    for (let i = 0; i < 11; i++) useRecentlyViewedStore.getState().recordView(String(i))
    const ids = useRecentlyViewedStore.getState().ids
    expect(ids).toHaveLength(10)
    expect(ids[0]).toBe("10")
    expect(ids.includes("0")).toBe(false)
  })

  /// Ordering, de-duplication and the cap are the ordering logic this store still
  /// owns — the products moved to the lookup, but the sequence did not. Kept
  /// deliberately: they are asserted here against ids rather than against a
  /// fixture, which is the same rule with less to go stale.
  it("keeps the newest ten in most-recent-first order", () => {
    for (let i = 0; i < 10; i++) useRecentlyViewedStore.getState().recordView(String(i))
    useRecentlyViewedStore.getState().recordView("11")
    expect(useRecentlyViewedStore.getState().ids).toEqual([
      "11",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
      "2",
      "1",
    ])
  })
})
