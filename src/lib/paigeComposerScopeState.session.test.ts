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
const knowledgeIntake={extractionWorkId:'00000000-0000-4000-8000-000000000010',
  documentId:'00000000-0000-4000-8000-000000000020',extractionIntentId:'00000000-0000-4000-8000-000000000030',
  sourceSha256:'a'.repeat(64),expectedSourceRevision:1,turnId:null,expectedLinkRevision:0 as const};

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
  it('retains only original native intake parameters across a cold reload with an empty draft',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.saveComposerKnowledgeIntake(handle,knowledgeIntake)).toBe(true);
    const raw=JSON.parse(sessionStorage.getItem(cacheKey)!);
    expect(raw.entries[0]).toMatchObject({text:'',knowledgeIntake});
    store=await freshStore();expect(store.readComposerKnowledgeIntake(handle)).toBeNull();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    expect(store.readComposerKnowledgeIntake({...handle,conversationId:'different'})).toBeNull();
  });
  it('expires unsent text while keeping unresolved native-effect recovery until inspected',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);store.writeComposerDraft(handle,'Private unsent thought');
    expect(store.saveComposerKnowledgeIntake(handle,knowledgeIntake)).toBe(true);vi.advanceTimersByTime(25*60*60*1000);
    store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerDraft(handle)).toBe('');expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    expect(sessionStorage.getItem(cacheKey)).not.toContain('Private unsent thought');
  });
  it('refuses dispatch recovery if storage is unavailable and never overwrites an unresolved intent',async()=>{
    const store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.saveComposerKnowledgeIntake(handle,knowledgeIntake)).toBe(true);
    expect(store.saveComposerKnowledgeIntake(handle,{...knowledgeIntake,sourceSha256:'b'.repeat(64)})).toBe(false);
    expect(store.clearComposerKnowledgeIntake(handle,'00000000-0000-4000-8000-000000000099')).toBe(false);
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Storage unavailable');});
    expect(store.saveComposerKnowledgeIntake({...handle,conversationId:'new-chat'},knowledgeIntake)).toBe(false);
    expect(store.readComposerKnowledgeIntake({...handle,conversationId:'new-chat'})).toBeNull();
  });
  it('does not lose native recovery when the unsent text is cleared or consumed',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);store.writeComposerDraft(handle,'Draft');
    store.saveComposerKnowledgeIntake(handle,knowledgeIntake);store.takeComposerDraft(handle);store.clearComposerDraft(handle);
    store=await freshStore();store.setComposerDraftSessionScope(owner);expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    expect(store.clearComposerKnowledgeIntake(handle,knowledgeIntake.extractionWorkId)).toBe(true);
    store=await freshStore();store.setComposerDraftSessionScope(owner);expect(store.readComposerKnowledgeIntake(handle)).toBeNull();
  });
  it('withholds foreign actor/workspace recovery and purges it on sign-out',async()=>{
    const store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.saveComposerKnowledgeIntake({...handle,userId:'another'},knowledgeIntake)).toBe(false);
    expect(store.saveComposerKnowledgeIntake({...handle,tenantId:'another'},knowledgeIntake)).toBe(false);
    store.saveComposerKnowledgeIntake(handle,knowledgeIntake);store.setComposerDraftSessionScope({kind:'clear'});
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();expect(sessionStorage.getItem(cacheKey)).toBeNull();
  });
  it('rejects a modified cache containing source text or invalid native parameters',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);store.saveComposerKnowledgeIntake(handle,knowledgeIntake);
    const raw=JSON.parse(sessionStorage.getItem(cacheKey)!);raw.entries[0].knowledgeIntake.sourceText='Must not become an upload queue';
    sessionStorage.setItem(cacheKey,JSON.stringify(raw));store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();expect(sessionStorage.getItem(cacheKey)).toBeNull();
  });
  it('keeps an already-dispatched intake recoverable when a later draft cache write fails',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);store.saveComposerKnowledgeIntake(handle,knowledgeIntake);
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Later quota failure');});
    store.writeComposerDraft(handle,'New unsent thought');vi.restoreAllMocks();
    store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    expect(store.readComposerDraft(handle)).toBe('');
  });
  it.each(['draft','unresolved','workspace'] as const)('does not erase native recovery when later cache reads and writes both become unavailable: %s',async(change)=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.saveComposerKnowledgeIntake(handle,knowledgeIntake)).toBe(true);
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Write unavailable');});
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Read unavailable');});
    store.writeComposerDraft(handle,'New draft');
    if(change==='unresolved')store.setComposerDraftSessionScope({kind:'unresolved'});
    if(change==='workspace')store.setComposerDraftSessionScope({...owner,tenantId:'test-tenant-b'});
    vi.restoreAllMocks();
    store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    expect(store.readComposerDraft(handle)).toBe('');
  });
  it('never evicts unresolved native pointers to fit expanded ordinary draft text',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);
    const handles=Array.from({length:8},(_,index)=>({...handle,conversationId:`thread-${index}`}));
    for(const target of handles)expect(store.saveComposerKnowledgeIntake(target,knowledgeIntake)).toBe(true);
    for(const target of handles)store.writeComposerDraft(target,'\n'.repeat(20_000));
    store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(handles.map(target=>store.readComposerKnowledgeIntake(target))).toEqual(handles.map(()=>knowledgeIntake));
    expect(handles.every(target=>store.readComposerDraft(target)==='')).toBe(true);
  });
  it('withholds a cold unreadable recovery cache until inspection can resume',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.saveComposerKnowledgeIntake(handle,knowledgeIntake)).toBe(true);
    store=await freshStore();
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('Read unavailable');});
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('Write unavailable');});
    store.setComposerDraftSessionScope(owner);store.writeComposerDraft(handle,'New input');
    expect(store.readComposerKnowledgeRecoveryState(handle)).toBe('unavailable');
    expect(store.saveComposerKnowledgeIntake(handle,knowledgeIntake)).toBe(false);
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();
    store.setComposerDraftSessionScope({kind:'unresolved'});vi.restoreAllMocks();
    store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeRecoveryState(handle)).toBe('pending');
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    store=await freshStore();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
  });
  it('withholds recovery during transient resolution without erasing the original native intent',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);store.saveComposerKnowledgeIntake(handle,knowledgeIntake);
    store.setComposerDraftSessionScope({kind:'unresolved'});expect(store.readComposerKnowledgeIntake(handle)).toBeNull();
    store=await freshStore();store.setComposerDraftSessionScope(owner);expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    store.setComposerDraftSessionScope({kind:'unresolved'});store.setComposerDraftSessionScope({kind:'clear'});
    store.setComposerDraftSessionScope(owner);expect(store.readComposerKnowledgeIntake(handle)).toBeNull();
  });
  it('retains opaque pending metadata across same-actor A to B to cold A without exposing another scope',async()=>{
    let store=await freshStore();store.setComposerDraftSessionScope(owner);store.saveComposerKnowledgeIntake(handle,knowledgeIntake);
    const second={...owner,tenantId:'test-tenant-b'};store.setComposerDraftSessionScope(second);
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();store=await freshStore();store.setComposerDraftSessionScope(second);
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toEqual(knowledgeIntake);
    store.setComposerDraftSessionScope({...owner,userId:'test-user-b'});store.setComposerDraftSessionScope(owner);
    expect(store.readComposerKnowledgeIntake(handle)).toBeNull();
  });
});
