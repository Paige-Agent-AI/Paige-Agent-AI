// execute-approval — the action-backed email approval (owner.lead_followup family), driven against an
// in-memory service client and a fake send-message. Nothing here reaches a network or a database.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approvalActionId, classifySendResult, decideActionEmailApproval, extractActionDraft,
  type ActionEmailAdmin, type ApprovalRowForSend, type SendMessageRequest,
} from "./action-email.ts";

const T = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000009";
const A = "20000000-0000-4000-8000-000000000001", ACT = "40000000-0000-4000-8000-000000000001";
const C = "30000000-0000-4000-8000-000000000001", S1 = "50000000-0000-4000-8000-000000000001", S2 = "50000000-0000-4000-8000-000000000002";
type Row = Record<string, unknown>;

function db(tables: Record<string, Row[]>, failTables: string[] = []) {
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const writes: { table: string; values: Row; filters: [string, unknown][] }[] = [];
  const admin = {
    from: (table: string) => ({
      select: () => {
        const filters: [string, unknown][] = []; reads.push({ table, filters });
        const fail = failTables.includes(table);
        const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
        const q = {
          eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
          maybeSingle: async () => (fail ? { data: null, error: { code: "XX" } } : { data: rows()[0] ?? null, error: null }),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(fail ? { data: null, error: { code: "XX" } } : { data: rows(), error: null }).then(res, rej),
        };
        return q;
      },
      update: (values: Row) => {
        const filters: [string, unknown][] = []; writes.push({ table, values, filters });
        const q = {
          eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res, rej),
        };
        return q;
      },
    }),
  };
  return { admin: admin as unknown as ActionEmailAdmin, reads, writes };
}

const contact = {
  id: C, tenant_id: T, first_name: "Dana", last_name: "Reyes",
  client_contact_methods: [
    { kind: "email", value: "other@x.test", is_primary: false, position: 0 },
    { kind: "email", value: "Dana@X.test", is_primary: true, position: 1 },
  ],
};
const conn = (id: string, extra: Row = {}) => ({
  id, tenant_id: T, channel_type: "email", provider: "resend", from_address: `owner-${id.slice(-1)}@biz.test`,
  active: true, status: "active", credentials_vault_ref: null, config: {}, ...extra,
});
const action = (extra: Row = {}) => ({ id: ACT, tenant_id: T, action_kind: "owner.lead_followup", contact_id: C, approval_id: A, status: "pending_approval", ...extra });
const kinds = [
  { slug: "owner.lead_followup", executor: "send_via_approval" },
  { slug: "owner.lead_captured", executor: "record_only" },
];
const legacyDraft = {
  ok: true, subagent: "email-composer",
  draft: { subject: "Thanks for reaching out", body_html: "<p>Hi Dana</p>", body_text: "Hi Dana" },
  recipient: { email: "attacker@evil.test" },
};
const approvalRow = (extra: Partial<ApprovalRowForSend> = {}): ApprovalRowForSend => ({
  id: A, tenant_id: T, conversation_id: null, category: "owner.lead_followup", type: "cs_draft",
  draft_content: legacyDraft, metadata: { action_id: ACT }, ...extra,
});

function harness(tables: Record<string, Row[]>, sendAnswer: { httpOk: boolean; body: unknown } | "throw" = { httpOk: true, body: { status: "sent", audit_id: "aud-1" } }, opts: { failTables?: string[]; env?: Record<string, string> } = {}) {
  const d = db({ paige_action_kinds: kinds, ...tables }, opts.failTables);
  const sends: SendMessageRequest[] = [];
  let released = 0;
  const env = { RESEND_API_KEY: "set", ...(opts.env ?? {}) };
  const deps = {
    admin: d.admin,
    sendMessage: async (r: SendMessageRequest) => { sends.push(r); if (sendAnswer === "throw") throw new Error("network"); return sendAnswer; },
    releaseClaim: async () => { released += 1; },
    env: (k: string) => (env as Record<string, string>)[k],
    now: () => new Date("2026-10-13T12:00:00.000Z"),
  };
  return { deps, sends, writes: d.writes, reads: d.reads, released: () => released };
}
const run = (h: ReturnType<typeof harness>, a = approvalRow(), connectorId: string | null = null) =>
  decideActionEmailApproval(h.deps, a, { connectorId });

describe("extractActionDraft", () => {
  it("reads the worker's contract shape", () => {
    expect(extractActionDraft({ channel: "email", subject: " Hi ", body: "<p>x</p>", body_text: "x", raw: {} }, "owner.lead_followup"))
      .toEqual({ kind: "email", subject: "Hi", bodyHtml: "<p>x</p>", shape: "contract" });
  });
  it("tolerates the legacy nested composer shape", () => {
    expect(extractActionDraft(legacyDraft, "owner.lead_followup")).toEqual({ kind: "email", subject: "Thanks for reaching out", bodyHtml: "<p>Hi Dana</p>", shape: "legacy_nested" });
  });
  it("leaves SMS to the existing comms path, by channel or by an SMS kind", () => {
    expect(extractActionDraft({ channel: "sms", body: "x" }, "owner.lead_followup").kind).toBe("other_channel");
    expect(extractActionDraft(legacyDraft, "owner.sms_nudge").kind).toBe("other_channel");
  });
  it("an incomplete or missing draft is unsendable, never a guess", () => {
    expect(extractActionDraft({ channel: "email", subject: "x" }, "k")).toEqual({ kind: "unsendable", reason: "draft_incomplete" });
    expect(extractActionDraft({ draft: { subject: "x" } }, "k")).toEqual({ kind: "unsendable", reason: "draft_incomplete" });
    expect(extractActionDraft({ channel: "fax", subject: "x", body: "y" }, "k")).toEqual({ kind: "unsendable", reason: "unsupported_channel" });
    expect(extractActionDraft({ content: "hello" }, "k")).toEqual({ kind: "unsendable", reason: "draft_not_sendable" });
    expect(extractActionDraft(null, "k")).toEqual({ kind: "unsendable", reason: "draft_not_sendable" });
  });
});

describe("classifySendResult", () => {
  it("sent only on a 2xx with status sent", () => {
    expect(classifySendResult(true, { status: "sent", audit_id: "a" })).toEqual({ kind: "sent", auditId: "a" });
    expect(classifySendResult(false, { status: "sent" }).kind).toBe("failed");
  });
  it("a queued_* hold answered as status 'failed' is ACCEPTED, not a failure", () => {
    expect(classifySendResult(true, { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T08:00:00Z", message_id: "m1" }))
      .toEqual({ kind: "queued", outcome: "queued_quiet_hours", scheduledFor: "2026-10-14T08:00:00Z", messageId: "m1" });
    expect(classifySendResult(true, { status: "failed", outcome: "queued_tenant_dnd" }).kind).toBe("queued");
  });
  it("a block or an error stays a failure", () => {
    expect(classifySendResult(true, { status: "failed", outcome: "blocked_suppressed" })).toEqual({ kind: "failed", error: "blocked_suppressed" });
    expect(classifySendResult(true, { status: "failed", error: "RESEND_API_KEY missing" })).toEqual({ kind: "failed", error: "RESEND_API_KEY missing" });
    expect(classifySendResult(false, {})).toEqual({ kind: "failed", error: "send_failed" });
  });
});

describe("decideActionEmailApproval", () => {
  it("an approval with no action is not this module's (falls through, nothing read)", async () => {
    const h = harness({});
    expect(await run(h, approvalRow({ metadata: {} }))).toBeNull();
    expect(approvalActionId({ action_id: "not-a-uuid" })).toBeNull();
    expect(h.reads).toHaveLength(0);
  });

  it("a non-send action kind keeps today's behaviour (falls through)", async () => {
    const h = harness({ paige_actions: [action({ action_kind: "owner.lead_captured" })] });
    expect(await run(h)).toBeNull();
    expect(h.sends).toHaveLength(0);
    expect(h.released()).toBe(0);
  });

  it("an SMS draft on a send kind falls through to the existing comms path", async () => {
    const h = harness({ paige_actions: [action()] });
    expect(await run(h, approvalRow({ draft_content: { channel: "sms", body: "hi" } }))).toBeNull();
    expect(h.sends).toHaveLength(0);
  });

  it("SENDS a legacy-shaped lead follow-up through the business's own connector to the contact's primary email", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1)] });
    const r = await run(h);
    expect(r).toEqual({ status: 200, payload: { ok: true, executed: true, channel: "email", approval_id: A, audit_id: "aud-1", last_contacted_recorded: true } });
    expect(h.sends).toEqual([{
      channel: "email", to: "dana@x.test", subject: "Thanks for reaching out", body: "<p>Hi Dana</p>",
      contact_id: C, approval_id: A, connector_id: S1, idempotency_key: `approval:${A}`,
    }]);
    expect(h.released()).toBe(0);
    // The contact read is tenant-filtered (§9).
    expect(h.reads.find((x) => x.table === "clients")?.filters).toEqual([["id", C], ["tenant_id", T]]);
    // The touch on the contact is recorded, inside the tenant.
    expect(h.writes).toEqual([{ table: "clients", values: { last_contacted_at: "2026-10-13T12:00:00.000Z" }, filters: [["id", C], ["tenant_id", T]] }]);
  });

  it("sends the contract shape and never takes a recipient from the draft", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1)] });
    const draft = { channel: "email", to: "attacker@evil.test", recipient: "attacker@evil.test", subject: "S", body: "<p>B</p>", body_text: "B", raw: {} };
    await run(h, approvalRow({ draft_content: draft, conversation_id: "60000000-0000-4000-8000-000000000001" }));
    expect(h.sends[0].to).toBe("dana@x.test");
    expect(h.sends[0].conversation_id).toBe("60000000-0000-4000-8000-000000000001");
  });

  it("no email sender → 422 needs_setup, claim released, nothing sent, nothing approved", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [] });
    const r = await run(h);
    expect(r?.status).toBe(422);
    expect(r?.payload).toMatchObject({ ok: false, executed: false, error: "needs_setup" });
    expect(h.sends).toHaveLength(0);
    expect(h.released()).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it("a sender that is not usable right now is needs_setup too (gmail without a credential)", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1, { provider: "gmail" })] }, undefined, { env: { GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y" } });
    const r = await run(h);
    expect(r?.payload).toMatchObject({ error: "needs_setup", reason: "EMAIL_RECONNECT_REQUIRED" });
    expect(h.sends).toHaveLength(0);
    expect(h.released()).toBe(1);
  });

  it("several senders and no choice → 422 sender_choice_required; a valid choice sends from it", async () => {
    const tables = { paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1), conn(S2)] };
    const h = harness(tables);
    const r = await run(h);
    expect(r?.status).toBe(422);
    expect(r?.payload).toMatchObject({ error: "sender_choice_required" });
    expect((r?.payload.senders as unknown[]).length).toBe(2);
    expect(h.sends).toHaveLength(0);
    expect(h.released()).toBe(1);

    const h2 = harness(tables);
    expect((await run(h2, approvalRow(), S2))?.status).toBe(200);
    expect(h2.sends[0].connector_id).toBe(S2);
  });

  it("a chosen connector of another business is not a sender here", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1), conn(S2, { tenant_id: OTHER })] });
    const r = await run(h, approvalRow(), S2);
    expect(r?.payload).toMatchObject({ error: "needs_setup" });
    expect(h.sends).toHaveLength(0);
  });

  it("a QUEUED send (quiet hours) is accepted: claim kept, row not approved, no second copy possible", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1)] },
      { httpOk: true, body: { status: "failed", outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T08:00:00Z", message_id: "m1" } });
    const r = await run(h);
    expect(r).toEqual({ status: 200, payload: { ok: true, executed: false, queued: true, outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T08:00:00Z", channel: "email", approval_id: A } });
    expect(h.released()).toBe(0);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].table).toBe("paige_pending_approvals");
    expect(h.writes[0].values).toEqual({ metadata: { action_id: ACT, send_queued: { outcome: "queued_quiet_hours", scheduled_for: "2026-10-14T08:00:00Z", message_id: "m1", at: "2026-10-13T12:00:00.000Z" } } });
    expect(h.writes[0].values).not.toHaveProperty("status");
  });

  it("a failed send releases the claim and reports the failure", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1)] }, { httpOk: true, body: { status: "failed", outcome: "blocked_no_consent" } });
    const r = await run(h);
    expect(r?.status).toBe(502);
    expect(r?.payload).toMatchObject({ ok: false, executed: false, error: "blocked_no_consent" });
    expect(h.released()).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it("no answer from send-message keeps the claim (outcome unknown), never a success", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1)] }, "throw");
    const r = await run(h);
    expect(r?.payload).toMatchObject({ ok: false, error: "send_outcome_unknown" });
    expect(h.released()).toBe(0);
  });

  it("an unsendable draft on a send kind fails honestly — never acknowledged", async () => {
    const h = harness({ paige_actions: [action()], clients: [contact], channel_connectors: [conn(S1)] });
    const r = await run(h, approvalRow({ draft_content: { content: "free text" } }));
    expect(r?.status).toBe(422);
    expect(r?.payload).toMatchObject({ ok: false, error: "not_sendable", reason: "draft_not_sendable" });
    expect(h.sends).toHaveLength(0);
    expect(h.released()).toBe(1);
    expect(h.writes).toHaveLength(0);
  });

  it("§9: an action of another tenant, or one not pointing back at this approval, is refused", async () => {
    const h = harness({ paige_actions: [action({ tenant_id: OTHER })], clients: [contact], channel_connectors: [conn(S1)] });
    expect((await run(h))?.payload).toMatchObject({ error: "action_tenant_mismatch" });
    expect(h.sends).toHaveLength(0);
    expect(h.released()).toBe(1);

    const h2 = harness({ paige_actions: [action({ approval_id: "20000000-0000-4000-8000-000000000099" })], clients: [contact], channel_connectors: [conn(S1)] });
    expect((await run(h2))?.payload).toMatchObject({ error: "action_approval_mismatch" });
    expect(h2.sends).toHaveLength(0);
  });

  it("a closed action, a vanished action with an email draft, or a contact with no primary email never sends", async () => {
    const closed = harness({ paige_actions: [action({ status: "dismissed" })], clients: [contact], channel_connectors: [conn(S1)] });
    expect((await run(closed))?.payload).toMatchObject({ error: "action_closed" });
    const gone = harness({ paige_actions: [], clients: [contact], channel_connectors: [conn(S1)] });
    expect((await run(gone))?.payload).toMatchObject({ error: "action_not_found" });
    const noEmail = harness({ paige_actions: [action()], clients: [{ ...contact, client_contact_methods: [] }], channel_connectors: [conn(S1)] });
    expect((await run(noEmail))?.payload).toMatchObject({ error: "no_recipient" });
    for (const h of [closed, gone, noEmail]) { expect(h.sends).toHaveLength(0); expect(h.released()).toBe(1); }
  });

  it("a read failure is unavailable, with the claim released", async () => {
    const h = harness({ paige_actions: [action()] }, undefined, { failTables: ["paige_actions"] });
    expect((await run(h))?.status).toBe(503);
    expect(h.released()).toBe(1);
  });
});

describe("execute-approval wiring (index.ts)", () => {
  const src = readFileSync(join(__dirname, "index.ts"), "utf8");
  it("decides action-backed approvals after the claim and before the comms heuristic and the acknowledge path", () => {
    const at = src.indexOf("decideActionEmailApproval({");
    expect(at).toBeGreaterThan(src.indexOf("const releaseClaim"));
    expect(at).toBeGreaterThan(src.indexOf('(metaLc as any).source === "paige_orchestration"'));
    expect(at).toBeLessThan(src.indexOf("const isComms ="));
    expect(at).toBeLessThan(src.indexOf('execute_note: "acknowledged'));
  });
  it("the generic comms path treats a queued_* hold as accepted and keeps the claim", () => {
    const branch = src.slice(src.indexOf("const sendOutcome = classifySendResult"), src.indexOf("if (sendOutcome.kind !== \"sent\")"));
    expect(branch).toContain('sendOutcome.kind === "queued"');
    expect(branch).not.toContain("releaseClaim");
    expect(branch).toContain("queued: true");
  });
});
