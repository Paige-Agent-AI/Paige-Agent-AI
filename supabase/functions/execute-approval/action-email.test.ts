// execute-approval — the outbound-message refusal and the send-message answer classifier, driven against
// an in-memory service client. Nothing here reaches a network or a database.
import { describe, it, expect } from "vitest";
import {
  approvalActionId, classifySendResult, refuseSendKindApproval, SEND_REFUSAL,
  type SendKindAdmin,
} from "./action-email.ts";

const A = "2000000a-0000-4000-8000-0000000000aa", ACT = "4000000b-0000-4000-8000-0000000000bb";
const T = "1000000c-0000-4000-8000-0000000000cc", OTHER = "10000000-0000-4000-8000-000000000009";
type Row = Record<string, unknown>;

/** Read-only fake: it has NO update/insert/delete/rpc, so any write attempt throws and fails the test. */
function db(tables: Record<string, Row[]>, failTables: string[] = []) {
  const reads: { table: string; columns: string; filters: [string, string, unknown][] }[] = [];
  const admin = {
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: [string, string, unknown][] = []; reads.push({ table, columns, filters });
        const rows = () => (tables[table] ?? []).filter((r) => filters.every(([op, k, v]) =>
          op === "in" ? (v as unknown[]).includes(r[k]) : r[k] === v));
        const run = (single: boolean) => (failTables.includes(table)
          ? { data: null, error: { code: "XX" } }
          : { data: single ? (rows()[0] ?? null) : rows(), error: null });
        const q = {
          eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
          in: (k: string, v: unknown[]) => { filters.push(["in", k, v]); return q; },
          maybeSingle: async () => run(true),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
        };
        return q;
      },
    }),
  };
  return { admin: admin as unknown as SendKindAdmin, reads };
}

// Every send_via_approval kind on the platform (migrations 20260711140000, 20260714092000, 20260720200830,
// 20260726190000, 20270117000000) plus a non-send kind of each other executor.
const kinds = [
  { slug: "client.followup", executor: "send_via_approval" },
  { slug: "owner.followup_email", executor: "send_via_approval" },
  { slug: "owner.sms_nudge", executor: "send_via_approval" },
  { slug: "owner.lead_followup", executor: "send_via_approval" },
  { slug: "sales.work_followup", executor: "send_via_approval" },
  { slug: "finance.retainer_reminder", executor: "send_via_approval" },
  { slug: "comms-draft-reply", executor: "send_via_approval" },
  { slug: "social.post_publish", executor: "send_via_approval" },
  { slug: "owner.lead_captured", executor: "record_only" },
  { slug: "owner.run_workflow", executor: "workflow" },
  { slug: "client.surface_note", executor: "surface_to_client" },
];
const SEND_KINDS = kinds.filter((k) => k.executor === "send_via_approval").map((k) => k.slug);
const REVIEWABLE_EMAIL_KINDS = ["owner.lead_followup", "client.followup", "owner.followup_email"];
const action = (extra: Row = {}) => ({ id: ACT, tenant_id: T, action_kind: "client.followup", contact_id: null, approval_id: A, status: "pending_approval", ...extra });
const declineOnly = { status: 409, payload: { ok: false, executed: false, error: "send_requires_review", reason_code: "decline_only", reason: SEND_REFUSAL.decline_only, approval_id: A } };
const reviewAndSend = { status: 409, payload: { ok: false, executed: false, error: "send_requires_review", reason_code: "review_and_send", reason: SEND_REFUSAL.review_and_send, approval_id: A } };
const ap = (metadata: unknown, tenant_id: string | null = T) => ({ id: A, tenant_id, metadata });

describe("refuseSendKindApproval", () => {
  it("an approval with no action behind it (no action_id, nothing pointing back) is not this module's: null", async () => {
    const d = db({ paige_actions: [], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({}))).toBeNull();
    expect(await refuseSendKindApproval(d.admin, ap(null))).toBeNull();
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: "not-a-uuid" }))).toBeNull();
    expect(approvalActionId({ action_id: ` ${ACT} ` })).toBe(ACT);
    // Only the back-pointer read runs (no action_id to look up, no kind to read).
    expect(d.reads.map((r) => [r.table, r.filters])).toEqual(Array(3).fill(["paige_actions", [["eq", "approval_id", A]]]));
  });

  it("the legacy client.followup shape is still refused here, with review_and_send guidance", async () => {
    const d = db({ paige_actions: [action()], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toEqual(reviewAndSend);
    // Filtered reads, by server-held ids only: the named action, the back-pointer, the kind.
    expect(d.reads.map((r) => [r.table, r.filters])).toEqual([
      ["paige_actions", [["eq", "id", ACT]]],
      ["paige_actions", [["eq", "approval_id", A]]],
      ["paige_action_kinds", [["in", "slug", ["client.followup"]]]],
    ]);
  });

  it.each(SEND_KINDS.filter((k) => !REVIEWABLE_EMAIL_KINDS.includes(k)))("every unsupported send kind is refused decline_only: %s", async (slug) => {
    const d = db({ paige_actions: [action({ action_kind: slug })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toEqual(declineOnly);
  });

  it("a reply to a new lead of the same business is refused review_and_send (the reply screen is its path)", async () => {
    const d = db({ paige_actions: [action({ action_kind: "owner.lead_followup" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toEqual(reviewAndSend);
    // Upper-case tenant on the approval is the same business.
    expect(T.toUpperCase()).not.toBe(T);
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }, T.toUpperCase()))).toEqual(reviewAndSend);
  });

  it("the back-pointer ALONE is enough: metadata.action_id dropped, the action still points at the approval", async () => {
    const d = db({ paige_actions: [action({ action_kind: "owner.lead_followup" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({}))).toEqual(reviewAndSend);
    const c = db({ paige_actions: [action({ action_kind: "owner.sms_nudge" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(c.admin, ap({ action_id: "garbage" }))).toEqual(declineOnly);
  });

  it("the named action ALONE is enough: it does not point back at this approval", async () => {
    const d = db({ paige_actions: [action({ approval_id: null })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toEqual(reviewAndSend);
  });

  it("an upper-case action_id names the same action (ids compare case-insensitively)", async () => {
    expect(ACT.toUpperCase()).not.toBe(ACT); // the fixture id has hex letters, or this proves nothing
    const d = db({ paige_actions: [action({ approval_id: null })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT.toUpperCase() }))).toEqual(reviewAndSend);
    expect(d.reads[0].filters).toEqual([["eq", "id", ACT]]);
  });

  it.each(["owner.lead_captured", "owner.run_workflow", "client.surface_note"])("a non-send kind continues as before: %s", async (slug) => {
    const d = db({ paige_actions: [action({ action_kind: slug })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toBeNull();
  });

  it("a kind that is not registered is not a send kind (continues as before)", async () => {
    const d = db({ paige_actions: [action({ action_kind: "made.up" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toBeNull();
  });

  it("a reply action of ANOTHER business is refused decline_only, and the answer carries nothing read from it", async () => {
    const d = db({ paige_actions: [action({ tenant_id: OTHER, action_kind: "owner.lead_followup", approval_id: null })], paige_action_kinds: kinds });
    const r = await refuseSendKindApproval(d.admin, ap({ action_id: ACT }));
    expect(r).toEqual(declineOnly);
    expect(JSON.stringify(r)).not.toContain(OTHER);
    expect(JSON.stringify(r)).not.toContain("owner.lead_followup");
    // An approval with no tenant cannot be reviewed either.
    const n = db({ paige_actions: [action({ action_kind: "owner.lead_followup" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(n.admin, ap({ action_id: ACT }, null))).toEqual(declineOnly);
  });

  it("a reply plus an unsupported send kind behind one approval is decline_only", async () => {
    const d = db({ paige_actions: [action({ action_kind: "owner.lead_followup", approval_id: null }),
      action({ id: "40000000-0000-4000-8000-000000000002", action_kind: "owner.sms_nudge" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toEqual(declineOnly);
  });

  it("an action that no longer exists names no kind: continues as before", async () => {
    const d = db({ paige_actions: [], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toBeNull();
  });

  it("a read failure is 503 unavailable — never a guess that it is safe to proceed", async () => {
    const a = db({ paige_actions: [action()], paige_action_kinds: kinds }, ["paige_actions"]);
    expect(await refuseSendKindApproval(a.admin, ap({ action_id: ACT })))
      .toEqual({ status: 503, payload: { ok: false, executed: false, error: "unavailable", detail: "action_read_failed", approval_id: A } });
    const b = db({ paige_actions: [action()], paige_action_kinds: kinds }, ["paige_actions"]);
    expect((await refuseSendKindApproval(b.admin, ap({})))?.payload).toMatchObject({ error: "unavailable", detail: "action_read_failed" });
    const k = db({ paige_actions: [action()], paige_action_kinds: kinds }, ["paige_action_kinds"]);
    expect((await refuseSendKindApproval(k.admin, ap({ action_id: ACT })))?.payload)
      .toMatchObject({ error: "unavailable", detail: "action_kind_read_failed" });
  });

  it("user-facing reasons never name an email provider", () => {
    for (const text of Object.values(SEND_REFUSAL)) expect(text).not.toMatch(/sendgrid|resend|twilio|mailgun|postmark/i);
  });

  it.each(REVIEWABLE_EMAIL_KINDS)("%s uses existing review guidance, with no write or send capability", async (slug) => {
    const d = db({ paige_actions: [action({ action_kind: slug, contact_id: "not-authority", draft: { to: "ignored@example.invalid" } })], paige_action_kinds: kinds });
    const result = await refuseSendKindApproval(d.admin, ap({ action_id: ACT }));
    expect(result).toEqual(reviewAndSend);
    expect(d.reads.map((r) => r.table)).toEqual(["paige_actions", "paige_actions", "paige_action_kinds"]);
    // The fake exposes filtered reads only: neither content nor an address is returned as authority.
    expect(JSON.stringify(result)).not.toMatch(/ignored@example|not-authority/);
    expect(await refuseSendKindApproval(d.admin, ap({}))).toEqual(reviewAndSend);
  });

  it.each(REVIEWABLE_EMAIL_KINDS)("%s in another workspace, without a workspace, or mixed with a foreign action stays decline_only", async (slug) => {
    const foreign = db({ paige_actions: [action({ action_kind: slug, tenant_id: OTHER, approval_id: null })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(foreign.admin, ap({ action_id: ACT }))).toEqual(declineOnly);
    const own = db({ paige_actions: [action({ action_kind: slug })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(own.admin, ap({ action_id: ACT }, null))).toEqual(declineOnly);
    expect(await refuseSendKindApproval(own.admin, ap({ action_id: ACT }, ""))).toEqual(declineOnly);
    const mixed = db({ paige_actions: [action({ action_kind: slug, approval_id: null }),
      action({ id: "40000000-0000-4000-8000-000000000002", action_kind: "owner.followup_email", tenant_id: OTHER })], paige_action_kinds: kinds });
    const result = await refuseSendKindApproval(mixed.admin, ap({ action_id: ACT }));
    expect(result).toEqual(declineOnly);
    expect(JSON.stringify(result)).not.toContain(OTHER);
  });

  it("a kind merely resembling a supported email kind gets no new review guidance", async () => {
    for (const slug of ["client.followup.extra", "Client.followup", "owner.followup_email.extra"]) {
      const d = db({ paige_actions: [action({ action_kind: slug })], paige_action_kinds: [...kinds, { slug, executor: "send_via_approval" }] });
      expect(await refuseSendKindApproval(d.admin, ap({ action_id: ACT }))).toEqual(declineOnly);
    }
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
    expect(classifySendResult(false, { outcome: "queued_quiet_hours" }).kind).toBe("failed");
  });
  it("a block or an error stays a failure", () => {
    expect(classifySendResult(true, { status: "failed", outcome: "blocked_suppressed" })).toEqual({ kind: "failed", error: "blocked_suppressed" });
    expect(classifySendResult(true, { status: "failed", error: "RESEND_API_KEY missing" })).toEqual({ kind: "failed", error: "RESEND_API_KEY missing" });
    expect(classifySendResult(false, {})).toEqual({ kind: "failed", error: "send_failed" });
  });
});
