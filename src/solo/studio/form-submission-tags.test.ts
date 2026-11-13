import { afterEach, describe, expect, it, vi } from "vitest";
import { applySubmissionFutureTags, type SubmissionTagCaller, type SubmissionTagScope } from "../../../supabase/functions/_shared/growth/form-submission-tags";

const TENANT = "11111111-1111-4111-8111-111111111111", FORM = "22222222-2222-4222-8222-222222222222", SUB = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444", ACTOR = "55555555-5555-4555-8555-555555555555", AUTO = "66666666-6666-4666-8666-666666666666";
const AUDIT = "77777777-7777-4777-8777-777777777777", OTHER = "88888888-8888-4888-8888-888888888888";
const DATE = "2026-11-13T17:05:06.123456+00:00", SAVED = "2026-11-13T17:06:06.654321+00:00";
type Row = Record<string, unknown>;
type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const source = (change: Partial<SubmissionTagScope> = {}): SubmissionTagScope => ({ submissionId: SUB, tenantId: TENANT, formId: FORM, contactId: CONTACT,
  automationId: AUTO, claimAttempt: 1, operatorId: ACTOR, futureTags: ["New tag"], hasRecordedResult: false, ...change });
const record = (change: Row = {}) => ({ v: 1, submission_id: SUB, tenant_id: TENANT, form_id: FORM, contact_id: CONTACT, automation_id: AUTO,
  operator_user_id: ACTOR, outcome: "applied", future_tags: ["New tag"], config_digest: "a".repeat(64), source_updated_at: DATE, saved_updated_at: SAVED, audit_id: AUDIT, ...change });
const envelope = (result: unknown = record(), replayed = false) => ({ ok: true, state: "recorded", replayed, result });
const unknown = (): Reply => ({ data: { ok: false, code: "unknown" }, error: null });
type Options = { apply?: Reply; state?: Reply; contact?: unknown; afterRead?: () => void; afterApply?: () => void; throwApply?: boolean;
  applyPromise?: Promise<Reply>; readPromise?: Promise<Reply> };
function setup(options: Options = {}) {
  const calls: Array<{ name: string; args: Row }> = [], reads: Array<{ columns: string; filters: unknown[][] }> = [];
  const caller: SubmissionTagCaller = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "growth_apply_submission_contact_tags") { options.afterApply?.(); if (options.throwApply) throw Error("lost response"); return options.applyPromise ?? options.apply ?? { data: envelope(), error: null }; }
      if (name === "growth_submission_contact_tags_state") return options.state ?? { data: envelope(record(), true), error: null };
      throw Error("Unexpected native call");
    },
    from: () => { const read = { columns: "", filters: [] as unknown[][] }; reads.push(read);
      const q = { select: (columns: string) => { read.columns = columns; return q; }, eq: (key: string, value: string) => { read.filters.push([key, value]); return q; },
        maybeSingle: async () => { options.afterRead?.(); return options.readPromise ?? { data: options.contact ?? { id: CONTACT, updated_at: DATE }, error: null }; } }; return q;
    },
  };
  return { caller, calls, reads };
}
afterEach(() => vi.useRealTimers());

describe("original submission causal future-tag adapter — captured ports", () => {
  it("uses only exact original binding hints, unchanged microseconds and minimal tenant-scoped contact version read", async () => {
    const w = setup(); expect(await applySubmissionFutureTags(source(), w)).toMatchObject({ kind: "recorded", replayed: false, result: { audit_id: AUDIT } });
    expect(w.reads).toEqual([{ columns: "id,updated_at", filters: [["id", CONTACT], ["tenant_id", TENANT]] }]);
    expect(w.calls).toEqual([{ name: "growth_apply_submission_contact_tags", args: { p_submission_id: SUB, p_claim_attempt: 1, p_automation_id: AUTO, p_contact_id: CONTACT,
      p_actor_user_id: ACTOR, p_expected_updated_at: DATE, p_expected_future_tags: ["New tag"] } }]);
  });
  it("no-change is recorded native evidence with no invented mutation audit", async () => {
    const w = setup({ apply: { data: envelope(record({ outcome: "no_change", audit_id: null, saved_updated_at: DATE })), error: null } });
    expect(await applySubmissionFutureTags(source(), w)).toMatchObject({ kind: "recorded", result: { outcome: "no_change", audit_id: null } });
  });
  it.each([{ tenant_id: OTHER }, { form_id: OTHER }, { contact_id: OTHER }, { submission_id: OTHER }, { automation_id: OTHER }, { operator_user_id: OTHER },
    { v: 2 }, { audit_id: null }, { source_updated_at: "2026-02-31T00:00:00Z" }, { config_digest: "bad" }, { future_tags: ["Forged"] }, { url: "https://example.test" },
    { outcome: "no_change", audit_id: AUDIT }, { outcome: "no_change", audit_id: null }, { future_tags: ["New tag", "New tag"] }, { future_tags: Array(51).fill("New tag") }])("withholds malformed or foreign application evidence and inspects only the original source %#", async change => {
    const w = setup({ apply: { data: envelope(record(change)), error: null }, state: unknown() });
    expect(await applySubmissionFutureTags(source(), w)).toEqual({ kind: "unknown" });
    expect(w.calls.map(c => c.name)).toEqual(["growth_apply_submission_contact_tags", "growth_submission_contact_tags_state"]);
    expect(w.calls[1].args).toEqual({ p_submission_id: SUB, p_contact_id: CONTACT, p_automation_id: AUTO });
  });
  it("an envelope with extra authority or URL fields is not accepted", async () => {
    const w = setup({ apply: { data: { ...envelope(), session_id: OTHER }, error: null }, state: unknown() });
    expect(await applySubmissionFutureTags(source(), w)).toEqual({ kind: "unknown" });
  });
  it("a committed historic result survives changed config, current tags, operator and claim attempt without a writer call", async () => {
    const historic = record({ operator_user_id: OTHER }), w = setup({ state: { data: envelope(historic, true), error: null } });
    const result = await applySubmissionFutureTags(source({ claimAttempt: 4, operatorId: null, futureTags: ["Different config"], hasRecordedResult: true }), w);
    expect(result).toMatchObject({ kind: "recorded", replayed: true, result: historic }); expect(w.reads).toEqual([]);
    expect(w.calls.map(c => c.name)).toEqual(["growth_submission_contact_tags_state"]);
  });
  it("a replay returned by the native apply also retains its historic source", async () => {
    const w = setup({ apply: { data: envelope(record({ source_updated_at: "2026-11-12T09:00:00.987654+00:00", future_tags: ["Prior config"] }), true), error: null } });
    expect(await applySubmissionFutureTags(source(), w)).toMatchObject({ kind: "recorded", replayed: true, result: { future_tags: ["Prior config"] } });
  });
  it.each(["not_allowed", "source_changed", "config_changed", "invalid"])("native %s is refused without a retry", async code => {
    const w = setup({ apply: { data: { ok: false, code }, error: null } }); expect(await applySubmissionFutureTags(source(), w)).toEqual({ kind: "refused", code });
    expect(w.calls).toHaveLength(1);
  });
  it.each([["40001", "stale"], ["42501", "not_allowed"], ["22023", "invalid"]])("native SQLSTATE %s preserves rollback refusal %s", async (code, expected) => {
    const w = setup({ apply: { data: null, error: { code, message: "private native detail" } } });
    expect(await applySubmissionFutureTags(source(), w)).toEqual({ kind: "refused", code: expected }); expect(w.calls).toHaveLength(1);
  });
  it.each([false, true])("a lost response reads the same original result exactly once (throw=%s)", async throwApply => {
    const w = setup({ throwApply, apply: { data: null, error: { message: "lost ACK" } } });
    expect(await applySubmissionFutureTags(source(), w)).toMatchObject({ kind: "recorded", replayed: true });
    expect(w.calls.map(c => c.name)).toEqual(["growth_apply_submission_contact_tags", "growth_submission_contact_tags_state"]);
  });
  it("absent/unknown causal result remains unknown; no current membership query or second apply", async () => {
    const w = setup({ apply: unknown(), state: unknown() }); expect(await applySubmissionFutureTags(source(), w)).toEqual({ kind: "unknown" });
    expect(w.calls).toHaveLength(2); expect(w.reads[0].columns).not.toContain("tags");
  });
  it("a prior checkpoint with unreadable state never falls back to an apply", async () => {
    const w = setup({ state: unknown() }); expect(await applySubmissionFutureTags(source({ hasRecordedResult: true }), w)).toEqual({ kind: "unknown" });
    expect(w.calls.map(c => c.name)).toEqual(["growth_submission_contact_tags_state"]); expect(w.reads).toEqual([]);
  });
  it("a foreign contact-version row is refused before any operation", async () => {
    const w = setup({ contact: { id: OTHER, updated_at: DATE } }); expect(await applySubmissionFutureTags(source(), w)).toMatchObject({ kind: "refused" }); expect(w.calls).toEqual([]);
  });
  it("an invalid operator hint and invalid future config never reach a native effect", async () => {
    for (const input of [source({ operatorId: null }), source({ futureTags: ["x".repeat(81)] })]) { const w = setup(); expect(await applySubmissionFutureTags(input, w)).toMatchObject({ kind: "refused" }); expect(w.calls).toEqual([]); }
  });
  it("withdrawal after version read prevents dispatch; an abort after dispatch remains unknown", async () => {
    let live = true; const before = setup({ afterRead: () => { live = false; } });
    expect(await applySubmissionFutureTags(source(), { ...before, current: () => live })).toMatchObject({ kind: "refused" }); expect(before.calls).toEqual([]);
    const abort = new AbortController(), after = setup({ afterApply: () => abort.abort() });
    expect(await applySubmissionFutureTags(source(), { ...after, signal: abort.signal })).toEqual({ kind: "unknown" }); expect(after.calls).toHaveLength(1);
  });
  it("two admitted attempt hints preserve their own native verdicts instead of rebinding to a newer attempt", async () => {
    const old = setup({ apply: { data: null, error: { code: "40001" } } }), newer = setup();
    const results = await Promise.all([applySubmissionFutureTags(source({ claimAttempt: 1 }), old), applySubmissionFutureTags(source({ claimAttempt: 2 }), newer)]);
    expect(results[0]).toEqual({ kind: "refused", code: "stale" }); expect(results[1]).toMatchObject({ kind: "recorded" });
    expect(old.calls[0].args.p_claim_attempt).toBe(1); expect(newer.calls[0].args.p_claim_attempt).toBe(2);
  });
  it("a timed-out apply permits only one bounded read and a late response cannot promote success", async () => {
    vi.useFakeTimers(); let finish!: (reply: Reply) => void;
    const w = setup({ applyPromise: new Promise(resolve => { finish = resolve; }), state: unknown() });
    const pending = applySubmissionFutureTags(source(), { ...w, timeoutMs: 20 }); await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toEqual({ kind: "unknown" }); finish({ data: envelope(), error: null }); await vi.runAllTimersAsync();
    expect(w.calls.map(c => c.name)).toEqual(["growth_apply_submission_contact_tags", "growth_submission_contact_tags_state"]);
  });
});
