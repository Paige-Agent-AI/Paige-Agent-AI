// INT-328 — the governed executor and reconcile, with every database/network edge injected.
import { describe, it, expect } from "vitest";
import { executeCommsEmailSend, reconcileCommsEmailSend, type CommsEmailExecutorDependencies } from "./adapter.ts";
import { commsEmailContentDigest } from "./contract.ts";

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
  it("re-enters only a reconcilable Resend operation, under the same operation and key", async () => {
    const t = deps(); t.set("unknown"); const sent: Record<string, unknown>[] = []; t.d.send = async b => { sent.push(b); t.set("provider_accepted"); return {}; };
    expect(await reconcileCommsEmailSend(OP, T, t.d)).toMatchObject({ ok: true, outcome: "provider_accepted", reconciled: true });
    expect(sent).toEqual([expect.objectContaining({ comms_email_operation_id: OP, comms_email_reconcile: true, idempotency_key: `comms-email:${OP}`, message_id: M, body: "<p>Hello there</p>" })]);
  });
  it("leaves a non-reconcilable or foreign-tenant operation unknown without sending", async () => {
    const t = deps({ readResult: async () => ({ outcome: "unknown", message_id: M, provider: "gmail", reconcilable: false }) });
    expect(await reconcileCommsEmailSend(OP, T, t.d)).toMatchObject({ outcome: "outcome_unknown", reconcilable: false });
    const u = deps({ readBinding: async () => ({ operation_id: OP, tenant_id: "10000000-0000-4000-8000-000000000009", message_id: M }) }); u.set("unknown");
    expect((await reconcileCommsEmailSend(OP, T, u.d)).outcome).toBe("outcome_unknown");
    expect([...t.log, ...u.log]).toEqual([]);
  });
});
