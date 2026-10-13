// paige-action-worker — the §8 two-way ACTION-BUS DRAINER.
//
// The gap this closes (PLATFORM_ASSESSMENT D2, the single highest-leverage missing piece): paige_actions
// rows get filed with status='filed', but NOTHING drains them — so §8's core promise (Client team
// detects a need → files an action → Owner team DRAFTS it → routes to the coach's approval) only ever
// fired while a human was actively chatting. This worker makes it autonomous: on a */2 cron it claims
// filed actions whose kind has a drafting sub-agent, has that sub-agent draft the work through Paige's
// orchestrator (§14 — her TEAM does it, not her), and advances the action to 'drafted' — which
// advance_action then routes into paige_pending_approvals for the human's yes. Nothing is ever SENT
// here; the drainer only produces drafts and files them for approval.
//
// -- SECURITY (§9/§13) -------------------------------------------------------------------------------
// NOT user-facing. Authorized ONLY by (a) the exact service-role bearer, or (b) a valid Vault cron token
// (verify_cron_token) — the same gate every cron-style fn uses. Fails CLOSED. The tenant of every write
// is taken from the CLAIMED action row (claim_filed_actions returns it), NEVER from the request body.
// The claim is ATOMIC (FOR UPDATE ... SKIP LOCKED in claim_filed_actions) so two concurrent workers can
// never double-draft the same action.
//
// -- HONESTY (§13) -----------------------------------------------------------------------------------
// A claimed action moves filed→drafting (the claim). If the sub-agent draft succeeds, advance_action
// records the REAL draft it produced + the invocation_id that produced it, then routes to approval. If
// the invoke fails, fail_action marks the row 'blocked' with the real error so it SURFACES in the
// Actions queue instead of dying silently. A crashed run's 'drafting' rows self-heal (claim_filed_actions
// reopens a >10-min stale claim). One action failing never aborts the batch — each is independent.
// owner.lead_followup (a reply to a website-form lead) is the one kind whose draft is shaped: the
// visitor's answers reach the composer as untrusted data, the stored draft is the email contract
// {channel:'email', subject, body (plain text), body_html, raw} with no recipient in it, and a filing
// with no intent or a result with no usable subject + body is failed with the reason. Every other
// kind is drafted exactly as before. See draft.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { recordCapabilityRun } from "../_shared/capability-record.ts";
import { idempotencyKey } from "../_shared/durable-job/mod.ts";
import { type ClaimedAction, draftClaimedAction } from "./draft.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORCHESTRATOR_URL = `${SUPABASE_URL}/functions/v1/paige-orchestrator`;
// INVARIANT: BATCH_LIMIT × INVOKE_TIMEOUT_MS must stay well under claim_filed_actions' 10-min self-heal
// window. Rows are stamped assigned_at at claim time but drafted serially, so the last row in a batch
// sits 'drafting' for up to (BATCH_LIMIT × INVOKE_TIMEOUT) before it's reached. 5 × 55s ≈ 4.6 min < 10 min
// keeps a legitimately-in-flight row from being self-healed and re-claimed under a concurrent tick. (The
// advance_action approval insert is also idempotent now, so even a race can't double-draft — this just
// avoids the wasted re-invoke.) At */2 that's up to 150 drafts/hr, ample for the current volume.
const BATCH_LIMIT = 5;
const INVOKE_TIMEOUT_MS = 55_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
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

  // -- 1. Atomically claim a batch of draft-eligible filed actions (self-heals stale claims). --
  const { data: claim, error: claimErr } = await admin.rpc("claim_filed_actions", { p_limit: BATCH_LIMIT });
  if (claimErr) return json({ error: "claim_failed", detail: claimErr.message }, 500);
  const claimed: ClaimedAction[] = Array.isArray(claim?.claimed) ? claim.claimed : [];
  if (claimed.length === 0) return json({ ok: true, claimed: 0, drafted: 0, failed: 0 }, 200);

  const drafted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  // -- Receipt helpers (Receipt & Rail Contract adopter): terminal transitions record to the Rail
  //    with deterministic job-attempt correlation (`action-bus:<action_id>:draft` — a re-FILED need is
  //    a new action row, hence a new id; re-drafts of the same row replay the same correlation key).
  //    Actor: the tenant's active owner/admin (the business the draft serves) — resolved once per
  //    tenant and cached for the batch. VP attribution: the drafting specialist's parent VP from the
  //    C-suite registry, resolved once per batch. Both fail soft: a missing row records without them.
  const actorByTenant = new Map<string, string | null>();
  const resolveActor = async (tenantId: string): Promise<string | null> => {
    if (actorByTenant.has(tenantId)) return actorByTenant.get(tenantId)!;
    const { data: m } = await admin.from("tenant_members")
      .select("user_id").eq("tenant_id", tenantId).eq("status", "active")
      .in("role", ["owner", "admin"]).limit(1);
    const actor = m?.[0]?.user_id ?? null;
    actorByTenant.set(tenantId, actor);
    return actor;
  };
  const { data: vpRows } = await admin.from("paige_subagents")
    .select("slug, parent_subagent_slug, name");
  const vpParentBySlug = new Map<string, string>();
  for (const r of (vpRows ?? []) as Array<{ slug: string; parent_subagent_slug: string | null; name: string }>) {
    if (r.parent_subagent_slug) vpParentBySlug.set(r.slug, r.parent_subagent_slug);
  }
  const recordReceipt = async (
    a: ClaimedAction,
    outcome: "capability_succeeded" | "capability_failed",
    extra: Record<string, unknown> = {},
  ) => {
    const actor = await resolveActor(a.tenant_id);
    const specialist = a.draft_subagent_slug;
    const vp = vpParentBySlug.get(specialist) ?? null;
    await recordCapabilityRun(admin, {
      tenantId: a.tenant_id,
      actorId: actor,
      capabilityKey: "actions_draft",
      outcome,
      agentSlug: specialist,
      correlation: { jobAttemptId: idempotencyKey("action-bus", a.id, "draft") },
      detail: {
        substrate: "paige-action-worker",
        action_kind: a.action_kind,
        subagent: specialist,
        ...(vp ? { vp_desk: vp } : {}),
        ...extra,
      },
    });
  };

  // -- 2. Draft each claimed action through Paige's orchestrator, then advance it. Independent. --
  for (const a of claimed) {
    try {
      // Invoke the kind's drafting sub-agent through the orchestrator (§14 — her team drafts it).
      // tenant_id is passed TOP-LEVEL (the orchestrator's trusted service-role tenant source); context
      // carries the contact/conversation. The service-role bearer marks us a trusted internal caller.
      // draft.ts decides the rest; only owner.lead_followup is shaped (see draft.ts).
      const outcome = await draftClaimedAction({
        invoke: async (request) => {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), INVOKE_TIMEOUT_MS);
          let orchRes: Response;
          try {
            orchRes = await fetch(ORCHESTRATOR_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SERVICE_ROLE}`,
                "apikey": SERVICE_ROLE,
              },
              body: JSON.stringify(request),
              signal: ctl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          // Read after the timer is cleared, exactly as before: the timeout bounds the request.
          const body = await orchRes.json().catch(() => ({}));
          return { httpOk: orchRes.ok, status: orchRes.status, body };
        },
        rpc: async (fn, args) => {
          const { error } = await admin.rpc(fn, args);
          return { error: error ? { message: error.message } : null };
        },
      }, a);

      if (outcome.kind === "failed") {
        await recordReceipt(a, "capability_failed", { stage: outcome.stage });
        failed.push({ id: a.id, error: outcome.error });
        continue;
      }
      const invocationId = outcome.invocationId;
      await recordReceipt(a, "capability_succeeded", {
        invocation_id: invocationId,
        routed_to_approval: true,
      });
      drafted.push(a.id);
    } catch (e) {
      const msg = (e as Error)?.message ?? "worker error";
      try { await admin.rpc("fail_action", { p_action_id: a.id, p_error: msg }); } catch (_e) { /* self-heals */ }
      try { await recordReceipt(a, "capability_failed", { stage: "worker", error: msg.slice(0, 200) }); } catch (_e) { /* receipt must not resurrect a failed batch */ }
      failed.push({ id: a.id, error: msg });
    }
  }

  // -- PROACTIVE DELIVERY (runway ①, decision #19 layer 3): the COO reports without being asked.
  //    One daily-brief item per tenant whose drafts landed this run — the owner-facing brief line
  //    the action bus already surfaces (record_only/auto lane: an internal report to the CEO, not
  //    an external client send — no approval gate applies). The Rail receipts (with desk names)
  //    already stream live to the Paige sidebar; this is the same report as a durable brief item.
  //    Email push defers to the comms template lane (a 'paige-digest' template is registry work).
  const draftedByTenant = new Map<string, Array<{ desk: string | null; title: string }>>();
  for (const a of claimed) {
    if (!drafted.includes(a.id)) continue;
    const desk = vpParentBySlug.get(a.draft_subagent_slug) ?? null;
    const list = draftedByTenant.get(a.tenant_id) ?? [];
    list.push({ desk, title: a.title });
    draftedByTenant.set(a.tenant_id, list);
  }
  for (const [tenantId, items] of draftedByTenant) {
    try {
      await admin.rpc("file_action", {
        p_action_kind: "owner.daily_brief_item",
        p_title: items.length === 1
          ? `New draft waiting on you: ${items[0]!.desk ? items[0]!.desk + " — " : ""}${items[0]!.title}`
          : `${items.length} new drafts waiting on you`,
        p_summary: items.map((i) => `${i.desk ? i.desk + " — " : ""}${i.title}`).join("; ").slice(0, 500),
        p_payload: { source: "action-worker-digest", items: items.map((i) => ({ desk: i.desk, title: i.title })) },
        p_to_department: "owner_ops",
        p_priority: "low",
        p_created_by_agent: "paige-action-worker",
        p_tenant_id: tenantId,
      });
    } catch (e) {
      // The brief is an enhancement, never a failure of the drafting run itself.
      console.error("[paige-action-worker] digest brief failed", tenantId, (e as Error)?.message);
    }
  }

  return json({ ok: true, claimed: claimed.length, drafted: drafted.length, failed: failed.length, failures: failed }, 200);
});
