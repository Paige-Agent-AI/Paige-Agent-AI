/**
 * THE EXTERNAL-SEND APPROVAL FOR `draft_and_email_document` — durable, single-use, and bound to the
 * EXACT thing a person approved.
 *
 * WHY THIS IS ITS OWN GATE, ABOVE THE GENERIC GOVERNED GATE. `draft_and_email_document` is the one
 * skill in `skill-runner` with an EXTERNAL SEND (a Resend email into a real person's inbox). The
 * generic governed decision (`decideSkillRun`) refuses the cases that must never reach here at all —
 * an unauthenticated caller, a request-supplied tenant, a service principal acting alone, a caller
 * the surface did not authorize. What it cannot do is bind a human's "yes" to the EXACT send, so that
 * a direct caller cannot (a) forge a confirmation, or (b) reuse one approval to email a DIFFERENT
 * recipient, a DIFFERENT document, or from a DIFFERENT sender. That binding is what this module adds,
 * and it reuses the canonical `paige_pending_confirmations` table + the `confirm-fingerprint.ts`
 * pattern rather than inventing a parallel approval system (§18).
 *
 * THE TWO PHASES, AND WHY THE DRAFT IS STORED RATHER THAN RE-AUTHORED.
 *   - Phase 1 (no approval submitted): resolve the sender, DRAFT the document, fingerprint the EXACT
 *     send — `(action, tenant, contact, recipient, sender identity, doc_type, content hash)` — and
 *     record a single-use proposal holding the drafted content. Nothing is sent. The caller is handed
 *     the fingerprint + a human-readable summary.
 *   - Phase 2 (approval submitted): CLAIM the proposal atomically (a compare-and-set on `consumed_at`),
 *     and send the STORED content to the STORED recipient under the STORED sender — the exact thing the
 *     fingerprint was bound to. The model/caller never re-authors the call, so it cannot drift the
 *     recipient, the body, or the sender between approval and send (the same reason the chat gate
 *     executes stored arguments, 20261023000000).
 *
 * SINGLE USE IS ENFORCED BY THE WRITE, NOT BY TRUST. The claim sets `consumed_at` in the same UPDATE
 * that reads the row, so a replay of the same fingerprint after consumption matches nothing and is
 * DENIED. An expired, forged, cross-tenant, or wrong-person token matches nothing for the same reason.
 * On EVERY denied path nothing is sent and no receipt is written.
 *
 * PURE + DEPENDENCY-INJECTED, exactly like `resolveSecureBrowserAuthority`, so the whole matrix —
 * same-tenant success, cross-tenant denial, forged/expired/replayed denial, and "no send on any
 * denied path" — is provable from `src/**` vitest without a Deno runtime, a database, or Resend.
 *
 * THE PRE-SEND GATE (E09 Slice 6, §37). Before the provider call, the claimed recipient passes the SAME
 * runPreSend every other client send passes: a contact who turned email off (their portal, their
 * unsubscribe link), a hard bounce, a complaint or a business pause stops the send. The claim is
 * already spent (consume-then-execute), so a held send is reported as `send_failed` with the gate's
 * plain reason, a failed receipt is written, and nothing reaches the provider. `preSend` is optional so
 * the approval-binding proofs keep their exact shape; the host always injects it (emailPreSend).
 */
import { runPreSend } from "../pre-send-pipeline.ts";

/** The arguments stored with a proposal — the EXACT send that was approved. Returned by a successful
 *  claim and used verbatim; never re-authored. */
export type EmailProposalArgs = {
  recipient: string;
  fromHeader: string;
  subject: string;
  html: string;
  doc_type: string;
  contact_id: string;
  content_sha256: string;
};

export type EmailProposalRow = {
  userId: string;
  tenantId: string;
  fingerprint: string;
  requestNonce: string;
  contactId: string;
  args: EmailProposalArgs;
  summary: string;
};

export type EmailApprovalOutcome =
  /** Phase 1 — drafted and proposed; NOTHING sent. The caller re-submits `confirm_fingerprint`. */
  | { kind: "awaiting_confirm"; confirm_fingerprint: string; summary: string }
  /** Phase 2 — approval claimed once AND the stored draft was SENT successfully. */
  | { kind: "sent"; resend_id: string | null; recipient: string }
  /** Phase 2 — the approval was claimed (single-use: now consumed) but the external SEND FAILED. §13:
   *  this is never reported as success — the email did not go out and the one-time approval is spent,
   *  so the caller must be told plainly and re-draft to try again. "A fire is not a delivery." */
  | { kind: "send_failed"; resend_id: string | null; recipient: string; held_reason?: string }
  /** Any denial — cross-tenant/scoped-out, forged/expired/replayed approval, unrecordable proposal.
   *  NOTHING was sent on a pre-send denial, and no success receipt is written. */
  | { kind: "denied"; code: string; message: string };

export type EmailApprovalInput = {
  /** The CALLER's tenant, resolved server-side. Never the contact's, never the body's. */
  tenantId: string;
  /** The CALLER (JWT actor). The proposal is bound to this person; nobody else can claim it. */
  userId: string;
  contactId: string;
  /** From the contact looked up SCOPED TO `tenantId`. Null means the contact is not in the caller's
   *  workspace (a cross-tenant `contact_id`, or none) — a hard denial before any draft or send. */
  recipientEmail: string | null;
  /** The scoped contact's own tenant. Defense-in-depth: it must equal `tenantId`. Null = not found. */
  contactTenantId: string | null;
  recipientName?: string;
  docType: string;
  prompt: string;
  /** The fingerprint the caller submitted to approve (phase 2). Absent on phase 1. */
  confirmToken?: string;
  /** A per-REQUEST nonce. The claim excludes the minting request, mirroring the canonical mechanism
   *  (20261026000000) so a minting turn cannot also redeem. */
  requestNonce: string;
};

export type EmailApprovalDeps = {
  /** Draft the document body (HTML). The LLM call in the host; injected so the flow is pure. */
  draft: (p: { docType: string; prompt: string; recipientName?: string }) => Promise<string>;
  /** Resolve the tenant's sending identity (the `get_tenant_sender` result). */
  resolveSender: (tenantId: string) => Promise<{ fromName: string; fromEmail: string }>;
  /** The canonical `confirm-fingerprint.ts` hash. Injected so the module has no crypto import of its
   *  own and the SAME function that governs chat governs this. */
  fingerprint: (tool: string, args: Record<string, unknown>) => Promise<string>;
  /** SHA-256 hex of the drafted content, so the approval is bound to the EXACT bytes drafted. */
  sha256Hex: (s: string) => Promise<string>;
  /** INSERT a single-use proposal into `paige_pending_confirmations` (service-role; authenticated
   *  INSERT is revoked by 20261201000400). "exists" = the same live proposal already stands. */
  recordProposal: (row: EmailProposalRow) => Promise<"created" | "exists" | "failed">;
  /** Atomic compare-and-set claim on `consumed_at`, matching user+tenant+fingerprint, unconsumed,
   *  unexpired, server-issued, and NOT the minting request. Returns the stored args once, else null. */
  claimProposal: (p: {
    userId: string; tenantId: string; fingerprint: string; requestNonce: string;
  }) => Promise<EmailProposalArgs | null>;
  /** The external send. Returns the provider id; `ok:false` is an honest failed send (§13). */
  send: (p: { fromHeader: string; to: string; subject: string; html: string }) => Promise<{ ok: boolean; id: string | null }>;
  /** The canonical pre-send gate (runPreSend) for the claimed recipient. `proceed:false` holds the send
   *  with the gate's plain reason. Optional for the pure proofs; the host injects emailPreSend. */
  preSend?: (p: { contactId: string; to: string }) => Promise<{ proceed: boolean; reason: string | null }>;
  /** The durable execution receipt — the run/communication record read back after a real send. Only
   *  ever called after a successful atomic claim, so it is written at most once per approval. */
  recordReceipt: (p: EmailProposalArgs & { resendId: string | null; ok: boolean }) => Promise<void>;
};

const SUBJECT = (docType: string) => `Your ${docType} from Paige`;

export async function governedDraftAndEmail(
  input: EmailApprovalInput,
  deps: EmailApprovalDeps,
): Promise<EmailApprovalOutcome> {
  // 1 — CONTACT SCOPE. The contact was looked up SCOPED TO the caller's tenant, so a cross-tenant
  // `contact_id` arrives here as a miss. Deny before drafting or sending — this is the §9 leak the
  // whole fix exists to close, enforced independently of the approval.
  if (!input.recipientEmail || !input.contactTenantId) {
    return {
      kind: "denied",
      code: "contact_not_in_workspace",
      message: "That contact isn't in your workspace (or has no email on file), so nothing was drafted or sent.",
    };
  }
  // Defense-in-depth: a scoped lookup can only ever return the caller's tenant, so a mismatch here is
  // an invariant break, not a reachable input. Refuse loudly rather than proceed.
  if (input.contactTenantId !== input.tenantId) {
    return {
      kind: "denied",
      code: "tenant_scope_mismatch",
      message: "The contact's workspace did not match the caller's, so nothing was sent.",
    };
  }

  // 2 — PHASE 2: an approval was submitted. Claim it atomically and send the STORED draft.
  if (input.confirmToken) {
    const claimed = await deps.claimProposal({
      userId: input.userId,
      tenantId: input.tenantId,
      fingerprint: input.confirmToken,
      requestNonce: input.requestNonce,
    });
    if (!claimed) {
      // Missing / expired / already-consumed (replay) / forged / wrong person or tenant → DENIED.
      // Nothing is sent; no receipt is written.
      return {
        kind: "denied",
        code: "approval_not_valid",
        message: "That approval is missing, expired, or already used, so nothing was sent.",
      };
    }
    // The recipient's opt-outs are checked at the moment of sending, not at the moment of drafting:
    // a contact can turn email off between the two.
    if (deps.preSend) {
      const gate = await deps.preSend({ contactId: claimed.contact_id, to: claimed.recipient });
      if (!gate.proceed) {
        await deps.recordReceipt({ ...claimed, resendId: null, ok: false });
        return {
          kind: "send_failed", resend_id: null, recipient: claimed.recipient,
          held_reason: gate.reason ?? "This contact can't be emailed right now.",
        };
      }
    }
    // Send the EXACT approved content to the EXACT approved recipient under the EXACT approved sender.
    const res = await deps.send({
      fromHeader: claimed.fromHeader,
      to: claimed.recipient,
      subject: claimed.subject,
      html: claimed.html,
    });
    // The one-time execution receipt. Written only after the single-use claim succeeded, so it is
    // written at most once per approval (a replay never reaches here). It carries `ok` so the durable
    // record is honest whether or not the send landed.
    await deps.recordReceipt({ ...claimed, resendId: res.id, ok: res.ok });
    // §13 — report the TRUTH. The approval is already consumed (single-use, consume-then-execute: the
    // replay-safe ordering), so a failed send is `send_failed`, never `sent`; the caller re-drafts.
    return res.ok
      ? { kind: "sent", resend_id: res.id, recipient: claimed.recipient }
      : { kind: "send_failed", resend_id: res.id, recipient: claimed.recipient };
  }

  // 3 — PHASE 1: no approval submitted. Resolve the sender, draft, bind the fingerprint, record a
  // single-use proposal, and ask. Nothing is sent.
  const sender = await deps.resolveSender(input.tenantId);
  const fromHeader = `${sender.fromName} <${sender.fromEmail}>`;
  const html = await deps.draft({ docType: input.docType, prompt: input.prompt, recipientName: input.recipientName });
  const subject = SUBJECT(input.docType);
  const contentHash = await deps.sha256Hex(html);

  // The fingerprint covers EVERY field that defines the send. A different recipient, sender, doc_type,
  // or drafted content yields a different fingerprint, so an old token cannot authorize a new target.
  const fp = await deps.fingerprint("draft_and_email_document", {
    action: "draft_and_email_document",
    tenant_id: input.tenantId,
    contact_id: input.contactId,
    recipient: input.recipientEmail,
    from_email: sender.fromEmail,
    from_name: sender.fromName,
    doc_type: input.docType,
    content_sha256: contentHash,
  });

  const recorded = await deps.recordProposal({
    userId: input.userId,
    tenantId: input.tenantId,
    fingerprint: fp,
    requestNonce: input.requestNonce,
    contactId: input.contactId,
    args: {
      recipient: input.recipientEmail,
      fromHeader,
      subject,
      html,
      doc_type: input.docType,
      contact_id: input.contactId,
      content_sha256: contentHash,
    },
    summary: `Email a ${input.docType} to ${input.recipientEmail} from ${fromHeader}.`,
  });
  if (recorded === "failed") {
    // Fail closed: if the approval could not be recorded there is nothing to approve, so do not
    // pretend it is pending (§13).
    return {
      kind: "denied",
      code: "approval_unrecordable",
      message: "The approval could not be set up, so nothing was drafted for sending. Nothing ran.",
    };
  }
  return {
    kind: "awaiting_confirm",
    confirm_fingerprint: fp,
    summary: `Drafted a ${input.docType} for ${input.recipientEmail}. Approve to send it from ${fromHeader}.`,
  };
}

/** The host's pre-send gate for this skill: runPreSend for an email to one contact of the CALLER's tenant. */
export function emailPreSend(
  admin: Parameters<typeof runPreSend>[0],
  tenantId: string,
): NonNullable<EmailApprovalDeps["preSend"]> {
  return async ({ contactId, to }) => {
    const r = await runPreSend(admin, { tenantId, channel: "email", to, contactId });
    return { proceed: r.proceed, reason: r.reason };
  };
}
