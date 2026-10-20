// paige-native-event-dispatch — the native-event DRAINER (Main Paige Operational Chat · P3 / MPC-4).
//
// A producer (the AFTER-INSERT trigger on public.clients, or the recovery sweeper) POSTs
// {event_id, tenant_id} here; this function delivers that event to its approved subscribers —
// the paige_automations rows whose trigger_key matches the event's event_key and whose state is
// 'live' — exactly once each, and records the true delivery outcome in the fire-once ledger.
//
// The spine it drives lives in migration 20270119000000_contact_created_native_event.sql:
//   * paige_claim_event / _complete_ / _fail_   - atomic claim + terminal lifecycle (service-only)
//   * paige_automations                         - the subscribers (§67 Process Records) by trigger_key
//   * paige_event_dispatches                    - the fire-once ledger, UNIQUE(event_id, automation_id)
//
// -- SCOPE (honest, §13) — Layer C · C2 (one bounded native auto-execute vertical) --------------
// This delivers the EVENT to its subscribers AND runs the governed act-execution engine
// (_shared/paige-orchestration). Before any of that it runs an INDEPENDENT event-integrity check
// (owner correction #2): the tenant is re-derived from the canonical SUBJECT record and asserted to
// equal the claimed event tenant — a mismatch/unknown subject fails CLOSED (truthful failure recorded,
// NO subscriber load, NO authority/adapter/provider decision). Per subscriber it then evaluates
// conditions, resolves the effective autonomy lane (grant ∧ most-restrictive act floor ∧ Trust-Compass
// ceiling ∧ §68 decay), and runs the ONE governed pathway (decideGovernedExecution) per act, recording
// the EXACT per-act outcome in paige_act_executions through the ATOMIC, MONOTONIC transition RPC
// (paige_record_act_execution) — a final outcome is never overwritten, and every durable write is
// CHECKED (a failed write fails the dispatch for retry, correction #3). C2 adds the NATIVE synchronous
// execute path: a governed-authorized act whose action_kind is `crm.advance_journey_stage` (the dotted
// action-bus slug; `crm_advance_journey_stage` is its tool/capability key) is dispatched to the in-tenant
// set_journey_stage RPC AFTER its durable accepted_for_execution record persists, OUR write is CONFIRMED
// by a transition stamped with the act's correlation ref (§32, never a bare current-slug match), and the
// ledger advances to `executed` (or `ambiguous` → correlation reconcile, never blind retry). An EXTERNAL-EFFECT adapter (n8n) still stops at accepted_for_execution / approval_pending
// — its dispatch + signed readback is C3+. THREE distinct levels are preserved (correction #6):
// event-level `no_subscriber`, subscriber-level paige_event_dispatches delivery, per-act
// paige_act_executions outcome. `acts_executed` is legacy per-subscriber metadata only (now true for a
// confirmed native `executed`) — never owner-visible proof by itself; the per-act ledger is.
//
// -- SECURITY (§9/§13) ------------------------------------------------------------------------
// NOT user-facing. Authorized ONLY by (a) the service-role bearer, or (b) a valid Vault cron token
// (verify_cron_token) — the same gate the cron-style functions use. Fails CLOSED. The tenant is
// taken from the CLAIMED event row, never trusted from the body (body.tenant_id is log-only).
// Subscribers are read scoped to that authoritative tenant.
//
// -- HONESTY (§13) ----------------------------------------------------------------------------
// Each subscriber's TRUE delivery outcome is written to the ledger (done|error). One failing never
// drops the rest — the loop runs them all, then the event is completed if all succeeded or failed
// (with the real error) so the sweeper can retry only the failures (the done rows are skipped via
// the ledger read). non-2xx is returned ONLY on a top-level failure (bad auth, missing id, claim
// error, unknown event); otherwise 200 with the per-subscriber results — never a 200 hiding a
// top-level error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { runEventActs, type AutomationRow, type ClaimedEvent, type EngineDb } from "../_shared/paige-orchestration/engine.ts";
import { verifySubjectTenant, type SubjectDb } from "../_shared/paige-orchestration/subject-tenant.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : (typeof v === "number" ? String(v) : null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Auth: service-role bearer OR a valid Vault cron token. Fail CLOSED (§13). --
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let authorized = bearer.length > 0 && bearer === SERVICE_ROLE;
  if (!authorized) {
    const cronToken = req.headers.get("x-cron-token") ?? "";
    if (cronToken) {
      const { data: cronOk } = await admin.rpc("verify_cron_token", { _token: cronToken });
      authorized = cronOk === true;
    }
  }
  if (!authorized) return json({ error: "unauthorized" }, 401);

  // -- Body --
  let body: { event_id?: string; tenant_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const eventId = s(body?.event_id);
  if (!eventId || !UUID_RE.test(eventId)) {
    return json({ error: "event_id required (uuid)" }, 400);
  }

  // -- 1. Atomic claim. Loser exits cleanly (idempotent). --
  const { data: claim, error: claimErr } = await admin.rpc("paige_claim_event", { p_event_id: eventId });
  if (claimErr) {
    return json({ error: "claim_failed", detail: claimErr.message }, 500);
  }
  if (!claim?.claimed) {
    // Already claimed by a concurrent worker, or already terminal. Nothing to do.
    return json({ event_id: eventId, claimed: false, delivered: [], failed: [] }, 200);
  }
  const tenantId: string = claim.tenant_id;   // authoritative — from the claimed row, never the body (§9)
  const eventKey: string = claim.event_key;

  // From here on, a thrown/failed path must mark the event failed so the sweeper can retry.
  const failEvent = async (msg: string) => {
    try { await admin.rpc("paige_fail_event", { p_event_id: eventId, p_error: msg.slice(0, 1000) }); }
    catch (_e) { /* best-effort; the claim goes stale and is re-picked */ }
  };

  try {
    // -- 1.5 INDEPENDENT event-integrity check (§9, owner correction #2). The tenant the acts will run
    //    under must be the tenant that actually OWNS the event's subject — not merely the tenant the event
    //    row claims. Re-derive it from the canonical subject record and assert equality. On ANY mismatch,
    //    missing subject, or unrecognised subject table we FAIL CLOSED: record the truthful failure and
    //    make NO authority/adapter/provider decision (no subscriber load, no engine, no dispatch). --
    const integrity = await verifySubjectTenant(
      admin as unknown as SubjectDb, claim.subject_table, claim.subject_id, tenantId,
    );
    if (!integrity.ok) {
      await failEvent(`event_integrity:${integrity.code}: ${integrity.reason}`);
      return json({
        event_id: eventId,
        event_key: eventKey,
        claimed: true,
        event_integrity: { ok: false, code: integrity.code, reason: integrity.reason },
        subscriber_count: 0,
        delivered: [],
        failed: [],
        terminal: "integrity_failed",
      }, 200);
    }

    // -- 2. Load this event's approved, live subscribers for THIS tenant (§67 Process Records). --
    const { data: subs, error: subErr } = await admin
      .from("paige_automations")
      .select("id, name, granted_lane, conditions, created_by, state")
      .eq("tenant_id", tenantId)
      .eq("trigger_key", eventKey)
      .eq("state", "live");
    if (subErr) {
      await failEvent(`subscriber_load_failed: ${subErr.message}`);
      return json({ error: "subscriber_load_failed", detail: subErr.message }, 500);
    }
    // -- 2.5 A recovery re-open (Slice 2b) is pinned to what it was re-opened for. The reconciler sets
    //    recovery_scope when it re-opens a finished event to re-drive a stranded act; that drain then delivers ONLY
    //    to those automations and governs ONLY acts that existed when the event happened — never an old event to a
    //    process granted since, never an act added since. NULL scope = a normal event (all live subscribers). --
    const { data: evRow, error: evErr } = await admin
      .from("paige_native_events")
      .select("recovery_scope, created_at")
      .eq("id", eventId)
      .maybeSingle();
    // 42703 = the column does not exist yet (this function deployed before its migration applied). Then no event
    // can have been re-opened by recovery, so the drain is a normal one. Any other read failure retries.
    const scopeColumnMissing = (evErr as { code?: string } | null)?.code === "42703";
    if (!scopeColumnMissing && (evErr || !evRow)) {
      const msg = evErr?.message ?? "event row not readable";
      await failEvent(`event_scope_read_failed: ${msg}`);
      return json({ error: "event_scope_read_failed", detail: msg }, 500);
    }
    const recoveryScope: string[] | null =
      !scopeColumnMissing && Array.isArray(evRow?.recovery_scope) ? evRow.recovery_scope : null;
    const subscribers = (subs ?? []).filter((s: any) => recoveryScope === null || recoveryScope.includes(s.id));

    // -- 3. Skip subscribers already delivered (fire-once across retries). --
    const { data: priorRows } = await admin
      .from("paige_event_dispatches")
      .select("automation_id, status")
      .eq("event_id", eventId);
    const alreadyDone = new Set(
      (priorRows ?? []).filter((r: any) => r.status === "done").map((r: any) => r.automation_id as string),
    );

    const delivered: string[] = [];
    const failed: string[] = [];

    // -- 4. Run the governed act-execution engine (Layer C). For each subscriber it evaluates the
    //    process's conditions (this CLOSES the former TODO F3 — a subscriber whose conditions exclude
    //    the event no longer even reaches an act), resolves the effective autonomy lane (grant ∧
    //    most-restrictive act floor ∧ Trust-Compass ceiling ∧ §68 decay), and runs the ONE governed
    //    pathway per act — recording the EXACT per-act outcome (condition_not_matched / held_by_lane /
    //    approval_pending / refused_* / accepted_for_execution / executed / failed / ambiguous) in
    //    paige_act_executions, fire-once. C2: a native, synchronous execute (action_kind
    //    `crm.advance_journey_stage`) dispatches + confirms in-engine and advances to `executed`; an external-effect adapter (n8n)
    //    still stops at accepted_for_execution, and a high external-effect act on an `auto` process
    //    correctly HOLDS for approval — the lane alone never authorizes a high act (§67 / RE-2 grant lift). --
    const engine = await runEventActs(
      admin as unknown as EngineDb,
      {
        event_id: eventId, tenant_id: tenantId, event_key: eventKey,
        subject_table: claim.subject_table, subject_id: claim.subject_id, payload: claim.payload ?? {},
      } as ClaimedEvent,
      (subscribers as any[]).map((s): AutomationRow => ({
        id: s.id, name: s.name, granted_lane: s.granted_lane,
        conditions: s.conditions, created_by: s.created_by ?? null, state: s.state,
      })),
      recoveryScope === null ? {} : { actsCreatedAtOrBefore: String(evRow?.created_at) },
    );

    // -- 5. Record DELIVERY per subscriber (paige_event_dispatches), now carrying the EXACT per-act
    //    outcomes from the engine. FAIL CLOSED (§13 / owner correction #3): if ANY of a subscriber's
    //    per-act ledger writes failed, its delivery is recorded 'error' (retry) — never a 'done'
    //    delivery whose per-act outcome was not durably recorded. `acts_executed` is legacy per-subscriber
    //    metadata (true only on a real `executed` outcome, never in C1) — never proof by itself. --
    const persistFailed = new Set(engine.persist_failures);
    const infraRetry = new Set(engine.subscriber_retry);
    // A subscriber whose NATIVE act settled NON-terminal (accepted_for_execution / retrying / ambiguous)
    // is not durably done — its correlation reconcile must run on a later drain (§39 F1). Keeping the
    // event reclaimable (NOT `done`) is the reconcile TRIGGER: the sweeper re-drives (bounded by its
    // attempts cap → a genuinely stuck row lands in `error`, never a silent `done`), and phase 5 reconciles
    // BY CORRELATION (an `ambiguous` row is re-read, never blind re-dispatched). Reuses the existing event
    // lifecycle + sweeper — no second cron (§18).
    const reconcilePending = new Set(engine.reconcile_pending);
    for (const sub of subscribers) {
      if (alreadyDone.has(sub.id)) { delivered.push(sub.id); continue; }
      const actRecs = engine.records.filter((r) => r.automation_id === sub.id);
      const acts = actRecs.map((r) => ({
        act_id: r.act_id, position: r.act_position, adapter: r.adapter_kind, outcome: r.outcome,
      }));
      // NOT durably delivered when: an infra read/resolve failed (no records governed at all), OR any of
      // this subscriber's per-act ledger writes failed, OR a native act settled non-terminal and still owes
      // a correlation reconcile. Any of these → status 'error' → the event fails → the sweeper retries
      // (never a silent 'done' whose acts were not governed/recorded or whose advance was never confirmed,
      // §13/§32 F2, §39 F1).
      const anyPersistFailed = actRecs.some((r) => persistFailed.has(r.act_id));
      const awaitingReconcile = reconcilePending.has(sub.id);
      const needsRetry = infraRetry.has(sub.id) || anyPersistFailed || awaitingReconcile;
      const anyExecuted = actRecs.some((r) => r.outcome === "executed");
      const retryReason = infraRetry.has(sub.id)
        ? "engine_infra_error"
        : anyPersistFailed
          ? "act_ledger_write_failed"
          : "native_act_awaiting_reconcile";
      const { error: upErr } = await admin
        .from("paige_event_dispatches")
        .upsert(
          {
            event_id: eventId,
            automation_id: sub.id,
            tenant_id: tenantId,
            status: needsRetry ? "error" : "done",
            result: {
              delivered: !needsRetry,
              acts_governed: actRecs.length,
              acts_executed: needsRetry ? false : anyExecuted,
              acts,
            },
            error: needsRetry ? retryReason : null,
          },
          { onConflict: "event_id,automation_id" },
        );
      if (upErr || needsRetry) { failed.push(sub.id); }
      else { delivered.push(sub.id); }
    }

    // -- 5. Terminal lifecycle: complete when nothing failed (incl. zero subscribers — it fired,
    //    nobody is listening yet, which is a legitimate 'done'), else fail so the sweeper retries. --
    let terminal: string;
    if (failed.length === 0) {
      // §13/§39 F2: do NOT report "done" if the terminal write itself failed — the event is still
      // 'claimed' and the sweeper will re-claim + re-deliver idempotently. Report the real state.
      const { error: compErr } = await admin.rpc("paige_complete_event", { p_event_id: eventId });
      terminal = compErr ? "complete_error" : "done";
    } else {
      await failEvent(`dispatch_failed for ${failed.length} subscriber(s)`);
      terminal = "retry_pending";
    }

    return json({
      event_id: eventId,
      event_key: eventKey,
      claimed: true,
      event_integrity: { ok: true },
      // event-level distinction (owner correction #6): the event FIRED with zero live subscribers — a
      // legitimate 'done', distinct from a subscriber-level delivery result or a per-act outcome.
      no_subscriber: subscribers.length === 0,
      subscriber_count: subscribers.length,
      delivered,
      failed,
      act_outcomes: engine.by_outcome,
      terminal,
    }, 200);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    await failEvent(msg);
    return json({ error: "dispatch_error", detail: msg.slice(0, 1000) }, 500);
  }
});
