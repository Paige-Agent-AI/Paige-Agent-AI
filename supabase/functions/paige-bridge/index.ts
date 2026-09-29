// Phase 6 — Paige Bridge (reverse direction)
// MMA OS + n8n call INTO Paige via this verb-routed Edge Function.
// Doctrine §91: bearer auth, single function, verb router, mirrors MMA OS bridge.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import {
  CLIENT_CONTACT_METHODS_EMBED,
  findFirstClientByEmailAnyWorkspace,
  withPrimaryAddresses,
} from "../_shared/contact-methods.ts";
import { upsertContactMirror } from "./contact-mirror.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_API_KEY = Deno.env.get("PAIGE_BRIDGE_API_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- helpers ----------

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function ok(verb: string, data: unknown) {
  return new Response(JSON.stringify({ ok: true, verb, data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}
function fail(verb: string, status: number, error: string, details?: unknown) {
  return new Response(JSON.stringify({ ok: false, verb, error, details }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function splitName(full?: string | null): { first: string; last: string } {
  const s = (full ?? "").trim();
  if (!s) return { first: "Unknown", last: "" };
  const idx = s.indexOf(" ");
  if (idx < 0) return { first: s, last: "" };
  return { first: s.slice(0, idx), last: s.slice(idx + 1).trim() };
}

async function resolveOwnerUserId(): Promise<string | null> {
  const { data: owner } = await supabase
    .from("app_settings_owner")
    .select("owner_email")
    .limit(1)
    .maybeSingle();
  if (!owner?.owner_email) return null;
  // auth admin lookup
  const { data: list } = await supabase.auth.admin.listUsers();
  const u = list?.users?.find(
    (x) => (x.email ?? "").toLowerCase() === String(owner.owner_email).toLowerCase(),
  );
  return u?.id ?? null;
}

// ---------- verb schemas ----------

const CreatePendingApprovalSchema = z.object({
  type: z.enum(["cs_draft", "campaign_send", "tier_change", "qc_finding", "milestone", "other"]),
  draft_content: z.record(z.any()),
  contact_id: z.string().uuid().nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  created_by_n8n_workflow_key: z.string().nullable().optional(),
  metadata: z.record(z.any()).optional(),
});

const UpdatePendingApprovalSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "edited", "skipped", "escalated", "stale"]).optional(),
  metadata: z.record(z.any()).optional(),
  escalation_note: z.string().max(2000).optional(),
});

const CreateWorkflowRunSchema = z.object({
  registry_key: z.string().min(1),
  triggered_by: z.enum(["cron", "webhook", "api"]).default("api"),
  payload: z.record(z.any()).optional(),
  n8n_execution_id: z.string().optional(),
  started_at: z.string().datetime().optional(),
});

const UpdateWorkflowRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  completed_at: z.string().datetime().optional(),
  result: z.record(z.any()).optional(),
  error: z.string().max(4000).optional(),
});

const LogMessageSendSchema = z.object({
  channel: z.enum(["email", "sms"]),
  pipe_used: z.enum(["resend", "twilio"]),
  to: z.string().min(1).max(255),
  from: z.string().max(255).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().optional(),
  status: z.enum(["queued", "sent", "failed", "bounced"]),
  contact_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  vendor_message_id: z.string().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
});

const TierEnum = z.enum(["lead","standard","premium","vip","internal","staff","free"]);

const UpsertContactMirrorSchema = z.object({
  email: z.string().email(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  full_name: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  tier: TierEnum.nullable().optional(),
  ghl_contact_id: z.string().max(100).nullable().optional(),
  custom_fields: z.record(z.any()).optional(),
  assigned_to_email: z.string().email().nullable().optional(),
  metadata: z.record(z.any()).optional(),
});

const NotifyAdminSchema = z.object({
  severity: z.enum(["info", "warning", "urgent"]).default("info"),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).nullable().optional(),
  link_to: z.string().max(500).nullable().optional(),
  source_workflow_key: z.string().max(100).nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  scope: z.enum(["global","admin","role","assigned_user"]).default("global"),
  scope_role: z.string().max(50).nullable().optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
});

const ReadConfigSchema = z.object({ key: z.string().optional() });

const GetCoachForClientSchema = z.object({ email: z.string().email() });
const GetOpportunitiesForContactSchema = z.object({ email: z.string().email(), limit: z.number().int().min(1).max(200).default(50) });
const ListModifiedClientsSinceSchema = z.object({
  since: z.string().datetime(),
  limit: z.number().int().min(1).max(500).default(100),
});

const StrategyEnum = z.enum(["manual", "round_robin", "load_balanced"]);
const AssignRoleEnum = z.enum(["lead_owner", "cs_primary"]);

const SetAssignmentPolicySchema = z.object({
  tier: TierEnum,
  strategy: StrategyEnum,
  target_role: AssignRoleEnum.optional(),
  eligible_user_ids: z.array(z.string().uuid()).default([]),
  eligible_user_emails: z.array(z.string().email()).optional(),
});

const GetAssignmentPolicySchema = z.object({
  tier: TierEnum.optional(),
});

const ClaimClientForUserSchema = z.object({
  client_email: z.string().email().optional(),
  client_id: z.string().uuid().optional(),
  user_email: z.string().email(),
  assigned_role: AssignRoleEnum.default("lead_owner"),
});

// ---------- handler ----------

async function logAuthFailure(req: Request, status: number, reason: string, verb: string) {
  try {
    await supabase.from("paige_bridge_auth_failures").insert({
      function_name: "paige-bridge",
      status,
      verb,
      reason,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    });
  } catch (e) {
    console.error("auth_failure_log_error", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  let verb = "unknown";

  try {
    if (!BRIDGE_API_KEY) return fail(verb, 500, "Bridge not configured");

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      await logAuthFailure(req, 401, "Missing bearer token", verb);
      return fail(verb, 401, "Missing bearer token");
    }
    if (!timingSafeEqual(auth.slice(7), BRIDGE_API_KEY)) {
      await logAuthFailure(req, 401, "Invalid bearer token", verb);
      return fail(verb, 401, "Invalid bearer token");
    }


    // Coarse rate limit per-IP (best-effort; reuses api_rate_limits sentinel uuid).
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "0.0.0.0";
    try {
      // Sentinel user id derived from ip for bucketing
      const enc = new TextEncoder().encode(ip);
      const hash = await crypto.subtle.digest("SHA-256", enc);
      const bytes = new Uint8Array(hash).slice(0, 16);
      // Make a deterministic uuid v4-ish
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const sentinel = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const { data: allowed } = await supabase.rpc("check_rate_limit", {
        _user_id: sentinel,
        _function_name: "paige-bridge",
        _max_requests: 600,
        _window_minutes: 1,
      });
      if (allowed === false) return fail(verb, 429, "Rate limit exceeded");
    } catch { /* swallow rate-limit errors */ }

    const body = await req.json().catch(() => null) as { verb?: string; payload?: unknown } | null;
    if (!body || typeof body.verb !== "string") {
      return fail(verb, 400, "Body must be { verb, payload }");
    }
    verb = body.verb;
    const payload = (body.payload ?? {}) as Record<string, unknown>;

    switch (verb) {
      // -----------------------------------------------------------------
      case "health_check": {
        return ok(verb, { status: "ok", version: 1, timestamp: new Date().toISOString() });
      }

      // -----------------------------------------------------------------
      case "create_pending_approval": {
        const p = CreatePendingApprovalSchema.parse(payload);
        let contactId = p.contact_id ?? null;
        if (!contactId && p.contact_email) {
          contactId = (await findFirstClientByEmailAnyWorkspace(supabase, p.contact_email, "paige-bridge"))?.id ?? null;
        }
        const { data, error } = await supabase
          .from("paige_pending_approvals")
          .insert({
            type: p.type,
            draft_content: p.draft_content,
            contact_id: contactId,
            conversation_id: p.conversation_id ?? null,
            created_by_n8n_workflow_key: p.created_by_n8n_workflow_key ?? null,
            metadata: p.metadata ?? {},
            status: "pending",
          })
          .select("id, created_at, status")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "update_pending_approval": {
        const p = UpdatePendingApprovalSchema.parse(payload);
        const patch: Record<string, unknown> = {};
        if (p.status) patch.status = p.status;
        if (p.metadata) patch.metadata = p.metadata;
        if (p.escalation_note) patch.escalation_note = p.escalation_note;
        const { data, error } = await supabase
          .from("paige_pending_approvals")
          .update(patch)
          .eq("id", p.id)
          .select("id, status, metadata, updated_at")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "create_workflow_run": {
        const p = CreateWorkflowRunSchema.parse(payload);
        const { data: reg, error: regErr } = await supabase
          .from("paige_workflow_registry")
          .select("id")
          .eq("key", p.registry_key)
          .maybeSingle();
        if (regErr) throw regErr;
        if (!reg) return fail(verb, 404, `Registry key not found: ${p.registry_key}`);

        const insertRow: Record<string, unknown> = {
          registry_id: reg.id,
          payload: { ...(p.payload ?? {}), triggered_by: p.triggered_by, n8n_execution_id: p.n8n_execution_id },
          status: "running",
          n8n_execution_id: p.n8n_execution_id ?? null,
        };
        if (p.started_at) insertRow.triggered_at = p.started_at;

        const { data, error } = await supabase
          .from("paige_workflow_runs")
          .insert(insertRow)
          .select("id")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "update_workflow_run": {
        const p = UpdateWorkflowRunSchema.parse(payload);
        const patch: Record<string, unknown> = { status: p.status };
        if (p.completed_at) patch.completed_at = p.completed_at;
        else if (p.status === "completed" || p.status === "failed") patch.completed_at = new Date().toISOString();
        if (p.result !== undefined) patch.result = p.result;
        if (p.error !== undefined) patch.error = p.error;
        const { data, error } = await supabase
          .from("paige_workflow_runs")
          .update(patch)
          .eq("id", p.id)
          .select("id, status, completed_at")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "log_message_send": {
        const p = LogMessageSendSchema.parse(payload);
        const { data, error } = await supabase
          .from("paige_messages_audit")
          .insert({
            channel: p.channel,
            pipe_used: p.pipe_used,
            to_address: p.to,
            from_address: p.from ?? null,
            subject: p.subject ?? null,
            body: p.body ?? null,
            status: p.status,
            vendor_message_id: p.vendor_message_id ?? null,
            error: p.error ?? null,
            contact_id: p.contact_id ?? null,
            conversation_id: p.conversation_id ?? null,
            sent_at: p.status === "sent" ? new Date().toISOString() : null,
          })
          .select("id")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "upsert_contact_mirror": {
        const p = UpsertContactMirrorSchema.parse(payload);
        const emailLower = p.email.toLowerCase();
        const fallback = splitName(p.full_name);
        const first = (p.first_name ?? fallback.first ?? "Unknown").trim();
        const last = (p.last_name ?? fallback.last ?? "").trim();

        const ownerId = await resolveOwnerUserId();
        if (!ownerId) return fail(verb, 500, "Platform owner not resolvable for created_by");

        const { data: ownerProfile } = await supabase.from("profiles")
          .select("active_tenant_id").eq("user_id", ownerId).maybeSingle();
        const tenantId = ownerProfile?.active_tenant_id ?? null;
        if (!tenantId) return fail(verb, 409, "tenant_not_resolved");

        const nowIso = new Date().toISOString();

        // Resolve assigned user mapping (auth.users by email)
        let assignedUserId: string | null = null;
        if (p.assigned_to_email) {
          const { data: list } = await supabase.auth.admin.listUsers();
          const u = list?.users?.find(
            (x) => (x.email ?? "").toLowerCase() === p.assigned_to_email!.toLowerCase(),
          );
          assignedUserId = u?.id ?? null;
        }

        // Match by the external CRM id, then by ANY email a contact here holds; update it, or create
        // the contact with its addresses in one transaction (contact-mirror.ts).
        const result = await upsertContactMirror(supabase, {
          tenantId, ownerId, emailLower, first, last,
          phone: p.phone ?? null, tier: p.tier ?? null, ghlContactId: p.ghl_contact_id ?? null,
          source: p.source ?? null, assignedUserId, nowIso,
        });
        return ok(verb, result);
      }

      // -----------------------------------------------------------------
      case "notify_admin": {
        const p = NotifyAdminSchema.parse(payload);
        const { data, error } = await supabase
          .from("paige_admin_notifications")
          .insert({
            severity: p.severity,
            title: p.title,
            body: p.body ?? null,
            link_to: p.link_to ?? null,
            source_workflow_key: p.source_workflow_key ?? null,
            contact_id: p.contact_id ?? null,
            scope: p.scope,
            assigned_role: p.scope_role ?? null,
            assigned_user_id: p.assigned_user_id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "read_config": {
        const p = ReadConfigSchema.parse(payload);
        const { data, error } = await supabase
          .from("paige_config")
          .select("*")
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (p.key) return ok(verb, { [p.key]: (data as Record<string, unknown> | null)?.[p.key] ?? null });
        return ok(verb, data ?? {});
      }

      // -----------------------------------------------------------------
      case "get_approval_queue_count": {
        const { data, error } = await supabase.rpc("get_approval_queue_counts");
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "get_coach_for_client": {
        const p = GetCoachForClientSchema.parse(payload);
        const client = await findFirstClientByEmailAnyWorkspace(supabase, p.email, "paige-bridge");
        if (!client?.id) return ok(verb, { client_id: null, assignments: [] });

        const { data: rows, error } = await supabase
          .from("paige_coach_assignments")
          .select("assigned_role, rep_user_id, assigned_at, metadata")
          .eq("contact_id", client.id)
          .eq("active", true);
        if (error) throw error;

        const userIds = (rows ?? []).map((r: any) => r.rep_user_id).filter(Boolean);
        const emails: Record<string, string> = {};
        if (userIds.length) {
          const { data: list } = await supabase.auth.admin.listUsers();
          for (const u of list?.users ?? []) {
            if (userIds.includes(u.id)) emails[u.id] = u.email ?? "";
          }
        }
        const assignments = (rows ?? []).map((r: any) => ({
          role: r.assigned_role,
          user_id: r.rep_user_id,
          email: r.rep_user_id ? emails[r.rep_user_id] ?? null : null,
          assigned_at: r.assigned_at,
        }));
        return ok(verb, { client_id: client.id, assignments });
      }

      // -----------------------------------------------------------------
      case "get_opportunities_for_contact": {
        const p = GetOpportunitiesForContactSchema.parse(payload);
        const client = await findFirstClientByEmailAnyWorkspace(supabase, p.email, "paige-bridge");
        if (!client?.id) return ok(verb, { client_id: null, deals: [] });

        const { data, error } = await supabase
          .from("deals")
          .select("id, title, value_cents, currency, status, expected_close_date, actual_close_date, lost_reason, source, tags, created_at, updated_at, pipeline_id, stage_id, pipelines(name), pipeline_stages(name)")
          .eq("contact_client_id", client.id)
          .order("updated_at", { ascending: false })
          .limit(p.limit);
        if (error) throw error;
        const deals = (data ?? []).map((d: any) => ({
          id: d.id,
          title: d.title,
          value_cents: d.value_cents,
          currency: d.currency,
          status: d.status,
          expected_close_date: d.expected_close_date,
          actual_close_date: d.actual_close_date,
          lost_reason: d.lost_reason,
          source: d.source,
          tags: d.tags,
          pipeline: d.pipelines?.name ?? null,
          stage: d.pipeline_stages?.name ?? null,
          created_at: d.created_at,
          updated_at: d.updated_at,
        }));
        return ok(verb, { client_id: client.id, deals });
      }

      // -----------------------------------------------------------------
      case "list_modified_clients_since": {
        const p = ListModifiedClientsSinceSchema.parse(payload);
        const { data, error } = await supabase
          .from("clients")
          .select(`id, first_name, last_name, tier, ghl_contact_id, lifecycle_stage, lead_score, tags, updated_at, mirror_source, ${CLIENT_CONTACT_METHODS_EMBED}`)
          .gt("updated_at", p.since)
          .or("mirror_source.is.null,mirror_source.neq.mma_os")
          .order("updated_at", { ascending: true })
          .limit(p.limit);
        if (error) throw error;
        // Each contact's PRIMARY email and phone, read from its contact methods (an address change
        // moves the contact's updated_at, so it is picked up here too).
        const clients = (data ?? []).map((row: { client_contact_methods?: unknown }) => withPrimaryAddresses(row));
        return ok(verb, { count: clients.length, clients });
      }

      // -----------------------------------------------------------------
      case "set_assignment_policy": {
        const p = SetAssignmentPolicySchema.parse(payload);
        let userIds = [...(p.eligible_user_ids ?? [])];
        if (p.eligible_user_emails?.length) {
          const { data: list } = await supabase.auth.admin.listUsers();
          const wanted = new Set(p.eligible_user_emails.map((e) => e.toLowerCase()));
          for (const u of list?.users ?? []) {
            if (u.email && wanted.has(u.email.toLowerCase()) && !userIds.includes(u.id)) {
              userIds.push(u.id);
            }
          }
        }
        const target_role = p.target_role ??
          (["premium", "vip", "internal"].includes(p.tier) ? "cs_primary" : "lead_owner");

        const { data, error } = await supabase
          .from("paige_assignment_policy")
          .upsert(
            {
              tier: p.tier,
              strategy: p.strategy,
              target_role,
              eligible_user_ids: userIds,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "tier" },
          )
          .select("*")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      case "get_assignment_policy": {
        const p = GetAssignmentPolicySchema.parse(payload);
        let q = supabase.from("paige_assignment_policy").select("*").order("tier");
        if (p.tier) q = q.eq("tier", p.tier);
        const { data, error } = await q;
        if (error) throw error;
        return ok(verb, data ?? []);
      }

      // -----------------------------------------------------------------
      case "claim_client_for_user": {
        const p = ClaimClientForUserSchema.parse(payload);

        // Resolve client_id
        let clientId = p.client_id ?? null;
        if (!clientId && p.client_email) {
          clientId = (await findFirstClientByEmailAnyWorkspace(supabase, p.client_email, "paige-bridge"))?.id ?? null;
        }
        if (!clientId) return fail(verb, 404, "client_not_found");

        // Resolve user_id
        const { data: list } = await supabase.auth.admin.listUsers();
        const u = list?.users?.find(
          (x) => (x.email ?? "").toLowerCase() === p.user_email.toLowerCase(),
        );
        if (!u?.id) return fail(verb, 404, "user_not_found");

        const { data, error } = await supabase
          .from("paige_coach_assignments")
          .upsert(
            {
              contact_id: clientId,
              assigned_role: p.assigned_role,
              rep_user_id: u.id,
              active: true,
              metadata: { source: "bridge_admin_assign" },
            },
            { onConflict: "contact_id,assigned_role" } as any,
          )
          .select("*")
          .single();
        if (error) throw error;
        return ok(verb, data);
      }

      // -----------------------------------------------------------------
      default:
        return fail(verb, 400, `Unknown verb: ${verb}`);
    }
  } catch (err) {
    const msg = err instanceof z.ZodError ? "validation_error" : (err as Error).message ?? "unknown_error";
    const details = err instanceof z.ZodError ? err.flatten() : undefined;
    console.error(JSON.stringify({ verb, ok: false, error: msg, duration_ms: Date.now() - started }));
    return fail(verb, err instanceof z.ZodError ? 400 : 500, msg, details);
  } finally {
    console.log(JSON.stringify({ verb, duration_ms: Date.now() - started }));
  }
});
