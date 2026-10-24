import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheKey = "paige.composer.drafts.v1";
const owner = { kind: "ready" as const, tenantId: "test-tenant-a", userId: "test-user-a" };
const handle = {
  tenantId: owner.tenantId, userId: owner.userId, conversationId: "thread-a",
  focusedClientId: "none", focusedBusinessMissionId: "none",
};
const freshStore = async () => {
  vi.resetModules();
  return import("./paigeComposerScopeState");
};

describe("optional same-tab composer recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T06:00:00Z"));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("is disabled by default and preserves existing memory-only behavior", async () => {
    const store = await freshStore();
    store.writeComposerDraft(handle, "Unsent question");
    expect(store.readComposerDraft(handle)).toBe("Unsent question");
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
    expect((await freshStore()).readComposerDraft(handle)).toBe("");
  });

  it("restores only after the actual actor/workspace has been bound", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "How is my business doing?");
    store = await freshStore();
    store.setComposerDraftSessionScope({ kind: "unresolved" });
    expect(store.readComposerDraft(handle)).toBe("");
    expect(sessionStorage.getItem(cacheKey)).not.toBeNull();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("How is my business doing?");
  });

  it.each([
    { tenantId: "test-tenant-b" }, { userId: "test-user-b" },
    { conversationId: "thread-b" }, { conversationId: "new-chat" },
    { focusedClientId: "client-a" }, { focusedBusinessMissionId: "play-a" },
  ])("retains the full five-axis key; other slot %j stays empty", async (change) => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Only the original context");
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft({ ...handle, ...change })).toBe("");
    expect(store.readComposerDraft(handle)).toBe("Only the original context");
  });

  it("does not persist effective-user, foreign-workspace or platform text", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    for (const change of [{ userId: "effective-user" }, { tenantId: "test-tenant-b" }, { tenantId: "platform" }]) {
      store.writeComposerDraft({ ...handle, ...change }, "Excluded context");
    }
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("");
  });

  it.each(["clear", "take"])("%s cannot revive submitted/deleted text after reload", async (action) => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Must not return");
    if (action === "take") expect(store.takeComposerDraft(handle).text).toBe("Must not return");
    else store.clearComposerDraft(handle);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("");
  });

  it("restores a definite refusal but never overwrites a later edit or empty tombstone", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Refused question");
    const submitted = store.takeComposerDraft(handle);
    expect(store.restoreComposerDraft(handle, submitted)).toBe(true);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("Refused question");
    const later = store.takeComposerDraft(handle);
    store.writeComposerDraft(handle, "New thought");
    store.clearComposerDraft(handle);
    expect(store.restoreComposerDraft(handle, later)).toBe(false);
  });

  it("does not hydrate over a newer in-memory edit or explicit clear", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Old cache");
    store = await freshStore();
    store.clearComposerDraft(handle);
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("");
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
  });

  it.each([{ userId: "test-user-b" }, { tenantId: "test-tenant-b" }])(
    "retirement prevents A→B→A stale refusal resurrection: %j", async (change) => {
      const store = await freshStore();
      store.setComposerDraftSessionScope(owner);
      store.writeComposerDraft(handle, "Old actor draft");
      const pending = store.takeComposerDraft(handle);
      store.setComposerDraftSessionScope({ ...owner, ...change });
      store.setComposerDraftSessionScope(owner);
      expect(store.restoreComposerDraft(handle, pending)).toBe(false);
      expect(store.readComposerDraft(handle)).toBe("");
      expect(sessionStorage.getItem(cacheKey)).toBeNull();
    },
  );

  it.each(["unresolved", "clear"] as const)("%s retires a known owner; a cold sign-out purges stored text", async (kind) => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Retired text");
    store.setComposerDraftSessionScope({ kind });
    expect(store.readComposerDraft(handle)).toBe("");
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Cold signed-out text");
    store = await freshStore();
    store.setComposerDraftSessionScope({ kind: "clear" });
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("");
  });

  it("preserves existing same-actor workspace drafts, then clears all of that actor on sign-out", async () => {
    const store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Business A question");
    const second = { ...owner, tenantId: "test-tenant-b" };
    const secondHandle = { ...handle, tenantId: second.tenantId };
    store.setComposerDraftSessionScope(second);
    store.writeComposerDraft(secondHandle, "Business B question");
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("Business A question");
    expect(store.readComposerDraft(secondHandle)).toBe("Business B question");
    expect(sessionStorage.getItem(cacheKey)).not.toContain("Business B question");
    store.setComposerDraftSessionScope({ kind: "clear" });
    expect(store.readComposerDraft(handle)).toBe("");
    expect(store.readComposerDraft(secondHandle)).toBe("");
  });

  it("moves an unsent new-chat draft once and retains a newer destination", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    const fresh = { ...handle, conversationId: "new-chat" };
    store.writeComposerDraft(fresh, "New question");
    store.moveComposerDraft(fresh, handle);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(fresh)).toBe("");
    expect(store.readComposerDraft(handle)).toBe("New question");
    store.writeComposerDraft(fresh, "Another question");
    store.moveComposerDraft(fresh, handle);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(fresh)).toBe("Another question");
    expect(store.readComposerDraft(handle)).toBe("New question");
  });

  it("drops expired cache and never truncates an oversized in-memory thought", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Expired");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("");
    store.writeComposerDraft(handle, "x".repeat(20_001));
    expect(store.readComposerDraft(handle)).toHaveLength(20_001);
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
  });

  it("bounds retained contexts to the eight most recently edited", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(1);
      store.writeComposerDraft({ ...handle, conversationId: `thread-${i}` }, `Thought ${i}`);
    }
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft({ ...handle, conversationId: "thread-0" })).toBe("");
    expect(store.readComposerDraft({ ...handle, conversationId: "thread-8" })).toBe("Thought 8");
  });

  it("bounds serialized storage while retaining the newest untruncated text", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    const text = "\u0000".repeat(20_000);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(1);
      store.writeComposerDraft({ ...handle, conversationId: `escaped-${i}` }, text);
    }
    expect(sessionStorage.getItem(cacheKey)!.length).toBeLessThanOrEqual(200_000);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft({ ...handle, conversationId: "escaped-7" })).toBe(text);
  });

  it("keeps the latest edit when more than eight slots change in the same millisecond", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    for (let i = 0; i < 9; i++) {
      store.writeComposerDraft({ ...handle, conversationId: `same-tick-${i}` }, `Thought ${i}`);
    }
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft({ ...handle, conversationId: "same-tick-0" })).toBe("");
    expect(store.readComposerDraft({ ...handle, conversationId: "same-tick-8" })).toBe("Thought 8");
  });

  it("hydration cannot evict a newer in-memory edit when cached timestamps tie", async () => {
    let store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    for (let i = 0; i < 8; i++) {
      store.writeComposerDraft({ ...handle, conversationId: `hydrate-${i}` }, `Old ${i}`);
    }
    store = await freshStore();
    const latest = { ...handle, conversationId: "hydrate-8" };
    store.writeComposerDraft(latest, "Newer before auth finished");
    store.setComposerDraftSessionScope(owner);
    store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(latest)).toBe("Newer before auth finished");
    expect(store.readComposerDraft({ ...handle, conversationId: "hydrate-7" })).toBe("Old 7");
    expect(store.readComposerDraft({ ...handle, conversationId: "hydrate-0" })).toBe("");
  });

  it.each(["foreign-owner", "future-time", "duplicate-slot", "invalid-slot", "unknown-version"])(
    "refuses a tampered cache before hydrating any entry: %s", async (change) => {
      let store = await freshStore();
      store.setComposerDraftSessionScope(owner);
      store.writeComposerDraft(handle, "Do not hydrate from invalid cache");
      const cache = JSON.parse(sessionStorage.getItem(cacheKey)!);
      if (change === "foreign-owner") cache.owner.userId = "foreign-user";
      if (change === "future-time") cache.entries[0].updatedAt = Date.now() + 1;
      if (change === "duplicate-slot") cache.entries.push(cache.entries[0]);
      if (change === "invalid-slot") cache.entries.push({ ...cache.entries[0], key: '["wrong"]' });
      if (change === "unknown-version") cache.version = 2;
      sessionStorage.setItem(cacheKey, JSON.stringify(cache));
      store = await freshStore();
      store.setComposerDraftSessionScope(owner);
      expect(store.readComposerDraft(handle)).toBe("");
      expect(sessionStorage.getItem(cacheKey)).toBeNull();
    },
  );

  it("never consults local storage and tolerates a throwing session storage getter", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const store = await freshStore();
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("Storage denied"); });
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Keep current text");
    expect(store.readComposerDraft(handle)).toBe("Keep current text");
    expect(local).not.toHaveBeenCalled();
  });

  it.each(["{", '{"version":2}', "x".repeat(200_001)])("rejects malformed/unknown/oversized cache", async (raw) => {
    sessionStorage.setItem(cacheKey, raw);
    const store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe("");
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
  });

  it("keeps current input when storage is blocked and removes stale text after quota failure", async () => {
    const store = await freshStore();
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Old stored thought");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    store.writeComposerDraft(handle, "New current thought");
    expect(store.readComposerDraft(handle)).toBe("New current thought");
    expect(sessionStorage.getItem(cacheKey)).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    store.setComposerDraftSessionScope({ kind: "clear" });
    store.setComposerDraftSessionScope(owner);
    store.writeComposerDraft(handle, "Still editable");
    expect(store.readComposerDraft(handle)).toBe("Still editable");
  });
});
