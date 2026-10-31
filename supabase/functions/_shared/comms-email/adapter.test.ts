// INT-328 — the governed executor and reconcile, with every database/network edge injected.
import { describe, it, expect } from "vitest";
import { executeCommsEmailSend, reconcileCommsEmailSend, releaseScheduledCommsEmail, type CommsEmailExecutorDependencies, type ScheduledReleaseDependencies } from "./adapter.ts";
import { COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS, commsEmailBodyHtml, commsEmailContentDigest } from "./contract.ts";

const T = "10000000-0000-4000-8000-000000000001", A = "40000000-0000-4000-8000-000000000001", OP = "20000000-0000-4000-8000-000000000001";
const C = "30000000-0000-4000-8000-000000000001", S = "50000000-0000-4000-8000-000000000001", M = "60000000-0000-4000-8000-000000000001";
const command = { action: "comms.email_send" as const, contact_id: C, connector_id: S, subject: "Hi", body: "Hello there" };
async function input() {
  return { actorUserId: A, tenantId: T, operationId: OP, governance: { decision_receipt_recorded: true },
    stored: { command, recipient: "dana@x.test", fromAddress: "owner@biz.test", contentDigest: await commsEmailContentDigest({ recipient: "dana@x.test", connectorId: S, subject: "Hi", bodyText: "Hello there" }) } };
}
function deps(over: Partial<CommsEmailExecutorDependencies> = {}) {
  const log: string[] = []; let state: string | null = null;
  const d: CommsEmailExecutorDependencies = {
    stillCurrent: async () => true,
    readResult: async () => state ? { outcome: state, operation_id: OP, message_id: M, provider: "resend", reconcilable: state === "unknown", provider_receipt_available: state === "provider_accepted" } : null,
    resolveParties: async () => ({ kind: "resolved", contactId: C, contactName: "Dana", recipient: "dana@x.test", connectorId: S, fromAddress: "owner@biz.test" }),
    readiness: async () => ({ eligible: true, state: "ready", reason: "READY_FOR_GOVERNED_REVIEW", provider_execution_verified: false }),
    prepare: async () => { log.push("prepare"); state = "prepared"; return { data: { ok: true, replayed: false, state: "prepared", message_id: M }, error: null }; },
    send: async () => { log.push("send"); state = "provider_accepted"; return {}; },
    readBinding: async () => ({ operation_id: OP, tenant_id: T, message_id: M, recipient: "dana@x.test", contact_id: C, connector_id: S, subject: "Hi", body_html: "<p>Hello there</p>" }),
    ...over,
  };
  return { d, log, set: (s: string | null) => { state = s; } };
}

describe("original saved draft binding through the governed executor", () => {
  const draftSource = { message_id: M, updated_at: "2026-10-30T20:00:00.123456+00:00" };
  const draftHtml = "<p><strong>Hello there</strong></p>";
  async function savedInput() {
    const i = await input();
    return { ...i, stored: { ...i.stored, draftSource, draftBodyHtml: draftHtml } };
  }
  it("keeps source identity/version and approved HTML in the stored call", async () => {
    const { parseCommsEmailStoredCall } = await import("./adapter.ts"); const i = await input();
    const args = { expected_tenant_id: T, operation_id: OP, command, recipient: i.stored.recipient,
      from_address: i.stored.fromAddress, content_digest: i.stored.contentDigest };
    expect(parseCommsEmailStoredCall({ ...args, draft_source: draftSource, draft_body_html: draftHtml }, T))
      .toMatchObject({ draftSource, draftBodyHtml: draftHtml });
    for (const extra of [{ draft_source: draftSource }, { draft_body_html: draftHtml },
      { draft_source: { ...draftSource, tenant_id: T }, draft_body_html: draftHtml },
      { draft_source: { ...draftSource, updated_at: "2026-10-30" }, draft_body_html: draftHtml },
      { draft_source: draftSource, draft_body_html: "" }, { draft_source: draftSource, draft_body_html: "x\0y" },
    ]) expect(parseCommsEmailStoredCall({ ...args, ...extra }, T)).toBeNull();
    expect(parseCommsEmailStoredCall(args, T)).not.toHaveProperty("draftSource");
    expect(parseCommsEmailStoredCall(args, T)).not.toHaveProperty("draftBodyHtml");
  });
  it("names the new native overload and sends the exact approved original HTML", async () => {
    const prepared: Record<string, unknown>[] = [], sent: Record<string, unknown>[] = [];
    const t = deps(); t.d.prepare = async args => { prepared.push(args); t.set("prepared"); return { data: { ok: true, state: "prepared", message_id: M }, error: null }; };
    t.d.send = async body => { sent.push(body); t.set("provider_accepted"); return {}; };
    expect(await executeCommsEmailSend(await savedInput(), t.d)).toMatchObject({ ok: true, outcome: "provider_accepted", message_id: M });
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({ _draft_source: draftSource, _send_at: null, _attachments: null, _body_html: draftHtml });
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ message_id: M, body: draftHtml });
    expect(draftHtml).not.toEqual(commsEmailBodyHtml(command.body));
  });
  it("an older database refuses before any transport instead of silently taking the old INSERT path", async () => {
    const t = deps({ prepare: async args => {
      expect(args).toHaveProperty("_draft_source", draftSource);
      return { data: null, error: { code: "PGRST202", message: "Could not find the function public.prepare_comms_email_send with the supplied arguments" } };
    } });
    expect(await executeCommsEmailSend(await savedInput(), t.d)).toMatchObject({ outcome: "refused", reason: "COMMS_EMAIL_DRAFT_BINDING_UNAVAILABLE" });
    expect(t.log).toEqual([]);
  });
  it("never sends a different row returned in place of the original draft", async () => {
    const t = deps({ prepare: async () => ({ data: { ok: true, state: "prepared", message_id: OP }, error: null }) });
    expect(await executeCommsEmailSend(await savedInput(), t.d)).toMatchObject({ outcome: "outcome_unknown" });
    expect(t.log).toEqual([]);
  });
  for (const change of ["row", "version", "html", "command"] as const) {
    it(`does not report a terminal operation as this draft after its ${change} changes`, async () => {
      const i = await savedInput();
      const binding = { operation_id: OP, tenant_id: T, actor_user_id: A, command, recipient: i.stored.recipient,
        from_address: i.stored.fromAddress, content_digest: i.stored.contentDigest, body_html: draftHtml,
        governance: { draft_source: draftSource } };
      const t = deps({
        readResult: async () => ({ outcome: "provider_accepted", operation_id: OP, message_id: change === "row" ? OP : M }),
        readBinding: async () => change === "version" ? { ...binding, governance: { draft_source: { ...draftSource, updated_at: draftSource.updated_at.replace("123456", "123457") } } }
          : change === "html" ? { ...binding, body_html: "<p>Changed</p>" }
          : change === "command" ? { ...binding, command: { ...command, body: "Changed" } } : binding,
      });
      expect(await executeCommsEmailSend(i, t.d)).toMatchObject({ outcome: "outcome_unknown" });
      expect(t.log).toEqual([]);
    });
  }
  it("reopens the matching terminal operation without another prepare or send", async () => {
    const i = await savedInput();
    const t = deps({
      readResult: async () => ({ outcome: "provider_accepted", operation_id: OP, message_id: M, provider_receipt_available: true }),
      readBinding: async () => ({ operation_id: OP, tenant_id: T, actor_user_id: A, command, recipient: i.stored.recipient,
        from_address: i.stored.fromAddress, content_digest: i.stored.contentDigest, body_html: draftHtml, governance: { draft_source: draftSource } }),
    });
    expect(await executeCommsEmailSend(i, t.d)).toMatchObject({ outcome: "provider_accepted", message_id: M, replayed: true });
    expect(t.log).toEqual([]);
  });
  it("a failed source-binding read cannot replay a completed operation or create another draft", async () => {
    const t = deps({ readResult: async () => ({ outcome: "provider_accepted", operation_id: OP, message_id: M }),
      readBinding: async () => { throw new Error("Fictional read failure"); } });
    expect(await executeCommsEmailSend(await savedInput(), t.d)).toMatchObject({ outcome: "outcome_unknown" });
    expect(t.log).toEqual([]);
  });
  for (const code of ["COMMS_EMAIL_DRAFT_SOURCE_CHANGED", "COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE", "COMMS_EMAIL_DRAFT_SOURCE_INVALID", "COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED"]) {
    it(`retains the native source refusal ${code} without dispatch`, async () => {
      const t = deps({ prepare: async () => ({ data: null, error: { code: "40001", message: code } }) });
      expect(await executeCommsEmailSend(await savedInput(), t.d)).toMatchObject({ outcome: "refused", reason: code }); expect(t.log).toEqual([]);
    });
  }
});

describe("executeCommsEmailSend", () => {
  it("prepares then sends the derived HTML and reports only the readback", async () => {
    const t = deps(); const sent: Record<string, unknown>[] = []; t.d.send = async b => { sent.push(b); t.set("provider_accepted"); return { provider_message_id: "re_x" }; };
    const r = await executeCommsEmailSend(await input(), t.d);
    expect(r).toEqual({ ok: true, outcome: "provider_accepted", operation_id: OP, message_id: M, provider_receipt_available: true, delivery_confirmed: false });
    expect(sent[0]).toMatchObject({ to: "dana@x.test", body: "<p>Hello there</p>", comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}` });
  });
  it("never sends without a recorded decision receipt or when the workspace moved", async () => {
    const t = deps();
    expect((await executeCommsEmailSend({ ...(await input()), governance: {} }, t.d)).outcome).toBe("refused");
    expect((await executeCommsEmailSend(await input(), { ...t.d, stillCurrent: async () => false })).outcome).toBe("refused");
    expect(t.log).toEqual([]);
  });
  it("refuses a changed recipient or sender before prepare", async () => {
    for (const parties of [{ kind: "resolved", contactId: C, contactName: "D", recipient: "new@x.test", connectorId: S, fromAddress: "owner@biz.test" }, { kind: "resolved", contactId: C, contactName: "D", recipient: "dana@x.test", connectorId: S, fromAddress: "other@biz.test" }, { kind: "contact_not_in_workspace" }] as const) {
      const t = deps({ resolveParties: async () => parties });
      expect((await executeCommsEmailSend(await input(), t.d)).outcome).toBe("refused");
      expect(t.log).toEqual([]);
    }
  });
  it("does not redispatch an operation whose outcome is unknown or already recorded", async () => {
    for (const s of ["unknown", "dispatching", "provider_accepted", "failed"]) {
      const t = deps(); t.set(s);
      const r = await executeCommsEmailSend(await input(), t.d);
      expect(t.log).toEqual([]);
      expect(r.outcome).toBe(["unknown", "dispatching"].includes(s) ? "outcome_unknown" : s);
    }
  });
  it("a failed read of the parties or the readiness before prepare is a refusal (nothing was prepared or sent), not unknown", async () => {
    const parties = deps({ resolveParties: async () => { throw new Error("db down"); } });
    expect(await executeCommsEmailSend(await input(), parties.d)).toMatchObject({ ok: false, outcome: "refused", reason: "COMMS_EMAIL_PARTIES_UNAVAILABLE" });
    expect(parties.log).toEqual([]);
    const ready = deps({ readiness: async () => { throw new Error("db down"); } });
    expect(await executeCommsEmailSend(await input(), ready.d)).toMatchObject({ ok: false, outcome: "refused", reason: "EMAIL_READINESS_UNVERIFIED" });
    expect(ready.log).toEqual([]);
  });
  it("an unanswered send is outcome_unknown, never success", async () => {
    const t = deps({ send: async () => { throw new Error("network"); } });
    expect(await executeCommsEmailSend(await input(), t.d)).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED" });
  });
  it("maps database refusals and treats an unanswered prepare as unknown", async () => {
    expect((await executeCommsEmailSend(await input(), deps({ prepare: async () => ({ data: null, error: { code: "40001", message: "COMMS_EMAIL_RECIPIENT_CHANGED" } }) }).d))).toMatchObject({ outcome: "refused", reason: "RECIPIENT_CHANGED" });
    expect((await executeCommsEmailSend(await input(), deps({ prepare: async () => ({ data: null, error: { code: "55000", message: "COMMS_EMAIL_RECONCILIATION_REQUIRED" } }) }).d)).outcome).toBe("outcome_unknown");
    expect((await executeCommsEmailSend(await input(), deps({ prepare: async () => ({ data: null, error: { message: "fetch failed" } }) }).d)).outcome).toBe("outcome_unknown");
  });
});

describe("reconcileCommsEmailSend", () => {
  it("never re-sends, even an operation the database still calls reconcilable (SendGrid has no idempotent replay)", async () => {
    for (const provider of ["resend", "sendgrid"]) {
      const t = deps({ readResult: async () => ({ outcome: "unknown", operation_id: OP, message_id: M, provider, reconcilable: true }) });
      const sent: Record<string, unknown>[] = []; t.d.send = async b => { sent.push(b); return {}; };
      expect(await reconcileCommsEmailSend(OP, T, t.d), provider).toMatchObject({ ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_RECONCILIATION_REQUIRED", reconcilable: false });
      expect(sent, provider).toEqual([]);
      expect(t.log, provider).toEqual([]);
    }
  });
  it("replays an outcome that is already recorded, without sending", async () => {
    const t = deps(); t.set("provider_accepted"); const sent: unknown[] = []; t.d.send = async b => { sent.push(b); return {}; };
    expect(await reconcileCommsEmailSend(OP, T, t.d)).toMatchObject({ ok: true, outcome: "provider_accepted", replayed: true });
    expect(sent).toEqual([]);
  });
  it("leaves a non-reconcilable or foreign-tenant operation unknown without sending", async () => {
    const t = deps({ readResult: async () => ({ outcome: "unknown", message_id: M, provider: "gmail", reconcilable: false }) });
    expect(await reconcileCommsEmailSend(OP, T, t.d)).toMatchObject({ outcome: "outcome_unknown", reconcilable: false });
    const u = deps({ readBinding: async () => ({ operation_id: OP, tenant_id: "10000000-0000-4000-8000-000000000009", message_id: M }) }); u.set("unknown");
    expect((await reconcileCommsEmailSend(OP, T, u.d)).outcome).toBe("outcome_unknown");
    expect([...t.log, ...u.log]).toEqual([]);
  });
});

describe("executeCommsEmailSend — approve now, send later", () => {
  const SEND_AT = "2026-11-02T14:30:00.000Z";
  const scheduled = async () => { const i = await input(); return { ...i, stored: { ...i.stored, sendAt: SEND_AT } }; };
  it("prepares with _send_at and answers 'scheduled' without calling send-message", async () => {
    const args: Record<string, unknown>[] = [];
    const t = deps({ prepare: async a => { args.push(a); t.log.push("prepare"); return { data: { ok: true, replayed: false, state: "prepared", message_id: M, send_at: SEND_AT }, error: null }; } });
    const r = await executeCommsEmailSend(await scheduled(), t.d);
    expect(r).toEqual({ ok: true, outcome: "scheduled", send_at: SEND_AT, operation_id: OP, message_id: M, delivery_confirmed: false });
    expect(args[0]._send_at).toBe(SEND_AT);
    expect(t.log).toEqual(["prepare"]);
  });
  it("an immediate call never names _send_at (so the 13-argument prepare is the one chosen)", async () => {
    const args: Record<string, unknown>[] = [];
    const t = deps(); const prepare = t.d.prepare; t.d.prepare = async a => { args.push(a); return prepare(a); };
    await executeCommsEmailSend(await input(), t.d);
    expect(args[0]).not.toHaveProperty("_send_at");
  });
  it("a replayed prepared scheduled operation is still 'scheduled'; a time the database did not echo is unknown", async () => {
    const replay = deps({ prepare: async () => ({ data: { ok: true, replayed: true, state: "prepared", message_id: M, send_at: SEND_AT }, error: null }) });
    expect(await executeCommsEmailSend(await scheduled(), replay.d)).toMatchObject({ ok: true, outcome: "scheduled", replayed: true });
    const drift = deps({ prepare: async () => ({ data: { ok: true, replayed: false, state: "prepared", message_id: M, send_at: "2026-11-02T15:30:00.000Z" }, error: null }) });
    expect((await executeCommsEmailSend(await scheduled(), drift.d)).outcome).toBe("outcome_unknown");
    expect([...replay.log, ...drift.log]).toEqual([]);
  });
  it("maps the database's send-time refusals", async () => {
    for (const code of ["COMMS_EMAIL_SEND_AT_INVALID", "COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED"]) {
      const t = deps({ prepare: async () => ({ data: null, error: { code: "22023", message: code } }) });
      expect(await executeCommsEmailSend(await scheduled(), t.d)).toMatchObject({ outcome: "refused", reason: code });
    }
  });
});

describe("releaseScheduledCommsEmail — the drainer's release matrix", () => {
  const SEND_AT = "2026-11-02T14:30:00.000Z", AT = Date.parse(SEND_AT);
  async function binding(over: Record<string, unknown> = {}) {
    return { operation_id: OP, tenant_id: T, actor_user_id: A, contact_id: C, connector_id: S, recipient: "dana@x.test", from_address: "owner@biz.test",
      subject: "Hi", body_text: "Hello there", body_html: commsEmailBodyHtml("Hello there"), state: "prepared", send_at: SEND_AT,
      content_digest: await commsEmailContentDigest({ recipient: "dana@x.test", connectorId: S, subject: "Hi", bodyText: "Hello there" }), ...over };
  }
  function release(over: Partial<ScheduledReleaseDependencies> = {}, opts: { state?: string; afterState?: string; answered?: boolean; code?: string | null; eligible?: boolean; readError?: string; now?: number } = {}) {
    const log: string[] = []; let reads = 0;
    const sends: Record<string, unknown>[] = []; const closes: Record<string, unknown>[] = [];
    const d: ScheduledReleaseDependencies = {
      now: () => opts.now ?? AT + 30_000,
      providerExecutionAllowed: async () => true,
      resolveParties: async () => ({ kind: "resolved", contactId: C, contactName: "Dana", recipient: "dana@x.test", connectorId: S, fromAddress: "owner@biz.test" }),
      readiness: async () => ({ eligible: true, state: "ready", reason: "READY_FOR_GOVERNED_REVIEW", provider_execution_verified: false }),
      readBinding: async () => {
        reads++;
        if (opts.readError) throw new Error(opts.readError);
        return { operation_id: OP, send_at: SEND_AT, state: reads === 1 ? (opts.state ?? "prepared") : (opts.afterState ?? "provider_accepted"), eligible: opts.eligible ?? true };
      },
      send: async (b) => { sends.push(b); log.push("send"); return { answered: opts.answered ?? true, code: opts.code ?? null }; },
      closeRefused: async (c) => { closes.push(c); log.push(`refuse:${c.reason}`); return true; },
      markSupportCase: async () => { log.push("support"); },
      ...over,
    };
    return { d, log, sends, closes };
  }
  it("sends exactly the bound row as its scheduler and reports only the readback", async () => {
    const t = release();
    expect(await releaseScheduledCommsEmail(await binding(), M, t.d)).toEqual({ result: "released" });
    expect(t.sends).toEqual([{ channel: "email", to: "dana@x.test", contact_id: C, connector_id: S, message_id: M, subject: "Hi", body: "<p>Hello there</p>",
      comms_email_operation_id: OP, idempotency_key: `comms-email:${OP}`, comms_email_scheduled_release: true }]);
    expect(t.log).toEqual(["send", "support"]);
  });
  it("releases original rich draft HTML only from an identical fresh approved binding", async () => {
    const source = { message_id: M, updated_at: "2026-10-30T16:00:00.123456Z" };
    const original = await binding({ command, body_html: "<p><strong>Hello there</strong></p>", governance: { draft_source: source } });
    let reads = 0;
    const t = release({ readBinding: async () => ({ ...original, state: ++reads === 1 ? "prepared" : "provider_accepted", eligible: true }) });
    expect(await releaseScheduledCommsEmail(original, M, t.d)).toEqual({ result: "released" });
    expect(t.sends[0]?.body).toBe(original.body_html);
    expect(t.closes).toEqual([]);
  });
  it("does not release rich drafts when any fresh binding identity, content or source moved", async () => {
    const original = await binding({ command, body_html: "<p><strong>Hello there</strong></p>", governance: { draft_source: { message_id: M, updated_at: "2026-10-30T16:00:00.123456Z" } } });
    for (const moved of [
      { body_html: "<p>Changed</p>" }, { body_text: "Changed" }, { subject: "Changed" },
      { content_digest: "a".repeat(64) }, { recipient: "other@tests.invalid" }, { from_address: "other@tests.invalid" },
      { actor_user_id: C }, { tenant_id: C }, { contact_id: A }, { connector_id: C },
      { governance: { draft_source: { message_id: M, updated_at: "2026-10-30T16:00:00.123457Z" } } },
      { governance: {} }, { governance: { draft_source: null } },
      { command: { ...command, body: "Changed" } }, { attachments: [{ path: "unapproved" }] },
    ]) {
      const t = release({ readBinding: async () => ({ ...original, ...moved, eligible: true }) });
      expect(await releaseScheduledCommsEmail(original, M, t.d)).toEqual({ result: "left", reason: "binding_moved" });
      expect(t.sends).toEqual([]); expect(t.closes).toEqual([]);
    }
  });
  it("malformed or different original draft identity never admits scheduled rich HTML", async () => {
    for (const source of [null, {}, { message_id: C, updated_at: "2026-10-30T16:00:00.123456Z" },
      { message_id: M, updated_at: "invalid" }, { message_id: M, updated_at: "2026-10-30T16:00:00.123456Z", tenant_id: T }]) {
      const t = release();
      expect(await releaseScheduledCommsEmail(await binding({ governance: { draft_source: source } }), M, t.d)).toEqual({ result: "invalid" });
      expect(t.log).toEqual([]);
    }
  });
  it("an edge clock up to a minute behind the database still releases (the database's claim is the authority)", async () => {
    const behind = release({}, { now: AT - 30_000 });
    expect(await releaseScheduledCommsEmail(await binding(), M, behind.d)).toEqual({ result: "released" });
    const wayBehind = release({}, { now: AT - 61_000 });
    expect(await releaseScheduledCommsEmail(await binding(), M, wayBehind.d)).toEqual({ result: "left", reason: "not_due" });
    expect(wayBehind.sends).toEqual([]);
  });
  it("before its time nothing happens; past the grace it is closed as missed without sending", async () => {
    const early = release({}, { now: AT - 120_000 });
    expect(await releaseScheduledCommsEmail(await binding(), M, early.d)).toEqual({ result: "left", reason: "not_due" });
    const late = release({}, { now: AT + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS + 1 });
    expect(await releaseScheduledCommsEmail(await binding(), M, late.d)).toEqual({ result: "refused", reason: "scheduled_release_missed" });
    expect([...early.log, ...late.log]).toEqual(["refuse:scheduled_release_missed"]);
  });
  it("a removed scheduler, a closed business, or a binding no longer eligible is closed, never sent", async () => {
    for (const [readError, reason] of [["COMMS_EMAIL_AUTHORITY_UNAVAILABLE", "scheduler_authority_removed"], ["COMMS_EMAIL_ACTOR_UNAVAILABLE", "scheduler_authority_removed"], ["COMMS_EMAIL_WORKSPACE_UNAVAILABLE", "workspace_unavailable"]]) {
      const t = release({}, { readError });
      expect(await releaseScheduledCommsEmail(await binding(), M, t.d), readError).toEqual({ result: "refused", reason });
      expect(t.sends).toEqual([]);
    }
    const ineligible = release({}, { eligible: false });
    expect(await releaseScheduledCommsEmail(await binding(), M, ineligible.d)).toEqual({ result: "refused", reason: "send_no_longer_eligible" });
    expect(ineligible.sends).toEqual([]);
  });
  it("any other unreadable binding writes nothing and sends nothing", async () => {
    const t = release({}, { readError: "fetch failed" });
    expect(await releaseScheduledCommsEmail(await binding(), M, t.d)).toEqual({ result: "left", reason: "binding_unreadable" });
    expect(t.log).toEqual([]);
  });
  it("repeats the executor's pre-send checks: kill switch, parties, readiness, exact content", async () => {
    const cases: [Partial<ScheduledReleaseDependencies>, Record<string, unknown>, string][] = [
      [{ providerExecutionAllowed: async () => false }, {}, "comms_provider_execution_disabled"],
      [{ resolveParties: async () => ({ kind: "contact_not_in_workspace" }) }, {}, "contact_not_in_workspace"],
      [{ resolveParties: async () => ({ kind: "resolved", contactId: C, contactName: "D", recipient: "new@x.test", connectorId: S, fromAddress: "owner@biz.test" }) }, {}, "recipient_changed"],
      [{ resolveParties: async () => ({ kind: "resolved", contactId: C, contactName: "D", recipient: "dana@x.test", connectorId: S, fromAddress: "other@biz.test" }) }, {}, "sender_changed"],
      [{ readiness: async () => ({ eligible: false, state: "held", reason: "BLOCKED_SUPPRESSED", provider_execution_verified: false }) }, {}, "blocked_suppressed"],
      [{}, { body_html: "<p>Something else</p>" }, "content_changed"],
      [{}, { content_digest: "0".repeat(64) }, "content_changed"],
    ];
    for (const [over, b, reason] of cases) {
      const t = release(over);
      expect(await releaseScheduledCommsEmail(await binding(b), M, t.d), reason).toEqual({ result: "refused", reason });
      expect(t.sends, reason).toEqual([]);
    }
  });
  it("an unreadable kill switch, parties or readiness is left for the next lease, never closed", async () => {
    for (const over of [{ providerExecutionAllowed: async () => { throw new Error("x"); } }, { resolveParties: async () => { throw new Error("x"); } },
      { readiness: async () => ({ eligible: false, state: "unavailable", reason: "EMAIL_READINESS_UNVERIFIED", provider_execution_verified: false }) }] as Partial<ScheduledReleaseDependencies>[]) {
      const t = release(over);
      expect((await releaseScheduledCommsEmail(await binding(), M, t.d)).result).toBe("left");
      expect(t.log).toEqual([]);
    }
  });
  it("still prepared after an ANSWERED send-message: only a permanent answer closes it", async () => {
    for (const code of ["comms_email_send_shape_invalid", "comms_email_binding_required", "COMMS_EMAIL_NOT_SCHEDULED", "COMMS_EMAIL_SCHEDULED_RELEASE_REQUIRED", "message_not_found"]) {
      const t = release({}, { afterState: "prepared", code });
      expect(await releaseScheduledCommsEmail(await binding(), M, t.d), code).toEqual({ result: "refused", reason: code.toLowerCase() });
    }
  });
  it("a transient answer is left for the next lease — never a permanent cancel (lock timeout, concurrent change, claim error, identical in flight)", async () => {
    for (const code of ["comms_email_binding_invalid", "COMMS_EMAIL_NOT_CLAIMABLE", "COMMS_EMAIL_NOT_YET_DUE", "Something odd!", null]) {
      const t = release({}, { afterState: "prepared", code });
      const r = await releaseScheduledCommsEmail(await binding(), M, t.d);
      expect(r, String(code)).toEqual({ result: "left", reason: expect.stringMatching(/^retry:/) });
      expect(t.sends, String(code)).toHaveLength(1);
      expect(t.closes, String(code)).toEqual([]);
    }
    const unanswered = release({}, { afterState: "prepared", answered: false });
    expect(await releaseScheduledCommsEmail(await binding(), M, unanswered.d)).toEqual({ result: "left", reason: "send_unanswered" });
    expect(unanswered.closes).toEqual([]);
  });
  it("…and once the grace runs out the next lease closes it as missed", async () => {
    const t = release({}, { afterState: "prepared", code: "COMMS_EMAIL_NOT_CLAIMABLE", now: AT + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS + 1 });
    expect(await releaseScheduledCommsEmail(await binding(), M, t.d)).toEqual({ result: "refused", reason: "scheduled_release_missed" });
    expect(t.sends).toEqual([]);
  });
  it("a claimed or settled send is never closed as refused — it may have gone out", async () => {
    for (const afterState of ["dispatching", "unknown", "failed"]) {
      const t = release({}, { afterState });
      expect(await releaseScheduledCommsEmail(await binding(), M, t.d), afterState).toEqual({ result: "settled" });
      expect(t.closes).toEqual([]);
    }
    const claimed = release({}, { state: "dispatching" });
    expect(await releaseScheduledCommsEmail(await binding(), M, claimed.d)).toEqual({ result: "settled" });
    expect(claimed.sends).toEqual([]);
    const thrown = release({ send: async () => { throw new Error("network"); } }, { afterState: "dispatching" });
    expect(await releaseScheduledCommsEmail(await binding(), M, thrown.d)).toEqual({ result: "settled" });
  });
  it("a close the database will not record is left, not reported as refused", async () => {
    const t = release({ closeRefused: async () => false }, { now: AT + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS + 1 });
    expect(await releaseScheduledCommsEmail(await binding(), M, t.d)).toEqual({ result: "left", reason: "close_unrecorded:scheduled_release_missed" });
  });
  it("a binding that is not a canonical scheduled one is invalid and untouched", async () => {
    for (const b of [{ send_at: undefined }, { send_at: "2026-11-02T14:30:00Z" }, { operation_id: "nope" }, { content_digest: "x" }]) {
      const t = release();
      expect(await releaseScheduledCommsEmail(await binding(b), M, t.d)).toEqual({ result: "invalid" });
      expect(t.log).toEqual([]);
    }
    expect(await releaseScheduledCommsEmail(await binding(), "not-a-uuid", release().d)).toEqual({ result: "invalid" });
  });
});

describe("executeCommsEmailSend — files the person approved", () => {
  const SHA = "a".repeat(64);
  const manifest = [{ path: `${T}/governed/${OP}/1-a.pdf`, source_path: `${T}/90000000-0000-4000-8000-000000000001-a.pdf`, name: "a.pdf", mime: "application/pdf", size: 12, sha256: SHA }];
  const withFiles = async (extra: Record<string, unknown> = {}) => { const i = await input(); return { ...i, stored: { ...i.stored, attachments: manifest, ...extra } }; };
  const DIGEST = "c".repeat(64);
  it("prepares the 15-argument call (files + an explicit null time) and sends exactly the bound row", async () => {
    const args: Record<string, unknown>[] = []; const sent: Record<string, unknown>[] = [];
    const t = deps(); const prepare = t.d.prepare; t.d.prepare = async a => { args.push(a); return prepare(a); };
    t.d.send = async b => { sent.push(b); t.set("provider_accepted"); return {}; };
    expect(await executeCommsEmailSend(await withFiles(), t.d)).toMatchObject({ ok: true, outcome: "provider_accepted" });
    expect(args[0]).toMatchObject({ _attachments: manifest, _send_at: null });
    expect(Object.keys(args[0])).toHaveLength(15);
    expect(sent[0]).not.toHaveProperty("attachments");
  });
  it("a scheduled email with files names both, and is only scheduled", async () => {
    const args: Record<string, unknown>[] = [];
    const t = deps({ prepare: async a => { args.push(a); return { data: { ok: true, replayed: false, state: "prepared", message_id: M, send_at: "2026-11-02T14:30:00.000Z" }, error: null }; } });
    expect(await executeCommsEmailSend(await withFiles({ sendAt: "2026-11-02T14:30:00.000Z" }), t.d)).toMatchObject({ ok: true, outcome: "scheduled" });
    expect(args[0]).toMatchObject({ _attachments: manifest, _send_at: "2026-11-02T14:30:00.000Z" });
    expect(t.log).toEqual([]);
  });
  it("maps the database's file refusals", async () => {
    for (const code of ["COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED", "COMMS_EMAIL_ATTACHMENTS_INVALID", "COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED"]) {
      const t = deps({ prepare: async () => ({ data: null, error: { code: "22023", message: code } }) });
      expect(await executeCommsEmailSend(await withFiles(), t.d)).toMatchObject({ outcome: "refused", reason: code });
      expect(t.log).toEqual([]);
    }
  });
  it("a call approved WITHOUT files that reaches a row prepared WITH files sends nothing", async () => {
    const t = deps({
      prepare: async () => ({ data: { ok: true, replayed: true, state: "prepared", message_id: M }, error: null }),
      readBinding: async () => ({ operation_id: OP, attachments: manifest }),
    });
    expect(await executeCommsEmailSend(await input(), t.d)).toMatchObject({ outcome: "refused", reason: "COMMS_EMAIL_ATTACHMENTS_CHANGED" });
    expect(t.log).toEqual([]);
    const fine = deps({ prepare: async () => ({ data: { ok: true, replayed: true, state: "prepared", message_id: M }, error: null }) });
    fine.d.send = async () => { fine.set("provider_accepted"); return {}; };
    expect(await executeCommsEmailSend(await input(), fine.d)).toMatchObject({ ok: true, outcome: "provider_accepted" });
  });
  it("a stored call whose files are not this operation's manifest is not the approved call", async () => {
    const { parseCommsEmailStoredCall } = await import("./adapter.ts");
    const i = await input();
    const args = { expected_tenant_id: T, operation_id: OP, command, recipient: i.stored.recipient, from_address: i.stored.fromAddress, content_digest: i.stored.contentDigest };
    expect(parseCommsEmailStoredCall({ ...args, attachments: manifest, attachments_digest: DIGEST }, T)?.attachments).toEqual(manifest);
    expect(parseCommsEmailStoredCall({ ...args, attachments: [{ ...manifest[0], path: manifest[0].path.replace(OP, "20000000-0000-4000-8000-000000000009") }], attachments_digest: DIGEST }, T)).toBeNull();
    expect(parseCommsEmailStoredCall({ ...args, attachments: [], attachments_digest: DIGEST }, T)).toBeNull();
    // The digest rides with the manifest: both or neither, and only a real sha256.
    expect(parseCommsEmailStoredCall({ ...args, attachments: manifest }, T)).toBeNull();
    expect(parseCommsEmailStoredCall({ ...args, attachments_digest: DIGEST }, T)).toBeNull();
    expect(parseCommsEmailStoredCall({ ...args, attachments: manifest, attachments_digest: "XYZ" }, T)).toBeNull();
    expect(parseCommsEmailStoredCall(args, T)).not.toHaveProperty("attachments");
  });
});
