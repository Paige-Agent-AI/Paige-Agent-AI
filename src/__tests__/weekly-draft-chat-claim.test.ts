import { afterEach, describe, expect, it, vi } from "vitest";
import { claimWeeklyDraftChatApproval } from "../../supabase/functions/_shared/paige-orchestration/weekly-draft-chat-claim";

const actor = "11111111-1111-4111-8111-111111111111", tenant = "22222222-2222-4222-8222-222222222222";
const confirmation = "33333333-3333-4333-8333-333333333333", thread = "44444444-4444-4444-8444-444444444444";
const request = "55555555-5555-4555-8555-555555555555", issued = "66666666-6666-4666-8666-666666666666";
const nonce = "77777777-7777-4777-8777-777777777777", intent = "88888888-8888-4888-8888-888888888888";
const runtimeNonce = "99999999-9999-4999-8999-999999999999";
const token = "0123456789abcdef:" + issued;
const storedArgs = () => ({ _request_id: request, _name: "Weekly responsibility",
  _weekday: 1, _local_time: "09:00", _timezone: "America/New_York" });
const options = () => ({ proposal: { id: confirmation, approvedToken: token, storedArgs: storedArgs() },
  scope: { actorId: actor, tenantId: tenant, threadId: thread, clientId: null },
  confirmationRequestNonce: nonce, runtime: { intentId: intent, requestNonce: runtimeNonce },
  current: () => true, signal: new AbortController().signal });
const claimed = () => ({ claimed: true, confirmation_id: confirmation, thread_id: thread,
  actor_id: actor, tenant_id: tenant, args: storedArgs() });
const observed = () => ({ ok: true, actor_id: actor, tenant_id: tenant, thread_id: thread,
  confirmation_id: confirmation, request_id: request, phase: "unknown",
  read_at: "2026-10-24T10:00:00Z", expires_at: "2026-10-24T10:10:00Z",
  summary: "Private approval summary", draft: { name: "Weekly responsibility", weekday: 1,
    local_time: "09:00", timezone: "America/New_York" }, confirmation_token: null,
  automation_id: null, revision: null, process_state: null, receipt_id: null, recurrence_authorized: false });
type Reply = { data: unknown; error: unknown };
const caller = (data: unknown = claimed()) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
afterEach(() => vi.useRealTimers());

describe("original weekly Chat claim before generic confirmation CAS", () => {
  it("claims exactly the selected native approval once and returns only its unchanged stored args", async () => {
    const db = caller();
    const result = await claimWeeklyDraftChatApproval(db, options());
    expect(db.rpc.mock.calls).toEqual([["claim_weekly_commitment_chat_draft", {
      _confirmation_id: confirmation, _approved_token: token, _request_nonce: nonce,
      _expected_thread_id: thread, _intent_id: intent, _runtime_request_nonce: runtimeNonce,
    }]]);
    expect(result).toMatchObject({ status: "claimed", storedArgs: storedArgs(),
      rpcAttempted: true, retryAllowed: false, genericFallbackAllowed: false });
    if (result.status === "claimed") expect(Object.isFrozen(result.storedArgs)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result).not.toHaveProperty("receipt");
  });
  it.each(["actor_id", "tenant_id", "thread_id", "confirmation_id"])("rejects native foreign %s", async key => {
    const db = caller({ ...claimed(), [key]: issued });
    expect(await claimWeeklyDraftChatApproval(db, options())).toMatchObject({
      status: "unavailable", rpcAttempted: true, retryAllowed: false, genericFallbackAllowed: false,
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { _request_id: issued }, { _name: "Different work" }, { _weekday: 2 },
    { _local_time: "10:00" }, { _timezone: "UTC" }, { privileged: true },
  ])("never substitutes changed or expanded native arguments %j", async change => {
    expect((await claimWeeklyDraftChatApproval(caller({ ...claimed(), args: { ...storedArgs(), ...change } }), options())).status)
      .toBe("unavailable");
  });
  it.each(["42501", "XX000"])("keeps native refusal/error %s terminal and private", async code => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: claimed(), error: { code, message: "private native error" } }) };
    const result = await claimWeeklyDraftChatApproval(db, options());
    expect(result).toMatchObject({ status: "unavailable", rpcAttempted: true, retryAllowed: false,
      genericFallbackAllowed: false });
    expect(JSON.stringify(result)).not.toContain("private native error");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns an already-consumed original outcome as observation, never fresh execution authority", async () => {
    const db = caller({ claimed: false, state: observed(), thread_id: thread });
    const result = await claimWeeklyDraftChatApproval(db, options());
    expect(result).toMatchObject({ status: "observed", context: { phase: "unknown",
      next_step: "reconcile_original_record" }, genericFallbackAllowed: false, retryAllowed: false });
    expect(result).not.toHaveProperty("storedArgs");
    for (const privateValue of [actor, tenant, thread, request, confirmation, token, observed().summary])
      expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["confirmation_id", "request_id", "tenant_id", "actor_id", "thread_id"])("rejects a different observed %s", async key => {
    expect((await claimWeeklyDraftChatApproval(caller({ claimed: false,
      state: { ...observed(), [key]: issued }, thread_id: thread }), options())).status).toBe("unavailable");
  });
  it("preserves an already-saved native draft and receipt as observation only", async () => {
    const state = { ...observed(), phase: "saved", automation_id: intent, revision: 1,
      process_state: "draft", receipt_id: runtimeNonce };
    const result = await claimWeeklyDraftChatApproval(caller({ claimed: false, state, thread_id: thread }), options());
    expect(result).toMatchObject({ status: "observed", context: { phase: "saved",
      definition_is_current: "saved_draft", authority: "not_granted_by_projection" } });
    expect(result).not.toHaveProperty("storedArgs");
    expect(result).toMatchObject({ record: { automationId: intent, runId: request, receiptId: runtimeNonce } });
    if (result.status === "observed") for (const id of [intent, request, runtimeNonce, confirmation, token])
      expect(JSON.stringify(result.context)).not.toContain(id);
  });
  it("does not promote an unreceipted observation to an inspectable completed run", async () => {
    const state = { ...observed(), phase: "saved_unreceipted", automation_id: intent, revision: 1,
      process_state: "draft" };
    const db = caller({ claimed: false, state, thread_id: thread });
    expect(await claimWeeklyDraftChatApproval(db, options())).toMatchObject({
      status: "observed", record: null, retryAllowed: false, genericFallbackAllowed: false,
      context: { phase: "saved_unreceipted" },
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not accept an observed changed original schedule or missing saved receipt", async () => {
    for (const state of [{ ...observed(), draft: { ...observed().draft, weekday: 2 } },
      { ...observed(), phase: "saved", automation_id: intent, revision: 1, process_state: "draft" }]) {
      expect((await claimWeeklyDraftChatApproval(caller({ claimed: false, state, thread_id: thread }), options())).status)
        .toBe("unavailable");
    }
  });
  it("does not treat an unclaimed pending proposal as fresh claim authority", async () => {
    const state = { ...observed(), phase: "awaiting_approval", confirmation_token: token };
    expect((await claimWeeklyDraftChatApproval(caller({ claimed: false, state, thread_id: thread }), options())).status)
      .toBe("unavailable");
  });
  it.each(["proposal", "scope", "runtime", "confirmationRequestNonce"])("rejects absent %s before a native call", async key => {
    const db = caller(), invalid = { ...options(), [key]: undefined } as ReturnType<typeof options>;
    expect(await claimWeeklyDraftChatApproval(db, invalid)).toMatchObject({ status: "unavailable", rpcAttempted: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("requires original normal-thread scope, no customer focus or inherited thread labels", async () => {
    for (const scope of [{ ...options().scope, clientId: issued }, { ...options().scope, threadId: null },
      Object.assign(Object.create({ threadId: thread }), { actorId: actor, tenantId: tenant, clientId: null })]) {
      const db = caller();
      expect((await claimWeeklyDraftChatApproval(db, { ...options(), scope } as ReturnType<typeof options>)).rpcAttempted).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });
  it("rejects missing bound runtime, same issuance/approval request, and malformed surface tokens", async () => {
    for (const option of [{ ...options(), runtime: { intentId: intent, requestNonce: null } },
      { ...options(), confirmationRequestNonce: issued },
      { ...options(), proposal: { ...options().proposal, approvedToken: "yes" } }]) {
      const db = caller();
      expect((await claimWeeklyDraftChatApproval(db, option as ReturnType<typeof options>)).rpcAttempted).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });
  it("captures exact arguments and scope before awaiting the native response", async () => {
    let resolve!: (r: Reply) => void;
    const option = options(), db = { rpc: vi.fn(() => new Promise<Reply>(r => { resolve = r; })) };
    const pending = claimWeeklyDraftChatApproval(db, option);
    await Promise.resolve(); await Promise.resolve();
    option.scope.actorId = issued; option.proposal.storedArgs._weekday = 2;
    resolve({ data: { ...claimed(), actor_id: issued, args: { ...storedArgs(), _weekday: 2 } }, error: null });
    expect((await pending).status).toBe("unavailable");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["scope", "abort"])("discards a late claim after %s retirement without a second effect", async mode => {
    let resolve!: (r: Reply) => void, current = true;
    const controller = new AbortController(), db = { rpc: vi.fn(() => new Promise<Reply>(r => { resolve = r; })) };
    const pending = claimWeeklyDraftChatApproval(db, { ...options(), current: () => current, signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    if (mode === "scope") current = false; else controller.abort();
    resolve({ data: claimed(), error: null });
    expect(await pending).toMatchObject({ status: "unavailable", rpcAttempted: true,
      retryAllowed: false, genericFallbackAllowed: false });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("expires within the original elapsed budget, never committing/retrying a late claim", async () => {
    vi.useFakeTimers();
    let resolve!: (r: Reply) => void;
    const db = { rpc: vi.fn(() => new Promise<Reply>(r => { resolve = r; })) };
    const pending = claimWeeklyDraftChatApproval(db, options());
    await vi.advanceTimersByTimeAsync(12_001);
    expect(await pending).toMatchObject({ status: "unavailable", rpcAttempted: true,
      retryAllowed: false, genericFallbackAllowed: false });
    resolve({ data: claimed(), error: null }); await Promise.resolve();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("starts no claim from a stopped context", async () => {
    const db = caller();
    expect((await claimWeeklyDraftChatApproval(db, { ...options(), current: () => false })).rpcAttempted).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
