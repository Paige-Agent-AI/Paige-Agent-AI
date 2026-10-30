import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
import { runPreSend } from "../_shared/pre-send-pipeline.ts";
import { confirmFingerprint } from "../_shared/confirm-fingerprint.ts";
import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";
import { COMMS_EMAIL_SEND_CAPABILITY } from "../_shared/paige-spine/domains/comms.ts";
import { COMMS_EMAIL_TOOL, COMMS_EMAIL_ACTION, FINGERPRINT, UUID, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest, parseCommsEmailSendAt, canonicalCommsEmailSendAt, COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS, parseCommsEmailAttachmentRequest, COMMS_EMAIL_FILE_PROVIDERS } from "../_shared/comms-email/contract.ts";
import { readCommsEmailAttachmentSources, copyCommsEmailAttachmentsToGoverned, parseCommsEmailAttachmentManifest, commsEmailManifestsEqual, commsEmailAttachmentPreview, commsEmailAttachmentSummary, commsEmailManifestDigest, readGovernedCommsEmailAttachmentFiles, type CommsEmailAttachmentFile, type CommsEmailAttachmentManifest, type CommsEmailStorage } from "../_shared/comms-email/attachments.ts";
import { resolveCommsEmailParties, readCommsEmailReadiness, commsEmailReadinessOutcome, emailProvidersFor, type CommsEmailAdmin } from "../_shared/comms-email/readiness.ts";
import { readLeadReplyApproval, verifyLeadReplyApproval, storedApprovalMatches, recordLeadReplySend, bindingApprovalMatches, leadReplyPrepareRefusal, type LeadReplyApprovalAdmin, type VerifiedLeadReplyApproval } from "./lead-reply-approval.ts";
import { executeCommsEmailSend, reconcileCommsEmailSend, parseCommsEmailStoredCall, commsEmailSafeResult } from "../_shared/comms-email/adapter.ts";
import { parseCommsEmailDraftSource, commsEmailDraftSourcesEqual, type CommsEmailDraftSource } from "../_shared/comms-email/draft-source.ts";
import { readCommsEmailDraftProposal } from "../_shared/comms-email/draft-proposal.ts";
import { sha256Hex } from "../_shared/webhookSig.ts";

// INT-328 comms.email_send — the governed door for ONE business email to ONE existing contact.
// Mirrors sales-invoice-command: authenticated actor, server-derived tenant, owner/admin seat,
// replay first, server-resolved recipient + sender, readiness BEFORE any proposal, the canonical
// single-use approval (paige_pending_confirmations), decideDeclaredCapability, a decision receipt,
// then the executor. It creates no approval channel and trusts no request-authored recipient,
// sender address, HTML, governance or tenant. Responses never carry provider ids, keys or errors.
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify({ delivery_confirmed: false, ...body }), { status, headers });
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
// Every refusal this door returns BEFORE anything could have been dispatched carries
// outcome:'refused' — Chat narrates a reply without an outcome as "could not confirm whether it went
// out", which would block the owner from a retry that is safe. `outcome_unknown` is reserved for a
// moment when a send may have reached the provider (or a prepared send may still be admitted).
const refusedBeforeDispatch = (status: number, code: string) => response(status, { ok: false, outcome: "refused", code });
const REPLAY_MISMATCH = "COMMS_EMAIL_REPLAY_MISMATCH";
const statusOf = (result: Record<string, unknown>) => result.ok === true ? 200 : result.outcome === "outcome_unknown" ? 503 : result.outcome === "sender_choice_required" ? 409 : 422;
// How long the door waits on send-message. Without files: 25 s (send-message's provider call has its own
// 20 s deadline). With files, send-message first reads and re-hashes up to 10 MiB of governed copies (in
// parallel) before its claim, so the wait is 40 s. A send-message that does not answer in time is never
// read as "not sent": the result is read back from the database, and an unanswered send stays unknown.
const SEND_WAIT_MS = 25_000;
const SEND_WAIT_WITH_FILES_MS = 40_000;

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return refusedBeforeDispatch(405, "METHOD_NOT_ALLOWED");
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, serviceKey);
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return refusedBeforeDispatch(401, "UNAUTHENTICATED");
  let body: Record<string, unknown> & { expected_tenant_id: string; operation_id: string; approval_id?: string; send_at?: string; cancel?: true; attachments?: unknown; draft_source?: CommsEmailDraftSource }, command: ReturnType<typeof parseCommsEmailCommand>;
  try {
    const raw = await req.text();
    if (raw.length > 100000) throw new TypeError("BODY_TOO_LARGE");
    const parsed = object(JSON.parse(raw));
    if (!parsed || Object.keys(parsed).some(key => !["expected_tenant_id", "operation_id", "command", "approved_fingerprint", "approval_id", "send_at", "cancel", "attachments", "draft_source"].includes(key))) throw new TypeError("INVALID_BODY");
    if (typeof parsed.expected_tenant_id !== "string" || !UUID.test(parsed.expected_tenant_id) || typeof parsed.operation_id !== "string" || !UUID.test(parsed.operation_id)) throw new TypeError("INVALID_SCOPE");
    // Cancel of a scheduled send: exactly { expected_tenant_id, operation_id, cancel: true } — no command,
    // no approval, no time. It is answered further down, after the workspace/seat/profile checks.
    if (parsed.cancel !== undefined) {
      if (parsed.cancel !== true || Object.keys(parsed).length !== 3) throw new TypeError("INVALID_CANCEL");
      body = { expected_tenant_id: parsed.expected_tenant_id.toLowerCase(), operation_id: parsed.operation_id.toLowerCase(), cancel: true };
      // Never read: the cancel path returns before step 2, the first use of the command.
      command = null as unknown as ReturnType<typeof parseCommsEmailCommand>;
    } else {
      if (parsed.approved_fingerprint !== undefined && (typeof parsed.approved_fingerprint !== "string" || !FINGERPRINT.test(parsed.approved_fingerprint))) throw new TypeError("INVALID_FINGERPRINT");
      // Experience 03: the drafted lead reply this email answers (paige_pending_approvals.id). Optional.
      if (parsed.approval_id !== undefined && (typeof parsed.approval_id !== "string" || !UUID.test(parsed.approval_id))) throw new TypeError("INVALID_APPROVAL");
      command = parseCommsEmailCommand(parsed.command);
      const draftSource = parsed.draft_source === undefined ? undefined : parseCommsEmailDraftSource(parsed.draft_source);
      // "Approve now, send later": a top-level send time, never part of the command (the command and its
      // content digest are unchanged). Raising a card checks the window (2 min .. 30 days ahead); a
      // confirm only canonicalizes it — the STORED call's time is what runs, and the execute step below
      // refuses one that has already passed.
      let sendAt: string | undefined;
      if (parsed.send_at !== undefined) {
        try { sendAt = parsed.approved_fingerprint === undefined ? parseCommsEmailSendAt(parsed.send_at, Date.now()) : canonicalCommsEmailSendAt(parsed.send_at); }
        catch { return refusedBeforeDispatch(400, "COMMS_EMAIL_SEND_AT_INVALID"); }
      }
      // A drafted lead reply is answered now; its one-send-per-approval record is not scheduled.
      if (sendAt !== undefined && parsed.approval_id !== undefined) return refusedBeforeDispatch(400, "COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED");
      // Files ride as a top-level key too (the command and its content digest are unchanged), and never
      // with a drafted lead reply, whose send is recorded against its approval exactly as drafted.
      if (parsed.attachments !== undefined && parsed.approval_id !== undefined) return refusedBeforeDispatch(400, "COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED");
      // The binding, the unique index and send-message all compare the operation id as lowercase
      // text; an uppercase id from a direct caller would otherwise never match its own binding.
      const { send_at: _requestedSendAt, ...rest } = parsed;
      body = { ...rest, expected_tenant_id: parsed.expected_tenant_id.toLowerCase(), operation_id: parsed.operation_id.toLowerCase(),
        ...(draftSource ? { draft_source: draftSource } : {}),
        ...(typeof parsed.approval_id === "string" ? { approval_id: parsed.approval_id.toLowerCase() } : {}),
        ...(sendAt !== undefined ? { send_at: sendAt } : {}) };
    }
  } catch { return refusedBeforeDispatch(400, "COMMS_EMAIL_COMMAND_INVALID"); }

  const { data: tenantId, error: tenantError } = await caller.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string" || tenantId !== body.expected_tenant_id) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
  // The files named, checked against the SERVER-derived tenant before anything is read: a path in
  // another business, the Team Hub or the governed folder is refused here, with no storage call at all.
  let attachmentPaths: string[] | null = null;
  if (body.attachments !== undefined && !body.draft_source) {
    try { attachmentPaths = parseCommsEmailAttachmentRequest(body.attachments, tenantId); }
    catch { return refusedBeforeDispatch(400, "COMMS_EMAIL_ATTACHMENTS_INVALID"); }
  }
  // A cancel is a brake, not a send: it is not held behind the provider kill switch.
  if (body.cancel !== true && !await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user.id })) return refusedBeforeDispatch(403, COMMS_PROVIDER_EXECUTION_DISABLED);
  const stillCurrent = async () => {
    const { data, error } = await caller.rpc("current_user_tenant_id");
    return !error && data === tenantId;
  };
  const { data: member, error: memberError } = await admin.from("tenant_members").select("role,status").eq("tenant_id", tenantId).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (memberError || !["owner", "admin"].includes(member?.role ?? "")) return response(403, { ok: false, outcome: "refused", code: "COMMS_EMAIL_FORBIDDEN" });
  // The seat is held in the workspace the person has OPEN, exactly as the SQL (_comms_email_actor)
  // requires: profiles.active_tenant_id = this tenant. current_user_tenant_id() can fall back to a
  // membership when none is set, but every prepare/read would then refuse — so say it plainly here
  // ("reopen the right workspace") instead of a retry that can never succeed.
  const { data: profile, error: profileError } = await admin.from("profiles").select("active_tenant_id").eq("user_id", user.id).maybeSingle();
  if (profileError) return refusedBeforeDispatch(503, "COMMS_EMAIL_AUTHORITY_UNAVAILABLE");
  if (typeof profile?.active_tenant_id !== "string" || profile.active_tenant_id.toLowerCase() !== tenantId) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");

  // 1b — Cancel a scheduled email (any owner/admin of this business may: a brake needs no special
  // authority). The database decides under the row lock: a scheduled operation still 'prepared' is
  // closed as refused `cancelled_by_owner`; once the drainer's claim has taken it, it is too late and
  // the answer says what the send's state is. Nothing is ever sent from here.
  if (body.cancel === true) {
    if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
    const { data: cancelled, error: cancelError } = await admin.rpc("cancel_comms_email_send", { _actor_user_id: user.id, _expected_tenant_id: tenantId, _operation_id: body.operation_id });
    if (cancelError) {
      const message = String(object(cancelError)?.message ?? "");
      if (message.includes("COMMS_EMAIL_NOT_SCHEDULED")) return response(409, { ok: false, cancelled: false, code: "COMMS_EMAIL_NOT_SCHEDULED", operation_id: body.operation_id });
      if (message.includes("COMMS_EMAIL_OPERATION_NOT_FOUND")) return response(404, { ok: false, cancelled: false, code: "COMMS_EMAIL_NOT_FOUND", operation_id: body.operation_id });
      if (message.includes("COMMS_EMAIL_WORKSPACE_CHANGED")) return response(409, { ok: false, cancelled: false, code: "WORKSPACE_CHANGED" });
      if (object(cancelError)?.code === "42501") return response(403, { ok: false, cancelled: false, code: "COMMS_EMAIL_FORBIDDEN" });
      // No answer we can read: the cancel may or may not have landed. Say so; the thread re-reads it.
      return response(503, { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_UNVERIFIED", operation_id: body.operation_id });
    }
    const c = object(cancelled);
    // The cancel and its audit row (comms.email_scheduled_cancelled) are one database transaction.
    if (c?.cancelled === true) {
      return response(200, { ok: true, cancelled: true, outcome: "refused", reason: "CANCELLED_BY_OWNER", operation_id: body.operation_id,
        ...(typeof c.message_id === "string" && UUID.test(c.message_id) ? { message_id: c.message_id } : {}) });
    }
    // Too late: the drainer already took it (or it has an outcome). Report the send's own state honestly.
    const state = typeof c?.outcome === "string" ? c.outcome : "";
    const outcome = ["provider_accepted", "failed", "refused"].includes(state) ? state : "outcome_unknown";
    // The recorded reason (a lower-case code such as cancelled_by_owner or scheduled_release_missed) lets
    // the thread say WHY nothing went out; anything not shaped like one is dropped.
    const reason = outcome === "refused" && typeof c?.reason === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(c.reason) ? c.reason : undefined;
    return response(409, { ok: false, cancelled: false, code: "COMMS_EMAIL_CANCEL_TOO_LATE", outcome, ...(reason ? { reason } : {}), operation_id: body.operation_id });
  }

  const readResult = async (operationId: string) => {
    const { data, error } = await admin.rpc("read_comms_email_send_result", { _actor_user_id: user.id, _expected_tenant_id: tenantId, _operation_id: operationId });
    // The read is tied to the actor: an operation that exists but belongs to someone else raises
    // COMMS_EMAIL_REPLAY_MISMATCH. Keep that one distinguishable; every other failure is opaque.
    if (error) throw new Error(String(object(error)?.message ?? "").includes(REPLAY_MISMATCH) ? REPLAY_MISMATCH : "comms_email_readback_unavailable");
    return data;
  };
  // Whether send-message ANSWERED (finished) rather than timing out or failing at the gateway. Only
  // an answered call that left the row 'prepared' proves nothing was dispatched for this operation.
  let sendAnswered = false;
  let sendWaitMs = SEND_WAIT_MS;
  const send = async (payload: Record<string, unknown>) => {
    sendAnswered = false;
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), sendWaitMs);
    try {
      const sent = await fetch(`${url}/functions/v1/send-message`, { method: "POST", headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: abort.signal });
      const answer = await sent.json().catch(() => null);
      sendAnswered = typeof sent.status === "number" && sent.status < 500 && answer !== null;
      return answer;
    } finally { clearTimeout(timer); }
  };
  // send-message answered, but its claim did not admit the row (an identical email is in flight, or
  // the row no longer matched): the operation is still 'prepared', so nothing went out. THIS
  // operation is closed as refused (an unclaimed finalize: 'prepared', no attempt number), so its row
  // reads "Not sent" instead of sitting 'prepared' ("Sending…") forever. The person can ask again;
  // that is a new request. If the database will not close it (another attempt claimed it meanwhile),
  // nothing is claimed about it: the answer stays outcome_unknown.
  const notAdmitted = async (result: Record<string, unknown>, operationId: string): Promise<Record<string, unknown>> => {
    if (result.outcome !== "outcome_unknown" || !sendAnswered) return result;
    try {
      const after = object(await readResult(operationId));
      if (after?.outcome !== "prepared" || typeof after.message_id !== "string" || !UUID.test(after.message_id)) return result;
      // The claim also refuses while an IDENTICAL email (same recipient + content) is dispatching or
      // unknown under another operation. This operation sent nothing, but telling the owner "Not sent"
      // would invite a resend of an email that may already have gone out: name that send instead.
      let inFlight: string | null = null;
      const b = object(await readBinding(after.message_id));
      if (b && typeof b.recipient === "string" && typeof b.content_digest === "string") {
        const { data: pending, error } = await admin.rpc("find_comms_email_pending_reconciliation", { _expected_tenant_id: tenantId, _recipient: b.recipient, _content_digest: b.content_digest });
        if (error) return result;
        if (typeof pending === "string" && UUID.test(pending) && pending !== operationId) inFlight = pending;
      }
      const { error: closeError } = await admin.rpc("finalize_comms_email_send", { _message_id: after.message_id, _operation_id: operationId, _outcome: "refused", _provider_message_id: null, _reason: "send_not_admitted", _claimed_attempt: null });
      if (inFlight) return { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT", reconciled_operation_id: inFlight, operation_id: operationId, delivery_confirmed: false };
      if (closeError) return result;
      const closed = object(await readResult(operationId));
      return closed?.outcome === "refused" ? commsEmailSafeResult(closed) : result;
    } catch { return result; }
  };
  const readBinding = async (messageId: string) => {
    const { data, error } = await admin.rpc("read_comms_email_send_binding", { _message_id: messageId });
    if (error) throw new Error("comms_email_binding_unavailable");
    return data;
  };
  const reconcile = (operationId: string) => reconcileCommsEmailSend(operationId, tenantId, { readResult, readBinding, send, stillCurrent });

  // #1140: a governed send that the provider accepted moves the thread's support
  // case (if any) to awaiting_customer and clears its pending follow-up — the
  // bounded no-chase rule. Best-effort and NEVER blocking: a failure here changes
  // nothing about the send's own result, which the readback below still owns.
  const settleSupportCase = async (settled: Record<string, unknown>) => {
    // ok:true alone is not "sent": a scheduled email is ok:true, outcome 'scheduled', and nothing went out.
    if (settled.ok !== true || settled.outcome !== "provider_accepted" || typeof settled.message_id !== "string" || !UUID.test(settled.message_id)) return;
    try { await admin.rpc("mark_support_case_outbound", { _message_id: settled.message_id }); } catch { /* next inbound re-syncs the case */ }
  };

  // Experience 03: once the provider ACCEPTED this send (never delivery), bind it to the lead reply's
  // approval server-side. A record failure never reports the send as failed — the email went out — it
  // answers record_status:'pending_record', and re-POSTing the same operation (a replay) records it.
  // The approval named here is never trusted on its own: on a replay it must equal the approval the
  // operation was PREPARED for (comms_email_binding.approval_id, checked below), and the SQL record
  // (_lead_reply_record_send) refuses any send whose binding names a different approval.
  const approvalAdmin = admin as unknown as LeadReplyApprovalAdmin;
  const withApprovalRecord = async (settled: Record<string, unknown>, operationId: string): Promise<Record<string, unknown>> => {
    if (body.approval_id === undefined || settled.ok !== true || settled.outcome !== "provider_accepted") return settled;
    const record_status = await recordLeadReplySend(approvalAdmin, { approvalId: body.approval_id, operationId, actorUserId: user.id });
    return { ...settled, approval_id: body.approval_id, record_status };
  };
  // PAIGE Email (SendGrid) is a sender this door recognises; whether it may send is readiness's call.
  const senderProviders = emailProvidersFor({ sendgridConfigured: !!Deno.env.get("SENDGRID_MAIL_SEND_API_KEY") });

  // 2 — Replay first: a recorded outcome is returned before any current fact or approval is read.
  // An operation whose provider outcome is unknown is reconciled under its own id, never re-run.
  if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
  let replay: Record<string, unknown> | null;
  // A failed replay read proves nothing about this operation: it may already have been sent on an
  // earlier attempt. Never "Not sent" — unknown, and no send is attempted.
  try { replay = object(await readResult(body.operation_id)); } catch { return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE" }); }
  let replayBinding: Record<string, unknown> | null = null;
  if (replay) {
    try { replayBinding = typeof replay.message_id === "string" && UUID.test(replay.message_id) ? object(await readBinding(replay.message_id)) : null; }
    catch { return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE" }); }
    const boundSource = object(replayBinding?.governance)?.draft_source;
    if (body.draft_source !== undefined || boundSource !== undefined) {
      let matches = false;
      try {
        const recordedSource = parseCommsEmailDraftSource(boundSource);
        const recordedCommand = parseCommsEmailCommand(replayBinding?.command);
        matches = body.draft_source !== undefined && commsEmailDraftSourcesEqual(recordedSource, body.draft_source)
          && replay.message_id === recordedSource.message_id && replayBinding?.message_id === recordedSource.message_id
          && replayBinding?.operation_id === body.operation_id && replayBinding?.tenant_id === tenantId && replayBinding?.actor_user_id === user.id
          && (command.connector_id === null || command.connector_id === recordedCommand.connector_id)
          && JSON.stringify(parseCommsEmailCommand({ ...command, connector_id: recordedCommand.connector_id })) === JSON.stringify(recordedCommand);
      } catch { /* an existing operation never becomes permission for another source */ }
      if (!matches) return response(409, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_DRAFT_REPLAY_MISMATCH", operation_id: body.operation_id });
    }
  }
  // A scheduled operation is 'prepared' for days by design: it is answered as scheduled, never taken
  // into the prepared-recovery path (which would mint a fresh card and send it at once).
  const scheduledReplay = replay?.outcome === "prepared" && typeof replay.send_at === "string";
  const preparedRecovery = replay?.outcome === "prepared" && !scheduledReplay;
  // A replay that names an approval must name the one this operation was prepared for: the request's
  // approval_id is a claim, the binding is the record. An operation prepared for no approval, or for
  // another, is never recorded against this one (round-3 MAJOR-2). A replay naming NO approval records
  // nothing, so it is answered as before.
  if (replay && body.approval_id !== undefined) {
    let matches: boolean;
    try {
      const messageId = typeof replay.message_id === "string" && UUID.test(replay.message_id) ? replay.message_id : null;
      matches = messageId !== null && bindingApprovalMatches(await readBinding(messageId), body.approval_id);
    } catch { return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE" }); }
    // The operation exists, so it may have been (or may still be) dispatched: never "refused"/"Not sent".
    if (!matches) return response(403, { ok: false, outcome: "outcome_unknown", code: "LEAD_REPLY_APPROVAL_MISMATCH", operation_id: body.operation_id });
  }
  if (replay && scheduledReplay) {
    // Past its release grace and still 'prepared': no claim ever admitted it, so the email service has
    // not received it — but the database has not recorded that yet (the drainer's sweep closes it as
    // missed), and a release leased at the very end of the grace may still be finishing. So it is not
    // "scheduled" any more, and not yet a recorded "not sent": outcome_unknown, never a resend prompt.
    if (Date.parse(String(replay.send_at)) + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS < Date.now()) {
      return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_SCHEDULED_RELEASE_UNSETTLED", send_at: replay.send_at,
        operation_id: body.operation_id, replayed: true });
    }
    return response(200, { ok: true, outcome: "scheduled", send_at: replay.send_at, operation_id: body.operation_id,
      ...(typeof replay.message_id === "string" && UUID.test(replay.message_id) ? { message_id: replay.message_id } : {}), replayed: true });
  }
  if (replay && !preparedRecovery) {
    if (replay.outcome === "unknown" || replay.outcome === "dispatching") {
      const settled = await withApprovalRecord(await reconcile(body.operation_id), body.operation_id);
      await settleSupportCase(settled);
      return response(statusOf(settled), { ...settled, replayed: true });
    }
    const recorded = await withApprovalRecord(commsEmailSafeResult(replay, { replayed: true }), body.operation_id);
    await settleSupportCase(recorded);
    return response(statusOf(recorded), recorded);
  }

  // 2b — A named lead-reply approval must be THIS business's pending owner.lead_followup approval for
  // THIS contact, before any card is raised or anything is prepared (re-checked on the stored call).
  let originalApproval: VerifiedLeadReplyApproval | undefined;
  if (body.approval_id !== undefined) {
    const checked = await readLeadReplyApproval(approvalAdmin, { tenantId, approvalId: body.approval_id, contactId: command.contact_id, operationId: body.operation_id });
    if (typeof checked === "string") return refusedBeforeDispatch(checked === "LEAD_REPLY_APPROVAL_UNAVAILABLE" ? 503 : 409, checked);
    originalApproval = checked;
  }

  let draftBodyHtml: string | undefined;
  if (body.draft_source) {
    if (preparedRecovery) {
      // The original row is now bound, so its updated_at is no longer the pre-approval
      // source version. Recover only that same binding, never read a replacement draft.
      if (!replayBinding || typeof replayBinding.body_html !== "string" || typeof replayBinding.connector_id !== "string") return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_BINDING_UNAVAILABLE" });
      draftBodyHtml = replayBinding.body_html;
      command = parseCommsEmailCommand({ ...command, connector_id: replayBinding.connector_id });
      const manifest = replayBinding.attachments == null ? null : parseCommsEmailAttachmentManifest(replayBinding.attachments, tenantId, body.operation_id);
      if (replayBinding.attachments != null && !manifest) return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_ATTACHMENTS_CHANGED" });
      attachmentPaths = manifest?.map(file => file.source_path) ?? null;
      if (body.attachments !== undefined) {
        let named: string[] | null;
        try { named = Array.isArray(body.attachments) && body.attachments.length === 0 ? null : parseCommsEmailAttachmentRequest(body.attachments, tenantId); }
        catch { return refusedBeforeDispatch(400, "COMMS_EMAIL_ATTACHMENTS_INVALID"); }
        if (JSON.stringify(named) !== JSON.stringify(attachmentPaths)) return response(409, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_ATTACHMENTS_CHANGED" });
      }
    } else {
      const draft = await readCommsEmailDraftProposal(admin as unknown as CommsEmailAdmin, { tenantId, actorUserId: user.id, source: body.draft_source, command, attachments: body.attachments, contentReader: caller as unknown as CommsEmailAdmin, originalApproval });
      if (!draft.ok) return refusedBeforeDispatch(409, draft.code);
      draftBodyHtml = draft.bodyHtml; attachmentPaths = draft.attachmentPaths;
      command = parseCommsEmailCommand({ ...command, connector_id: draft.connectorId });
    }
  }

  // 3 — Who it goes to and who it comes from, resolved here and never taken from the model.
  let parties: Awaited<ReturnType<typeof resolveCommsEmailParties>>;
  try { parties = await resolveCommsEmailParties(admin as unknown as CommsEmailAdmin, { tenantId, actorUserId: user.id, contactId: command.contact_id, connectorId: command.connector_id }, senderProviders); }
  catch { return response(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_PARTIES_UNAVAILABLE" }); }
  if (parties.kind === "contact_not_in_workspace") return response(422, { ok: false, outcome: "refused", reason: "CONTACT_NOT_IN_WORKSPACE" });
  if (parties.kind === "recipient_missing") return response(422, { ok: false, outcome: "needs_setup", reason: "RECIPIENT_EMAIL_MISSING" });
  if (parties.kind === "sender_missing") return response(422, { ok: false, outcome: "needs_setup", reason: "TENANT_EMAIL_SENDER_MISSING" });
  if (parties.kind === "sender_choice_required") return response(409, { ok: false, outcome: "sender_choice_required", reason: "SENDER_CHOICE_REQUIRED", senders: parties.senders });
  const proposedCommand = parseCommsEmailCommand({ ...command, connector_id: parties.connectorId });
  const contentDigest = await commsEmailContentDigest({ recipient: parties.recipient, connectorId: parties.connectorId, subject: command.subject, bodyText: command.body });

  // An identical email to the same person whose earlier send is unresolved is THAT send: settle it.
  const { data: pending, error: pendingError } = await admin.rpc("find_comms_email_pending_reconciliation", { _expected_tenant_id: tenantId, _recipient: parties.recipient, _content_digest: contentDigest });
  if (pendingError) return response(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_RECONCILIATION_UNVERIFIED" });
  if (typeof pending === "string" && UUID.test(pending)) {
    // The finder searches the whole workspace; the result read is tied to its actor. An identical
    // unresolved email that a TEAMMATE asked for is theirs to settle: name it, never send, and never
    // promise that asking again will check it (for this person it cannot).
    let pendingResult: Record<string, unknown> | null = null;
    try { pendingResult = object(await readResult(pending)); } catch (error) {
      if (error instanceof Error && error.message === REPLAY_MISMATCH) return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_TEAMMATE_IN_FLIGHT", operation_id: body.operation_id });
    }
    // The text matches, but files make it a different email: when this request names files, or the
    // unsettled one carried them, that send's result is NOT this one's (its files, or this request's,
    // never went with it). Nothing is sent; the owner is told a matching email is still settling.
    // Unreadable (a read error, or no answer): whether that send carried files cannot be told, so its result is
    // never handed back as this one's. Nothing is sent; asking again re-checks it.
    if (!attachmentPaths && pendingResult === null) return response(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_RECONCILIATION_UNVERIFIED" });
    let pendingCarriesFiles = false;
    if (!attachmentPaths) {
      try {
        const pendingMessage = typeof pendingResult?.message_id === "string" && UUID.test(pendingResult.message_id) ? pendingResult.message_id : null;
        const pendingBinding = pendingMessage ? object(await readBinding(pendingMessage)) : null;
        pendingCarriesFiles = pendingBinding !== null && pendingBinding.attachments !== undefined && pendingBinding.attachments !== null;
      } catch { return response(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_RECONCILIATION_UNVERIFIED" }); }
    }
    if (attachmentPaths || pendingCarriesFiles) {
      return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT", reconciled_operation_id: pending, operation_id: body.operation_id, delivery_confirmed: false });
    }
    const settled = await reconcile(pending);
    await settleSupportCase(settled);
    return response(statusOf(settled), { ...settled, reconciled_operation_id: pending });
  }

  // 3b — The same email to the same contact, approved for later under ANOTHER operation and still waiting,
  // is that email: another time, or "send it now", would send it twice. Refused (card and confirm alike)
  // until the owner cancels it. Read with the service role, scoped to the server-derived tenant.
  // No time bound: a row past its release grace but not yet swept can still be claimed by a release
  // leased at the very end of the grace (the replay above answers outcome_unknown for that same state).
  // On a prepared recovery this operation's own row is unresolved, so a refusal here is outcome_unknown.
  const notThisOne = preparedRecovery ? "outcome_unknown" : "refused";
  const { data: waiting, error: waitingError } = await admin.from("messages")
    .select("scheduled_operation_id:meta->comms_email_binding->>operation_id,scheduled_send_at:meta->comms_email_binding->>send_at")
    .eq("tenant_id", tenantId).eq("contact_id", command.contact_id).eq("status", "queued")
    .eq("meta->comms_email_binding->>state", "prepared").eq("meta->comms_email_binding->>content_digest", contentDigest)
    .neq("meta->comms_email_binding->>operation_id", body.operation_id).not("meta->comms_email_binding->>send_at", "is", null)
    .order("scheduled_for", { ascending: true }).limit(1).maybeSingle();
  if (waitingError) return response(503, { ok: false, outcome: notThisOne, code: "COMMS_EMAIL_RECONCILIATION_UNVERIFIED" });
  const scheduledAt = typeof waiting?.scheduled_send_at === "string" ? waiting.scheduled_send_at : null;
  if (scheduledAt && Date.parse(scheduledAt) + COMMS_EMAIL_SCHEDULED_RELEASE_GRACE_MS < Date.now()) {
    // Its time has passed and its release is not settled: it may still be going out. Never a resend prompt.
    return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_IDENTICAL_IN_FLIGHT", scheduled_operation_id: waiting!.scheduled_operation_id,
      operation_id: body.operation_id, delivery_confirmed: false });
  }
  if (scheduledAt) return response(409, { ok: false, outcome: notThisOne, code: "COMMS_EMAIL_ALREADY_SCHEDULED", send_at: scheduledAt, scheduled_operation_id: waiting!.scheduled_operation_id });

  // 4 — Readiness before any proposal: no card is raised for an email that cannot go out.
  const readiness = await readCommsEmailReadiness(admin as unknown as CommsEmailAdmin, { tenantId, actorUserId: user.id, contactId: command.contact_id, recipient: parties.recipient, connectorId: parties.connectorId, scheduled: body.send_at !== undefined }, key => Deno.env.get(key), runPreSend);
  if (!readiness.eligible || !parties.fromAddress) return response(422, { ok: false, outcome: readiness.eligible ? "needs_setup" : commsEmailReadinessOutcome(readiness), reason: readiness.eligible ? "TENANT_EMAIL_SENDER_MISSING" : readiness.reason });

  // 4b — The files, read only now that the email can go out. Only a sender whose email leaves through the
  // SendGrid arm carries files (Gmail and SMTP send no governed files). Each file is read with the service
  // role, checked (size, the bucket's live type list, its own signature and extension) and hashed: the
  // manifest is part of the approved call, so a card and its confirm must have read the same bytes.
  let attachmentManifest: CommsEmailAttachmentManifest | null = null;
  let attachmentFiles: CommsEmailAttachmentFile[] = [];
  let attachmentsDigest: string | null = null;
  if (attachmentPaths) {
    if (!COMMS_EMAIL_FILE_PROVIDERS.includes(String(readiness.sender_provider ?? ""))) return refusedBeforeDispatch(422, "COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED");
    // A prepared operation (its send never answered) already holds its approved files: the binding is the
    // record and the governed copies are the bytes. Recovery re-sends exactly those — read back and
    // re-hashed — whatever has happened to the composer uploads since (the composer deletes an upload the
    // person removes). The request must still name the same uploads, in the same order, as that approval.
    let boundManifest: CommsEmailAttachmentManifest | null = null;
    if (preparedRecovery) {
      let bound: Record<string, unknown> | null;
      try { bound = typeof replay?.message_id === "string" && UUID.test(replay.message_id) ? object(await readBinding(replay.message_id)) : null; }
      catch { return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_BINDING_UNAVAILABLE", operation_id: body.operation_id }); }
      if (bound && bound.attachments !== undefined && bound.attachments !== null) {
        boundManifest = parseCommsEmailAttachmentManifest(bound.attachments, tenantId, body.operation_id);
        if (!boundManifest || boundManifest.map(e => e.source_path).join("\n") !== attachmentPaths.join("\n")) return refusedBeforeDispatch(409, "COMMS_EMAIL_ATTACHMENTS_CHANGED");
      }
    }
    if (boundManifest) {
      let kept: Awaited<ReturnType<typeof readGovernedCommsEmailAttachmentFiles>>;
      try { kept = await readGovernedCommsEmailAttachmentFiles(admin.storage as unknown as CommsEmailStorage, boundManifest); }
      catch { return refusedBeforeDispatch(503, "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE"); }
      if (!kept.ok) return refusedBeforeDispatch(409, "COMMS_EMAIL_ATTACHMENT_CHANGED");
      attachmentManifest = boundManifest;
      attachmentFiles = kept.files;
    } else {
      let read: Awaited<ReturnType<typeof readCommsEmailAttachmentSources>>;
      try { read = await readCommsEmailAttachmentSources(admin.storage as unknown as CommsEmailStorage, { tenantId, operationId: body.operation_id, paths: attachmentPaths }); }
      catch { return refusedBeforeDispatch(503, "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE"); }
      if (!read.ok) return refusedBeforeDispatch(read.code === "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" ? 503 : 422, read.code);
      attachmentManifest = read.manifest;
      attachmentFiles = read.files;
    }
    attachmentsDigest = await commsEmailManifestDigest(attachmentManifest);
  }

  // 5 — The proposed call: the exact recipient address, sender address and content digest are part
  // of what is fingerprinted, so a change to any of them is a different approval.
  const requestArgs: Record<string, unknown> = { expected_tenant_id: tenantId, operation_id: body.operation_id, command: proposedCommand, recipient: parties.recipient, from_address: parties.fromAddress, content_digest: contentDigest };
  const draftBodyDigest = draftBodyHtml === undefined ? undefined : await sha256Hex(draftBodyHtml);
  if (body.draft_source) { requestArgs.draft_source = body.draft_source; requestArgs.draft_body_html = draftBodyHtml; requestArgs.draft_body_digest = draftBodyDigest; }
  const sameDraftProposal = (args: unknown): boolean => {
    const stored = object(args);
    if (!body.draft_source) return stored?.draft_source === undefined && stored?.draft_body_html === undefined && stored?.draft_body_digest === undefined;
    try { return commsEmailDraftSourcesEqual(parseCommsEmailDraftSource(stored?.draft_source), body.draft_source)
      && stored?.draft_body_html === draftBodyHtml && stored?.draft_body_digest === draftBodyDigest; } catch { return false; }
  };
  // The approval is part of what is fingerprinted: a card approved for one approval cannot be confirmed
  // against another. Absent when no approval is named, so every other send's fingerprint is unchanged.
  if (body.approval_id !== undefined) requestArgs.approval_id = body.approval_id;
  // "Approve now, send later": the send time is part of what is fingerprinted, so a card approved for
  // one time cannot be confirmed for another. Absent for an immediate send: every existing fingerprint,
  // summary and preview is unchanged.
  if (body.send_at !== undefined) requestArgs.send_at = body.send_at;
  // The files are part of what is fingerprinted (each one's governed path, size, type and sha256). Absent
  // without files: every existing fingerprint, summary and preview is unchanged.
  if (attachmentManifest) { requestArgs.attachments = attachmentManifest; requestArgs.attachments_digest = attachmentsDigest; }
  const summary = `Email ${parties.contactName} at ${parties.recipient} from ${parties.fromAddress}: "${command.subject}"`
    + (attachmentManifest ? commsEmailAttachmentSummary(attachmentManifest) : "")
    + (body.send_at !== undefined ? ` — scheduled for ${body.send_at.slice(0, 16).replace("T", " ")} UTC` : "");
  const preview = { kind: "email", to_name: parties.contactName, to_address: parties.recipient, from_address: parties.fromAddress, subject: command.subject, body_text: command.body,
    ...(body.draft_source && draftBodyHtml !== undefined ? { body_html: draftBodyHtml } : {}),
    ...(body.send_at !== undefined ? { send_at: body.send_at } : {}),
    ...(attachmentManifest ? { attachments: commsEmailAttachmentPreview(attachmentManifest) } : {}) };
  if (preparedRecovery || body.approved_fingerprint === undefined) {
    // Reuse a live server-issued proposal cycle for this operation, or mint a fresh one. A consumed
    // fingerprint never becomes authority again (same rule as the invoice door).
    const { data: pendingCycle, error: cycleError } = await admin.from("paige_pending_confirmations")
      .select("args").eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", COMMS_EMAIL_TOOL)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .gt("expires_at", new Date().toISOString()).contains("args", { operation_id: body.operation_id })
      .order("server_issued_at", { ascending: false }).limit(1).maybeSingle();
    if (cycleError) return response(503, { ok: false, outcome: preparedRecovery ? "outcome_unknown" : "refused", code: "APPROVAL_STORE_UNAVAILABLE" });
    const cycle = object(pendingCycle?.args);
    // A live cycle carries exactly the files this request read (none when none were named).
    const cycleAttachmentsMatch = (stored: unknown, digest: unknown) => stored === undefined ? attachmentManifest === null && digest === undefined
      : attachmentManifest !== null && digest === attachmentsDigest && commsEmailManifestsEqual(parseCommsEmailAttachmentManifest(stored, tenantId, body.operation_id), attachmentManifest);
    if (cycle) {
      let cycleCommand: ReturnType<typeof parseCommsEmailCommand>;
      try { cycleCommand = parseCommsEmailCommand(cycle.command); } catch { return response(409, { ok: false, outcome: "refused", code: "APPROVAL_CYCLE_INVALID" }); }
      if (cycle.expected_tenant_id !== tenantId || cycle.operation_id !== body.operation_id || JSON.stringify(cycleCommand) !== JSON.stringify(proposedCommand)
        || cycle.recipient !== parties.recipient || cycle.from_address !== parties.fromAddress || cycle.content_digest !== contentDigest
        || !storedApprovalMatches(cycle, body.approval_id)
        || !sameDraftProposal(cycle)
        || cycle.send_at !== body.send_at
        || !cycleAttachmentsMatch(cycle.attachments, cycle.attachments_digest)
        || typeof cycle.approval_cycle_nonce !== "string" || !UUID.test(cycle.approval_cycle_nonce))
        return response(409, { ok: false, outcome: "refused", code: "APPROVAL_CYCLE_INVALID" });
      requestArgs.approval_cycle_nonce = cycle.approval_cycle_nonce;
    } else requestArgs.approval_cycle_nonce = crypto.randomUUID();
  }

  // 6 — Lane, then the atomic single-use redemption of exactly one server-issued proposal.
  const { data: resolvedLane, error: laneError } = await caller.rpc("resolve_tool_autonomy", { _tenant_id: tenantId, _tool_key: COMMS_EMAIL_TOOL });
  const lane = !laneError && ["auto", "confirm", "off"].includes(resolvedLane) ? resolvedLane : "unresolved";
  const requestNonce = crypto.randomUUID();
  let claimedArgs: Record<string, unknown> | null | undefined;
  if (body.approved_fingerprint !== undefined) {
    claimedArgs = null;
    if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
    let redeem = admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() }).eq("user_id", user.id).eq("tenant_id", tenantId)
      .eq("tool_name", COMMS_EMAIL_TOOL).eq("fingerprint", body.approved_fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .neq("issued_in_request", requestNonce).gt("expires_at", new Date().toISOString());
    // With files, only a proposal holding exactly the files just read is redeemed — an exact match on the
    // manifest's digest (a short value, never the manifest itself in the request URL). A file changed since
    // the card was shown, or a confirm naming fewer or other files, has another digest: nothing is spent.
    if (attachmentsDigest) redeem = redeem.eq("args->>attachments_digest", attachmentsDigest);
    // Filter with the short server-derived digest, never private HTML in a query URL.
    // A changed source/content cannot consume the original approval cycle.
    if (body.draft_source) redeem = redeem.eq("args->draft_source->>message_id", body.draft_source.message_id)
      .eq("args->draft_source->>updated_at", body.draft_source.updated_at).eq("args->>draft_body_digest", draftBodyDigest);
    else redeem = redeem.is("args->draft_source", null);
    const { data: claimed, error } = await redeem.select("args").maybeSingle();
    if (!error) claimedArgs = object(claimed?.args);
  }

  // 7 — The canonical gate. availability: readiness was just re-resolved as ready above, so the
  // only thing left between this call and the act is a person's yes — `needs_approval`.
  const decision = decideDeclaredCapability(COMMS_EMAIL_SEND_CAPABILITY, {
    caller: { authenticated: true, userId: user.id, principal: "person", tenantId, tenantSource: "server", door: "other", access: { allowed: true, reason: "Active tenant owner or admin." } },
    capability: { id: COMMS_EMAIL_TOOL, effect: "mutate", outcomeChannel: "record_capability_run", availability: "needs_approval" },
    approval: { autonomyLane: lane, ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: COMMS_EMAIL_TOOL } : {}) }, requestArgs,
  });
  const auditedContact = object(object(decision.kind === "execute" ? decision.args : null)?.command)?.contact_id ?? command.contact_id;
  const { error: auditError } = await admin.from("paige_audit_log").insert({ actor_user_id: user.id, actor_role: `comms:${member?.role}`, tenant_id: tenantId, action: "comms.email_governed_decision", target_type: "contact", target_id: auditedContact,
    payload: { capability: COMMS_EMAIL_TOOL, decision: decision.kind, risk: decision.risk, lane_requested: decision.audit.laneRequested, lane_effective: decision.audit.laneEffective, clamped: decision.audit.clamped } });
  if (decision.kind === "refuse") return response(403, { ok: false, outcome: "refused", code: decision.code, message: decision.message, audit_recorded: !auditError });
  if (auditError) return response(503, { ok: false, outcome: "refused", code: "COMMS_EMAIL_DECISION_RECEIPT_FAILED" });

  // 8 — Propose: nothing is sent; the card shows exactly what would go out.
  if (decision.kind === "propose") {
    if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
    const fingerprint = await confirmFingerprint(COMMS_EMAIL_TOOL, requestArgs);
    const now = new Date().toISOString();
    const { error: expiredError } = await admin.from("paige_pending_confirmations").update({ consumed_at: now })
      .eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", COMMS_EMAIL_TOOL).eq("fingerprint", fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null).lte("expires_at", now);
    if (expiredError) return response(503, { ok: false, outcome: preparedRecovery ? "outcome_unknown" : "refused", code: "APPROVAL_STORE_UNAVAILABLE" });
    let { data: proposal, error: proposalError } = await admin.from("paige_pending_confirmations").insert({
      user_id: user.id, tenant_id: tenantId, thread_id: null, scoped_client_id: null, tool_name: COMMS_EMAIL_TOOL,
      fingerprint, issued_in_request: requestNonce, server_issued_at: now, args: requestArgs, summary,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select("summary,expires_at").maybeSingle();
    if (proposalError?.code === "23505") {
      const existing = await admin.from("paige_pending_confirmations").select("summary,expires_at")
        .eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", COMMS_EMAIL_TOOL).eq("fingerprint", fingerprint)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null).gt("expires_at", now).maybeSingle();
      proposal = existing.data; proposalError = existing.error;
    }
    if (proposalError || !proposal) return response(503, { ok: false, outcome: preparedRecovery ? "outcome_unknown" : "refused", code: "APPROVAL_STORE_UNAVAILABLE" });
    return response(202, { ok: false, outcome: "approval_required", capability: COMMS_EMAIL_TOOL, fingerprint, operation_id: body.operation_id, summary: proposal.summary, expires_at: proposal.expires_at,
    // The check's remaining life by the server's clock, so a browser with a wrong clock can still time it.
    expires_in_ms: Math.max(0, Date.parse(String(proposal.expires_at)) - Date.now()), preview });
  }

  // 9 — Execute the STORED call only. The request's own command was used to find this proposal;
  // it is not what runs.
  const stored = parseCommsEmailStoredCall(decision.args, tenantId);
  if (!stored) return response(403, { ok: false, outcome: "refused", code: "APPROVAL_CLAIM_INVALID" });
  if (!sameDraftProposal(decision.args)) return refusedBeforeDispatch(403, "COMMS_EMAIL_DRAFT_SOURCE_CHANGED");
  // A scheduled call whose time has (nearly) come is not quietly turned into "send now": nothing is
  // prepared, nothing is sent, and the owner picks a new time. (The database refuses < 30 s too.)
  if (stored.sendAt !== undefined && Date.parse(stored.sendAt) <= Date.now() + 60_000) return refusedBeforeDispatch(409, "COMMS_EMAIL_SEND_AT_PASSED");
  // The approved call carries the approval it was approved for; a confirm naming a different (or no)
  // approval is a swap. Then the approval is re-proved against the STORED call's contact.
  if (!storedApprovalMatches(decision.args, body.approval_id)) return refusedBeforeDispatch(403, "LEAD_REPLY_APPROVAL_MISMATCH");
  if (body.approval_id !== undefined) {
    const refusal = await verifyLeadReplyApproval(approvalAdmin, { tenantId, approvalId: body.approval_id, contactId: stored.command.contact_id, operationId: stored.operationId });
    if (refusal) return refusedBeforeDispatch(refusal === "LEAD_REPLY_APPROVAL_UNAVAILABLE" ? 503 : 409, refusal);
  }
  if (preparedRecovery && (stored.operationId !== body.operation_id || JSON.stringify(stored.command) !== JSON.stringify(proposedCommand)
    || typeof object(decision.args)?.approval_cycle_nonce !== "string")) return response(403, { ok: false, outcome: "refused", code: "APPROVAL_CYCLE_INVALID" });
  // The approved files must be exactly the ones this request read (a confirm without them, or with other
  // bytes, is not this approval): the bytes about to be kept are the bytes the person approved.
  if (!commsEmailManifestsEqual(stored.attachments, attachmentManifest)
    || (stored.attachments && object(decision.args)?.attachments_digest !== await commsEmailManifestDigest(stored.attachments))) return refusedBeforeDispatch(409, "COMMS_EMAIL_ATTACHMENTS_CHANGED");
  if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
  // Copy-on-approve: the bytes hashed above are kept at the operation's governed paths (never overwritten;
  // a replay must find the same bytes there). send-message sends only these copies, re-hashed at send time.
  if (stored.attachments) {
    let copied: Awaited<ReturnType<typeof copyCommsEmailAttachmentsToGoverned>>;
    try { copied = await copyCommsEmailAttachmentsToGoverned(admin.storage as unknown as CommsEmailStorage, attachmentFiles); }
    catch { return refusedBeforeDispatch(503, "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE"); }
    if (!copied.ok) return refusedBeforeDispatch(copied.code === "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" ? 503 : 409, copied.code);
    sendWaitMs = SEND_WAIT_WITH_FILES_MS;
  }
  const governance = { actor_user_id: user.id, tenant_id: tenantId, tool: COMMS_EMAIL_TOOL, action: COMMS_EMAIL_ACTION,
    approval_channel: decision.audit.laneEffective === "confirm" ? "operator_card" : "standing_autonomy_setting",
    approved_fingerprint: decision.audit.laneEffective === "confirm" ? body.approved_fingerprint : null,
    decision_receipt_recorded: true,
    // The reply approval this send answers (already proved equal to the STORED call's). prepare stores
    // it on the binding (comms_email_binding.approval_id): one live send per approval, and the only send
    // the approval can ever be recorded or approved by. Absent for every other send.
    ...(body.approval_id !== undefined ? { approval_id: body.approval_id } : {}) };
  // The adapter reports any database refusal it does not know as COMMS_EMAIL_PREPARE_REFUSED; keep the
  // specific one-send-per-approval refusal so the owner is told the reply is already sent / in flight.
  const approvalPrepareRefusal: { code: string | null } = { code: null };

  const result = await executeCommsEmailSend({ actorUserId: user.id, tenantId, operationId: stored.operationId, stored, governance }, {
    stillCurrent, readResult, send, readBinding,
    resolveParties: () => resolveCommsEmailParties(admin as unknown as CommsEmailAdmin, { tenantId, actorUserId: user.id, contactId: stored.command.contact_id, connectorId: stored.command.connector_id }, senderProviders),
    readiness: resolved => readCommsEmailReadiness(admin as unknown as CommsEmailAdmin, { tenantId, actorUserId: user.id, contactId: resolved.contactId, recipient: resolved.recipient, connectorId: resolved.connectorId, scheduled: stored.sendAt !== undefined }, key => Deno.env.get(key), runPreSend),
    prepare: async args => {
      const { data, error } = await admin.rpc("prepare_comms_email_send", args);
      approvalPrepareRefusal.code = error ? leadReplyPrepareRefusal(error) : null;
      return { data, error };
    },
  });
  const mapped = approvalPrepareRefusal.code && result.outcome === "refused" && result.reason === "COMMS_EMAIL_PREPARE_REFUSED"
    ? { ...result, reason: approvalPrepareRefusal.code } : result;
  const settled = await withApprovalRecord(await notAdmitted(mapped, stored.operationId), stored.operationId);
  await settleSupportCase(settled);
  return response(statusOf(settled), { ...settled, capability: COMMS_EMAIL_TOOL });
});
