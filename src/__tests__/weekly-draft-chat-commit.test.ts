import { afterEach, describe, expect, it, vi } from "vitest";
import { commitWeeklyDraftChatApproval } from "../../supabase/functions/_shared/paige-orchestration/weekly-draft-chat-commit";

const actor = "11111111-1111-4111-8111-111111111111", tenant = "22222222-2222-4222-8222-222222222222";
const confirmation = "33333333-3333-4333-8333-333333333333", thread = "44444444-4444-4444-8444-444444444444";
const request = "55555555-5555-4555-8555-555555555555", process = "66666666-6666-4666-8666-666666666666";
const nonce = "77777777-7777-4777-8777-777777777777", intent = "88888888-8888-4888-8888-888888888888";
const runtimeNonce = "99999999-9999-4999-8999-999999999999", receipt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const args = () => ({ _request_id: request, _name: "Weekly responsibility", _weekday: 1,
  _local_time: "09:00", _timezone: "America/New_York" });
const options = () => ({
  claim: { status: "claimed" as const, storedArgs: args(), rpcAttempted: true as const,
    retryAllowed: false as const, genericFallbackAllowed: false as const },
  confirmationId: confirmation, confirmationRequestNonce: nonce,
  scope: { actorId: actor, tenantId: tenant, threadId: thread, clientId: null },
  runtime: { intentId: intent, requestNonce: runtimeNonce },
  callerFacts: { authenticated: true, userId: actor, tenantId: tenant, tenantSource: "server" as const,
    principal: "person" as const, door: "chat" as const, access: { allowed: true } },
  availability: "live" as const, autonomyLane: "confirm", remainingMs: 12000,
  current: () => true, signal: new AbortController().signal,
});
const saved = () => ({ ok: true, actor_id: actor, tenant_id: tenant, thread_id: thread,
  confirmation_id: confirmation, request_id: request, phase: "saved",
  read_at: "2026-10-24T21:00:00Z", expires_at: "2026-10-24T21:10:00Z",
  summary: "Private approval summary", draft: { name: "Weekly responsibility", weekday: 1,
    local_time: "09:00", timezone: "America/New_York" }, confirmation_token: null,
  automation_id: process, revision: 1, process_state: "draft", receipt_id: receipt, recurrence_authorized: false });
type Reply = { data: unknown; error: unknown };
const caller = (data: unknown = saved()) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
afterEach(() => vi.useRealTimers());

describe("original weekly Chat save after native claim and existing Kit decision", () => {
  it("commits only the exact stored call and returns the original draft and Rail references", async () => {
    const db = caller(), result = await commitWeeklyDraftChatApproval(db, options());
    expect(db.rpc.mock.calls).toEqual([["commit_weekly_commitment_chat_draft", {
      _confirmation_id: confirmation, _request_nonce: nonce, _expected_args: args(),
      _expected_thread_id: thread, _intent_id: intent, _runtime_request_nonce: runtimeNonce,
    }]]);
    expect(result).toMatchObject({ status: "saved", commitAttempted: true, retryAllowed: false,
      genericFallbackAllowed: false, record: { automationId: process, receiptId: receipt, requestId: request },
      context: { phase: "saved", definition_is_current: "saved_draft" } });
    expect(JSON.stringify(result)).not.toContain(saved().summary);
    expect(result).not.toHaveProperty("approvalToken");
  });
  it.each([
    { availability: "unavailable" }, { availability: "unknown" }, { autonomyLane: "off" },
    { callerFacts: { ...options().callerFacts, authenticated: false } },
    { callerFacts: { ...options().callerFacts, access: { allowed: false } } },
    { callerFacts: { ...options().callerFacts, tenantSource: "request" } },
    { callerFacts: { ...options().callerFacts, principal: "service" } },
    { callerFacts: { ...options().callerFacts, tenantId: process } },
    { scope: { ...options().scope, clientId: process } },
    { runtime: { intentId: intent, requestNonce: null } },
    { claim: { ...options().claim, status: "observed" } },
    { claim: { ...options().claim, storedArgs: { ...args(), _weekday: 9 } } },
    { claim: { ...options().claim, storedArgs: { ...args(), extra: true } } },
    { remainingMs: 0 }, { remainingMs: 12001 }, { current: () => false },
  ])("refuses unsafe or unavailable execution facts before a write: %j", async change => {
    const db = caller();
    const result = await commitWeeklyDraftChatApproval(db, { ...options(), ...change } as unknown as Parameters<typeof commitWeeklyDraftChatApproval>[1]);
    expect(result).toMatchObject({ status: "unavailable", commitAttempted: false,
      retryAllowed: false, genericFallbackAllowed: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["actor_id", "tenant_id", "thread_id", "confirmation_id", "request_id"])("never confirms foreign result %s", async key => {
    const db = caller({ ...saved(), [key]: process });
    expect(await commitWeeklyDraftChatApproval(db, options())).toMatchObject({ status: "unknown", commitAttempted: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { receipt_id: null }, { revision: 2 }, { process_state: "live" }, { recurrence_authorized: true },
    { draft: { ...saved().draft, weekday: 2 } },
  ])("never confirms contradictory saved metadata %j", async change => {
    expect((await commitWeeklyDraftChatApproval(caller({ ...saved(), ...change }), options())).status).toBe("unknown");
  });
  it("reconciles a lost acknowledgment using one original read and no second commit", async () => {
    const db = { rpc: vi.fn().mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "private transport" } })
      .mockResolvedValueOnce({ data: saved(), error: null }) };
    expect(await commitWeeklyDraftChatApproval(db, options())).toMatchObject({ status: "saved", commitAttempted: true });
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["commit_weekly_commitment_chat_draft", "read_weekly_commitment_chat_draft"]);
    expect(db.rpc.mock.calls[1][1]).toEqual({ _confirmation_id: confirmation, _expected_thread_id: thread });
  });
  it("keeps an unconfirmed save unknown and never offers retry", async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new Error("private transport")) };
    const result = await commitWeeklyDraftChatApproval(db, options());
    expect(result).toEqual({ status: "unknown", commitAttempted: true, retryAllowed: false, genericFallbackAllowed: false });
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["commit_weekly_commitment_chat_draft", "read_weekly_commitment_chat_draft"]);
    expect(JSON.stringify(result)).not.toContain("private transport");
  });
  it("does not misdescribe a later changed process as the original saved draft", async () => {
    const state = { ...saved(), phase: "changed", revision: 2, process_state: "paused", recurrence_authorized: null };
    const result = await commitWeeklyDraftChatApproval(caller(state), options());
    expect(result).toMatchObject({ status: "observed", context: { phase: "changed" } });
    expect(result).not.toHaveProperty("record");
  });
  it.each(["scope", "abort"])("suppresses a late completion after %s retirement", async mode => {
    let resolve!: (reply: Reply) => void, current = true;
    const controller = new AbortController(), db = { rpc: vi.fn((_name: string, _args: Record<string, unknown>) => new Promise<Reply>(r => { resolve = r; })) };
    const pending = commitWeeklyDraftChatApproval(db, { ...options(), current: () => current, signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    if (mode === "scope") current = false; else controller.abort();
    resolve({ data: saved(), error: null });
    expect(await pending).toMatchObject({ status: "unknown", commitAttempted: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("uses the supplied remaining elapsed budget and ignores a late write response", async () => {
    vi.useFakeTimers(); let resolve!: (reply: Reply) => void;
    const db = { rpc: vi.fn((_name: string, _args: Record<string, unknown>) => new Promise<Reply>(r => { resolve = r; })) };
    const pending = commitWeeklyDraftChatApproval(db, { ...options(), remainingMs: 50 });
    await vi.advanceTimersByTimeAsync(51);
    expect(await pending).toMatchObject({ status: "unknown", commitAttempted: true });
    resolve({ data: saved(), error: null }); await Promise.resolve();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("freezes original selector, args and identity before an asynchronous reply", async () => {
    let resolve!: (reply: Reply) => void;
    const option = options(), db = { rpc: vi.fn((_name: string, _args: Record<string, unknown>) => new Promise<Reply>(r => { resolve = r; })) };
    const pending = commitWeeklyDraftChatApproval(db, option);
    await Promise.resolve(); await Promise.resolve();
    option.confirmationId = process; option.scope.actorId = process; option.claim.storedArgs._weekday = 2;
    resolve({ data: saved(), error: null });
    expect(await pending).toMatchObject({ status: "saved", record: { requestId: request } });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ _confirmation_id: confirmation, _expected_args: args() });
  });

  it.each(["unknown", "saved_unreceipted"])("reports recovered %s without claiming a verified save", async phase => {
    const state = phase === "unknown" ? { ...saved(), phase, automation_id: null, revision: null,
      process_state: null, receipt_id: null } : { ...saved(), phase, receipt_id: null };
    const db = { rpc: vi.fn().mockResolvedValueOnce({ data: null, error: { code: "XX000" } })
      .mockResolvedValueOnce({ data: state, error: null }) };
    const result = await commitWeeklyDraftChatApproval(db, options());
    expect(result).toMatchObject({ status: "observed", context: { phase }, retryAllowed: false });
    expect(result).not.toHaveProperty("record");
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["commit_weekly_commitment_chat_draft", "read_weekly_commitment_chat_draft"]);
  });
  it("keeps native authority refusals terminal without trying a privileged fallback", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "private native reason" } }) };
    const result = await commitWeeklyDraftChatApproval(db, options());
    expect(result).toEqual({ status: "unknown", commitAttempted: true, retryAllowed: false, genericFallbackAllowed: false });
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["commit_weekly_commitment_chat_draft", "read_weekly_commitment_chat_draft"]);
    expect(JSON.stringify(result)).not.toContain("private native reason");
  });
  it("never gives the recovery read a new elapsed budget", async () => {
    vi.useFakeTimers();
    let resolve!: (reply: Reply) => void;
    const db = { rpc: vi.fn().mockImplementationOnce(() => new Promise<Reply>(r => { resolve = r; }))
      .mockImplementationOnce(() => new Promise<Reply>(() => {})) };
    const pending = commitWeeklyDraftChatApproval(db, { ...options(), remainingMs: 50 });
    await vi.advanceTimersByTimeAsync(40);
    resolve({ data: null, error: { code: "XX000" } });
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({ status: "unknown", commitAttempted: true, retryAllowed: false });
    expect(db.rpc.mock.calls.map(call => call[0])).toEqual(["commit_weekly_commitment_chat_draft", "read_weekly_commitment_chat_draft"]);
  });
});
