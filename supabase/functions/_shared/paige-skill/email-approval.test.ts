// E09 Slice 6 (§37): draft_and_email_document sends to a real contact, so the claimed recipient passes
// runPreSend before the provider call. A contact who turned email off never reaches send; the approval
// is spent, the failed receipt is written, and the caller hears the gate's plain reason.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emailPreSend, governedDraftAndEmail, type EmailApprovalDeps, type EmailProposalArgs } from "./email-approval.ts";

const claimed: EmailProposalArgs = {
  recipient: "jordan.rivera@tests.invalid", fromHeader: "Northwind Studio <hello@tests.invalid>", subject: "Your plan from Paige",
  html: "<p>plan</p>", doc_type: "plan", contact_id: "client-1", content_sha256: "abc",
};
const input = {
  tenantId: "tenant-a", userId: "owner-a", contactId: "client-1", recipientEmail: "jordan.rivera@tests.invalid",
  contactTenantId: "tenant-a", docType: "plan", prompt: "p", confirmToken: "fp-1", requestNonce: "n-2",
};

function deps(preSend?: EmailApprovalDeps["preSend"]) {
  const calls = { send: 0, receipts: [] as Array<{ ok: boolean; resendId: string | null }>, gated: [] as Array<{ contactId: string; to: string }> };
  const d: EmailApprovalDeps = {
    draft: async () => { throw new Error("phase 2 never drafts"); },
    resolveSender: async () => { throw new Error("phase 2 never resolves a sender"); },
    fingerprint: async () => "fp",
    sha256Hex: async () => "abc",
    recordProposal: async () => "created",
    claimProposal: async () => claimed,
    send: async () => { calls.send++; return { ok: true, id: "re_1" }; },
    recordReceipt: async (r) => { calls.receipts.push({ ok: r.ok, resendId: r.resendId }); },
    ...(preSend ? { preSend: async (p: { contactId: string; to: string }) => { calls.gated.push(p); return preSend(p); } } : {}),
  };
  return { d, calls };
}

describe("draft_and_email_document pre-send gate", () => {
  it("a recipient who turned email off never reaches send", async () => {
    const { d, calls } = deps(async () => ({ proceed: false, reason: "This contact turned off messages on this channel." }));
    const out = await governedDraftAndEmail(input, d);
    assert.deepEqual(out, { kind: "send_failed", resend_id: null, recipient: claimed.recipient, held_reason: "This contact turned off messages on this channel." });
    assert.equal(calls.send, 0);
    assert.deepEqual(calls.receipts, [{ ok: false, resendId: null }]);
    assert.deepEqual(calls.gated, [{ contactId: "client-1", to: "jordan.rivera@tests.invalid" }], "the gate checks the CLAIMED recipient");
  });

  it("a recipient the gate clears is sent exactly once", async () => {
    const { d, calls } = deps(async () => ({ proceed: true, reason: null }));
    const out = await governedDraftAndEmail(input, d);
    assert.equal(out.kind, "sent");
    assert.equal(calls.send, 1);
  });

  it("emailPreSend runs runPreSend for an email to that contact of the caller's tenant", async () => {
    const reads: string[] = [];
    const admin = {
      from(table: string) {
        reads.push(table);
        const q = {
          select: () => q, eq: () => q, or: () => q, order: () => q,
          limit: async () => ({ data: table === "paige_suppressions" ? [{ id: "s1", reason: "customer_request" }] : [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return q;
      },
    };
    const gate = emailPreSend(admin as unknown as Parameters<typeof emailPreSend>[0], "tenant-a");
    assert.deepEqual(await gate({ contactId: "client-1", to: "jordan.rivera@tests.invalid" }),
      { proceed: false, reason: "This contact turned off messages on this channel." });
    assert.ok(reads.includes("paige_suppressions"));
  });
});
