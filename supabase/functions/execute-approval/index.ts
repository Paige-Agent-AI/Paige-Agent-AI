// execute-approval — the callable "approve AND act" seam (doctrine §10).
//
// Until now, approving a pending action only flipped its status to 'approved';
// nothing executed the drafted move, so an approved email/SMS silently never
// went out. This function is the single seam BOTH the UI (ApprovalRow) and Paige
// (paige-mcp decide_pending_approval) call to actually run an approved action.
//
// It loads the approval, authorizes the caller (admin + tenant match), and
// dispatches by the drafted channel:
//   • email / SMS  → forwards to the existing `send-message` executor, which
//     sends and stamps the row approved+sent_at+audit_id (send drives status).
//   • anything else → there is no automated executor yet, so we ACKNOWLEDGE
//     (mark approved) exactly as the old button did — no regression — and report
//     executed:false so callers/Paige know no outbound action ran.
//
// It NEVER marks a comms row approved without a successful send.
//
// LAYER C (C5): an approval minted by the event→act engine (metadata.source='paige_orchestration') carries a
// held act's coordinates. This one door also delegates those to the Layer-C approval-executor — re-running the
// governed decision as an execute and driving the adapter → ledger — so there is still ONE approve door (§18),
// not a second. (Dormant until the engine mints those rows — the companion-minting is the next slice; this
// branch fires only for orchestration-sourced rows and changes nothing for existing approvals, §58.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeApprovedLayerCAct, type ApproveExecutorDb } from "../_shared/paige-orchestration/approve-executor.ts";
import { CLIENT_CONTACT_METHODS_EMBED, clientAddresses } from "../_shared/contact-methods.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Caller identity from the JWT (verify_jwt=true on this fn).
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return json(403, { error: "forbidden" });

  let payload: { approval_id?: string };
  try { payload = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const approvalId = payload?.approval_id;
  if (!approvalId) return json(400, { error: "missing_approval_id" });

  // Load the approval (service role — we authorize explicitly below).
  const { data: approval, error: loadErr } = await admin
    .from("paige_pending_approvals")
    .select("id, status, tenant_id, contact_id, conversation_id, category, type, draft_content, metadata")
    .eq("id", approvalId)
    .maybeSingle();
  if (loadErr) return json(500, { error: loadErr.message });
  if (!approval) return json(404, { error: "approval_not_found" });

  // Tenant isolation: unless the caller is the platform owner, the approval must
  // belong to a tenant the caller is a member of (defense-in-depth over the
  // global admin gate). Skip only when the row carries no tenant_id.
  const { data: isOwner } = await admin.rpc("is_platform_owner", { _user_id: user.id });
  if (approval.tenant_id && !isOwner) {
    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("tenant_id", approval.tenant_id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return json(403, { error: "cross_tenant_forbidden" });
  }

  // Idempotency: don't re-run a row that already went out.
  if (approval.status === "sent" || approval.status === "approved") {
    return json(200, { ok: true, executed: false, already: approval.status, approval_id: approvalId });
  }

  // Atomic claim: guard against a double-send from two concurrent Approve clicks
  // (two tabs, or the UI and Paige at once). Only the caller that flips
  // claimed_at from NULL while status is still 'pending' proceeds; the loser
  // treats it as already handled. There is no transient status admitted by the
  // CHECK, so claimed_at is the lock. Released below if a comms send fails, so a
  // genuine retry is still possible.
  const { data: claimed } = await admin
    .from("paige_pending_approvals")
    .update({ claimed_at: new Date().toISOString(), reviewed_by_user_id: user.id })
    .eq("id", approvalId)
    .eq("status", "pending")
    .is("claimed_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    return json(200, { ok: true, executed: false, already: "in_progress", approval_id: approvalId });
  }
  const releaseClaim = () => admin
    .from("paige_pending_approvals")
    .update({ claimed_at: null })
    .eq("id", approvalId);

  // A marketing email campaign's approval is decided by email_campaign_approve, never by flipping the row:
  // that RPC re-derives the frozen version's content hash, requires a person who owns or administers the
  // business, and schedules the dispatch. A DB guard refuses any other writer, so the generic acknowledge
  // path below would fail here rather than strand the campaign. Called with the caller's own JWT (§9).
  const campaignVersionId = approval.type === "campaign_send"
    ? String(((approval as any).metadata ?? {}).email_campaign_version_id ?? "")
    : "";
  if (campaignVersionId) {
    const { data: scheduled, error: approveErr } = await userClient.rpc("email_campaign_approve", { p_version_id: campaignVersionId });
    if (approveErr) {
      await releaseClaim();
      // 200 + ok:false like the other non-terminal outcomes here, so callers can show the reason
      // (approval_stale, not_permitted, version_not_found …) rather than a generic transport error.
      return json(200, { ok: false, executed: false, error: approveErr.message, approval_id: approvalId });
    }
    // Approved and scheduled: the email-campaign-worker sends it in bounded batches. Nothing has been sent yet.
    return json(200, { ok: true, executed: false, scheduled: true, campaign: scheduled, approval_id: approvalId });
  }

  // Layer C (C5): an orchestration-sourced approval carries the held act's coordinates. Delegate to the
  // Layer-C approval-executor (the row is already atomically claimed above — that is the single-use guard;
  // the executor's approve RPC is a second idempotency guard on the ledger row). NATIVE acts this slice.
  //
  // ORDERING (§37/§32, slice 2): this branch runs BEFORE the isComms heuristic below on purpose. The
  // orchestration branch keys off metadata.source === 'paige_orchestration' — an AUTHORITATIVE, exact signal
  // the engine set — whereas isComms is a substring heuristic over category/channel. A future native
  // capability whose dotted action-kind happens to contain 'sms'/'email' would otherwise be mis-routed into
  // the comms send path; checking the authoritative source first makes that impossible.
  const metaLc = (typeof (approval as any).metadata === "object" && (approval as any).metadata) || {};
  if (metaLc && (metaLc as any).source === "paige_orchestration" && (metaLc as any).event_id && (metaLc as any).act_id) {
    const res = await executeApprovedLayerCAct({
      // The supabase-js client is bridged to the executor's minimal structural db the same way the engine's
      // drainer bridges it (`admin as unknown as EngineDb`): the SDK's rpc returns a thenable builder, not a bare
      // Promise, so a direct assignment is a Deno-strict type error (§32) — the cast is the sanctioned seam.
      db: admin as unknown as ApproveExecutorDb, eventId: String((metaLc as any).event_id), actId: String((metaLc as any).act_id), approverUserId: user.id,
      // §9/§59: the caller was authorised above against THIS approval row's tenant; the executor refuses unless
      // the held act's ledger tenant is the SAME (a crafted approval in tenant A must not drive tenant B's act).
      expectedTenantId: approval.tenant_id ?? null,
    });
    // Consume the approval (stamp `approved`) ONLY for a TERMINAL, durably-recorded outcome — executed or
    // failed. EVERY non-terminal outcome consumes NOTHING here: release the claim so the held act stays
    // recoverable and report honestly (§13). This includes:
    //   • approval_pending (governed refusal / not-supported / tenant-auth stop) — nothing was redeemed;
    //   • `ambiguous` (§P4, Codex peer-gate) — the dispatch could NOT be confirmed; consuming it would burn the
    //     approval with the act stuck unreconciled. Left pending, a re-approval re-enters the executor, which
    //     RESUMES from the ambiguous ledger row and reconciles by correlation (never blind re-fires); the durable
    //     reconciler (paige_reconcile_orchestration_acts) also sweeps it so it never loops silently (slice 2);
    //   • `accepted_for_execution` (§P3) — a ledger-write blip left the row redeemed-but-unadvanced; a re-approval
    //     RESUMES and, after the §68 gate, reconciles/re-dispatches idempotently;
    //   • `unknown` (a transient ledger_read_error) / `absent` (act_execution_not_found) — nothing ran.
    // Stamping `approved` on any of these would burn the human's approval and the status='approved' idempotency
    // guard would then block the very retry that recovers it.
    const attempted = res.outcome === "executed" || res.outcome === "failed";
    if (!attempted) {
      await releaseClaim();
      return json(200, { ok: false, executed: false, act_outcome: res.outcome, reason: res.reason, approval_id: approvalId });
    }
    // A real attempt — the ledger records the outcome. Stamp the approval with it (metadata.act_outcome also
    // satisfies the DB direct-approve guard that blocks a bypass approve on an orchestration row, slice 2).
    const { error: lcErr } = await admin
      .from("paige_pending_approvals")
      .update({
        status: "approved",
        reviewed_by_user_id: user.id,
        reviewed_at: new Date().toISOString(),
        metadata: { ...(metaLc as Record<string, unknown>), executed: res.executed, act_outcome: res.outcome, execute_note: res.reason ?? null },
      })
      .eq("id", approvalId);
    if (lcErr) {
      // §5 slice 2: the ACT already ran (terminal in the ledger), but the approval-row STAMP failed → the row
      // is still pending+claimed and would be stuck unrecoverable. Release the claim so it is reclaimable; the
      // ledger is the source of truth and a re-approval will RESUME (see the row already terminal) and re-stamp.
      await releaseClaim();
      return json(500, { error: lcErr.message });
    }
    return json(200, { ok: res.ok, executed: res.executed, act_outcome: res.outcome, approval_id: approvalId });
  }

  const dc = (approval.draft_content ?? {}) as Record<string, unknown>;
  const category = String(approval.category ?? approval.type ?? "").toLowerCase();
  const channelRaw = String(dc.channel ?? "").toLowerCase();
  const isComms =
    channelRaw === "email" || channelRaw === "sms" ||
    category.includes("email") || category.includes("sms") || category === "followup";

  if (isComms) {
    const channel = channelRaw === "sms" || category.includes("sms") ? "sms" : "email";

    // Resolve the recipient: explicit draft address, else the contact's PRIMARY email (or phone).
    let to = String(dc.to ?? dc.recipient ?? "");
    if (!to && approval.contact_id) {
      const { data: contact } = await admin
        .from("clients")
        .select(CLIENT_CONTACT_METHODS_EMBED)
        .eq("id", approval.contact_id)
        .maybeSingle();
      const primary = clientAddresses(contact);
      to = channel === "sms" ? String(primary.phone ?? "") : String(primary.email ?? "");
    }
    if (!to) { await releaseClaim(); return json(422, { error: "no_recipient", detail: "draft has no `to` and the contact has no address" }); }

    const body = String(dc.body ?? dc.message ?? "");
    if (!body) { await releaseClaim(); return json(422, { error: "empty_body" }); }

    // Forward the caller's JWT so send-message authorizes the same user and
    // performs the send + status flip (status='approved' on success).
    const resp = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anonKey },
      body: JSON.stringify({
        channel,
        to,
        subject: dc.subject ? String(dc.subject) : undefined,
        body,
        contact_id: approval.contact_id ?? undefined,
        conversation_id: approval.conversation_id ?? undefined,
        approval_id: approvalId,
      }),
    });
    const sendResult = await resp.json().catch(() => ({}));
    if (!resp.ok || sendResult?.status !== "sent") {
      // send-message leaves the row 'pending' on failure — release the claim so a
      // genuine retry is possible, surface the error, never report success.
      await releaseClaim();
      return json(502, { ok: false, executed: false, error: sendResult?.error ?? "send_failed", detail: sendResult });
    }
    return json(200, { ok: true, executed: true, channel, approval_id: approvalId, audit_id: sendResult.audit_id });
  }

  // No automated executor for this category yet — acknowledge (mark approved)
  // exactly as the prior button did, and record that no outbound action ran.
  // metadata is now selected above, so the spread preserves existing keys.
  const meta = (typeof (approval as any).metadata === "object" && (approval as any).metadata) || {};
  const { error: ackErr } = await admin
    .from("paige_pending_approvals")
    .update({
      status: "approved",
      reviewed_by_user_id: user.id,
      reviewed_at: new Date().toISOString(),
      metadata: { ...meta, executed: false, execute_note: "acknowledged — no automated executor for this category yet" },
    })
    .eq("id", approvalId);
  if (ackErr) return json(500, { error: ackErr.message });
  return json(200, { ok: true, executed: false, acknowledged: true, approval_id: approvalId });
});
