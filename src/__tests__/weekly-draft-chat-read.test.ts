import { afterEach, describe, expect, it, vi } from "vitest";
import { readWeeklyDraftChatStatus } from "../../supabase/functions/_shared/paige-orchestration/weekly-draft-chat-read";

const actor = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const confirmation = "33333333-3333-4333-8333-333333333333";
const thread = "44444444-4444-4444-8444-444444444444";
const request = "55555555-5555-4555-8555-555555555555";
const other = "66666666-6666-4666-8666-666666666666";
const scope = { actorId: actor, tenantId: tenant, threadId: thread };
const token = "0123456789abcdef:77777777-7777-4777-8777-777777777777";
type NativeResult = { data: unknown; error: unknown };
const native = () => ({ ok: true, actor_id: actor, tenant_id: tenant, thread_id: thread,
  confirmation_id: confirmation, request_id: request, phase: "awaiting_approval",
  read_at: "2026-10-24T10:00:00Z", expires_at: "2026-10-24T10:10:00Z",
  summary: "Private native approval summary", draft: { name: "Weekly responsibility", weekday: 1,
    local_time: "09:00", timezone: "UTC" }, confirmation_token: token,
  automation_id: null, revision: null, process_state: null, receipt_id: null,
  recurrence_authorized: false });
const options = () => ({ confirmationId: confirmation, scope, current: () => true,
  signal: new AbortController().signal });
const caller = (data: unknown = native()) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });

afterEach(() => vi.useRealTimers());

describe("original weekly draft Chat readback", () => {
  it("reads only the original bound proposal through the caller-JWT native facade", async () => {
    const db = caller();
    const result = await readWeeklyDraftChatStatus(db, options());
    expect(db.rpc.mock.calls).toEqual([["read_weekly_commitment_chat_draft", {
      _confirmation_id: confirmation, _expected_thread_id: thread,
    }]]);
    expect(result).toMatchObject({ status: "available", context: {
      phase: "awaiting_approval", next_step: "review_original_proposal", authority: "not_granted_by_projection",
    } });
    const serialized = JSON.stringify(result);
    for (const privateValue of [actor, tenant, thread, confirmation, request, token, native().summary])
      expect(serialized).not.toContain(privateValue);
  });
  it.each(["unknown", "expired", "declined"])("preserves original %s without another decision or write", async phase => {
    const db = caller({ ...native(), phase, confirmation_token: null });
    const result = await readWeeklyDraftChatStatus(db, options());
    expect(result).toMatchObject({ status: "available", context: { phase } });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("can_retry");
  });
  it("retains original saved-draft evidence without claiming recurrence or business completion", async () => {
    const db = caller({ ...native(), phase: "saved", confirmation_token: null,
      automation_id: other, revision: 1, process_state: "draft", receipt_id: request });
    const result = await readWeeklyDraftChatStatus(db, options());
    expect(result).toMatchObject({ status: "available", context: {
      phase: "saved", definition_is_current: "saved_draft", authority: "not_granted_by_projection",
    } });
    expect(result).toMatchObject({ record: { automationId: other, runId: request, receiptId: request } });
    expect(JSON.stringify(result.status === "available" && result.context)).not.toContain(other);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps an original changed record inspectable without substituting its receipt for the run", async () => {
    const receipt = "77777777-7777-4777-8777-777777777777";
    const db = caller({ ...native(), phase: "changed", confirmation_token: null,
      automation_id: other, revision: 2, process_state: "paused", receipt_id: receipt });
    const result = await readWeeklyDraftChatStatus(db, options());
    expect(result).toMatchObject({ status: "available", record: {
      automationId: other, runId: request, receiptId: receipt,
    }, context: { definition_is_current: "historical", authority: "not_granted_by_projection" } });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    if (result.status === "available") for (const id of [other, receipt, request, confirmation, token])
      expect(JSON.stringify(result.context)).not.toContain(id);
  });
  it("keeps an unreceipted native record uncertain without an execution reference", async () => {
    const result = await readWeeklyDraftChatStatus(caller({ ...native(), phase: "saved_unreceipted",
      confirmation_token: null, automation_id: other, revision: 1, process_state: "draft" }), options());
    expect(result).toMatchObject({ status: "available", record: null,
      context: { phase: "saved_unreceipted", next_step: "reconcile_original_record_and_receipt" } });
  });
  it.each(["actor_id", "tenant_id", "thread_id", "confirmation_id"])("refuses a foreign %s result", async key => {
    expect(await readWeeklyDraftChatStatus(caller({ ...native(), [key]: other }), options()))
      .toEqual({ status: "unavailable", reason: "original_draft_not_verified" });
  });
  it.each(["", "not-a-uuid", null, undefined])("does not query an invalid original selector %s", async confirmationId => {
    const db = caller();
    expect(await readWeeklyDraftChatStatus(db, { ...options(), confirmationId } as ReturnType<typeof options>))
      .toEqual({ status: "refused", reason: "invalid_original_scope" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["actorId", "tenantId", "threadId"])("does not query missing %s scope", async key => {
    const db = caller();
    const invalid = { ...scope, [key]: undefined };
    expect(await readWeeklyDraftChatStatus(db, { ...options(), scope: invalid } as ReturnType<typeof options>))
      .toEqual({ status: "refused", reason: "invalid_original_scope" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("does not turn an inherited thread into a current explicit Chat binding", async () => {
    const db = caller();
    const inherited = Object.assign(Object.create({ threadId: thread }), { actorId: actor, tenantId: tenant });
    expect(await readWeeklyDraftChatStatus(db, { ...options(), scope: inherited }))
      .toEqual({ status: "refused", reason: "invalid_original_scope" });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("refuses a retired or aborted context before any read", async () => {
    for (const option of [{ ...options(), current: () => false },
      { ...options(), signal: AbortSignal.abort() }]) {
      const db = caller();
      expect((await readWeeklyDraftChatStatus(db, option)).status).toBe("refused");
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });
  it.each(["scope", "abort"])("discards a late result after %s retirement without follow-up", async mode => {
    let resolve!: (value: NativeResult) => void;
    let current = true;
    const controller = new AbortController();
    const db = { rpc: vi.fn(() => new Promise<NativeResult>(r => { resolve = r; })) };
    const pending = readWeeklyDraftChatStatus(db, { ...options(), signal: controller.signal, current: () => current });
    await Promise.resolve(); await Promise.resolve();
    if (mode === "scope") current = false; else controller.abort();
    resolve({ data: native(), error: null });
    expect(await pending).toEqual({ status: "refused", reason: "original_scope_retired" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("freezes the original expected scope rather than adopting mutated labels while waiting", async () => {
    let resolve!: (value: NativeResult) => void;
    const captured = { ...scope };
    const db = { rpc: vi.fn(() => new Promise<NativeResult>(r => { resolve = r; })) };
    const pending = readWeeklyDraftChatStatus(db, { ...options(), scope: captured });
    await Promise.resolve(); await Promise.resolve();
    captured.actorId = other;
    resolve({ data: { ...native(), actor_id: other }, error: null });
    expect(await pending).toEqual({ status: "unavailable", reason: "original_draft_not_verified" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("bounds an interrupted read and does not retry when the late RPC eventually completes", async () => {
    vi.useFakeTimers();
    let resolve!: (value: NativeResult) => void;
    const db = { rpc: vi.fn(() => new Promise<NativeResult>(r => { resolve = r; })) };
    const pending = readWeeklyDraftChatStatus(db, options());
    await vi.advanceTimersByTimeAsync(12_001);
    expect(await pending).toEqual({ status: "unavailable", reason: "original_draft_not_verified" });
    resolve({ data: native(), error: null }); await Promise.resolve();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["42501", "XX000"])("keeps native error %s bounded and private", async code => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: native(), error: { code, message: "private native detail" } }) };
    const result = await readWeeklyDraftChatStatus(db, options());
    expect(result).toEqual(code === "42501" ? { status: "refused", reason: "native_scope_refused" }
      : { status: "unavailable", reason: "original_draft_not_verified" });
    expect(JSON.stringify(result)).not.toContain("private native detail");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not accept contradictory receipt or approval metadata as a verified result", async () => {
    expect((await readWeeklyDraftChatStatus(caller({ ...native(), receipt_id: request }), options())).status)
      .toBe("unavailable");
  });
  it("keeps thrown transport details private without another RPC", async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new Error("private transport detail")) };
    expect(await readWeeklyDraftChatStatus(db, options()))
      .toEqual({ status: "unavailable", reason: "original_draft_not_verified" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});
