// growth-process-submission - the on-submit AUTOMATION EXECUTOR (Growth OS / Vibe Studio, Phase 4).
//
// This is the missing seam that turns a captured form/funnel submission into real CRM + Paige
// activity. A per-submission trigger (or the recovery sweeper) POSTs {submission_id, tenant_id}
// here; this function runs that submission's configured automations, in order, exactly once each.
//
// The spine it drives lives in migration 20260714092000_growth_submission_processor.sql:
//   * growth_claim_submission / _complete_ / _fail_  - atomic claim + terminal lifecycle (service-only)
//   * growth_form_automations                        - the per-form ordered automation config (rows)
//   * growth_automation_targets                      - the platform catalog: slug -> executor + config
//   * growth_submission_dispatches                   - the fire-once ledger, UNIQUE(submission,automation)
// Legacy forms with no automation rows fall back to their growth_forms columns (auto_create_contact /
// pipeline_id / workflow_slug / notify_user_ids) exactly as the migration's backfill intends.
// A form's own INTAKE settings (growth_form_set_intake) land where this plan already reads them:
// pipeline routing in the columns or in the ledgered automation rows, and the alert address as an
// email_alert step added to every form that has one — see applyIntakeSettings.
//
// -- EXECUTOR MAP (growth_automation_targets.executor -> what runs) ----------------------------
//   contact_upsert     -> resolve_contact_id, else create_contact; writes submission.contact_id
//   pipeline_attach    -> create/advance a tenant-owned deal on the form's pipeline/stage
//   paige_action       -> file_action(<kind>) onto the action bus (owner draft/approve lane)
//   surface_to_client  -> file_action(<kind>) (client-facing surface kind), same seam
//   client_rail_event  -> record_rail_event onto the client's activity timeline
//   notify_team        -> invoke notify-team-event (event=form_submission)
//   email_alert        -> email the form's notify_email (the address the owning workspace set) via
//                         send-transactional-email; the provider's answer decides done|error
//   n8n_workflow       -> file_action(owner.run_workflow, {workflow_key}) then advance_action -> run
//   outbound_webhook   -> SSRF-guarded POST of the submission to a connected endpoint
//
// -- SECURITY (S9/S13) ------------------------------------------------------------------------
// NOT user-facing. Authorized ONLY by (a) the service-role bearer, or (b) a valid Vault cron token
// (verify_cron_token) - the same gate the cron-style functions use. Fails CLOSED. The tenant is
// taken from the CLAIMED submission row, never trusted from the request body (body.tenant_id is
// only used to disambiguate/log). Every downstream RPC re-checks tenant scope in-DB.
//
// -- HONESTY (S13) ----------------------------------------------------------------------------
// Each executor's TRUE outcome is written to the dispatch ledger (done|error). One executor failing
// never drops the rest - the loop runs them all, then the submission is completed if all succeeded
// or failed (with the real error) if any did, so the sweeper can retry. non-2xx is returned ONLY on
// a top-level failure (bad auth, missing id, claim error, unknown submission/form); otherwise 200
// with the per-executor results - never a 200 hiding a top-level error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isEmailAddress } from "../_shared/growth-intake.ts";
// NOTE: the outbound_webhook executor (which uses the shared SSRF guard) is DEFERRED for the first
// live ship (see its case below); its only shared import is the pure address check above.
// The fast-follow that re-enables outbound_webhook re-adds: import { assertPublicHttpUrl } from
// "../_shared/ssrfGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Owner alert caps (email_alert): per form per hour, per business per day.
const ALERTS_PER_FORM_PER_HOUR = 30;
const ALERTS_PER_BUSINESS_PER_DAY = 200;
const SENSITIVE_FIELD_TYPES = new Set(["ssn4"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : (typeof v === "number" ? String(v) : null);
}

// -- Identity extraction from a submission payload, honoring the form's field maps_to --
// Fields declare maps_to like "contacts.email" / "clients.first_name" / "businesses.legal_name"
// (the convention used across GrowthHub + paige-ai-chat). payload_json is keyed by field.key.
// We resolve mapped columns first, then fall back to conventional top-level keys (like
// growth-inbound does) so a form that never set maps_to still yields a contact.
type Identity = {
  email: string | null; firstName: string | null; lastName: string | null;
  phone: string | null; entityName: string | null; title: string | null;
};
// Both stored form layouts: { sections: [{ fields }] } and a bare array of field arrays (which
// growth_form_upsert and the public intake both accept).
// deno-lint-ignore no-explicit-any
function schemaSections(schema: any): any[] {
  if (Array.isArray(schema?.sections)) return schema.sections;
  if (Array.isArray(schema)) return schema.map((fields: unknown) => ({ fields }));
  return [];
}

function extractIdentity(payload: Record<string, unknown>, schema: any): Identity {
  const id: Identity = { email: null, firstName: null, lastName: null, phone: null, entityName: null, title: null };
  const put = (mapsTo: string, raw: unknown) => {
    const v = s(raw);
    if (!v) return;
    const col = mapsTo.split(".").pop()!.toLowerCase();
    if (col === "email" && !id.email) id.email = v.toLowerCase();
    else if ((col === "first_name" || col === "firstname") && !id.firstName) id.firstName = v;
    else if ((col === "last_name" || col === "lastname") && !id.lastName) id.lastName = v;
    else if (col === "phone" && !id.phone) id.phone = v;
    else if ((col === "legal_name" || col === "business_name" || col === "company" || col === "entity_name") && !id.entityName) id.entityName = v;
    else if (col === "title" && !id.title) id.title = v;
  };
  const sections = schemaSections(schema);
  for (const sec of sections) {
    for (const f of (Array.isArray(sec?.fields) ? sec.fields : [])) {
      if (f?.maps_to && f?.key != null) put(String(f.maps_to), payload[f.key]);
    }
  }
  // Conventional fallbacks (mirror growth-inbound) when nothing was mapped.
  if (!id.email) id.email = s(payload.email)?.toLowerCase() ?? null;
  if (!id.firstName) id.firstName = s(payload.first_name) ?? s(payload.firstName) ?? null;
  if (!id.lastName) id.lastName = s(payload.last_name) ?? s(payload.lastName) ?? null;
  if (!id.phone) id.phone = s(payload.phone) ?? null;
  if (!id.entityName) id.entityName = s(payload.business_name) ?? s(payload.company) ?? null;
  // Split a single "name" field if we still have no first name.
  if (!id.firstName) {
    const full = s(payload.name) ?? s(payload.full_name);
    if (full) {
      const parts = full.split(/\s+/);
      id.firstName = parts[0];
      if (!id.lastName && parts.length > 1) id.lastName = parts.slice(1).join(" ");
    }
  }
  return id;
}

// -- Custom-field extraction: fields declare maps_to like "custom.t_shirt_size" (the extension
// this migration adds to the same allowlist growth_form_upsert enforces). Collected separately
// from identity because these write to client_custom_field_values, not clients columns, and an
// unknown/archived key is silently skipped server-side (client_custom_fields_upsert RPC) rather
// than failing the submission (§13 — one bad key never blocks the rest of a real answer).
function extractCustomFields(payload: Record<string, unknown>, schema: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sections = schemaSections(schema);
  for (const sec of sections) {
    for (const f of (Array.isArray(sec?.fields) ? sec.fields : [])) {
      const mapsTo = typeof f?.maps_to === "string" ? f.maps_to : null;
      if (!mapsTo?.startsWith("custom.") || f?.key == null) continue;
      const key = mapsTo.slice("custom.".length);
      const raw = payload[f.key];
      if (key && raw !== undefined && raw !== null && raw !== "") out[key] = raw;
    }
  }
  return out;
}

type ExecOutcome = { status: "done" | "error"; result: Record<string, unknown>; error?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Auth: service-role bearer OR a valid Vault cron token. Fail CLOSED (S13). --
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
  let body: { submission_id?: string; tenant_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const submissionId = s(body?.submission_id);
  if (!submissionId || !UUID_RE.test(submissionId)) {
    return json({ error: "submission_id required (uuid)" }, 400);
  }

  // -- 1. Atomic claim. Loser exits cleanly (idempotent). --
  const { data: claim, error: claimErr } = await admin.rpc("growth_claim_submission", { p_submission_id: submissionId });
  if (claimErr) {
    return json({ error: "claim_failed", detail: claimErr.message }, 500);
  }
  if (!claim?.claimed) {
    // Already claimed by a concurrent worker, or already terminal. Nothing to do.
    return json({ submission_id: submissionId, claimed: false, executed: [], failed: [] }, 200);
  }
  const tenantId: string = claim.tenant_id; // authoritative - from the claimed row, never the body (S9)

  // From here on, a thrown/failed path must mark the submission failed so the sweeper can retry.
  const failSubmission = async (msg: string) => {
    try { await admin.rpc("growth_fail_submission", { p_submission_id: submissionId, p_error: msg.slice(0, 1000) }); }
    catch (_e) { /* best-effort; the claim will go stale and be re-picked */ }
  };

  try {
    // -- 2. Load the claimed submission + its form --
    const { data: submission, error: subErr } = await admin
      .from("growth_form_submissions")
      .select("*") // whole row: this code must not fail on a column its migration has not added yet
      .eq("id", submissionId)
      .maybeSingle();
    if (subErr || !submission) {
      await failSubmission(`submission_not_found: ${subErr?.message ?? "no row"}`);
      return json({ error: "submission_not_found", detail: subErr?.message ?? null }, 404);
    }

    const { data: form, error: formErr } = await admin
      .from("growth_forms")
      .select("*") // whole row, for the same reason
      .eq("id", submission.form_id)
      .maybeSingle();
    if (formErr || !form) {
      await failSubmission(`form_not_found: ${formErr?.message ?? "no row"}`);
      return json({ error: "form_not_found", detail: formErr?.message ?? null }, 404);
    }
    // S9 defense-in-depth: the form MUST belong to the claimed submission's tenant. The anon-INSERT
    // RLS already binds submission.tenant_id to form.tenant_id, but the processor never runs one
    // tenant's automations under another's context on the strength of a single upstream policy.
    if (form.tenant_id !== tenantId) {
      await failSubmission("tenant_mismatch: form.tenant_id != submission.tenant_id");
      return json({ error: "tenant_mismatch" }, 409);
    }

    // -- 3. Resolve the ordered automation list (rows first; legacy columns as fallback) --
    const { data: rows, error: autoErr } = await admin
      .from("growth_form_automations")
      .select("id, target_slug, order_index, enabled, autonomy_lane, config_json, growth_automation_targets(executor, config_schema)")
      .eq("form_id", form.id)
      .eq("enabled", true)
      .order("order_index", { ascending: true });
    if (autoErr) {
      await failSubmission(`automation_load_failed: ${autoErr.message}`);
      return json({ error: "automation_load_failed", detail: autoErr.message }, 500);
    }

    type Plan = {
      automationId: string | null; // null = synthesized legacy fallback (not ledgered)
      slug: string;
      executor: string;
      lane: string | null;
      config: Record<string, unknown>;
      targetConfig: Record<string, unknown>;
    };
    const plan: Plan[] = [];

    if (rows && rows.length > 0) {
      for (const r of rows as any[]) {
        const target = Array.isArray(r.growth_automation_targets) ? r.growth_automation_targets[0] : r.growth_automation_targets;
        if (!target?.executor) continue; // orphaned slug - skip rather than guess
        plan.push({
          automationId: r.id,
          slug: r.target_slug,
          executor: target.executor,
          lane: r.autonomy_lane ?? null,
          config: (r.config_json ?? {}) as Record<string, unknown>,
          targetConfig: (target.config_schema ?? {}) as Record<string, unknown>,
        });
      }
    } else {
      // Legacy fallback - synthesize from growth_forms columns (no automation_id => not ledgered;
      // submission-level completion prevents re-fire on the normal path).
      if (form.auto_create_contact) {
        plan.push({ automationId: null, slug: "contact_upsert", executor: "contact_upsert", lane: null, config: {}, targetConfig: {} });
      }
      if (form.pipeline_id && form.auto_create_deal) {
        plan.push({ automationId: null, slug: "pipeline_attach", executor: "pipeline_attach", lane: null,
          config: { pipeline_id: form.pipeline_id, stage_id: form.stage_id }, targetConfig: {} });
      }
      if (s(form.workflow_slug)) {
        plan.push({ automationId: null, slug: "run_workflow", executor: "n8n_workflow", lane: null,
          config: { workflow_key: form.workflow_slug }, targetConfig: {} });
      }
      if (Array.isArray(form.notify_user_ids) && form.notify_user_ids.length > 0) {
        plan.push({ automationId: null, slug: "notify_team", executor: "notify_team", lane: null,
          config: { user_ids: form.notify_user_ids }, targetConfig: {} });
      }
    }

    applyIntakeSettings(plan, form);

    // Existing dispatch ledger for this submission -> skip already-completed executors (idempotent).
    const { data: existingDispatches } = await admin
      .from("growth_submission_dispatches")
      .select("automation_id, status")
      .eq("submission_id", submissionId);
    const doneByAutomation = new Map<string, string>();
    for (const d of (existingDispatches ?? []) as any[]) {
      if (d.automation_id) doneByAutomation.set(d.automation_id, d.status);
    }

    const payload = (submission.payload_json ?? {}) as Record<string, unknown>;
    let contactId: string | null = submission.contact_id ?? null;

    const executed: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    // -- 4. Run each automation in order --
    for (const p of plan) {
      // Idempotency: a done/skipped dispatch is permanent; an error dispatch is retried (re-run + upsert).
      if (p.automationId) {
        const prior = doneByAutomation.get(p.automationId);
        if ((prior === "done" || prior === "skipped") && p.executor !== "pipeline_attach") {
          skipped.push({ slug: p.slug, reason: "already_dispatched" });
          continue;
        }
      }

      let outcome: ExecOutcome;
      try {
        outcome = await runExecutor(p, {
          admin, tenantId, submissionId, claimAttempt: claim.attempts, form, payload, submission,
          contactId, setContactId: (id: string) => { contactId = id; },
        });
      } catch (e) {
        outcome = { status: "error", result: {}, error: (e as Error)?.message?.slice(0, 500) ?? "unknown_error" };
      }

      // Ledger the true outcome (real rows only; synthesized fallback carries no automation_id).
      if (p.automationId && p.executor !== "pipeline_attach") {
        await admin.from("growth_submission_dispatches").upsert({
          submission_id: submissionId,
          automation_id: p.automationId,
          tenant_id: tenantId,
          target_slug: p.slug,
          status: outcome.status,
          result: outcome.result,
          error: outcome.error ?? null,
          created_at: new Date().toISOString(),
        }, { onConflict: "submission_id,automation_id" });
      }

      if (outcome.status === "done") {
        executed.push({ slug: p.slug, executor: p.executor, result: outcome.result });
      } else {
        failed.push({ slug: p.slug, executor: p.executor, error: outcome.error ?? "unknown_error" });
      }
    }

    // -- 5. Terminal lifecycle (honest) --
    if (failed.length > 0) {
      await failSubmission(`executor_failures: ${failed.map((f) => `${f.slug}:${f.error}`).join("; ")}`);
    } else {
      const { error: compErr } = await admin.rpc("growth_complete_submission", { p_submission_id: submissionId });
      if (compErr) {
        // The work ran, but we couldn't mark it done - report truthfully; the sweeper will re-claim
        // and the ledger will skip the already-completed executors.
        return json({ submission_id: submissionId, claimed: true, executed, failed, skipped, complete_error: compErr.message }, 200);
      }
    }

    // -- 6. Structured summary. 200 with per-executor truth (top-level succeeded). --
    return json({ submission_id: submissionId, claimed: true, executed, failed, skipped }, 200);
  } catch (e) {
    const msg = (e as Error)?.message ?? "unknown_error";
    await failSubmission(`processor_error: ${msg}`);
    return json({ error: "internal", detail: msg.slice(0, 500) }, 500);
  }
});

// -- The executor dispatch. Each arm returns a truthful ExecOutcome; a throw is caught by the loop. --
type ExecCtx = {
  // deno-lint-ignore no-explicit-any
  admin: any;
  tenantId: string;
  submissionId: string;
  claimAttempt: number;
  // deno-lint-ignore no-explicit-any
  form: any;
  payload: Record<string, unknown>;
  // deno-lint-ignore no-explicit-any
  submission: any;
  contactId: string | null;
  setContactId: (id: string) => void;
};

async function runExecutor(
  p: { automationId: string | null; slug: string; executor: string; lane: string | null; config: Record<string, unknown>; targetConfig: Record<string, unknown> },
  ctx: ExecCtx,
): Promise<ExecOutcome> {
  const { admin, tenantId, submissionId, form, payload } = ctx;

  switch (p.executor) {
    // -- contact_upsert: resolve, else create; then pin the submission's contact_id. Also writes
    // any custom.<key>-mapped answers onto the resolved contact, whichever path found it (§13 —
    // an already-linked contact still gets its new answers, not just a freshly-created one). --
    case "contact_upsert": {
      let contactId = ctx.contactId;
      let note: string | undefined;
      if (contactId) {
        note = "already_linked";
      } else {
        const idn = extractIdentity(payload, form.schema_json);
        if (!idn.email && !idn.phone) {
          return { status: "done", result: { note: "no_identity_to_resolve" } };
        }
        // Resolve an existing tenant contact first (service path: p_tenant used directly).
        const { data: resolved } = await admin.rpc("resolve_contact_id", {
          p_tenant: tenantId, p_phone: idn.phone, p_email: idn.email, p_user_id: null,
        });
        contactId = s(resolved);
        if (!contactId) {
          // Create via the audited RPC seam (S10). p_created_by threads the form's verified
          // operator so the admin/coach role gate and NOT-NULL created_by are satisfied.
          const { data: created, error: createErr } = await admin.rpc("create_contact", {
            p_first_name: idn.firstName ?? "New",
            p_last_name: idn.lastName ?? null,
            p_email: idn.email,
            p_phone: idn.phone,
            p_entity_name: idn.entityName,
            p_title: idn.title,
            p_lifecycle_stage: "new_lead", // #172: 'lead' violates clients_lifecycle_stage_chk (23514)
            p_source: "paige_form",
            p_channel: "form", // #10 channel-of-origin (growth form submission)
            p_tags: [],
            p_primary_offer: null,
            p_notes: null,
            p_assigned_coach_user_id: null,
            p_tenant_id: tenantId,
            p_created_by: await resolveIntakeOperator(admin, tenantId, form.created_by),
          });
          if (createErr || !created) {
            return { status: "error", result: {}, error: `create_contact_failed: ${createErr?.message ?? "no id returned"}` };
          }
          contactId = s(created);
        }
        if (!contactId) return { status: "error", result: {}, error: "contact_unresolved" };
        const { data: pinned, error: pinErr } = await admin.from("growth_form_submissions")
          .update({ contact_id: contactId }).eq("id", submissionId).eq("tenant_id", tenantId)
          .eq("processing_state", "claimed").eq("attempts", ctx.claimAttempt).is("contact_id", null)
          .select("id").maybeSingle();
        if(pinErr || !pinned) return {status:"error",result:{},error:"submission_contact_link_failed"};
        ctx.setContactId(contactId);
      }

      let customFieldsError: string | undefined;
      const customValues = extractCustomFields(payload, form.schema_json);
      if (Object.keys(customValues).length > 0) {
        const { error: cfErr } = await admin.rpc("client_custom_fields_upsert", {
          p_client_id: contactId, p_tenant_id: tenantId, p_values: customValues,
        });
        if (cfErr) customFieldsError = cfErr.message;
      }

      return {
        status: "done",
        result: {
          contact_id: contactId,
          ...(note ? { note } : {}),
          ...(customFieldsError ? { custom_fields_error: customFieldsError } : {}),
        },
      };
    }

    // -- pipeline_attach: create/advance a tenant-OWNED deal on the form's pipeline/stage. --
    case "pipeline_attach": {
      const contactId = ctx.contactId;
      if (!contactId) {
        // A visitor who left no email or phone is captured as a submission, not a contact, so there
        // is nothing to hang a deal on — the same outcome as contact_upsert's, not a failure to retry.
        const idn = extractIdentity(payload, form.schema_json);
        if (!idn.email && !idn.phone) return { status: "done", result: { note: "no_contact_for_pipeline" } };
        return { status: "error", result: {}, error: "no_contact_for_pipeline" };
      }
      const {data: attached,error: attachError}=await admin.rpc("growth_attach_submission_deal",{
        p_submission_id:submissionId,p_claim_attempt:ctx.claimAttempt,p_automation_id:p.automationId,
      });
      if(attachError || !attached) return {status:"error",result:{},error:"submission_deal_admission_failed"};
      return {status:"done",result:attached};
    }

    // -- paige_action / surface_to_client: file the action onto the bus (governed lane). --
    case "paige_action":
    case "surface_to_client": {
      const actionKind = s(p.config.action_kind) ?? s(p.targetConfig.action_kind);
      if (!actionKind) return { status: "error", result: {}, error: "no_action_kind_configured" };
      const { data: filed, error: fileErr } = await admin.rpc("file_action", {
        p_action_kind: actionKind,
        p_title: `New submission - ${form.name ?? "form"}`,
        p_summary: null,
        p_contact_id: ctx.contactId,
        p_payload: { submission_id: submissionId, form_id: form.id, source: s(payload.source) ?? "paige_form" },
        p_from_department: null,
        p_to_department: null,
        p_priority: null,
        p_due_at: null,
        p_conversation_id: null,
        p_parent_action_id: null,
        p_created_by_agent: "paige",
        p_tenant_id: tenantId,
        p_autonomy_lane: p.lane, // null => the kind default; the DB resolver clamps it (S16)
      });
      if (fileErr || !filed?.ok) {
        return { status: "error", result: {}, error: `file_action_failed: ${fileErr?.message ?? filed?.error ?? "unknown"}` };
      }
      return { status: "done", result: { action_id: filed.action_id, action_kind: actionKind, status: filed.status } };
    }

    // -- client_rail_event: post the submission onto the client's activity timeline. --
    case "client_rail_event": {
      if (!ctx.contactId) return { status: "done", result: { note: "no_contact_for_timeline" } };
      const eventKind = s(p.config.event_kind) ?? s(p.targetConfig.event_kind) ?? "client.intake_answer";
      const { data: railId, error: railErr } = await admin.rpc("record_rail_event", {
        p_contact_id: ctx.contactId,
        p_event_kind: eventKind,
        p_surface: "form",
        p_actor_type: "client",
        p_title: `Submitted: ${form.name ?? "form"}`,
        p_summary: null,
        p_payload: { submission_id: submissionId, form_id: form.id },
        p_ref_table: "growth_form_submissions",
        p_ref_id: submissionId,
        p_from_department: "client_experience",
        p_to_department: "owner_ops",
        p_occurred_at: null,
        p_narrow_to_owner: false,
        p_tenant_id: tenantId,
      });
      if (railErr) return { status: "error", result: {}, error: `rail_event_failed: ${railErr.message}` };
      return { status: "done", result: { event_id: s(railId), event_kind: eventKind } };
    }

    // -- notify_team: hand off to the unified team notifier (event=form_submission). --
    case "notify_team": {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-team-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
        body: JSON.stringify({ event: "form_submission", submission_id: submissionId }),
      });
      const txt = await res.text();
      if (!res.ok) return { status: "error", result: {}, error: `notify_team_${res.status}: ${txt.slice(0, 200)}` };
      // deno-lint-ignore no-explicit-any
      let parsed: any = null; try { parsed = JSON.parse(txt); } catch { /* plain text */ }
      // The in-app notices are the team notification; the notifier's companion email is reported,
      // never assumed. Its template is not registered today, so that email has never been sent —
      // failing the submission (and retrying it five times, re-posting every in-app notice) over a
      // side-channel that cannot succeed would be worse than recording the truth. The owner's
      // email alert is the form's own email_alert step, which does fail on a refused send.
      return {
        status: "done",
        result: {
          notify: parsed ?? txt.slice(0, 200),
          ...(parsed?.success === false ? { emails_failed: parsed?.emails_failed ?? null } : {}),
        },
      };
    }

    // -- email_alert: email the address the owning workspace set on this form. --
    // The provider's answer decides the outcome (§13): send-transactional-email returns 200
    // {success:true, sent:true, id} only when Resend accepted the message; anything else is an error
    // the sweeper can retry. alert_sent_at makes the send once-only across retries.
    case "email_alert": {
      const to = s(form.notify_email);
      if (!to) return { status: "done", result: { note: "no_alert_address" } };
      if (ctx.submission?.alert_sent_at) return { status: "done", result: { note: "already_sent" } };

      // A flood of submissions must not become a flood of email through the platform's one sending
      // account. Past the cap the lead is still captured and visible in the account; only the email
      // is withheld, and the submission records why (alert_skipped_reason). If the counts cannot be
      // read, nothing is sent (fail closed). The check precedes the send, so a burst processed in
      // parallel can pass the cap by the number in flight.
      const sentSince = async (column: "form_id" | "tenant_id", value: string, hours: number) => {
        const { count, error } = await admin
          .from("growth_form_submissions")
          .select("id", { count: "exact", head: true })
          .eq(column, value)
          .gte("alert_sent_at", new Date(Date.now() - hours * 3600_000).toISOString());
        return error ? null : (count ?? 0);
      };
      const formHour = await sentSince("form_id", form.id, 1);
      const businessDay = await sentSince("tenant_id", tenantId, 24);
      if (formHour === null || businessDay === null) {
        return { status: "error", result: {}, error: "email_alert_cap_unreadable" };
      }
      if (formHour >= ALERTS_PER_FORM_PER_HOUR || businessDay >= ALERTS_PER_BUSINESS_PER_DAY) {
        const reason = formHour >= ALERTS_PER_FORM_PER_HOUR ? "form_hourly_cap" : "business_daily_cap";
        // Recorded on the submission itself, so the account can show why this lead sent no email.
        const { error: markErr } = await admin
          .from("growth_form_submissions")
          .update({ alert_skipped_reason: reason })
          .eq("id", submissionId);
        if (markErr) return { status: "error", result: {}, error: `alert_cap_mark_failed: ${markErr.message}` };
        return { status: "done", result: { note: "alert_capped", reason, form_last_hour: formHour, business_last_day: businessDay } };
      }

      const fields = labelledAnswers(payload, form.schema_json);
      const idn = extractIdentity(payload, form.schema_json);
      const visitorName = [idn.firstName, idn.lastName].filter(Boolean).join(" ").trim() || null;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
        body: JSON.stringify({
          templateName: "form-submission-alert",
          recipientEmail: to,
          tenantId,
          idempotencyKey: `form-submission-alert-${submissionId}`,
          // Replying goes straight to the person who filled in the form, when they gave a real address.
          ...(isEmailAddress(idn.email) ? { replyToOverride: idn.email } : {}),
          templateData: {
            formName: form.name ?? "Form",
            visitorName,
            visitorEmail: isEmailAddress(idn.email) ? idn.email : null,
            fields,
            submittedAt: ctx.submission?.created_at ?? new Date().toISOString(),
          },
        }),
      });
      const txt = await res.text();
      // deno-lint-ignore no-explicit-any
      let parsed: any = null; try { parsed = JSON.parse(txt); } catch { /* plain text */ }
      if (!res.ok || parsed?.success !== true || parsed?.sent !== true) {
        return {
          status: "error",
          result: { http: res.status },
          error: `email_alert_not_sent: ${res.status} ${txt.slice(0, 200)}`,
        };
      }
      const { error: markErr } = await admin
        .from("growth_form_submissions")
        .update({ alert_sent_at: new Date().toISOString(), alert_skipped_reason: null })
        .eq("id", submissionId);
      if (markErr) {
        // The email went; failing here would re-send it on retry. Record the truth and stop.
        return { status: "done", result: { sent: true, provider_id: parsed?.id ?? null, mark_error: markErr.message } };
      }
      return { status: "done", result: { sent: true, provider_id: parsed?.id ?? null } };
    }

    // -- n8n_workflow: file owner.run_workflow, then advance it into a queued run (governed). --
    case "n8n_workflow": {
      const workflowKey = s(p.config.workflow_key) ?? s(p.config.workflow_slug);
      if (!workflowKey) return { status: "error", result: {}, error: "no_workflow_key_configured" };
      const { data: filed, error: fileErr } = await admin.rpc("file_action", {
        p_action_kind: "owner.run_workflow",
        p_title: `Automation - ${form.name ?? "form"}`,
        p_summary: null,
        p_contact_id: ctx.contactId,
        p_payload: { workflow_key: workflowKey, submission_id: submissionId, form_id: form.id, contact_id: ctx.contactId },
        p_from_department: null,
        p_to_department: null,
        p_priority: null,
        p_due_at: null,
        p_conversation_id: null,
        p_parent_action_id: null,
        p_created_by_agent: "paige",
        p_tenant_id: tenantId,
        p_autonomy_lane: p.lane,
      });
      if (fileErr || !filed?.ok) {
        return { status: "error", result: {}, error: `file_action_failed: ${fileErr?.message ?? filed?.error ?? "unknown"}` };
      }
      // Drive it forward. advance_action's workflow executor enqueues a paige_workflow_runs row when
      // the resolved lane is 'auto'; on a confirm/off lane it holds for approval. The dispatch sweeper
      // fires the queued run and trg_pwr_sync_action flips the action to done/failed at terminal (S13
      // truthful - never done-at-fire-time). We report the real resulting status.
      const { data: adv, error: advErr } = await admin.rpc("advance_action", {
        p_action_id: filed.action_id, p_to_status: "drafted", p_tenant_id: tenantId,
      });
      if (advErr) {
        return { status: "error", result: { action_id: filed.action_id }, error: `advance_action_failed: ${advErr.message}` };
      }
      return { status: "done", result: { action_id: filed.action_id, workflow_key: workflowKey, action_status: adv?.status ?? filed.status } };
    }

    // -- outbound_webhook: DEFERRED (fast-follow). ----------------------------------------------
    // Held out of the first live ship on purpose. Two things must land together before a service-role
    // fetch to a tenant-authored URL is safe and honest, and neither is done yet:
    //   1. The connected-endpoint URL now lives ENCRYPTED (outbound_webhook_configs.url_ct, decrypt via
    //      platform_decrypt) and that table is not tenant-scoped - so the config-id path needs a
    //      tenant-owned endpoint table + a scoped decrypt, not the old plaintext `url` column.
    //   2. The inline-URL path needs DNS-rebinding-safe fetching (resolve once, connect to the
    //      validated IP literal with the original Host header) - assertPublicHttpUrl + fetch(url) is a
    //      TOCTOU that a low-TTL record can slip past.
    // This executor is NOT a platform default and has no authoring UI, so no live form references it;
    // deferring it fails no real submission. It records an honest, non-failing "deferred" outcome so a
    // directly-configured automation is visibly a no-op rather than a silent SSRF. Re-enable in the
    // fast-follow once (1)+(2) land. assertPublicHttpUrl stays imported for that work.
    case "outbound_webhook": {
      return {
        status: "done",
        result: { note: "outbound_webhook_deferred", detail: "The outbound webhook executor ships in a fast-follow; this submission's other automations ran." },
      };
    }

    default:
      return { status: "error", result: {}, error: `unknown_executor:${p.executor}` };
  }
}

// -- A form's alert address, applied to every form (with or without automation rows). --
// growth_form_set_intake() is the one place an owner sets it. Pipeline routing is NOT added here: that
// RPC writes it where the plan above already reads it (the form's columns for a form with no
// automation rows, its ledgered contact_upsert/pipeline_attach rows otherwise), so there is exactly
// one route per form and a retry never re-runs an unledgered deal step.
// deno-lint-ignore no-explicit-any
function applyIntakeSettings(plan: any[], form: any): void {
  if (s(form.notify_email) && !plan.some((p) => p.executor === "email_alert")) {
    plan.push({ automationId: null, slug: "email_alert", executor: "email_alert", lane: null, config: {}, targetConfig: {} });
  }
}

// -- Who a public submission's contact and deal are recorded as created by. --
// create_contact requires an active owner/admin of the tenant (CONTACT_NO_OPERATOR /
// CONTACT_CREATOR_NOT_IN_TENANT). The form's author is used while they still hold that seat; once
// they leave or are downgraded, the business's current owner is used instead, so a staff change
// never stops the business's forms from creating leads. Resolved from the form's own tenant only.
// deno-lint-ignore no-explicit-any
async function resolveIntakeOperator(admin: any, tenantId: string, createdBy: string | null): Promise<string | null> {
  const seat = async (userId: string) => {
    const { data } = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenantId).eq("user_id", userId).eq("status", "active")
      .in("role", ["owner", "admin"])
      .limit(1).maybeSingle();
    return !!data?.user_id;
  };
  if (createdBy && await seat(createdBy)) return createdBy;
  const { data: owner } = await admin
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId).eq("status", "active").eq("role", "owner")
    .order("joined_at", { ascending: true })
    .limit(1).maybeSingle();
  return s(owner?.user_id) ?? createdBy ?? null;
}

// -- The visitor's answers, labelled by the form's own fields, in the form's order. --
// deno-lint-ignore no-explicit-any
function labelledAnswers(payload: Record<string, unknown>, schema: any): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const sections = schemaSections(schema);
  for (const sec of sections) {
    for (const f of (Array.isArray(sec?.fields) ? sec.fields : [])) {
      if (f?.key == null) continue;
      // Identity numbers never travel by email; the owner reads them in the account.
      if (SENSITIVE_FIELD_TYPES.has(f.type)) continue;
      const raw = payload[f.key];
      if (raw === undefined || raw === null || raw === "") continue;
      // deno-lint-ignore no-explicit-any
      const optionLabel = (v: unknown) => {
        const opt = (Array.isArray(f.options) ? f.options : []).find((o: any) =>
          (typeof o === "string" ? o : o?.value) === v);
        return typeof opt === "string" ? opt : (opt?.label ?? String(v));
      };
      const value = Array.isArray(raw) ? raw.map(optionLabel).join(", ")
        : typeof raw === "boolean" ? (raw ? "Yes" : "No")
        : f.options ? optionLabel(raw) : String(raw);
      out.push({ label: String(f.label ?? f.key).slice(0, 200), value: value.slice(0, 2000) });
    }
  }
  return out;
}
