import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createPersistStorage } from "./persistStorage"

type TestState = { value: string }

/**
 * A fresh store over the same key is what a page reload produces: a new store
 * instance hydrating from the storage the previous one wrote. The adapter is
 * private, so this drives it through the public factory and the real
 * `localStorage` global rather than exporting it for the sake of a test.
 */
function createTestStore(name: string) {
  return create<TestState>()(
    persist(() => ({ value: "" }), { name, storage: createPersistStorage<TestState>() }),
  )
}

/** `localStorage` present, writes refused — Safari private mode past its quota, an origin at its cap. */
function refuseWrites() {
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError")
  })
}

/** The same API blocked for reads — a sandboxed frame, storage denied by policy. */
function refuseReads() {
  return vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("access denied", "SecurityError")
  })
}

// `.web.test.tsx` rather than `.test.ts` on purpose: this adapter is chosen by
// `typeof localStorage`, and the `utils` project is node-only — no DOM, so the
// in-memory fallback would be exercised instead of the real web path.
describe("createPersistStorage (web)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /// The bug this file guards. `setItem` degraded a refused write to the
  /// in-memory `Map`, but `getItem` only ever consulted `localStorage` and
  /// `removeItem` was the single method that knew the `Map` existed — so the
  /// value was written somewhere no read path would look, and the next reload
  /// silently lost it. For `useSessionStore` that is the seller's session.
  it("reads back a write that localStorage refused", async () => {
    refuseWrites()

    const writer = createTestStore("refused-write")
    writer.setState({ value: "written anyway" })

    const reader = createTestStore("refused-write")
    await reader.persist.rehydrate()

    expect(reader.getState().value).toBe("written anyway")
  })

  /// The happy path, so the fix above cannot degenerate into "always use the
  /// `Map`" and quietly stop persisting across page loads.
  it("reads back a write that localStorage accepted", async () => {
    const writer = createTestStore("accepted-write")
    writer.setState({ value: "written" })
    // The durable copy really is there, so this is not passing on the fallback.
    expect(localStorage.getItem("accepted-write")).not.toBeNull()

    const reader = createTestStore("accepted-write")
    await reader.persist.rehydrate()

    expect(reader.getState().value).toBe("written")
  })

  /// The third method's half of the incoherence: it cleared the `Map`
  /// unconditionally but could leave `localStorage` holding the value. A
  /// removal that only clears one of the two copies leaves a stale read behind.
  it("clears both copies on removeItem", async () => {
    const writer = createTestStore("removed")
    writer.setState({ value: "written" })

    writer.persist.clearStorage()

    expect(localStorage.getItem("removed")).toBeNull()
    const reader = createTestStore("removed")
    await reader.persist.rehydrate()
    expect(reader.getState().value).toBe("")
  })

  /// The case `:28-33` was written for: reads blocked outright. Degrading to
  /// `null` throws away a value the adapter is already holding, which is how a
  /// storage-blocked browser ends up signed out on every reload.
  it("falls back to the in-memory copy when localStorage refuses to read", async () => {
    const writes = refuseWrites()
    const writer = createTestStore("blocked-read")
    writer.setState({ value: "written anyway" })
    writes.mockRestore()

    refuseReads()
    const reader = createTestStore("blocked-read")
    await reader.persist.rehydrate()

    expect(reader.getState().value).toBe("written anyway")
  })
})
