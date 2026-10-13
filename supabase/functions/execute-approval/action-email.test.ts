// execute-approval — the outbound-message refusal and the send-message answer classifier, driven against
// an in-memory service client. Nothing here reaches a network or a database.
import { describe, it, expect } from "vitest";
import {
  approvalActionId, classifySendResult, refuseSendKindApproval, SEND_REQUIRES_REVIEW_REASON,
  type SendKindAdmin,
} from "./action-email.ts";

const A = "20000000-0000-4000-8000-000000000001", ACT = "40000000-0000-4000-8000-000000000001";
const T = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000009";
type Row = Record<string, unknown>;

/** Read-only fake: it has NO update/insert/delete/rpc, so any write attempt throws and fails the test. */
function db(tables: Record<string, Row[]>, failTables: string[] = []) {
  const reads: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  const admin = {
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: [string, unknown][] = []; reads.push({ table, columns, filters });
        const q = {
          eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
          maybeSingle: async () => (failTables.includes(table)
            ? { data: null, error: { code: "XX" } }
            : { data: (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v))[0] ?? null, error: null }),
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
const action = (extra: Row = {}) => ({ id: ACT, tenant_id: T, action_kind: "client.followup", contact_id: null, approval_id: A, status: "pending_approval", ...extra });
const refusal = { status: 409, payload: { ok: false, executed: false, error: "send_requires_review", reason: SEND_REQUIRES_REVIEW_REASON, approval_id: A } };

describe("refuseSendKindApproval", () => {
  it("an approval naming no action is not this module's: null, and nothing is read", async () => {
    const d = db({ paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: {} })).toBeNull();
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: null })).toBeNull();
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: "not-a-uuid" } })).toBeNull();
    expect(approvalActionId({ action_id: ` ${ACT} ` })).toBe(ACT);
    expect(d.reads).toHaveLength(0);
  });

  it("the 125 production rows' shape — legacy client.followup with a nested draft — is refused", async () => {
    const d = db({ paige_actions: [action()], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: ACT } })).toEqual(refusal);
    // Filtered reads, by server-held ids only.
    expect(d.reads.map((r) => [r.table, r.filters])).toEqual([
      ["paige_actions", [["id", ACT]]],
      ["paige_action_kinds", [["slug", "client.followup"]]],
    ]);
  });

  it.each(SEND_KINDS)("every send kind is refused: %s", async (slug) => {
    const d = db({ paige_actions: [action({ action_kind: slug })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: ACT } })).toEqual(refusal);
  });

  it.each(["owner.lead_captured", "owner.run_workflow", "client.surface_note"])("a non-send kind continues as before: %s", async (slug) => {
    const d = db({ paige_actions: [action({ action_kind: slug })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: ACT } })).toBeNull();
  });

  it("a kind that is not registered is not a send kind (continues as before)", async () => {
    const d = db({ paige_actions: [action({ action_kind: "made.up" })], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: ACT } })).toBeNull();
  });

  it("a send action of ANOTHER business is still refused, and the answer carries nothing read from it", async () => {
    const d = db({ paige_actions: [action({ tenant_id: OTHER, action_kind: "owner.lead_followup", approval_id: "x" })], paige_action_kinds: kinds });
    const r = await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: ACT } });
    expect(r).toEqual(refusal);
    expect(JSON.stringify(r)).not.toContain(OTHER);
    expect(JSON.stringify(r)).not.toContain("owner.lead_followup");
  });

  it("an action that no longer exists names no kind: continues as before", async () => {
    const d = db({ paige_actions: [], paige_action_kinds: kinds });
    expect(await refuseSendKindApproval(d.admin, { id: A, metadata: { action_id: ACT } })).toBeNull();
  });

  it("a read failure is 503 unavailable — never a guess that it is safe to proceed", async () => {
    const a = db({ paige_actions: [action()], paige_action_kinds: kinds }, ["paige_actions"]);
    expect(await refuseSendKindApproval(a.admin, { id: A, metadata: { action_id: ACT } }))
      .toEqual({ status: 503, payload: { ok: false, executed: false, error: "unavailable", detail: "action_read_failed", approval_id: A } });
    const k = db({ paige_actions: [action()], paige_action_kinds: kinds }, ["paige_action_kinds"]);
    expect((await refuseSendKindApproval(k.admin, { id: A, metadata: { action_id: ACT } }))?.payload)
      .toMatchObject({ error: "unavailable", detail: "action_kind_read_failed" });
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
