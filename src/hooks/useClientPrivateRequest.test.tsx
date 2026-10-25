import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useClientPrivateRequest } from "./useClientPrivateRequest";
import type { OwnerActionScope } from "./useClientActionsOwner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const f = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), listener: null as null | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => f.rpc(...args), auth: {
  getUser: () => f.user(), onAuthStateChange: (listener: typeof f.listener) => { f.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
} } }));
const actor = "e09d1000-0000-4000-8000-000000000001", tenant = "e09d1000-0000-4000-8000-000000000002";
const contact = "e09d1000-0000-4000-8000-000000000003", other = "e09d1000-0000-4000-8000-000000000004";
const intent = "e09d1000-0000-4000-8000-000000000005", work = "e09d1000-0000-4000-8000-000000000006";
const scope = { actor, tenant, contact }, words = { title: "Read the guide", body: "Start with section one." };
const version = "2026-10-25T06:00:00.123456-04:00";
const request = () => ({ work_id: work, status: "assigned", created_at: version, version, content_state: "prepared", ...words, customer_action_id: null });
const saved = (id = intent) => ({ schema_version: 1, actor_id: actor, tenant_id: tenant, contact_id: contact, intent_id: id,
  found: true, request: request(), recipient_available: true, missing_is_rejection: false, read_at: version });
const history = () => ({ schema_version: 1, actor_id: actor, tenant_id: tenant, contact_id: contact, requests: [], more: false,
  next_cursor: null, recipient_available: true, missing_is_rejection: false, read_at: version });
const ok = (data: unknown) => ({ data, error: null });
const user = (id = actor) => ({ data: { user: { id } }, error: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useClientPrivateRequest>;
function Harness({ value }: { value: OwnerActionScope }) { current = useClientPrivateRequest(value); return null; }
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
const mount = async (value = scope) => { await act(async () => root.render(<Harness value={value} />)); await flush(); };
const invoke = async (fn: () => Promise<void> | void) => { await act(async () => { await fn(); }); await flush(); };
const writes = () => f.rpc.mock.calls.filter(x => x[0] === "prepare_client_portal_request");
beforeEach(() => {
  f.user.mockReset().mockResolvedValue(user()); f.rpc.mockReset().mockImplementation((name: string) => Promise.resolve(ok(name === "prepare_client_portal_request" ? { ...saved(), replayed: false } : name === "read_client_portal_request_draft" ? saved() : history())));
  f.listener = null; vi.spyOn(crypto, "randomUUID").mockReturnValue(intent);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("loads only original private history with actor checks and no mutation", async () => {
  await mount(); expect(current.historyPhase).toBe("ready"); expect(current.history?.requests).toEqual([]);
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith("list_client_portal_request_drafts", { _expected_actor_id: actor, _expected_tenant_id: tenant, _contact_id: contact, _before_created_at: null, _before_work_id: null });
  expect(f.user).toHaveBeenCalledTimes(2); expect(crypto.randomUUID).not.toHaveBeenCalled();
});
it("prepares exact trimmed words once and preserves native Work/version without publication", async () => {
  await mount(); await invoke(() => current.prepare({ title: "  Read the guide\n", body: "\tStart with section one. " }));
  expect(current.phase).toBe("saved"); expect(current.result?.request?.version).toBe(version);
  expect(writes()).toEqual([["prepare_client_portal_request", { _expected_actor_id: actor, _expected_tenant_id: tenant, _contact_id: contact, _intent_id: intent, _title: words.title, _body: words.body }]]);
  expect(f.rpc.mock.calls.every(x => ["prepare_client_portal_request", "list_client_portal_request_drafts"].includes(x[0]))).toBe(true);
});
it("reserves one intent synchronously against double submit before Auth resolves", async () => {
  await mount(); const pending = deferred<ReturnType<typeof user>>(); f.user.mockReturnValueOnce(pending.promise);
  let first!: Promise<void>; act(() => { first = current.prepare(words); void current.prepare(words); }); await flush();
  expect(writes()).toHaveLength(0); expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(user()); await first; }); expect(writes()).toHaveLength(1);
});
it("validates input without a write and permits correction", async () => {
  await mount(); await invoke(() => current.prepare({ title: " ", body: "ok" })); expect(current.phase).toBe("validation"); expect(writes()).toHaveLength(0);
  await invoke(() => current.prepare(words)); expect(current.phase).toBe("saved"); expect(writes()).toHaveLength(1);
});
it("refuses a different actual actor before writing", async () => {
  await mount(); f.user.mockResolvedValue(user(other)); await invoke(() => current.prepare(words));
  expect(current.phase).toBe("refused"); expect(current.result).toBeNull(); expect(writes()).toHaveLength(0);
});
it("does not dispatch after an Auth lookup failure", async () => {
  await mount(); f.user.mockRejectedValue(new Error("offline")); await invoke(() => current.prepare(words));
  expect(current.phase).toBe("error"); expect(writes()).toHaveLength(0);
});
it("treats a missing acknowledgment as unknown and never automatically repeats the mutation", async () => {
  await mount(); f.rpc.mockImplementation(name => name === "prepare_client_portal_request" ? Promise.reject(new Error("lost response")) : Promise.resolve(ok(saved())));
  await invoke(() => current.prepare(words)); expect(current.phase).toBe("unknown");
  await invoke(() => current.prepare(words)); await invoke(() => current.startAnother()); expect(writes()).toHaveLength(1);
  await invoke(() => current.checkSaved()); expect(current.phase).toBe("saved"); expect(current.result?.request?.work_id).toBe(work);
  expect(f.rpc.mock.calls.filter(x => x[0] === "read_client_portal_request_draft")[0][1]._intent_id).toBe(intent);
});
it("keeps missing status unknown instead of treating it as rejection or permission to repeat", async () => {
  await mount(); f.rpc.mockImplementation(name => Promise.resolve(name === "prepare_client_portal_request" ? { data: null, error: { code: "503" } } : ok({ ...saved(), found: false, request: null })));
  await invoke(() => current.prepare(words)); await invoke(() => current.checkSaved());
  expect(current.phase).toBe("unknown"); expect(current.result?.found).toBe(false); expect(current.result?.missing_is_rejection).toBe(false);
  await invoke(() => current.startAnother()); await invoke(() => current.prepare(words)); expect(writes()).toHaveLength(1);
});
it("recovers a timed-out save through status even when its late acknowledgment arrives", async () => {
  await mount(); vi.useFakeTimers(); const pending = deferred<ReturnType<typeof ok>>(); f.rpc.mockImplementation(name => name === "prepare_client_portal_request" ? pending.promise : Promise.resolve(ok(saved())));
  let saving!: Promise<void>; act(() => { saving = current.prepare(words); }); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_001); await saving; }); expect(current.phase).toBe("unknown");
  await invoke(() => current.checkSaved()); expect(current.phase).toBe("saved");
  await act(async () => pending.resolve(ok({ ...saved(), replayed: false }))); expect(current.phase).toBe("saved"); expect(writes()).toHaveLength(1);
});
it("does not replace a pending mutation with an early status read", async () => {
  await mount(); const pending = deferred<ReturnType<typeof ok>>(); f.rpc.mockImplementation(name => name === "prepare_client_portal_request" ? pending.promise : Promise.resolve(ok(saved())));
  let saving!: Promise<void>; act(() => { saving = current.prepare(words); }); await flush(); await invoke(() => current.checkSaved());
  expect(f.rpc.mock.calls.filter(x => x[0] === "read_client_portal_request_draft")).toHaveLength(0);
  await act(async () => { pending.resolve(ok({ ...saved(), replayed: false })); await saving; }); expect(current.phase).toBe("saved");
});
it("refuses native permission failure without exposing private words or allowing another send", async () => {
  await mount(); f.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await invoke(() => current.prepare(words));
  expect(current.phase).toBe("refused"); expect(current.result).toBeNull(); await invoke(() => current.prepare(words)); expect(writes()).toHaveLength(1);
});
it("does not turn a malformed or foreign response into a saved receipt", async () => {
  await mount(); f.rpc.mockResolvedValue(ok({ ...saved(), tenant_id: other, replayed: false })); await invoke(() => current.prepare(words));
  expect(current.phase).toBe("unknown"); expect(current.result).toBeNull();
});
it("rechecks actual identity after a write before exposing its receipt", async () => {
  await mount(); f.user.mockResolvedValueOnce(user()).mockResolvedValueOnce(user(other)); await invoke(() => current.prepare(words));
  expect(writes()).toHaveLength(1); expect(current.phase).toBe("refused"); expect(current.result).toBeNull();
});
it("clears private output immediately on sign-out and rejects the delayed save", async () => {
  await mount(); const pending = deferred<ReturnType<typeof ok>>(); f.rpc.mockImplementation(name => name === "prepare_client_portal_request" ? pending.promise : Promise.resolve(ok(history())));
  let saving!: Promise<void>; act(() => { saving = current.prepare(words); }); await flush(); act(() => f.listener?.("SIGNED_OUT", null));
  expect(current.phase).toBe("refused"); expect(current.history).toBeNull();
  await act(async () => { pending.resolve(ok({ ...saved(), replayed: false })); await saving; }); expect(current.result).toBeNull();
});
it("does not dispatch if identity changes while the initial Auth read waits", async () => {
  await mount(); const pending = deferred<ReturnType<typeof user>>(); f.user.mockReturnValueOnce(pending.promise);
  let saving!: Promise<void>; act(() => { saving = current.prepare(words); }); await flush(); act(() => f.listener?.("TOKEN_REFRESHED", { user: { id: other } }));
  await act(async () => { pending.resolve(user()); await saving; }); expect(writes()).toHaveLength(0); expect(current.phase).toBe("refused");
});
it.each(["actor", "tenant", "contact"] as const)("retires the old %s callback before it can start any request", async field => {
  await mount(); const old = current; const next = { ...scope, [field]: other }; f.user.mockResolvedValue(user(next.actor));
  await mount(next); const count = f.rpc.mock.calls.length;
  await invoke(() => old.prepare(words)); await invoke(() => old.readHistory()); expect(f.rpc.mock.calls).toHaveLength(count); expect(writes()).toHaveLength(0);
});
it.each(["actor", "tenant", "contact"] as const)("withholds a save that completes after switching %s", async field => {
  await mount(); const next = { ...scope, [field]: other }; const pending = deferred<ReturnType<typeof ok>>();
  f.rpc.mockImplementation(name => name === "prepare_client_portal_request" ? pending.promise : Promise.resolve(ok({ ...history(), actor_id: next.actor, tenant_id: next.tenant, contact_id: next.contact })));
  let saving!: Promise<void>; act(() => { saving = current.prepare(words); }); await flush(); f.user.mockResolvedValue(user(next.actor)); await mount(next);
  await act(async () => { pending.resolve(ok({ ...saved(), replayed: false })); await saving; }); expect(current.result).toBeNull(); expect(current.phase).toBe("idle");
});
it("requires an explicit new-request action after an actually recovered Work", async () => {
  await mount(); await invoke(() => current.prepare(words)); await invoke(() => current.prepare(words)); expect(writes()).toHaveLength(1);
  await invoke(() => current.startAnother()); vi.mocked(crypto.randomUUID).mockReturnValue(other);
  f.rpc.mockResolvedValue(ok({ ...saved(other), replayed: false })); await invoke(() => current.prepare(words));
  expect(writes()).toHaveLength(2); expect(writes()[1][1]._intent_id).toBe(other);
});
it("keeps the native raw cursor for an explicit history page without mutating Work", async () => {
  await mount(); const cursor = { created_at: version, work_id: work }; await invoke(() => current.readHistory(cursor));
  expect(f.rpc.mock.calls[f.rpc.mock.calls.length - 1]).toEqual(["list_client_portal_request_drafts", { _expected_actor_id: actor, _expected_tenant_id: tenant, _contact_id: contact, _before_created_at: version, _before_work_id: work }]);
  expect(writes()).toHaveLength(0);
});
it("reopens the original intent after a reload without generating a new request", async () => {
  await mount(); await invoke(() => current.checkSaved(intent));
  expect(current.phase).toBe("saved"); expect(current.result?.request?.work_id).toBe(work);
  expect(f.rpc.mock.calls[f.rpc.mock.calls.length - 1]).toEqual(["read_client_portal_request_draft", { _expected_actor_id: actor, _expected_tenant_id: tenant, _contact_id: contact, _intent_id: intent }]);
  expect(crypto.randomUUID).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0);
});
it("does not lose an uncertain original intent by switching to another history record", async () => {
  await mount(); f.rpc.mockRejectedValue(new Error("lost")); await invoke(() => current.prepare(words));
  const count = f.rpc.mock.calls.length; await invoke(() => current.checkSaved(other));
  expect(f.rpc.mock.calls).toHaveLength(count); expect(current.phase).toBe("unknown");
});
it("keeps a missing reopened intent unknown and blocks replacement preparation", async () => {
  await mount(); f.rpc.mockResolvedValue(ok({ ...saved(), found: false, request: null })); await invoke(() => current.checkSaved(intent));
  expect(current.phase).toBe("unknown"); await invoke(() => current.prepare(words)); expect(writes()).toHaveLength(0); expect(crypto.randomUUID).not.toHaveBeenCalled();
});
it("validates a selected history intent before any Auth or native call", async () => {
  await mount(); const count = f.rpc.mock.calls.length, auth = f.user.mock.calls.length;
  await invoke(() => current.checkSaved("untrusted-invalid-id")); expect(current.phase).toBe("validation");
  expect(f.rpc.mock.calls).toHaveLength(count); expect(f.user).toHaveBeenCalledTimes(auth);
});
it("does not paint a wrong-customer history as empty or ready", async () => {
  f.rpc.mockResolvedValue(ok({ ...history(), contact_id: other })); await mount(); expect(current.historyPhase).toBe("error"); expect(current.history).toBeNull();
});
it("keeps a denied history distinct from an authorized empty result", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await mount(); expect(current.historyPhase).toBe("refused"); expect(current.history).toBeNull();
});
it("clears an earlier private receipt when a later native read refuses access", async () => {
  await mount(); await invoke(() => current.prepare(words)); expect(current.result?.found).toBe(true);
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await invoke(() => current.readHistory());
  expect(current.result).toBeNull(); expect(current.phase).toBe("refused");
  await invoke(() => current.startAnother()); await invoke(() => current.prepare(words)); expect(writes()).toHaveLength(1);
});
it("requires fresh status proof after an unsuccessful check, even if an earlier read found the Work", async () => {
  await mount(); await invoke(() => current.prepare(words)); f.rpc.mockResolvedValue({ data: null, error: { code: "503" } });
  await invoke(() => current.checkSaved()); expect(current.phase).toBe("unknown");
  await invoke(() => current.startAnother()); await invoke(() => current.prepare(words)); expect(writes()).toHaveLength(1);
});
it("lets a newer explicit history read win over an older delayed page", async () => {
  await mount(); const pending = deferred<ReturnType<typeof ok>>(); f.rpc.mockReturnValueOnce(pending.promise); let first!: Promise<void>;
  act(() => { first = current.readHistory(); }); await flush(); await invoke(() => current.readHistory());
  await act(async () => { pending.resolve(ok({ ...history(), contact_id: other })); await first; }); expect(current.historyPhase).toBe("ready");
});
it("invalidates an in-flight write receipt when a parallel native history read refuses", async () => {
  await mount(); const pending = deferred<ReturnType<typeof ok>>();
  f.rpc.mockImplementation(name => name === "prepare_client_portal_request" ? pending.promise : Promise.resolve({ data: null, error: { code: "42501" } }));
  let saving!: Promise<void>; act(() => { saving = current.prepare(words); }); await flush(); await invoke(() => current.readHistory());
  await act(async () => { pending.resolve(ok({ ...saved(), replayed: false })); await saving; });
  expect(current.phase).toBe("refused"); expect(current.result).toBeNull(); expect(current.history).toBeNull();
});
it("has no network side effect after unmount, even through a retained callback", async () => {
  await mount(); const old = current; act(() => root.unmount()); const count = f.rpc.mock.calls.length;
  await invoke(() => old.prepare(words)); await invoke(() => old.checkSaved()); await invoke(() => old.readHistory()); expect(f.rpc.mock.calls).toHaveLength(count);
  root = createRoot(host);
});
