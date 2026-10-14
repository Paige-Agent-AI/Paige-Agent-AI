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
// OUTBOUND MESSAGES ARE NOT SENT FROM HERE (./action-email.ts): an approval that stands for a
// `send_via_approval` action — named by metadata.action_id OR pointed at by paige_actions.approval_id,
// the same two signals the database guard reads (client.followup, owner.lead_followup, any of them, in
// any draft shape) — is REFUSED with 409 send_requires_review — before the claim, with no write, no
// acknowledge and no send-message call. Those messages go out only through the governed email command
// (comms-email-command / comms.email_send); there is no second sender path. The row stays pending and
// can still be declined. reason_code tells the caller what the person can do: review_and_send (a reply
// to a new lead: the reply screen) or decline_only (every other send kind, for now).
//
// A QUIET-HOURS / DO-NOT-DISTURB HOLD IS ANSWERED HELD, NEVER QUEUED BEHIND THE APPROVAL (#2132): on the
// generic comms path below, the pre-send seam (runPreSend, the function send-message itself runs) is read
// first; a hold returns HELD with nothing queued or sent and the approval pending and unclaimed. A queued
// copy has a lifecycle the approval cannot follow (the drain never closes the approval; a decline never
// stops the message), so it is not created. If send-message queues anyway (the hours began in between),
// that copy is cancelled through the existing undo seam and the answer is the same HELD.
//
// ONE MESSAGE, ONE APPROVAL PATH (#2150): that cancel returns the row to an unsent draft, which
// Conversations shows with its own "Approve & send". The draft's id is recorded on the approval
// (metadata.held_draft_message_id, written only onto a row still pending, and checked). The next Approve
// sends THAT row (send-message's message_id path), so it can never become a second message; if the draft
// already went out from Conversations the approval settles on it and nothing is sent again, and if it was
// scheduled from Conversations nothing is sent and the person is told where it is.
//
// LAYER C (C5): an approval minted by the event→act engine (metadata.source='paige_orchestration') carries a
// held act's coordinates. This one door also delegates those to the Layer-C approval-executor — re-running the
// governed decision as an execute and driving the adapter → ledger — so there is still ONE approve door (§18),
// not a second. (Dormant until the engine mints those rows — the companion-minting is the next slice; this
// branch fires only for orchestration-sourced rows and changes nothing for existing approvals, §58.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { approvalRefusalMessage, executeApprovedLayerCAct, type ApproveExecutorDb } from "../_shared/paige-orchestration/approve-executor.ts";
import { CLIENT_CONTACT_METHODS_EMBED, clientAddresses } from "../_shared/contact-methods.ts";
import { runPreSend } from "../_shared/pre-send-pipeline.ts";
import {
  ALREADY_SENT_STATUSES, DECIDED_MID_SEND_HELD, DECIDED_MID_SEND_QUEUED, HELD_DRAFT_CHANGED, HELD_DRAFT_KEY, HELD_DRAFT_UNCONFIRMED,
  QUEUED_UNCANCELLABLE, SCHEDULED_FROM_CONVERSATIONS, SENT_FROM_CONVERSATIONS, classifySendResult, heldDraftChange, heldPayload,
  holdReasonOf, refuseSendKindApproval, type HeldDraftContent, type HoldReason, type SendKindAdmin,
} from "./action-email.ts";

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

  // An outbound message (a send_via_approval action) is never sent or completed from this door — refuse it
  // BEFORE the claim, so nothing is written at all: no claim, no reviewer stamp, no acknowledge, no send.
  // Runs before every branch below (campaign, series, Layer C, comms, acknowledge), for ALL send kinds.
  // Same structural bridge as the Layer-C executor below: the SDK's builders are thenables.
  const sendRefusal = await refuseSendKindApproval(admin as unknown as SendKindAdmin, { id: approvalId, tenant_id: approval.tenant_id, metadata: approval.metadata });
  if (sendRefusal) return json(sendRefusal.status, sendRefusal.payload);

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
    // #2150: held by a copy that is already scheduled and could not be called back. Answering "in progress"
    // with ok:true would let a second press show a success and drop the row while nothing was approved, so
    // the answer repeats what is true: it goes out when the hold ends, and it cannot be approved again.
    const sq = (typeof approval.metadata === "object" && approval.metadata) ? (approval.metadata as Record<string, unknown>).send_queued : null;
    if (sq && typeof sq === "object" && (sq as Record<string, unknown>).cancel_failed === true) {
      const q = sq as Record<string, unknown>;
      return json(200, { ok: false, executed: false, already: "in_progress", queued: true, outcome: "queued", message_id: q.message_id ?? null, scheduled_for: q.scheduled_for ?? null, error: QUEUED_UNCANCELLABLE, approval_id: approvalId });
    }
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

  // An email series' approval is the same kind of row and is decided the same way: email_sequence_approve
  // re-derives the version's hash, requires a person who owns or administers the business, and starts the
  // series. Its own DB guard refuses any other writer, so this must run before the acknowledge path.
  const sequenceVersionId = approval.type === "campaign_send"
    ? String(((approval as any).metadata ?? {}).email_sequence_version_id ?? "")
    : "";
  if (sequenceVersionId) {
    const { data: started, error: approveErr } = await userClient.rpc("email_sequence_approve", { p_version_id: sequenceVersionId });
    if (approveErr) {
      await releaseClaim();
      return json(200, { ok: false, executed: false, error: approveErr.message, approval_id: approvalId });
    }
    // Approved and running: the email worker's tick enrols people and sends each email when it is due.
    return json(200, { ok: true, executed: false, scheduled: true, series: started, approval_id: approvalId });
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
      return json(200, { ok: false, executed: false, act_outcome: res.outcome, reason: res.reason, error: approvalRefusalMessage(res.reason, res.outcome), approval_id: approvalId });
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

    // HELD (#2132): release the claim — checked, so a hold is never reported while the row stays held.
    const answerHeld = async (reason: HoldReason, retryAfter: string | null, extra: Record<string, unknown> = {}) => {
      const { error: releaseErr } = await releaseClaim();
      if (releaseErr) return json(500, { ok: false, executed: false, error: "claim_release_failed", detail: releaseErr.message, approval_id: approvalId });
      return json(200, heldPayload(reason, retryAfter, channel, approvalId, extra));
    };

    // The hours are read from the ONE pre-send seam before anything is sent or queued. Only a hold stops
    // here; a block (client DND, suppression, no consent) and a check error still go to send-message,
    // which records them exactly as before and refuses the send.
    // #2150: the draft an earlier hold returned to Conversations IS this message. Read it first: if it
    // already went out (or is scheduled) from Conversations, nothing is sent again — whatever the hours.
    const apprMeta: Record<string, unknown> = (typeof approval.metadata === "object" && approval.metadata) ? approval.metadata as Record<string, unknown> : {};
    const heldDraftId = typeof apprMeta[HELD_DRAFT_KEY] === "string" && apprMeta[HELD_DRAFT_KEY] ? String(apprMeta[HELD_DRAFT_KEY]) : null;
    type HeldMsg = HeldDraftContent & { id: string; tenant_id: string | null; status: string | null; scheduled_for: string | null; sent_at: string | null };
    // The content columns are read too: an edited draft must never be sent with this approval's text (#2150).
    const readHeldDraft = (id: string) => admin.from("messages")
      .select("id, tenant_id, status, scheduled_for, sent_at, channel_type, recipients, subject, body_html, body_text").eq("id", id).maybeSingle();
    /** Answers for a held draft that already left Conversations; null when the draft can still be sent. */
    const settleOnHeldDraft = async (msg: HeldMsg): Promise<Response | null> => {
      if (msg.status && ALREADY_SENT_STATUSES.has(msg.status)) {
        // It went out from Conversations: this approval was that message. Close the approval on it (only
        // a row still pending, checked) and send nothing.
        const now = new Date().toISOString();
        const { data: settled, error: settleErr } = await admin.from("paige_pending_approvals").update({
          status: "approved", reviewed_by_user_id: user.id, reviewed_at: now, sent_at: msg.sent_at ?? null,
          metadata: { ...apprMeta, held_draft_outcome: { state: "sent_from_conversations", message_id: msg.id, at: now } },
        }).eq("id", approvalId).eq("status", "pending").select("id");
        if (settleErr) {
          await releaseClaim();
          return json(500, { ok: false, executed: false, error: "held_draft_settle_failed", detail: settleErr.message, message_id: msg.id, approval_id: approvalId });
        }
        if (!settled || settled.length !== 1) {
          return json(200, { ok: false, executed: false, already: "sent", error: SENT_FROM_CONVERSATIONS, message_id: msg.id, approval_id: approvalId });
        }
        return json(200, { ok: true, executed: false, already: "sent", sent_from: "conversations", note: SENT_FROM_CONVERSATIONS, message_id: msg.id, channel, approval_id: approvalId });
      }
      if (msg.status === "queued") {
        // Scheduled from Conversations: it goes out then. Nothing is sent from here; the claim is released
        // so the person can decline this, and every later Approve gets this same answer.
        const { error: releaseErr } = await releaseClaim();
        if (releaseErr) return json(500, { ok: false, executed: false, error: "claim_release_failed", detail: releaseErr.message, approval_id: approvalId });
        return json(200, { ok: false, executed: false, queued: true, outcome: "scheduled_elsewhere", error: SCHEDULED_FROM_CONVERSATIONS, message_id: msg.id, scheduled_for: msg.scheduled_for ?? null, channel, approval_id: approvalId });
      }
      return null;
    };
    let reuseMessageId: string | null = null;
    if (heldDraftId) {
      const { data: heldMsg, error: heldErr } = await readHeldDraft(heldDraftId);
      if (heldErr) {
        await releaseClaim();
        return json(503, { ok: false, executed: false, error: "held_draft_read_failed", detail: heldErr.message, message_id: heldDraftId, approval_id: approvalId });
      }
      // A draft that is gone (or is not this business's) is not this message any more: send fresh.
      if (heldMsg && (heldMsg.tenant_id ?? null) === (approval.tenant_id ?? null)) {
        const settled = await settleOnHeldDraft(heldMsg as HeldMsg);
        if (settled) return settled;
        // Still unsent — but edited in Conversations? send-message would send THIS approval's text on that row
        // and mark it sent without rewriting it, so the client would get one message and the thread show
        // another. Nothing is sent and nothing is approved: the claim is released and the person is told where.
        const changed = heldDraftChange(heldMsg as HeldMsg, { channel, to, subject: dc.subject ? String(dc.subject) : null, body });
        if (changed) {
          const { error: releaseErr } = await releaseClaim();
          if (releaseErr) return json(500, { ok: false, executed: false, error: "claim_release_failed", detail: releaseErr.message, approval_id: approvalId });
          return json(200, { ok: false, executed: false, outcome: "changed_in_conversations", changed, error: HELD_DRAFT_CHANGED, message_id: (heldMsg as HeldMsg).id, channel, approval_id: approvalId });
        }
        reuseMessageId = (heldMsg as HeldMsg).id;
      }
    }

    const preSend = await runPreSend(admin as unknown as Parameters<typeof runPreSend>[0], {
      tenantId: approval.tenant_id ?? null, channel, to, contactId: approval.contact_id ?? null,
    });
    const preHold = preSend.proceed ? null : holdReasonOf(preSend.outcome);
    if (preHold) return await answerHeld(preHold, preSend.queueUntil);

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
        // #2150: send the SAME row the earlier hold returned to a draft, never a second one.
        message_id: reuseMessageId ?? undefined,
      }),
    });
    const sendResult = await resp.json().catch(() => ({}));
    if (reuseMessageId && resp.ok && (sendResult as Record<string, unknown>)?.deduped === true) {
      // send-message found the draft already sent or scheduled (from Conversations, in between) and sent
      // nothing. Its dedupe answer says status:'sent' for a scheduled row too, so the row is read back.
      const { data: nowMsg, error: nowErr } = await readHeldDraft(reuseMessageId);
      const settled = !nowErr && nowMsg ? await settleOnHeldDraft(nowMsg as HeldMsg) : null;
      if (settled) return settled;
      await releaseClaim();
      return json(200, { ok: false, executed: false, error: HELD_DRAFT_UNCONFIRMED, message_id: reuseMessageId, approval_id: approvalId });
    }
    const sendOutcome = classifySendResult(resp.ok, sendResult);
    if (sendOutcome.kind === "queued") {
      // send-message held it after the check above said clear (the hours began in between). A queued row
      // with no approval behind it is what #2132 removed, so cancel it through the existing undo seam
      // (cancel_scheduled_message, the caller's own JWT: it returns the row to an unsent draft) and answer
      // HELD. No message_id means send-message persisted no row: nothing is queued, so it is simply held.
      const reason = holdReasonOf(sendOutcome.outcome) ?? "other";
      if (!sendOutcome.messageId) return await answerHeld(reason, sendOutcome.scheduledFor);
      const { data: cancelled, error: cancelErr } = await userClient.rpc("cancel_scheduled_message", { _id: sendOutcome.messageId });
      if (!cancelErr && cancelled === true) {
        // It is an unsent draft in Conversations now. Name it on the approval and release the claim in ONE
        // write, onto a row still pending, and check exactly one row took it (#2150): the next Approve then
        // sends that same draft, so the draft and the approval stay one message.
        const { data: linked, error: linkErr } = await admin.from("paige_pending_approvals").update({
          claimed_at: null, metadata: { ...apprMeta, [HELD_DRAFT_KEY]: sendOutcome.messageId },
        }).eq("id", approvalId).eq("status", "pending").select("id");
        if (linkErr) {
          console.error(`[execute-approval] approval ${approvalId}: held draft ${sendOutcome.messageId} could not be recorded: ${linkErr.message}`);
          return json(500, { ok: false, executed: false, error: "held_draft_link_not_recorded", detail: linkErr.message, returned_to_draft_message_id: sendOutcome.messageId, approval_id: approvalId });
        }
        if (!linked || linked.length !== 1) {
          // Decided (declined) while send-message ran: nothing went out, and the copy is a plain draft.
          return json(200, { ok: false, executed: false, held: false, link_recorded: false, error: DECIDED_MID_SEND_HELD, returned_to_draft_message_id: sendOutcome.messageId, approval_id: approvalId });
        }
        return json(200, heldPayload(reason, sendOutcome.scheduledFor, channel, approvalId, { returned_to_draft_message_id: sendOutcome.messageId }));
      }
      // It could not be cancelled, so it WILL go out when the hold ends. The claim is KEPT: releasing it
      // would let a second Approve queue a second copy to the same person. The link is recorded and its
      // write is checked; if it fails, the answer is a 500 carrying the message id, never a success.
      // The write must land on exactly ONE row still pending (#2150 P2a): PostgREST reports no error when the
      // filter matches nothing, so the match is read back rather than assumed.
      const { data: linked, error: linkErr } = await admin.from("paige_pending_approvals").update({
        metadata: { ...apprMeta, send_queued: { outcome: sendOutcome.outcome, scheduled_for: sendOutcome.scheduledFor, message_id: sendOutcome.messageId, cancel_failed: true, at: new Date().toISOString() } },
      }).eq("id", approvalId).eq("status", "pending").select("id");
      if (linkErr) {
        console.error(`[execute-approval] approval ${approvalId}: queued message ${sendOutcome.messageId} could not be cancelled and the link could not be recorded: ${linkErr.message}`);
        return json(500, { ok: false, executed: false, error: "queued_link_not_recorded", detail: linkErr.message, message_id: sendOutcome.messageId, scheduled_for: sendOutcome.scheduledFor, approval_id: approvalId });
      }
      if (!linked || linked.length !== 1) {
        // Decided while send-message ran, and the copy it queued could not be cancelled: it WILL go out.
        // Say exactly that — never "recorded" — with the message id so it can be found.
        console.error(`[execute-approval] approval ${approvalId}: decided mid-send; queued message ${sendOutcome.messageId} could not be cancelled and is not linked`);
        return json(200, {
          ok: false, executed: false, queued: true, outcome: "queued", link_recorded: false, message_id: sendOutcome.messageId,
          scheduled_for: sendOutcome.scheduledFor, channel, error: DECIDED_MID_SEND_QUEUED, approval_id: approvalId,
        });
      }
      return json(202, {
        ok: false, executed: false, queued: true, outcome: "queued", link_recorded: true, message_id: sendOutcome.messageId, scheduled_for: sendOutcome.scheduledFor, channel,
        error: QUEUED_UNCANCELLABLE,
        approval_id: approvalId,
      });
    }
    if (sendOutcome.kind !== "sent") {
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
  if (ackErr) {
    // Nothing was acknowledged (e.g. the send guard refused a send action that slipped past the check
    // above). Release the claim so the row can still be declined or retried, never left held (§13).
    await releaseClaim();
    return json(500, { ok: false, executed: false, error: ackErr.message, approval_id: approvalId });
  }
  return json(200, { ok: true, executed: false, acknowledged: true, approval_id: approvalId });
});
