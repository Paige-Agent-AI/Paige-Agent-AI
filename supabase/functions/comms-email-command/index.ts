import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { commsProviderExecutionAllowed, COMMS_PROVIDER_EXECUTION_DISABLED } from "../_shared/comms-provider-boundary.ts";
import { runPreSend } from "../_shared/pre-send-pipeline.ts";
import { confirmFingerprint } from "../_shared/confirm-fingerprint.ts";
import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";
import { COMMS_EMAIL_SEND_CAPABILITY } from "../_shared/paige-spine/domains/comms.ts";
import { COMMS_EMAIL_TOOL, COMMS_EMAIL_ACTION, FINGERPRINT, UUID, parseCommsEmailCommand, commsEmailBodyHtml, commsEmailContentDigest } from "../_shared/comms-email/contract.ts";
import { resolveCommsEmailParties, readCommsEmailReadiness, commsEmailReadinessOutcome, type CommsEmailAdmin } from "../_shared/comms-email/readiness.ts";
import { executeCommsEmailSend, reconcileCommsEmailSend, parseCommsEmailStoredCall, commsEmailSafeResult } from "../_shared/comms-email/adapter.ts";

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

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return refusedBeforeDispatch(405, "METHOD_NOT_ALLOWED");
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, serviceKey);
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return refusedBeforeDispatch(401, "UNAUTHENTICATED");
  let body: Record<string, unknown> & { expected_tenant_id: string; operation_id: string }, command: ReturnType<typeof parseCommsEmailCommand>;
  try {
    const raw = await req.text();
    if (raw.length > 100000) throw new TypeError("BODY_TOO_LARGE");
    const parsed = object(JSON.parse(raw));
    if (!parsed || Object.keys(parsed).some(key => !["expected_tenant_id", "operation_id", "command", "approved_fingerprint"].includes(key))) throw new TypeError("INVALID_BODY");
    if (typeof parsed.expected_tenant_id !== "string" || !UUID.test(parsed.expected_tenant_id) || typeof parsed.operation_id !== "string" || !UUID.test(parsed.operation_id)) throw new TypeError("INVALID_SCOPE");
    if (parsed.approved_fingerprint !== undefined && (typeof parsed.approved_fingerprint !== "string" || !FINGERPRINT.test(parsed.approved_fingerprint))) throw new TypeError("INVALID_FINGERPRINT");
    command = parseCommsEmailCommand(parsed.command);
    // The binding, the unique index and send-message all compare the operation id as lowercase
    // text; an uppercase id from a direct caller would otherwise never match its own binding.
    body = { ...parsed, expected_tenant_id: parsed.expected_tenant_id.toLowerCase(), operation_id: parsed.operation_id.toLowerCase() };
  } catch { return refusedBeforeDispatch(400, "COMMS_EMAIL_COMMAND_INVALID"); }

  const { data: tenantId, error: tenantError } = await caller.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string" || tenantId !== body.expected_tenant_id) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
  if (!await commsProviderExecutionAllowed(admin, { tenantId, actorUserId: user.id })) return refusedBeforeDispatch(403, COMMS_PROVIDER_EXECUTION_DISABLED);
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
  const send = async (payload: Record<string, unknown>) => {
    sendAnswered = false;
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 25000);
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

  // 2 — Replay first: a recorded outcome is returned before any current fact or approval is read.
  // An operation whose provider outcome is unknown is reconciled under its own id, never re-run.
  if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
  let replay: Record<string, unknown> | null;
  // A failed replay read proves nothing about this operation: it may already have been sent on an
  // earlier attempt. Never "Not sent" — unknown, and no send is attempted.
  try { replay = object(await readResult(body.operation_id)); } catch { return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_REPLAY_UNAVAILABLE" }); }
  const preparedRecovery = replay?.outcome === "prepared";
  if (replay && !preparedRecovery) {
    if (replay.outcome === "unknown" || replay.outcome === "dispatching") {
      const settled = await reconcile(body.operation_id);
      return response(statusOf(settled), { ...settled, replayed: true });
    }
    const recorded = commsEmailSafeResult(replay, { replayed: true });
    return response(statusOf(recorded), recorded);
  }

  // 3 — Who it goes to and who it comes from, resolved here and never taken from the model.
  let parties: Awaited<ReturnType<typeof resolveCommsEmailParties>>;
  try { parties = await resolveCommsEmailParties(admin as unknown as CommsEmailAdmin, { tenantId, contactId: command.contact_id, connectorId: command.connector_id }); }
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
    try { await readResult(pending); } catch (error) {
      if (error instanceof Error && error.message === REPLAY_MISMATCH) return response(503, { ok: false, outcome: "outcome_unknown", code: "COMMS_EMAIL_TEAMMATE_IN_FLIGHT", operation_id: body.operation_id });
    }
    const settled = await reconcile(pending);
    return response(statusOf(settled), { ...settled, reconciled_operation_id: pending });
  }

  // 4 — Readiness before any proposal: no card is raised for an email that cannot go out.
  const readiness = await readCommsEmailReadiness(admin as unknown as CommsEmailAdmin, { tenantId, contactId: command.contact_id, recipient: parties.recipient, connectorId: parties.connectorId }, key => Deno.env.get(key), runPreSend);
  if (!readiness.eligible || !parties.fromAddress) return response(422, { ok: false, outcome: readiness.eligible ? "needs_setup" : commsEmailReadinessOutcome(readiness), reason: readiness.eligible ? "TENANT_EMAIL_SENDER_MISSING" : readiness.reason });

  // 5 — The proposed call: the exact recipient address, sender address and content digest are part
  // of what is fingerprinted, so a change to any of them is a different approval.
  const requestArgs: Record<string, unknown> = { expected_tenant_id: tenantId, operation_id: body.operation_id, command: proposedCommand, recipient: parties.recipient, from_address: parties.fromAddress, content_digest: contentDigest };
  const summary = `Email ${parties.contactName} at ${parties.recipient} from ${parties.fromAddress}: "${command.subject}"`;
  const preview = { kind: "email", to_name: parties.contactName, to_address: parties.recipient, from_address: parties.fromAddress, subject: command.subject, body_text: command.body };
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
    if (cycle) {
      let cycleCommand: ReturnType<typeof parseCommsEmailCommand>;
      try { cycleCommand = parseCommsEmailCommand(cycle.command); } catch { return response(409, { ok: false, outcome: "refused", code: "APPROVAL_CYCLE_INVALID" }); }
      if (cycle.expected_tenant_id !== tenantId || cycle.operation_id !== body.operation_id || JSON.stringify(cycleCommand) !== JSON.stringify(proposedCommand)
        || cycle.recipient !== parties.recipient || cycle.from_address !== parties.fromAddress || cycle.content_digest !== contentDigest
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
    const { data: claimed, error } = await admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() }).eq("user_id", user.id).eq("tenant_id", tenantId)
      .eq("tool_name", COMMS_EMAIL_TOOL).eq("fingerprint", body.approved_fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .neq("issued_in_request", requestNonce).gt("expires_at", new Date().toISOString()).select("args").maybeSingle();
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
    return response(202, { ok: false, outcome: "approval_required", capability: COMMS_EMAIL_TOOL, fingerprint, operation_id: body.operation_id, summary: proposal.summary, expires_at: proposal.expires_at, preview });
  }

  // 9 — Execute the STORED call only. The request's own command was used to find this proposal;
  // it is not what runs.
  const stored = parseCommsEmailStoredCall(decision.args, tenantId);
  if (!stored) return response(403, { ok: false, outcome: "refused", code: "APPROVAL_CLAIM_INVALID" });
  if (preparedRecovery && (stored.operationId !== body.operation_id || JSON.stringify(stored.command) !== JSON.stringify(proposedCommand)
    || typeof object(decision.args)?.approval_cycle_nonce !== "string")) return response(403, { ok: false, outcome: "refused", code: "APPROVAL_CYCLE_INVALID" });
  if (!(await stillCurrent())) return refusedBeforeDispatch(409, "WORKSPACE_CHANGED");
  const governance = { actor_user_id: user.id, tenant_id: tenantId, tool: COMMS_EMAIL_TOOL, action: COMMS_EMAIL_ACTION,
    approval_channel: decision.audit.laneEffective === "confirm" ? "operator_card" : "standing_autonomy_setting",
    approved_fingerprint: decision.audit.laneEffective === "confirm" ? body.approved_fingerprint : null,
    decision_receipt_recorded: true };
  // #1140: a governed send that the provider accepted moves the thread's support
  // case (if any) to awaiting_customer and clears its pending follow-up — the
  // bounded no-chase rule. Best-effort and NEVER blocking: a failure here changes
  // nothing about the send's own result, which the readback below still owns.
  const settleSupportCase = async (settled: Record<string, unknown>) => {
    if (settled.ok !== true || typeof settled.message_id !== "string" || !UUID.test(settled.message_id)) return;
    try { await admin.rpc("mark_support_case_outbound", { _message_id: settled.message_id }); } catch { /* next inbound re-syncs the case */ }
  };

  const result = await executeCommsEmailSend({ actorUserId: user.id, tenantId, operationId: stored.operationId, stored, governance }, {
    stillCurrent, readResult, send, readBinding,
    resolveParties: () => resolveCommsEmailParties(admin as unknown as CommsEmailAdmin, { tenantId, contactId: stored.command.contact_id, connectorId: stored.command.connector_id }),
    readiness: resolved => readCommsEmailReadiness(admin as unknown as CommsEmailAdmin, { tenantId, contactId: resolved.contactId, recipient: resolved.recipient, connectorId: resolved.connectorId }, key => Deno.env.get(key), runPreSend),
    prepare: async args => { const { data, error } = await admin.rpc("prepare_comms_email_send", args); return { data, error }; },
  });
  const settled = await notAdmitted(result, stored.operationId);
  await settleSupportCase(settled);
  return response(statusOf(settled), { ...settled, capability: COMMS_EMAIL_TOOL });
});
