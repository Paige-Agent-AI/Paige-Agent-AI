import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { confirmFingerprint } from "../_shared/confirm-fingerprint.ts";
import { decideDeclaredCapability } from "../_shared/capability-kit/decision.ts";
import { SALES_COLLECTION_KIT_BY_ACTION } from "../_shared/paige-spine/domains/sales_collections.ts";
import { databaseAnswered } from "../_shared/approval-outcome.ts";
import { UUID, COLLECTION_ACTIONS, parseCollectionCommand } from "../_shared/sales-collections/contract.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "no-store" };
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// A domain adapter to the existing approval gate. It neither creates a new approval channel
// nor trusts request-authored actor, tenant, governance, financial facts or public-link secrets.
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return response(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user || user.is_anonymous === true) return response(401, { ok: false, code: "UNAUTHENTICATED" });
  let body: Record<string, unknown>, command: ReturnType<typeof parseCollectionCommand>;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 500000) throw new TypeError("BODY_TOO_LARGE");
    body = object(JSON.parse(raw))!;
    if (!body || Object.keys(body).some(key => !["expected_tenant_id", "operation_id", "command", "approved_fingerprint"].includes(key))) throw new TypeError("INVALID_BODY");
    if (typeof body.expected_tenant_id !== "string" || !UUID.test(body.expected_tenant_id) || typeof body.operation_id !== "string" || !UUID.test(body.operation_id)) throw new TypeError("INVALID_SCOPE");
    if (body.approved_fingerprint !== undefined && (typeof body.approved_fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(body.approved_fingerprint))) throw new TypeError("INVALID_FINGERPRINT");
    command = parseCollectionCommand(body.command);
  } catch { return response(400, { ok: false, code: "SALES_COLLECTION_COMMAND_INVALID" }); }

  const { data: tenantId, error: tenantError } = await caller.rpc("current_user_tenant_id");
  if (tenantError || typeof tenantId !== "string" || tenantId !== body.expected_tenant_id) return response(409, { ok: false, outcome: "refused", code: "WORKSPACE_CHANGED" });
  const stillCurrent = async () => {
    const { data, error } = await caller.rpc("current_user_tenant_id");
    return !error && data === tenantId;
  };
  const { data: member, error: memberError } = await admin.from("tenant_members").select("role,status").eq("tenant_id", tenantId).eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (memberError || !["owner", "admin"].includes(member?.role ?? "")) return response(403, { ok: false, outcome: "refused", code: "SALES_COLLECTION_FORBIDDEN" });
  const capability = COLLECTION_ACTIONS[command.action];
  const requestArgs: Record<string, unknown> = { command, operation_id: body.operation_id, expected_tenant_id: tenantId, approval_subject: `${command.action}:${"agreement_id" in command ? command.agreement_id : "batch_id" in command ? command.batch_id : "invoice_id" in command ? command.invoice_id : body.operation_id}` };
  const rpcArgs = { _actor_user_id: user.id, _expected_tenant_id: tenantId, _operation_id: body.operation_id, _command: command };
  // Replay comes before current balance/version eligibility and before approval redemption.
  // The business RPC fences actor/tenant and exact canonical request even for historical operations.
  if (!(await stillCurrent())) return response(409, { ok: false, code: "WORKSPACE_CHANGED" });
  const { data: replay, error: replayError } = await admin.rpc("read_sales_collection_command_result", rpcArgs);
  if (replayError) return response(409, { ok: false, outcome: "refused", code: "SALES_COLLECTION_REPLAY_UNAVAILABLE" });
  const preparedRecovery = false;
  if (object(replay)) return response(200, { ...object(replay)!, replayed: true, capability });

  const { data: previewData, error: previewError } = await admin.rpc("preview_sales_collection_command", { _actor_user_id: user.id, _expected_tenant_id: tenantId, _command: command });
  const preview = object(previewData);
  if (previewError || !preview || preview.eligible !== true) return response(422, { ok: false, outcome: "refused", code: "SALES_COLLECTION_INELIGIBLE", ...(preview ? { preview } : {}) });
  if (preparedRecovery || body.approved_fingerprint === undefined) {
    // Reuse a live server-issued proposal cycle. If an approval was consumed but
    // the process stopped before its business record, mint a fresh card for the
    // same operation; a consumed fingerprint must never become authority again.
    const { data: pendingCycle, error: cycleError } = await admin.from("paige_pending_confirmations")
      .select("args").eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", capability)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .gt("expires_at", new Date().toISOString()).contains("args", { operation_id: body.operation_id })
      .order("server_issued_at", { ascending: false }).limit(1).maybeSingle();
    if (cycleError) return response(503, { ok:false, outcome:preparedRecovery?"prepared":"refused", code:"APPROVAL_STORE_UNAVAILABLE" });
    const cycle = object(pendingCycle?.args);
    if (cycle) {
      let cycleCommand: ReturnType<typeof parseCollectionCommand>;
      try { cycleCommand = parseCollectionCommand(cycle.command); } catch { return response(409, { ok:false, outcome:preparedRecovery?"prepared":"refused", code:"APPROVAL_CYCLE_INVALID" }); }
      if (cycle.expected_tenant_id !== tenantId || cycle.operation_id !== body.operation_id
        || JSON.stringify(cycleCommand) !== JSON.stringify(command) || cycle.approval_subject !== requestArgs.approval_subject
        || typeof cycle.approval_cycle_nonce !== "string" || !UUID.test(cycle.approval_cycle_nonce))
        return response(409, { ok:false, outcome:preparedRecovery?"prepared":"refused", code:"APPROVAL_CYCLE_INVALID" });
      requestArgs.approval_cycle_nonce = cycle.approval_cycle_nonce;
    } else requestArgs.approval_cycle_nonce = crypto.randomUUID();
  }
  const { data: resolvedLane, error: laneError } = await caller.rpc("resolve_tool_autonomy", { _tenant_id: tenantId, _tool_key: capability });
  const lane = !laneError && ["auto", "confirm", "off"].includes(resolvedLane) ? resolvedLane : "unresolved";
  const requestNonce = crypto.randomUUID();
  let claimedArgs: Record<string, unknown> | null | undefined;
  if (body.approved_fingerprint !== undefined) {
    claimedArgs = null;
    if (!(await stillCurrent())) return response(409, { ok: false, code: "WORKSPACE_CHANGED" });
    const { data: claimed, error } = await admin.from("paige_pending_confirmations")
      .update({ consumed_at: new Date().toISOString() }).eq("user_id", user.id).eq("tenant_id", tenantId)
      .eq("tool_name", capability).eq("fingerprint", body.approved_fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .neq("issued_in_request", requestNonce).gt("expires_at", new Date().toISOString()).select("args").maybeSingle();
    if (!error) claimedArgs = object(claimed?.args);
  }
  const decision = decideDeclaredCapability(SALES_COLLECTION_KIT_BY_ACTION[capability], {
    caller: { authenticated: true, userId: user.id, principal: "person", tenantId, tenantSource: "server", door: "other", access: { allowed: true, reason: "Active tenant owner or admin." } },
    capability: { id: capability, effect: "mutate", outcomeChannel: "record_capability_run", availability: "needs_approval" },
    approval: { autonomyLane: lane, ...(claimedArgs !== undefined ? { claimedArgs, claimedFor: capability } : {}) }, requestArgs,
  });
  const auditedCommand: Record<string,unknown> = object(object(decision.kind === "execute" ? decision.args : null)?.command) ?? { ...command };
  const { error: auditError } = await admin.from("paige_audit_log").insert({ actor_user_id: user.id, actor_role: `sales:${member?.role}`, tenant_id: tenantId, action: "sales.collection_governed_decision", target_type: "collection", target_id: auditedCommand.agreement_id ?? auditedCommand.batch_id ?? auditedCommand.invoice_id ?? body.operation_id,
    payload: { capability, decision: decision.kind, risk: decision.risk, lane_requested: decision.audit.laneRequested, lane_effective: decision.audit.laneEffective, clamped: decision.audit.clamped } });
  if (decision.kind === "refuse") return response(403, { ok: false, outcome: "refused", code: decision.code, message: decision.message, audit_recorded: !auditError });
  if (auditError) return response(503, { ok: false, outcome: "refused", code: "SALES_DECISION_RECEIPT_FAILED" });
  if (decision.kind === "propose") {
    if (!(await stillCurrent())) return response(409, { ok: false, code: "WORKSPACE_CHANGED" });
    const fingerprint = await confirmFingerprint(capability, requestArgs);
    const now = new Date().toISOString();
    const { error: expiredError } = await admin.from("paige_pending_confirmations").update({ consumed_at: now })
      .eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", capability).eq("fingerprint", fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null).lte("expires_at", now);
    if (expiredError) return response(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE" });
    const summary = typeof preview.summary === "string" ? preview.summary : "Confirm the reviewed collection action.";
    let { data: proposal, error: proposalError } = await admin.from("paige_pending_confirmations").insert({
      user_id: user.id, tenant_id: tenantId, thread_id: null, scoped_client_id: null, tool_name: capability,
      fingerprint, issued_in_request: requestNonce, server_issued_at: now, args: requestArgs, summary,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select("summary,expires_at").maybeSingle();
    if (proposalError?.code === "23505") {
      const existing = await admin.from("paige_pending_confirmations").select("summary,expires_at")
        .eq("user_id", user.id).eq("tenant_id", tenantId).eq("tool_name", capability).eq("fingerprint", fingerprint)
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null).gt("expires_at", now).maybeSingle();
      proposal = existing.data; proposalError = existing.error;
    }
    if (proposalError || !proposal) return response(503, { ok: false, code: "APPROVAL_STORE_UNAVAILABLE" });
    return response(202, { ok: false, outcome: "approval_required", capability, fingerprint, operation_id: body.operation_id, summary: proposal.summary, expires_at: proposal.expires_at, preview });
  }
  let decided: ReturnType<typeof parseCollectionCommand>;
  const args = object(decision.args);
  try { decided = parseCollectionCommand(args?.command); } catch { return response(403, { ok: false, code: "APPROVAL_CLAIM_INVALID" }); }
  if (args?.expected_tenant_id !== tenantId || typeof args.operation_id !== "string" || !UUID.test(args.operation_id) || COLLECTION_ACTIONS[decided.action] !== capability) return response(403, { ok: false, code: "APPROVAL_CLAIM_INVALID" });
  if (preparedRecovery && (args.operation_id !== body.operation_id || JSON.stringify(decided) !== JSON.stringify(command) || typeof args.approval_cycle_nonce !== "string" || !UUID.test(args.approval_cycle_nonce))) return response(403, { ok:false, outcome:"prepared", code:"APPROVAL_CYCLE_INVALID" });
  if (!(await stillCurrent())) return response(409, { ok: false, code: "WORKSPACE_CHANGED" });
  const governance = { actor_user_id: user.id, tenant_id: tenantId, tool: capability, action: decided.action,
    approval_channel: decision.audit.laneEffective === "confirm" ? "operator_card" : "standing_autonomy_setting",
    approved_fingerprint: decision.audit.laneEffective === "confirm" ? body.approved_fingerprint : null,
    decision_receipt_recorded: true,
  };
  const { data: result, error: executeError } = await admin.rpc("execute_sales_collection_command", {
    _actor_user_id: user.id, _expected_tenant_id: tenantId, _operation_id: args.operation_id, _command: decided, _governance: governance,
  });
  if (executeError) return response(databaseAnswered(executeError) ? 422 : 503, { ok: false,
    outcome: databaseAnswered(executeError) ? "refused" : "outcome_unknown", code: "SALES_COLLECTION_COMMAND_FAILED",
    message: databaseAnswered(executeError) ? "The collection action could not complete. Reload its current state before trying again." : "The result is unknown. Recover this operation before starting another.", operation_id: args.operation_id });
  const resultObject = object(result);
  if (!resultObject || resultObject.ok !== true) return response(503, { ok: false, outcome: "outcome_unknown", code: "SALES_COLLECTION_READBACK_INVALID", operation_id: args.operation_id });
  return response(200, { ...resultObject, capability });
});
