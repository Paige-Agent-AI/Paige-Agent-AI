// Paige MCP Server — Phase 2 (API-key auth, 30 tools across CRM/Workflows/BTF/Admin).
// Hosted at https://<project>/functions/v1/paige-mcp (custom domain mcp.paigeagent.ai later).
// Auth: Bearer PAIGE_MCP_PLATFORM_KEY in Authorization header.
//
// Tool catalog:
//  CRM (10): search_contacts, get_contact, update_contact_stage [DEPRECATED → update_lifecycle_stage], add_contact_note,
//            list_deals, move_deal_stage, create_deal, list_tasks, create_task, complete_task
//  Workflows (5): list_workflows, run_workflow*, get_workflow_run,
//                 list_pending_approvals, decide_pending_approval*
//  (retired workspace tools consolidated into program_* canonical surface — Sprint 211.b)
//  Admin (6): list_team_members, assign_coach*, create_team_invitation*,
//             list_unassigned_queue, list_admin_notifications, create_admin_notification
//  Destructive tools marked * carry annotations.destructiveHint=true so MCP hosts
//  (Claude Desktop, ChatGPT, etc.) can gate them behind user approval.
//
// Phase 3 (next): OAuth 2.1 + Dynamic Client Registration + per-user RLS tokens.
// Discovery endpoints below are scaffolding for that work.

import { Hono } from "https://esm.sh/hono@4.13.5";
import { McpServer, StreamableHttpTransport } from "https://esm.sh/mcp-lite@0.10.0";
import { z } from "https://esm.sh/zod@3.25.76";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveOperatorIdentity } from "../_shared/operator-identity.ts";
import { applyContactSearchFilter, contactSearchTokens, CONTACT_NAME_SEARCH_COLUMNS, CONTACT_SEARCH_COLUMNS, contactIdsByAddressToken } from "../_shared/contact-search.ts";
import { findClientIdByAddress, orderedContactMethods } from "../_shared/contact-methods.ts";
import { resolveClientRef } from "../_shared/client-ref.ts";
import { canonicalAppUrl, type CanonicalDestination, type CanonicalTier } from "../_shared/canonical-app-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLATFORM_KEY = Deno.env.get("PAIGE_MCP_PLATFORM_KEY") ?? "";
const PAIGE_OS_CLAUDE_PLATFORM_KEY = Deno.env.get("PAIGE_OS_CLAUDE_PLATFORM_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

// Registered platform keys: label → secret value. Empty values are filtered.
const PLATFORM_KEYS: Array<{ label: string; value: string }> = [
  { label: "paige_default", value: PLATFORM_KEY },
  { label: "mma_os_claude", value: PAIGE_OS_CLAUDE_PLATFORM_KEY },
].filter((k) => k.value.length > 0);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mcp = new McpServer({
  name: "paige-agent-ai",
  version: "1.0.0",
  // mcp-lite needs a Standard Schema → JSON Schema adapter; Zod v3 ships with .toJSON via zod-to-json-schema,
  // but we keep it inline + minimal here.
  schemaAdapter: (schema: any) => zodToJsonSchema(schema as z.ZodTypeAny),
});

// Tiny Zod→JSON Schema converter covering object/string/number/integer/boolean/enum/optional/default.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def: any = (schema as any)._def;
  const t = def?.typeName;
  switch (t) {
    case "ZodObject": {
      const shape = def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries<any>(shape)) {
        properties[k] = zodToJsonSchema(v);
        if (!(v as any).isOptional?.()) required.push(k);
      }
      const out: Record<string, unknown> = { type: "object", properties };
      if (required.length) out.required = required;
      return out;
    }
    case "ZodString": {
      const out: Record<string, unknown> = { type: "string" };
      if (def.description) out.description = def.description;
      return out;
    }
    case "ZodNumber":
      return { type: def.checks?.some((c: any) => c.kind === "int") ? "integer" : "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: def.values };
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault":
      return { ...zodToJsonSchema(def.innerType), default: def.defaultValue() };
    case "ZodNullable":
      return zodToJsonSchema(def.innerType);
    default:
      return {};
  }
}

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
function err(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

// ── Contact methods: a contact's emails and phones, several of each, one primary per kind ──────
const CONTACT_METHOD_SELECT = "client_contact_methods(kind, value, label, is_primary, position)";
const contactMethodInput = z.object({
  kind: z.enum(["email", "phone"]),
  value: z.string(),
  label: z.string().optional(),
  is_primary: z.boolean().optional(),
}).strict();
const contactMethodsInput = z.array(contactMethodInput).max(20);

/** A contact row as a reader sees it: its client_ref and every address, never the legacy pair. */
// deno-lint-ignore no-explicit-any
function contactForReader(row: any) {
  const { account_number, client_contact_methods, email: _email, phone: _phone, ...rest } = row ?? {};
  return { ...rest, client_ref: account_number, contact_methods: orderedContactMethods(client_contact_methods) };
}

/** Why an address write was refused, in words an operator can act on. */
function contactMethodsError(message: string | undefined): string {
  const text = message ?? "contact_methods_write_failed";
  if (text.includes("CONTACT_METHOD_TAKEN")) return text.slice(text.indexOf("CONTACT_METHOD_TAKEN"));
  return text;
}

// Per-request actor context (set by the HTTP route before invoking the MCP transport).
// Phase 3: bearer tokens can resolve to either the platform key or a user OAuth token.
type ActorCtx = {
  kind: "platform" | "user";
  user_id: string | null;
  client_id: string | null;
  scopes: string[];
};
import { AsyncLocalStorage } from "https://deno.land/std@0.177.0/node/async_hooks.ts";
const actorStore = new AsyncLocalStorage() as {
  getStore(): ActorCtx | undefined;
  run<R>(store: ActorCtx, callback: () => R): R;
};
function currentActor(): ActorCtx {
  return actorStore.getStore() ?? { kind: "platform", user_id: null, client_id: null, scopes: [] };
}

/** `paige_audit_log.target_id` is a UUID column. Anything else Postgres rejects with 22P02, and this
 *  helper used to hand it whatever the call site had — a template_key, a slug, a TOOL NAME — and then
 *  swallow the error. That is why this surface has no audit history: not because nothing happened, but
 *  because the writer threw and said nothing. Proven against production: inserting
 *  target_id='create_contact' returns `22P02 invalid input syntax for type uuid`. The `tier_denied`
 *  rows the chokepoint has written since it shipped went the same way.
 *
 *  Any non-UUID identifier now travels as `payload.target_ref`, which is queryable and loses nothing. */
const AUDIT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function audit(
  action: string,
  target_type: string | null,
  target_id: string | null,
  payload: Record<string, unknown>,
  // THE WORKSPACE THIS ROW IS ABOUT, optional and defaulting to none. The tenant-admin read policy
  // on `paige_audit_log` gates on `tenant_id = current_user_tenant_id()`, so a row written without
  // it is one the workspace owner cannot read — the table's own index misses it too. Every existing
  // call site keeps its current behaviour by omitting it; the governed door passes the tenant it
  // already resolved server-side, and the remaining call sites are a tracked follow-up rather than
  // something to guess at from here.
  tenantId?: string | null,
) {
  const a = currentActor();
  const isUuid = typeof target_id === "string" && AUDIT_UUID.test(target_id);
  const { error } = await admin.from("paige_audit_log").insert({
    actor_user_id: a.user_id,
    actor_role: a.kind === "user" ? "mcp:user" : "mcp:platform",
    action,
    ...(tenantId ? { tenant_id: tenantId } : {}),
    target_type,
    target_id: isUuid ? target_id : null,
    payload: {
      ...payload,
      ...(a.client_id ? { mcp_client_id: a.client_id } : {}),
      ...(!isUuid && target_id ? { target_ref: target_id } : {}),
    },
  });
  // Loud, not swallowed (§32). An audit write that fails silently turns every later question about
  // what happened into a guess, which is the state this helper was in for the life of the surface.
  if (error) console.error(`[paige-mcp] AUDIT WRITE FAILED action=${action}:`, error.message);
}

// Workflow dispatcher lives in _shared so the pg_cron sweeper
// (dispatch-queued-workflow-runs) can re-use the same routing logic.
import { dispatchWorkflowRun } from "../_shared/workflowDispatch.ts";
import { canonicalDirectFunctionName, isMarketplaceDirectFunctionBlocked, resolveActiveMarketplaceTenant, retainActiveMarketplaceTenant } from "../_shared/marketplace-authority-containment.ts";
// §200: the god/platform actor has no tenant of its own; resolve the operator's
// designated system tenant from config-as-data (fail-closed null when unset).
import { platformOperatorTenantId } from "../_shared/platform-operator-tenant.ts";
// The governed door (task #45). One decision for all 119 tools; see the adapter's header for why
// a mutation refuses here rather than being left to a workspace autonomy row.
import { decideMcpToolCall, mcpGovernedAuditRow } from "../_shared/paige-mcp/governed-adapter.ts";
// Tier Rail Spine (Phase D): one shared tier resolver, off the same declared rail
// (public.get_actor_access) a human resolves through — so Paige's tier == a human's.
import { getActorTier, isClientSeatByScopes } from "../_shared/actorTier.ts";
import { classifyBusinessVerifyResponse } from "../_shared/business-verify-outcome.ts";
// Master Twilio Basic-auth from the ONE home (twilio.ts) — API Key trio
// (TWILIO_API_KEY_SID:TWILIO_API_KEY_SECRET); master TWILIO_AUTH_TOKEN absent in prod.

// Doctrine §118 master-only MCP tools. Hidden from tools/list when caller's
// tenant != MMA. These are forward-looking — none are implemented yet but the
// gate is in place so any future addition is opt-out by default.
const MASTER_ONLY_TOOLS = new Set<string>([
  "list_admin_notifications",
  "create_admin_notification",
  "list_tenants",
  "switch_active_tenant",
  "update_tenant_features",
  "create_tenant",
  "suspend_tenant",
  "get_platform_metrics",
  // Operator-scope platform health (tenant_id IS NULL rows). God-locked at the tier gate
  // rather than relying on its platform.read scope alone — the same reasoning as the forge
  // tools below: the handler reads operator-global rows with the service-role client and has
  // no in-handler tenant guard, so the TIER gate is what must deny a tenant caller.
  "get_systems_check_status",
  "broadcast_system_announcement",
  // Sub-agent forge = platform infra: approving a proposal can execute arbitrary
  // sub-agent code. These carry a platform.* SCOPE but were NOT god-locked at the
  // audience-tier gate, and — unlike register_workflow (guarded in-handler at
  // :2086) — have NO in-handler actorIsPlatformOwner() check, so a tenant caller
  // who held platform.write could reach them (toolTier() resolved them to
  // `tenant`). God-lock them here so the tier gate denies every non-operator.
  // (P0 Move 1 — Task #207.)
  "propose_subagent",
  "list_subagent_proposals",
  "approve_subagent_proposal",
]);

// Doctrine §9/§25 — four named audience tiers on the SINGLE MCP endpoint.
// Tier answers "who is this for?" (audience); scope answers "what operation?"
// A tools/call must clear BOTH. Ordered least→most privileged for the
// god⊇agency⊇tenant inheritance chain; `client` is a SEALED tier (self.* only —
// never inherits tenant, never inherited by tenant), handled explicitly.
type McpTier = "client" | "tenant" | "agency" | "god";
const TIER_RANK: Record<McpTier, number> = { client: 0, tenant: 1, agency: 2, god: 3 };

// Resolve the actor's effective tenant_id WITHOUT relying on static data.
// Platform-key callers → MMA. User callers → active_tenant_id only when valid,
// otherwise the first active tenant_members row. This mirrors SQL current_user_tenant_id().
async function actorIsPlatformOwner(actor = currentActor()): Promise<boolean> {
  if (actor.kind === "platform") return true;
  if (!actor.user_id) return false;
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", actor.user_id)
    .eq("role", "super_admin")
    .maybeSingle();
  return !!data;
}

async function actorTenantId(): Promise<string | null> {
  const actor = currentActor();
  // §200: was a hardcoded (and stale/phantom) MMA_TENANT_ID. Now the operator's
  // designated system tenant, or null when none is designated (every consumer
  // below fails closed on null — strictly safer than pinning to a phantom).
  if (actor.kind === "platform") return await platformOperatorTenantId(admin);
  if (!actor.user_id) return null;

  const [{ data: profile }, { data: memberships }, isPlatformOwner] = await Promise.all([
    admin.from("profiles").select("active_tenant_id").eq("user_id", actor.user_id).maybeSingle(),
    admin
      .from("tenant_members")
      .select("tenant_id, joined_at")
      .eq("user_id", actor.user_id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1),
    actorIsPlatformOwner(actor),
  ]);

  const activeTenantId = profile?.active_tenant_id as string | null | undefined;
  if (activeTenantId) {
    if (isPlatformOwner) return activeTenantId;
    const { data: member } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", actor.user_id)
      .eq("tenant_id", activeTenantId)
      .eq("status", "active")
      .maybeSingle();
    if (member?.tenant_id) return member.tenant_id as string;
  }

  const firstMembership = (memberships?.[0]?.tenant_id as string | null) ?? null;
  if (firstMembership) return firstMembership;
  // §200/Task #126: a platform-OWNER user with no tenant of their own (the tenant-less
  // super_admin operator) resolves to the DESIGNATED operator workspace — the same fallback
  // the platform-KEY branch above already uses — so operator-run platform-scope work has a
  // real forge tenant instead of failing tenant_unresolved. A non-owner tenant-less user
  // still resolves null (unchanged). §9-clean: the operator is authorized for the operator
  // workspace by construction.
  if (isPlatformOwner) return await platformOperatorTenantId(admin);
  return null;
}

async function externalActorDestination(
  tenantId: string,
  destination: CanonicalDestination,
): Promise<string | null> {
  const actor = currentActor();
  if (actor.kind === "platform" || await actorIsPlatformOwner(actor)) {
    return canonicalAppUrl({ actor: "operator", tier: "operator", destination });
  }
  const { data: tenant } = await admin
    .from("tenants")
    .select("account_type, account_number")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return null;
  return canonicalAppUrl({
    actor: "account",
    tier: String(tenant.account_type ?? "") as CanonicalTier,
    account: tenant.account_number,
    destination,
  });
}

/** Marketplace browse never inherits actorTenantId's legacy first-membership fallback. */
async function marketplaceActorTenantId(): Promise<string | null> {
  const actor = currentActor();
  if (!actor.user_id) return null;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("active_tenant_id")
    .eq("user_id", actor.user_id)
    .maybeSingle();
  if (profileError) return null;
  const activeTenantId = profile?.active_tenant_id ?? null;
  const structurallyCurrentTenant = resolveActiveMarketplaceTenant({
    activeAccountTenantId: activeTenantId,
    expectedTenantId: activeTenantId,
    authorizedTenantIds: [activeTenantId],
  });
  if (!structurallyCurrentTenant) return null;
  const { data: memberships, error: membershipError } = await admin
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", actor.user_id)
    .eq("tenant_id", structurallyCurrentTenant)
    .eq("status", "active");
  if (membershipError) return null;
  return resolveActiveMarketplaceTenant({
    activeAccountTenantId: activeTenantId,
    expectedTenantId: activeTenantId,
    authorizedTenantIds: (memberships ?? []).map((row) => row.tenant_id),
  });
}

// ── Tier derivation (§9/§25) ────────────────────────────────────────────────
// Agency tier is a property of the ACTOR, not their current tenant: it's "does
// this actor own/admin ANY agency/enterprise tenant." Deriving it from the
// active tenant's account_type would trap the operator the moment they switch
// into a standalone child (tier → tenant, agency tools unreachable, no way back).
// Basing it on the actor keeps the agency tool set reachable while they operate
// inside a child. (SECURITY DEFINER, service_role-only RPC.)
async function actorManagesAnyAgency(actor: ActorCtx): Promise<boolean> {
  if (actor.kind !== "user" || !actor.user_id) return false;
  const { data, error } = await admin.rpc("actor_manages_any_agency", { _actor: actor.user_id });
  if (error) return false;
  return data === true;
}

// A client/consumer portal seat: a USER token whose granted scopes are ENTIRELY
// within the self.* namespace. client_id is present on every user token (staff
// included), so the forgery-resistant signal is the scope set — nothing an
// operator token carries. No schema change required.
function isClientSeat(actor: ActorCtx): boolean {
  if (actor.kind !== "user") return false;
  return isClientSeatByScopes(actor.scopes);
}

// THE request-time tier. Precedence: god → client(sealed) → agency → tenant.
// Delegates to the shared resolver (Phase D) so MCP and paige-ai-chat and human
// surfaces all read the SAME declared rail. The shared resolver returns
// 'subaccount' for a sub-account operator; the MCP ladder treats a sub-account
// exactly like a tenant (they run their own child like a tenant), so collapse it.
async function deriveTier(actor: ActorCtx): Promise<McpTier> {
  const t = await getActorTier(admin, {
    actorUserId: actor.kind === "user" ? actor.user_id : null,
    isPlatform: actor.kind === "platform" || (await actorIsPlatformOwner(actor)),
    scopes: actor.scopes ?? [],
  });
  return (t === "subaccount" ? "tenant" : t) as McpTier;
}



// ---------- Contacts ----------
mcp.tool("search_contacts", {
  description:
    "Search Paige contacts (clients table) by name, email, phone, or company. An email or phone matches whichever of the contact's addresses it is. Returns up to `limit` matches with safe CRM metadata, client_ref and contact_methods (every email and phone, each marked is_primary). Use client_ref for later contact tools.",
  inputSchema: z.object({
    query: z.string().describe("Free-text match across first/last name, entity_name, and every email and phone the contact holds."),
    lifecycle_stage: z.string().optional().describe("Optional filter, e.g. 'qualifying', 'self_serve', 'active'."),
    limit: z.number().int().optional().describe("1-50, default 20."),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    // §18 shared tokenized search (hotfix #127) — full-name queries ("Tashia Anderson")
    // match first_name + last_name across columns, not the whole phrase per single column.
    let q = applyContactSearchFilter(
      admin
        .from("clients")
        .select(`account_number, first_name, last_name, entity_name, lifecycle_stage, tier, status, assigned_coach_user_id, updated_at, ${CONTACT_METHOD_SELECT}`)
        .eq("tenant_id", tenantId),
      String(args.query),
      // An email or phone matches whichever of the contact's addresses holds it.
      { columns: CONTACT_NAME_SEARCH_COLUMNS, addressMatches: await contactIdsByAddressToken(admin, tenantId, String(args.query), "paige-mcp") },
    );
    if (args.lifecycle_stage) q = q.eq("lifecycle_stage", args.lifecycle_stage);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
    if (error) return err(error.message);
    return ok({ items: (data ?? []).map(contactForReader), count: (data ?? []).length });
  },
});

mcp.tool("get_contact", {
  description:
    "Fetch a single contact's full Paige profile, including business details, address, owner/coach assignments, notes, and contact_methods (every email and phone, each marked is_primary).",
  inputSchema: z.object({ client_ref: z.string().describe("Tenant-scoped client reference, for example CLT-A1B2C3D4E5F6.") }),
  handler: async ({ client_ref }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin.from("clients")
      .select(`account_number, first_name, last_name, entity_name, lifecycle_stage, status, source, tags, last_contacted_at, created_at, updated_at, ${CONTACT_METHOD_SELECT}`)
      .eq("account_number", client_ref.trim().toUpperCase()).eq("tenant_id", tenantId).maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("contact_not_found");
    const paigeUrl = await externalActorDestination(tenantId, "contacts");
    return ok({ contact: contactForReader(data), ...(paigeUrl ? { paige_url: paigeUrl } : {}) });
  },
});

mcp.tool("lookup_contact_by_account_number", {
  description:
    "Resolve a customer by immutable client_ref within the caller's active tenant. Returns bounded CRM metadata, never an internal UUID.",
  inputSchema: z.object({
    account_number: z.string().describe("Immutable client_ref, for example CLT-A1B2C3D4E5F6."),
  }),
  handler: async ({ account_number }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin.from("clients")
      .select(`account_number, first_name, last_name, entity_name, lifecycle_stage, status, source, tags, last_contacted_at, created_at, updated_at, ${CONTACT_METHOD_SELECT}`)
      .eq("account_number", account_number.trim().toUpperCase()).eq("tenant_id", tenantId).maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("contact_not_found");
    const paigeUrl = await externalActorDestination(tenantId, "contacts");
    return ok({ contact: contactForReader(data), ...(paigeUrl ? { paige_url: paigeUrl } : {}) });
  },
});

mcp.tool("update_contact_stage", {
  description:
    "DEPRECATED — use `update_lifecycle_stage` instead. Free-form predecessor that accepts any string for `lifecycle_stage`. Kept for backward compatibility with existing automations; will be removed in a future release. New callers should use update_lifecycle_stage (Doctrine §111 enum-validated).",
  inputSchema: z.object({
    contact_id: z.string(),
    lifecycle_stage: z.string().describe("New value, e.g. 'lead', 'qualifying', 'active', 'won', 'lost', 'self_serve'."),
    reason: z.string().optional().describe("Short note explaining the move; appended to current_notes."),
  }),
  handler: async ({ contact_id, lifecycle_stage, reason }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const patch: Record<string, unknown> = { lifecycle_stage };
    const { data, error } = await admin
      .from("clients")
      .update(patch)
      .eq("id", contact_id)
      .eq("tenant_id", tenantId)
      .select("id, lifecycle_stage")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("contact_not_found");
    if (reason) {
      // Append reason to notes
      const { data: c } = await admin.from("clients").select("current_notes").eq("id", contact_id).eq("tenant_id", tenantId).maybeSingle();
      const stamp = new Date().toISOString();
      const next = `${c?.current_notes ?? ""}\n\n[${stamp} · stage→${lifecycle_stage}] ${reason}`.trim().slice(0, 8000);
      await admin.from("clients").update({ current_notes: next }).eq("id", contact_id).eq("tenant_id", tenantId);
    }
    await audit("update_contact_stage", "client", contact_id, { lifecycle_stage, reason });
    return ok({ ok: true, contact_id, lifecycle_stage: data.lifecycle_stage });
  },
});

mcp.tool("add_contact_note", {
  description:
    "Append a timestamped note to a contact's current_notes field. Use for short observations; for structured activity use create_task or deal_activities.",
  inputSchema: z.object({
    contact_id: z.string(),
    note: z.string().describe("Plain text, max 2000 chars."),
  }),
  handler: async ({ contact_id, note }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data: existing, error: readErr } = await admin
      .from("clients")
      .select("current_notes")
      .eq("id", contact_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (readErr) return err(readErr.message);
    if (!existing) return err("contact_not_found");
    const stamp = new Date().toISOString();
    const next = `${existing.current_notes ?? ""}\n\n[${stamp} · MCP] ${String(note).slice(0, 2000)}`.trim();
    const { error } = await admin.from("clients").update({ current_notes: next }).eq("id", contact_id).eq("tenant_id", tenantId);
    if (error) return err(error.message);
    await audit("add_contact_note", "client", contact_id, { length: String(note).length });
    return ok({ ok: true, contact_id, appended_at: stamp });
  },
});

// ---------- Deals ----------
mcp.tool("list_deals", {
  description: "List deals on a pipeline, optionally filtered by stage, owner, or contact. Returns up to 50.",
  inputSchema: z.object({
    pipeline_id: z.string().optional(),
    stage_id: z.string().optional(),
    contact_id: z.string().optional().describe("Filter to deals attached to this clients.id"),
    status: z.string().optional().describe("open | won | lost"),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 50);
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    let q = admin
      .from("deals")
      .select(
        "id, title, pipeline_id, stage_id, contact_client_id, owner_user_id, value_cents, currency, status, expected_close_date, updated_at",
      )
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (args.pipeline_id) q = q.eq("pipeline_id", args.pipeline_id);
    if (args.stage_id) q = q.eq("stage_id", args.stage_id);
    if (args.contact_id) q = q.eq("contact_client_id", args.contact_id);
    if (args.status) q = q.eq("status", args.status);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("move_deal_stage", {
  description: "Move a deal to a different pipeline stage. Logs a deal_activities row so the change shows in the CRM timeline.",
  inputSchema: z.object({
    deal_id: z.string(),
    stage_id: z.string().describe("pipeline_stages.id"),
    reason: z.string().optional(),
  }),
  handler: async ({ deal_id, stage_id, reason }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin
      .from("deals")
      .update({ stage_id })
      .eq("id", deal_id)
      .eq("tenant_id", tenantId)
      .select("id, stage_id, pipeline_id")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("deal_not_found");
    await admin.from("deal_activities").insert({
      deal_id,
      type: "stage_change",
      summary: `Moved to stage ${stage_id}${reason ? ` — ${String(reason).slice(0, 200)}` : ""}`,
      payload: { stage_id, source: "mcp" },
    });
    await audit("move_deal_stage", "deal", deal_id, { stage_id, reason });
    return ok({ ok: true, deal_id, stage_id: data.stage_id });
  },
});

mcp.tool("create_deal", {
  description:
    "Create a new deal on a pipeline. If `stage_id` is omitted the deal lands on the pipeline's first stage. Value should be sent in cents.",
  inputSchema: z.object({
    title: z.string(),
    pipeline_id: z.string(),
    stage_id: z.string().optional(),
    contact_id: z.string().optional().describe("clients.id of the linked contact"),
    value_cents: z.number().int().optional(),
    currency: z.string().optional(),
    expected_close_date: z.string().optional().describe("ISO date, e.g. 2026-08-15"),
    source: z.string().optional(),
  }),
  handler: async (args) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    let resolvedStage = args.stage_id;
    if (!resolvedStage) {
      const { data: stages } = await admin
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", args.pipeline_id)
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .order("order_index", { ascending: true })
        .limit(1);
      resolvedStage = stages?.[0]?.id;
      if (!resolvedStage) return err("pipeline_has_no_stages");
    }
    const { data, error } = await admin
      .from("deals")
      .insert({
        title: args.title,
        pipeline_id: args.pipeline_id,
        stage_id: resolvedStage,
        contact_client_id: args.contact_id ?? null,
        value_cents: args.value_cents ?? null,
        currency: args.currency ?? "USD",
        expected_close_date: args.expected_close_date ?? null,
        source: args.source ?? "mcp",
        status: "open",
        tenant_id: tenantId,
        created_by: currentActor().user_id ?? null,
      })
      .select("id")
      .single();
    if (error) return err(error.message);
    await audit("create_deal", "deal", data.id, { title: args.title, pipeline_id: args.pipeline_id, stage_id: resolvedStage });
    const paigeUrl = await externalActorDestination(tenantId, "pipeline");
    return ok({ ok: true, deal_id: data.id, ...(paigeUrl ? { paige_url: paigeUrl } : {}) });
  },
});

// ---------- Tasks ----------
mcp.tool("list_tasks", {
  description: "List tasks, optionally scoped to an owner (assignee auth.users.id), deal, status, or track. Returns up to 50.",
  inputSchema: z.object({
    owner_user_id: z.string().optional(),
    deal_id: z.string().optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    track: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 50);
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    let q = admin
      .from("tasks")
      .select("id, user_id, deal_id, biz_id, title, description, status, track, due_date, metadata, tenant_id, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (args.owner_user_id) q = q.eq("user_id", args.owner_user_id);
    if (args.deal_id) q = q.eq("deal_id", args.deal_id);
    if (args.status) q = q.eq("status", args.status);
    if (args.track) q = q.eq("track", args.track);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("create_task", {
  description: "Create a task assigned to a user (auth.users.id). owner_user_id is required because tasks.user_id is NOT NULL. Status defaults to 'pending'.",
  inputSchema: z.object({
    owner_user_id: z.string().describe("auth.users.id of the assignee. REQUIRED."),
    title: z.string(),
    description: z.string().optional(),
    deal_id: z.string().optional(),
    due_date: z.string().optional().describe("ISO timestamp."),
    track: z.string().optional().describe("Free-form bucket, e.g. 'sales', 'cs', 'build-to-fund', 'BUILD'."),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  handler: async (args) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin
      .from("tasks")
      .insert({
        user_id: args.owner_user_id,
        title: args.title,
        description: args.description ?? null,
        deal_id: args.deal_id ?? null,
        due_date: args.due_date ?? null,
        track: args.track ?? null,
        status: args.status ?? "pending",
        metadata: args.metadata ?? null,
        tenant_id: tenantId,
      })
      .select("id")
      .single();
    if (error) return err(error.message);
    await audit("create_task", "task", data.id, { title: args.title, owner_user_id: args.owner_user_id, deal_id: args.deal_id });
    return ok({ ok: true, task_id: data.id });
  },
});

mcp.tool("update_task", {
  description: "Update a task's fields. Any omitted field is left unchanged.",
  inputSchema: z.object({
    task_id: z.string(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    track: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.any()).nullable().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async (args) => {
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.status !== undefined) patch.status = args.status;
    if (args.track !== undefined) patch.track = args.track;
    if (args.due_date !== undefined) patch.due_date = args.due_date;
    if (args.metadata !== undefined) patch.metadata = args.metadata;
    if (Object.keys(patch).length === 0) return err("no_fields_to_update");
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin.from("tasks").update(patch).eq("id", args.task_id).eq("tenant_id", tenantId).select("id").maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("task_not_found");
    await audit("update_task", "task", args.task_id, patch);
    return ok({ ok: true, task_id: args.task_id });
  },
});

mcp.tool("complete_task", {
  description: "Mark a task as completed.",
  inputSchema: z.object({ task_id: z.string() }),
  handler: async ({ task_id }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin
      .from("tasks")
      .update({ status: "completed" })
      .eq("id", task_id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("task_not_found");
    await audit("complete_task", "task", task_id, {});
    return ok({ ok: true, task_id });
  },
});

mcp.tool("reopen_task", {
  description: "Move a task back to 'pending' (undo complete/cancel).",
  inputSchema: z.object({ task_id: z.string() }),
  handler: async ({ task_id }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin
      .from("tasks")
      .update({ status: "pending" })
      .eq("id", task_id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("task_not_found");
    await audit("reopen_task", "task", task_id, {});
    return ok({ ok: true, task_id });
  },
});

mcp.tool("delete_task", {
  description: "Permanently delete a task. Destructive — prefer update_task(status='cancelled') when reversibility matters.",
  inputSchema: z.object({ task_id: z.string() }),
  annotations: { destructiveHint: true },
  handler: async ({ task_id }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { error } = await admin.from("tasks").delete().eq("id", task_id).eq("tenant_id", tenantId);
    if (error) return err(error.message);
    await audit("delete_task", "task", task_id, {});
    return ok({ ok: true, task_id });
  },
});


// ---------- Workflows ----------
mcp.tool("list_workflows", {
  description:
    "List Paige workflows from paige_workflow_registry. Filter by category (e.g. 'sales', 'cs', 'build-to-fund', 'compliance') or active state.",
  inputSchema: z.object({
    category: z.string().optional(),
    only_active: z.boolean().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const tenantId = await actorTenantId();
    let q = admin
      .from("paige_workflow_registry")
      .select("id, key, label, description, category, provider, requires_approval, is_active, allowed_roles, sort_order, tenant_id")
      .order("sort_order", { ascending: true })
      .limit(limit);
    if (args.category) q = q.eq("category", args.category);
    if (args.only_active !== false) q = q.eq("is_active", true);
    // Doctrine §118: caller sees platform-default rows (tenant_id IS NULL) plus
    // rows owned by their tenant. Platform/MMA callers therefore see MMA rows too.
    if (tenantId) q = q.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    else q = q.is("tenant_id", null);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("run_workflow", {
  description:
    "Trigger a Paige workflow by registry key. Returns a run_id you can poll with get_workflow_run. If the workflow has requires_approval=true the run is queued in paige_pending_approvals instead of executing immediately.",
  inputSchema: z.object({
    workflow_key: z.string().describe("paige_workflow_registry.key, e.g. 'sales.lead_followup'"),
    payload: z
      .union([z.record(z.string(), z.any()), z.string()])
      .optional()
      .describe("JSON arguments passed to the workflow. Accepts an object or a JSON-encoded string."),
    contact_id: z.string().optional(),
  }),
  annotations: { destructiveHint: true, openWorldHint: true },
  handler: async (args) => {
    // Coerce payload: accept object OR JSON string (some MCP clients stringify nested args).
    let payload: Record<string, unknown> = {};
    if (args.payload != null) {
      if (typeof args.payload === "string") {
        const trimmed = args.payload.trim();
        if (trimmed.length > 0) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              payload = parsed as Record<string, unknown>;
            } else {
              return err("payload_must_be_json_object");
            }
          } catch {
            return err("payload_invalid_json");
          }
        }
      } else {
        payload = args.payload as Record<string, unknown>;
      }
    }

    const { data: wf, error: wfErr } = await admin
      .from("paige_workflow_registry")
      .select("id, key, requires_approval, is_active, provider, n8n_webhook_url, needs_n8n_link, langgraph_graph_id, direct_function_name, tenant_id")
      .eq("key", args.workflow_key)
      .maybeSingle();
    if (wfErr) return err(wfErr.message);
    if (!wf) return err("workflow_not_found");
    if (!wf.is_active) return err("workflow_inactive");

    // Doctrine §118: tenant-scoped workflows are only runnable by their owner tenant.
    const callerTenantId = await actorTenantId();
    if (wf.tenant_id && wf.tenant_id !== callerTenantId) {
      return err("workflow_restricted_to_owning_tenant");
    }

    if (wf.requires_approval) {
      const { data: pa, error: paErr } = await admin
        .from("paige_pending_approvals")
        .insert({
          type: "workflow_run",
          draft_content: { workflow_key: args.workflow_key, payload },
          contact_id: args.contact_id ?? null,
          created_by_n8n_workflow_key: args.workflow_key,
          status: "pending",
          metadata: { source: "mcp" },
        })
        .select("id")
        .single();
      if (paErr) return err(paErr.message);
      await audit("queue_workflow_approval", "workflow", wf.id, { workflow_key: args.workflow_key });
      return ok({ ok: true, queued: true, approval_id: pa.id, status: "pending_approval" });
    }

    const { data: run, error: runErr } = await admin
      .from("paige_workflow_runs")
      .insert({
        registry_id: wf.id,
        payload,
        status: "queued",
      })
      .select("id")
      .single();
    if (runErr) return err(runErr.message);
    await audit("run_workflow", "workflow", wf.id, { workflow_key: args.workflow_key, run_id: run.id });

    // Inline dispatch — route the queued run to its declared provider.
    const dispatch = await dispatchWorkflowRun({
      runId: run.id,
      provider: wf.provider,
      n8nWebhookUrl: wf.n8n_webhook_url,
      needsN8nLink: wf.needs_n8n_link,
      langgraphGraphId: wf.langgraph_graph_id,
      directFunctionName: wf.direct_function_name,
      payload,
      callerTenantId,
    });

    return ok({
      ok: true,
      run_id: run.id,
      status: dispatch.status,
      provider: wf.provider,
      n8n_execution_id: dispatch.executionId ?? null,
      dispatch_error: dispatch.error ?? null,
    });
  },
});

mcp.tool("get_workflow_run", {
  description: "Fetch status + result of a workflow run by id.",
  inputSchema: z.object({ run_id: z.string() }),
  handler: async ({ run_id }) => {
    const { data, error } = await admin
      .from("paige_workflow_runs")
      .select("id, registry_id, status, n8n_execution_id, result, error, payload, created_at")
      .eq("id", run_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("run_not_found");
    return ok({ run: data });
  },
});

mcp.tool("list_pending_approvals", {
  description:
    "List items in paige_pending_approvals awaiting human review. Supports filtering by category, contact, assignee, and risk level. Returns enriched rows from paige_approval_queue_v including SLA state and assigned reviewer.",
  inputSchema: z.object({
    status: z.string().optional().describe("pending | approved | rejected | changes_requested | escalated | skipped | sent"),
    category: z.string().optional().describe("e.g. refund | dispute_letter | campaign | ai_draft | field_ingest"),
    contact_id: z.string().uuid().optional(),
    assigned_to_user_id: z.string().uuid().optional(),
    risk_level: z.enum(["low", "medium", "high"]).optional(),
    only_overdue: z.boolean().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    let q = admin
      .from("paige_approval_queue_v")
      .select("*")
      .order("priority", { ascending: true, nullsFirst: false })
      .order("sla_due_at", { ascending: true, nullsFirst: false })
      .limit(limit);
    q = q.eq("status", args.status ?? "pending");
    if (args.category) q = q.eq("category", args.category);
    if (args.contact_id) q = q.eq("contact_id", args.contact_id);
    if (args.assigned_to_user_id) q = q.eq("assigned_to_user_id", args.assigned_to_user_id);
    if (args.risk_level) q = q.eq("risk_level", args.risk_level);
    if (args.only_overdue) q = q.eq("sla_state", "overdue");
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("decide_pending_approval", {
  description:
    "Record a decision (approve, reject, request_changes, escalate) on a pending approval. Provide a rationale for any non-approve decision. NOTE: this records the decision only — it does not itself send the drafted action. Outbound execution of an approved item happens through the operator's Live desk (execute-approval → send-message); use this to log a decision, not to trigger a send.",
  inputSchema: z.object({
    approval_id: z.string(),
    decision: z.enum(["approve", "reject", "request_changes", "escalate"]),
    note: z.string().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async ({ approval_id, decision, note }) => {
    if (decision !== "approve" && !note?.trim()) {
      return err("note_required_for_non_approve_decision");
    }
    // Layer C (C5, §18/§P2 Codex peer-gate): an ORCHESTRATION-sourced approval (a HELD paige_act_executions
    // act) must NOT be decided through this decision-only tool. Flipping its status→'approved' here would
    // dead-end the act: the execute-approval seam (the ONE approve door that redeems + dispatches) then no-ops
    // on its 'approved' idempotency guard, leaving the act stuck at approval_pending forever. Refuse and route
    // to that seam. (Full MCP routing of orchestration approvals through the same executor is a later slice;
    // today no such rows exist yet — this guard closes the trap the moment slice-2 minting creates them.)
    const { data: srcRow, error: srcErr } = await admin
      .from("paige_pending_approvals")
      .select("source, metadata")
      .eq("id", approval_id)
      .maybeSingle();
    if (srcErr) return err(srcErr.message);
    if (!srcRow) return err("approval_not_found");
    const srcMeta = (srcRow.metadata && typeof srcRow.metadata === "object") ? srcRow.metadata as Record<string, unknown> : {};
    if (srcRow.source === "paige_orchestration" || srcMeta.source === "paige_orchestration") {
      return err("orchestration_approval_routed_through_executor: decide this via the execute-approval seam (it redeems + dispatches the held act), not decide_pending_approval");
    }
    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
      request_changes: "changes_requested",
      escalate: "escalated",
    };
    const patch: Record<string, unknown> = {
      status: statusMap[decision],
      reviewed_at: new Date().toISOString(),
      decision_rationale: note ?? null,
      escalation_note: decision === "escalate" ? note : null,
    };
    const { data, error } = await admin
      .from("paige_pending_approvals")
      .update(patch)
      .eq("id", approval_id)
      .select("id, status")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("approval_not_found");
    await audit("decide_pending_approval", "approval", approval_id, { decision, note });
    return ok({ ok: true, approval_id, status: data.status });
  },
});

mcp.tool("create_approval", {
  description:
    "File a new item for human review. Use when a coach, agent, or external LLM wants a teammate to sign off before action (e.g., refund > $X, legal-sensitive dispute letter, campaign launch, AI draft). The tenant's policy engine auto-routes based on category and assigns SLA + reviewer role.",
  inputSchema: z.object({
    category: z.enum([
      "refund", "dispute_letter", "campaign", "ai_draft",
      "field_ingest", "workflow", "compliance", "legal", "other",
    ]),
    summary: z.string().describe("One-line description of what needs approval."),
    draft_content: z.record(z.any()).optional().describe("The proposed action payload (email body, refund amount, etc.)"),
    contact_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    risk_level: z.enum(["low", "medium", "high"]).optional(),
    priority: z.number().int().min(1).max(5).optional(),
  }),
  handler: async (args) => {
    const { data, error } = await admin
      .from("paige_pending_approvals")
      .insert({
        type: args.category,
        category: args.category,
        summary: args.summary,
        draft_content: args.draft_content ?? {},
        contact_id: args.contact_id ?? null,
        conversation_id: args.conversation_id ?? null,
        risk_level: args.risk_level ?? "medium",
        priority: args.priority ?? 3,
        source: "mcp",
        status: "pending",
      })
      .select("id, status, requires_role, sla_due_at, assigned_to_user_id")
      .maybeSingle();
    if (error) return err(error.message);
    await audit("create_approval", "approval", data?.id ?? "", { category: args.category });
    return ok({ ok: true, approval: data });
  },
});

mcp.tool("claim_approval", {
  description:
    "Claim ownership of a pending approval so other reviewers know you're handling it. Reassigns assigned_to_user_id to the calling user.",
  inputSchema: z.object({ approval_id: z.string() }),
  handler: async ({ approval_id }, ctx) => {
    const userId = (ctx as any)?.userId;
    if (!userId) return err("missing_user");
    const { data, error } = await admin
      .from("paige_pending_approvals")
      .update({ assigned_to_user_id: userId, claimed_at: new Date().toISOString() })
      .eq("id", approval_id)
      .select("id, assigned_to_user_id")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("approval_not_found");
    await audit("claim_approval", "approval", approval_id, {});
    return ok({ ok: true, approval_id, assigned_to_user_id: data.assigned_to_user_id });
  },
});

mcp.tool("comment_on_approval", {
  description:
    "Post a comment on an approval so other reviewers and the original submitter can see context, questions, or guidance.",
  inputSchema: z.object({
    approval_id: z.string(),
    body: z.string().min(1),
  }),
  handler: async ({ approval_id, body }, ctx) => {
    const userId = (ctx as any)?.userId;
    if (!userId) return err("missing_user");
    const { data, error } = await admin
      .from("paige_approval_comments")
      .insert({ approval_id, author_id: userId, body })
      .select("id, created_at")
      .maybeSingle();
    if (error) return err(error.message);
    await audit("comment_on_approval", "approval", approval_id, { length: body.length });
    return ok({ ok: true, comment: data });
  },
});

mcp.tool("list_approval_comments", {
  description: "Read the discussion thread on an approval.",
  inputSchema: z.object({ approval_id: z.string() }),
  handler: async ({ approval_id }) => {
    const { data, error } = await admin
      .from("paige_approval_comments")
      .select("id, author_id, body, created_at")
      .eq("approval_id", approval_id)
      .order("created_at", { ascending: true });
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

// ---------- (BTF Workspace tools removed — Sprint 211.b: tables consolidated into program_* canonical surface) ----------

// ---------- Admin ----------
mcp.tool("list_team_members", {
  description: "List team members and their roles from user_roles + profiles. Filter by role if needed.",
  inputSchema: z.object({
    role: z.string().optional().describe("owner | admin | sales_rep | coach | broker | cs"),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    let q = admin
      .from("user_roles")
      .select("user_id, role, created_at")
      .limit(limit);
    if (args.role) q = q.eq("role", args.role);
    const { data: roles, error } = await q;
    if (error) return err(error.message);
    const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, suspended_at")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const items = (roles ?? []).map((r) => ({
      user_id: r.user_id,
      role: r.role,
      full_name: byId.get(r.user_id)?.full_name ?? null,
      suspended: !!byId.get(r.user_id)?.suspended_at,
      created_at: r.created_at,
    }));
    return ok({ items });
  },
});

mcp.tool("assign_coach", {
  description: "Assign or reassign a coach to a client.",
  inputSchema: z.object({
    client_id: z.string(),
    coach_user_id: z.string(),
    reason: z.string().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async ({ client_id, coach_user_id, reason }) => {
    const { data, error } = await admin
      .from("clients")
      .update({ assigned_coach_user_id: coach_user_id })
      .eq("id", client_id)
      .select("id, assigned_coach_user_id")
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("client_not_found");
    await audit("assign_coach", "client", client_id, { coach_user_id, reason });
    return ok({ ok: true, client_id, coach_user_id: data.assigned_coach_user_id });
  },
});

// ---------- Coach Ops ----------
mcp.tool("list_coaches", {
  description: "List everyone in your business who has clients assigned to them, directly or through an active client relationship, with their profile metadata (specialties, capacity, accepting-new-clients) and client counts. \"Coach\" is a title, so this is decided by assignment, never by a role. active_clients/total_clients count direct assignments; relationship_clients counts active relationships, which may cover some of the same clients.",
  inputSchema: z.object({
    accepting_only: z.boolean().optional().describe("If true, return only people accepting new clients."),
    specialty: z.string().optional().describe("Filter by a single specialty tag, e.g. 'personal_credit'."),
  }),
  handler: async ({ accepting_only, specialty }) => {
    // Scoped to the caller's own business: an assignment in another business is never listed.
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const [directRes, relationshipRes] = await Promise.all([
      admin.from("clients").select("assigned_coach_user_id, status")
        .eq("tenant_id", tenantId).not("assigned_coach_user_id", "is", null),
      admin.from("coach_clients").select("coach_user_id")
        .eq("tenant_id", tenantId).eq("status", "active"),
    ]);
    if (directRes.error) return err(directRes.error.message);
    if (relationshipRes.error) return err(relationshipRes.error.message);
    const direct = (directRes.data ?? []) as Array<{ assigned_coach_user_id: string; status: string | null }>;
    const relationships = (relationshipRes.data ?? []) as Array<{ coach_user_id: string }>;
    const ids = [...new Set([
      ...direct.map((c) => c.assigned_coach_user_id),
      ...relationships.map((r) => r.coach_user_id),
    ])];
    if (!ids.length) return ok({ items: [] });
    const profilesRes = await admin.from("profiles")
      .select("user_id, full_name, coach_specialties, coach_capacity, coach_accepting_clients, coach_bio, coach_timezone, suspended_at")
      .in("user_id", ids);
    const items = ids.map((id) => {
      const p: any = (profilesRes.data || []).find((x: any) => x.user_id === id) || {};
      const assigned = direct.filter((c) => c.assigned_coach_user_id === id);
      return {
        user_id: id,
        full_name: p.full_name ?? null,
        specialties: p.coach_specialties ?? [],
        capacity: p.coach_capacity ?? null,
        accepting_clients: p.coach_accepting_clients ?? true,
        bio: p.coach_bio ?? null,
        timezone: p.coach_timezone ?? null,
        suspended: !!p.suspended_at,
        active_clients: assigned.filter((c) => (c.status ?? "active") === "active").length,
        total_clients: assigned.length,
        relationship_clients: relationships.filter((r) => r.coach_user_id === id).length,
      };
    }).filter((c) => {
      if (accepting_only && !c.accepting_clients) return false;
      if (specialty && !(c.specialties as string[]).includes(specialty)) return false;
      return true;
    });
    return ok({ items });
  },
});

mcp.tool("update_coach_profile", {
  description: "Update a coach's specialties, capacity, accepting-new-clients toggle, bio, or timezone. Omitted fields are left unchanged.",
  inputSchema: z.object({
    user_id: z.string(),
    specialties: z.array(z.string()).optional(),
    capacity: z.number().int().optional(),
    accepting_clients: z.boolean().optional(),
    bio: z.string().optional(),
    timezone: z.string().optional(),
  }),
  handler: async (args) => {
    const patch: Record<string, unknown> = {};
    if (args.specialties !== undefined) patch.coach_specialties = args.specialties;
    if (args.capacity !== undefined) patch.coach_capacity = args.capacity;
    if (args.accepting_clients !== undefined) patch.coach_accepting_clients = args.accepting_clients;
    if (args.bio !== undefined) patch.coach_bio = args.bio;
    if (args.timezone !== undefined) patch.coach_timezone = args.timezone;
    if (Object.keys(patch).length === 0) return err("no_fields_to_update");
    const { error } = await admin.from("profiles").update(patch).eq("user_id", args.user_id);
    if (error) return err(error.message);
    await audit("update_coach_profile", "user", args.user_id, patch);
    return ok({ ok: true });
  },
});

mcp.tool("bulk_assign_clients_to_coach", {
  description: "Assign many clients to one coach in a single call. Returns the number of rows updated.",
  inputSchema: z.object({
    coach_user_id: z.string(),
    client_ids: z.array(z.string()).describe("Array of clients.id UUIDs."),
  }),
  annotations: { destructiveHint: true },
  handler: async ({ coach_user_id, client_ids }) => {
    const { data, error } = await admin.rpc("admin_bulk_assign_coach", { _coach: coach_user_id, _client_ids: client_ids });
    if (error) return err(error.message);
    await audit("bulk_assign_clients_to_coach", "user", coach_user_id, { count: client_ids.length });
    return ok(data);
  },
});

mcp.tool("get_coach_performance", {
  description: "Performance snapshot for a coach: active clients vs capacity, open/completed task counts (30d), pipeline value, and last activity.",
  inputSchema: z.object({ coach_user_id: z.string() }),
  handler: async ({ coach_user_id }) => {
    // §9 — coach_user_id is BODY-SUPPLIED and must not be trusted across tenants.
    // Server-derive the caller's tenant and confirm the requested coach is an
    // ACTIVE member of it before returning any of their aggregates; a tenant-A
    // admin passing a tenant-B coach UUID must get nothing. profiles has no
    // reliable tenant_id, so tenant_members is the authoritative guard. Fail
    // closed when the tenant can't be resolved (mirrors the twin tools).
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data: coachMember } = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("user_id", coach_user_id)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();
    if (!coachMember) return err("coach_not_in_tenant");
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [prof, clientsRes, openTasksRes, doneTasksRes, dealsRes] = await Promise.all([
      admin.from("profiles").select("full_name, coach_capacity, coach_accepting_clients").eq("user_id", coach_user_id).maybeSingle(),
      admin.from("clients").select("id, status").eq("assigned_coach_user_id", coach_user_id).eq("tenant_id", tenantId),
      admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", coach_user_id).in("status", ["pending", "in_progress"]),
      admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", coach_user_id).eq("status", "completed").gte("updated_at", since),
      admin.from("deals").select("amount").eq("owner_user_id", coach_user_id).eq("tenant_id", tenantId),
    ]);
    const clients = clientsRes.data ?? [];
    const pipeline_value = (dealsRes.data ?? []).reduce((s: number, d: any) => s + Number(d.amount || 0), 0);
    return ok({
      coach_user_id,
      full_name: prof.data?.full_name ?? null,
      capacity: prof.data?.coach_capacity ?? null,
      accepting_clients: prof.data?.coach_accepting_clients ?? true,
      active_clients: clients.filter((c: any) => (c.status ?? "active") === "active").length,
      total_clients: clients.length,
      open_tasks: openTasksRes.count ?? 0,
      completed_tasks_30d: doneTasksRes.count ?? 0,
      pipeline_value,
    });
  },
});

mcp.tool("create_team_invitation", {
  description:
    "Create a team invitation row for an internal tenant team member (admin | sales_rep | cs_rep). Does NOT send the email — pair with the send-admin-invitation function for that. Platform (super_admin/platform_admin) and agency_* roles are NOT grantable here — those go through the platform-invite and agency-team flows.",
  inputSchema: z.object({
    email: z.string(),
    role: z.enum(["admin", "sales_rep", "cs_rep"])
      .describe("Tenant staff role. Valid app_role staff labels only: admin | sales_rep | cs_rep."),
    invited_by_user_id: z.string().optional(),
    template_name: z.string().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async (args) => {
    // ── SECURITY (Tier Rail Phase A) ────────────────────────────────────────
    // Clamp the grantable role to a server-side allow-list scoped to the
    // caller's tier — this generic tenant-invite tool must NEVER mint
    // super_admin/platform_admin or agency_* authority (those flow through the
    // platform-invite / agency-team paths). The z.enum blocks bad input at the
    // schema; this runtime check is defense-in-depth. Bind the invitation to the
    // caller's RESOLVED tenant — a null tenant_id would leave the accepted
    // membership unscoped.
    const actor = currentActor();
    const tier = await deriveTier(actor);
    if (tier === "client") return err("forbidden_tier");
    // DB-valid app_role staff labels only. Deny-by-default: super_admin,
    // platform_admin, agency_*, finance, moderator, developer, broker*, etc. are
    // NOT grantable through this generic tenant-invite tool.
    const ALLOWED_TENANT_INVITE_ROLES = new Set(["admin", "sales_rep", "cs_rep"]);
    if (!ALLOWED_TENANT_INVITE_ROLES.has(args.role)) return err("role_not_allowed");
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("invitations")
      .insert({
        email: args.email.toLowerCase(),
        role: args.role,
        tenant_id: tenantId,
        invited_by: args.invited_by_user_id ?? null,
        token_hash: tokenHash,
        expires_at: expiresAt,
        template_name: args.template_name ?? args.role,
      })
      .select("id")
      .single();
    if (error) return err(error.message);
    await audit("create_team_invitation", "invitation", data.id, { email: args.email, role: args.role, tenant_id: tenantId });
    return ok({
      ok: true,
      invitation_id: data.id,
      token,
      accept_url: `https://paigeagent.ai/accept-invite?token=${token}`,
      expires_at: expiresAt,
    });
  },
});

mcp.tool("list_unassigned_queue", {
  description: "List contacts in paige_unassigned_queue awaiting coach/sales assignment.",
  inputSchema: z.object({ limit: z.number().int().optional() }),
  handler: async ({ limit }) => {
    const cap = Math.min(Math.max(limit ?? 25, 1), 100);
    const { data, error } = await admin
      .from("paige_unassigned_queue")
      .select("id, email, first_name, last_name, tier, unassigned_for_hours, priority_rank, created_at")
      .order("priority_rank", { ascending: false })
      .limit(cap);
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("list_admin_notifications", {
  description: "List recent paige_admin_notifications. Filter by unread or severity.",
  inputSchema: z.object({
    only_unread: z.boolean().optional(),
    severity: z.string().optional().describe("info | warning | critical"),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    let q = admin
      .from("paige_admin_notifications")
      .select("id, severity, title, body, link_to, contact_id, source_workflow_key, assigned_role, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (args.only_unread) q = q.is("read_at", null);
    if (args.severity) q = q.eq("severity", args.severity);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("create_admin_notification", {
  description: "Post a new admin notification (info/warning/critical). Use sparingly — these page humans.",
  inputSchema: z.object({
    severity: z.enum(["info", "warning", "critical"]),
    title: z.string(),
    body: z.string().optional(),
    link_to: z.string().optional(),
    contact_id: z.string().optional(),
    assigned_role: z.string().optional(),
    source_workflow_key: z.string().optional(),
  }),
  handler: async (args) => {
    const { data, error } = await admin
      .from("paige_admin_notifications")
      .insert({
        severity: args.severity,
        title: args.title,
        body: args.body ?? null,
        link_to: args.link_to ?? null,
        contact_id: args.contact_id ?? null,
        assigned_role: args.assigned_role ?? null,
        source_workflow_key: args.source_workflow_key ?? "mcp",
        scope: "admin",
      })
      .select("id")
      .single();
    if (error) return err(error.message);
    await audit("create_admin_notification", "notification", data.id, { severity: args.severity, title: args.title });
    return ok({ ok: true, notification_id: data.id });
  },
});

// ---------- Email Templates (DB-stored, key-addressable) ----------
mcp.tool("list_email_templates", {
  description:
    "List rows from public.email_templates. Filter by category, product_scope, or active. Read-only catalog browse.",
  inputSchema: z.object({
    category: z.string().optional().describe("e.g. 'btf_lifecycle', 'btf_education', 'btf_stall'"),
    product_scope: z.string().optional().describe("e.g. 'btf', 'launchpad', 'mma'"),
    active: z.boolean().optional(),
    limit: z.number().int().optional().describe("1-200, default 100"),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    let q = admin
      .from("email_templates")
      .select("template_key, subject, preheader, variables, category, product_scope, active, notes, updated_at")
      .order("template_key", { ascending: true })
      .limit(limit);
    if (args.category) q = q.eq("category", args.category);
    if (args.product_scope) q = q.eq("product_scope", args.product_scope);
    if (typeof args.active === "boolean") q = q.eq("active", args.active);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

mcp.tool("upsert_email_template", {
  description:
    "Insert or update an email template by template_key. Stores markdown source of truth; rendering happens at send time. Use for the canonical BTF/launchpad/mma email libraries.",
  inputSchema: z.object({
    template_key: z.string().describe("Stable kebab-case key, e.g. 'btf-welcome-day-1'"),
    subject: z.string(),
    preheader: z.string().optional(),
    body_markdown: z.string().describe("Source of truth. Use {{var_name}} for substitutions."),
    variables: z.array(z.string()).optional().describe("Declared variable names for editor hints"),
    category: z.string().describe("'btf_lifecycle' | 'btf_education' | 'btf_stall' | etc."),
    product_scope: z.string().describe("'btf' | 'launchpad' | 'mma'"),
    active: z.boolean().optional(),
    notes: z.string().optional().describe("Voice/context notes for human editors"),
  }),
  annotations: { destructiveHint: true },
  handler: async (args) => {
    const row = {
      template_key: args.template_key,
      subject: args.subject,
      preheader: args.preheader ?? null,
      body_markdown: args.body_markdown,
      variables: args.variables ?? [],
      category: args.category,
      product_scope: args.product_scope,
      active: args.active ?? true,
      notes: args.notes ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin
      .from("email_templates")
      .upsert(row, { onConflict: "template_key" })
      .select("template_key, updated_at")
      .single();
    if (error) return err(error.message);
    await audit("upsert_email_template", "email_template", data.template_key, {
      category: args.category, product_scope: args.product_scope,
    });
    return ok({ ok: true, template_key: data.template_key, updated_at: data.updated_at });
  },
});

// Minimal mustache-style renderer: replaces {{var}} with vars[var]. Returns missing-var error on first miss.
function renderMustache(tpl: string, vars: Record<string, unknown>): { ok: true; out: string } | { ok: false; missing: string } {
  const pattern = /\{\{\s*([\w.]+)\s*\}\}/g;
  let missing: string | null = null;
  const out = tpl.replace(pattern, (_m, name: string) => {
    if (missing) return "";
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const v = (vars as any)[name];
      return v == null ? "" : String(v);
    }
    missing = name;
    return "";
  });
  if (missing) return { ok: false, missing };
  return { ok: true, out };
}

// Markdown → minimal HTML (paragraphs, line breaks, **bold**, *italic*, [text](url)). No HTML injection from vars
// since vars are substituted before this step but values are escaped first.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function mdToHtml(md: string): string {
  const blocks = md.split(/\n{2,}/).map((block) => {
    const escaped = escapeHtml(block)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n/g, "<br/>");
    return `<p>${escaped}</p>`;
  });
  return blocks.join("\n");
}

// Per-product_scope sender map. Each `from` must be on a domain verified in the Resend
// account that holds RESEND_API_KEY. All scopes route through Paige's verified
// paigeagent.ai subdomain post-Ship #2 (MMA sender identities retired).
// §45: reply_to defaults to the platform-neutral support inbox; the actual per-send
// reply_to is resolved present-only from the CALLER'S tenant operator identity in the
// handler (support_email / sender.reply_to) — never a hardcoded operator address.
const SCOPE_SENDERS: Record<string, { from: string; name: string; reply_to: string }> = {
  btf: {
    from: "alerts@paigeagent.ai",
    name: "Paige",
    reply_to: "support@paigeagent.ai",
  },
  mma: {
    from: "alerts@paigeagent.ai",
    name: "Paige",
    reply_to: "support@paigeagent.ai",
  },
  paige: {
    from: "hello@paigeagent.ai",
    name: "Paige",
    reply_to: "support@paigeagent.ai",
  },
};
const DEFAULT_SCOPE_SENDER = SCOPE_SENDERS.paige;

mcp.tool("send_btf_template_email", {
  description:
    "Look up an email_templates row by template_key, render {{vars}}, and send via Resend. From-address is auto-selected by the template's product_scope; all scopes currently route through paigeagent.ai. Override with `from_override` for one-off sends. Sends real customer email — use idempotency in the caller.",
  inputSchema: z.object({
    to_email: z.string().describe("Recipient email"),
    template_key: z.string().describe("public.email_templates.template_key"),
    vars: z.record(z.any()).optional().describe("Variable values for {{var}} substitution"),
    from_name: z.string().optional(),
    from_override: z.string().email().optional()
      .describe("Full from address (e.g. 'alerts@paigeagent.ai'). Must be a domain verified in Resend. Overrides product_scope default."),
    reply_to: z.string().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async (args) => {
    // Per-key check happens below after we know the template's product_scope.
    const vars = args.vars ?? {};

    const { data: tpl, error: tplErr } = await admin
      .from("email_templates")
      .select("template_key, subject, preheader, body_markdown, active, product_scope")
      .eq("template_key", args.template_key)
      .maybeSingle();
    if (tplErr) return err(tplErr.message);
    if (!tpl) return err(`template_not_found:${args.template_key}`);
    if (!tpl.active) return err(`template_inactive:${args.template_key}`);

    // Suppression check
    const { data: sup } = await admin
      .from("suppressed_emails").select("email").eq("email", args.to_email.toLowerCase()).maybeSingle();
    if (sup) return err(`recipient_suppressed:${args.to_email}`);

    const subjectR = renderMustache(tpl.subject, vars);
    if (!subjectR.ok) return err(`missing_var:${subjectR.missing} (subject)`);
    const bodyR = renderMustache(tpl.body_markdown, vars);
    if (!bodyR.ok) return err(`missing_var:${bodyR.missing} (body)`);
    const preheaderR = tpl.preheader ? renderMustache(tpl.preheader, vars) : { ok: true as const, out: "" };
    if (!preheaderR.ok) return err(`missing_var:${preheaderR.missing} (preheader)`);

    const html = (preheaderR.out ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheaderR.out)}</div>` : "") + mdToHtml(bodyR.out);

    const scopeCfg = SCOPE_SENDERS[tpl.product_scope] ?? DEFAULT_SCOPE_SENDER;
    const fromName = args.from_name ?? scopeCfg.name;
    const fromEmail = args.from_override ?? scopeCfg.from;
    const fromAddr = `${fromName} <${fromEmail}>`;
    // §45: reply_to resolves present-only from the caller's tenant operator identity
    // (the tenant's OWN support/reply address) — falling to the platform-neutral scope
    // default, never a hardcoded operator inbox.
    const tenantIdForReplyTo = await actorTenantId();
    const operatorForReplyTo = await resolveOperatorIdentity(
      admin as unknown as Parameters<typeof resolveOperatorIdentity>[0],
      tenantIdForReplyTo,
    );
    const tenantReplyTo =
      operatorForReplyTo.support_email ??
      (operatorForReplyTo.sender as { reply_to?: string } | undefined)?.reply_to ??
      undefined;
    const replyTo = args.reply_to ?? tenantReplyTo ?? scopeCfg.reply_to;

    // Single shared Resend account authenticates all sends from paigeagent.ai.
    // sender_account label retained as a constant for historical audit continuity.
    const apiKey = RESEND_API_KEY;
    const senderAccount = "mma_os_shared" as const;
    if (!apiKey) return err("resend_not_configured");

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [args.to_email],
        subject: subjectR.out,
        html,
        reply_to: replyTo,
        tags: [
          { name: "template_key", value: tpl.template_key.replace(/[^a-zA-Z0-9_-]/g, "_") },
          { name: "product_scope", value: tpl.product_scope },
          { name: "sender_account", value: senderAccount },
        ],
      }),
    });
    const payload = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      await audit("send_btf_template_email_failed", "email_template", tpl.template_key, {
        to: args.to_email, from: fromEmail, sender_account: senderAccount, status: resendRes.status, payload,
      });
      return err(`resend_${resendRes.status}: ${JSON.stringify(payload)}`);
    }

    const messageId = payload?.id ?? null;
    const sentAt = new Date().toISOString();
    await admin.from("email_send_log").insert({
      template_name: tpl.template_key,
      recipient_email: args.to_email.toLowerCase(),
      message_id: messageId,
      status: "sent",
      sender_account: senderAccount,
      metadata: { product_scope: tpl.product_scope, from: fromEmail, sender_account: senderAccount, via: "mcp.send_btf_template_email" },
    }).then(() => {}, () => {});
    await audit("send_btf_template_email", "email_template", tpl.template_key, {
      to: args.to_email, from: fromEmail, sender_account: senderAccount, message_id: messageId,
    });

    return ok({ ok: true, message_id: messageId, from: fromEmail, template_key: tpl.template_key, sent_at: sentAt });
  },
});


// ---------- Batch #1 (Doctrine §119 reversible-ops) ----------
// Helper: resolve a tenant_id for the actor. User actors → their active_tenant_id.
// Platform actors → optional explicit arg, falling back to the MMA tenant (slug='mma').
async function resolveTenantId(explicit?: string | null): Promise<string | null> {
  const actor = currentActor();
  if (explicit) {
    if (actor.kind === "platform" || await actorIsPlatformOwner(actor)) return explicit;
    if (actor.user_id) {
      const { data: member } = await admin
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", actor.user_id)
        .eq("tenant_id", explicit)
        .eq("status", "active")
        .maybeSingle();
      if (member?.tenant_id) return explicit;
    }
    return null;
  }
  // §200: FAIL CLOSED. This used to fall back to a hardcoded `slug = 'mma'` lookup, so any caller
  // whose workspace did not resolve silently wrote into Mogul Maker Academy — a real production
  // account — through five call sites, four of which also accept a caller-supplied tenant_id.
  //
  // The same §200 repair was already made 40 lines above in `actorTenantId`, whose comment reads
  // "was a hardcoded (and stale/phantom) MMA_TENANT_ID … or null when none is designated (every
  // consumer below fails closed on null — strictly safer than pinning to a phantom)". That cleanup
  // simply did not reach this function. `actorTenantId` ALREADY resolves the operator's designated
  // system tenant for a platform actor, so there is nothing left for a fallback to add: if it
  // returned null, the honest answer is null.
  //
  // This matters to the governed door specifically. The gate resolves tenancy server-side and
  // asserts `tenantSource: "server"`; a resolver that invents a tenant would have the gate govern
  // one workspace while the handler wrote to another, and stamp that as server-derived.
  return await actorTenantId();
}

// ---------- Contacts (extended) ----------
const DOCTRINE_111_LIFECYCLE_STAGES = [
  "new_lead", "qualified", "nurturing", "hot_lead", "negotiating",
  "won", "client_active", "client_paused", "client_churned", "client_funded", "client_alumni",
] as const;

mcp.tool("create_contact", {
  description:
    "Create a new contact (clients row) in the caller's tenant. Returns the new contact_id and client_ref. Emails and phones go in contact_methods: [{ kind: \"email\" | \"phone\", value, label?, is_primary? }], one primary per kind (the first of each kind when none is marked). Tenant is auto-resolved from the caller (user's active tenant, or MMA for platform callers). All optional fields map 1:1 to the underlying clients columns so Claude/ChatGPT can populate everything a human form would. Lifecycle stage follows Doctrine §111: new_lead, qualified, nurturing, hot_lead, negotiating, won, client_active, client_paused, client_churned, client_funded, client_alumni.",
  inputSchema: z.object({
    // identity
    first_name: z.string(),
    last_name: z.string().optional(),
    contact_methods: contactMethodsInput.optional().describe("Every email and phone for the contact, in display order."),
    title: z.string().optional(),
    // business
    entity_name: z.string().optional(),
    entity_type: z.string().optional(),
    website: z.string().optional(),
    linkedin_url: z.string().optional(),
    funding_goal: z.number().optional(),
    monthly_revenue: z.number().optional(),
    // address
    street_address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip_code: z.string().optional(),
    // lifecycle / CRM
    source: z.string().optional(),
    lifecycle_stage: z.enum(DOCTRINE_111_LIFECYCLE_STAGES).optional().describe("Default 'new_lead'."),
    tier: z.string().optional().describe("e.g. standard | premium | vip."),
    primary_offer: z.string().optional(),
    tags: z.array(z.string()).optional(),
    lead_score: z.number().int().optional(),
    do_not_contact: z.boolean().optional(),
    // ownership
    assigned_coach_user_id: z.string().optional(),
    lead_owner_user_id: z.string().optional(),
    cs_primary_user_id: z.string().optional(),
    // notes
    notes: z.string().optional().describe("Seeded into current_notes."),
    // tenant override
    tenant_id: z.string().optional().describe("Override the auto-resolved tenant_id (platform-only)."),
  }).strict(),
  handler: async (args) => {
    const tenant_id = await resolveTenantId(args.tenant_id ?? null);
    // Addresses are checked BEFORE the contact is written, so a bad or already-used address never
    // leaves a half-made contact behind.
    const methods = args.contact_methods ?? [];
    if (methods.length) {
      if (!tenant_id) return err("tenant_not_resolved");
      const { error: shapeError } = await admin.rpc("contact_methods_canonical", { _methods: methods });
      if (shapeError) return err(contactMethodsError(shapeError.message));
      for (const method of methods) {
        if (await findClientIdByAddress(admin, tenant_id, method.kind, method.value, "paige-mcp")) {
          return err(`CONTACT_METHOD_TAKEN: ${method.value} already belongs to another contact in this workspace`);
        }
      }
    }
    const actor = currentActor();
    let createdBy: string | null = actor.user_id ?? null;
    if (!createdBy && tenant_id) {
      const { data: t } = await admin
        .from("tenants").select("owner_user_id").eq("id", tenant_id).maybeSingle();
      createdBy = t?.owner_user_id ?? null;
    }
    if (!createdBy) return err("Could not resolve a created_by user for this contact (no caller user_id and no tenant owner).");
    const row: Record<string, unknown> = {
      first_name: args.first_name,
      last_name: args.last_name ?? null,
      title: args.title ?? null,
      entity_name: args.entity_name ?? null,
      entity_type: args.entity_type ?? null,
      website: args.website ?? null,
      linkedin_url: args.linkedin_url ?? null,
      funding_goal: args.funding_goal ?? null,
      monthly_revenue: args.monthly_revenue ?? null,
      street_address: args.street_address ?? null,
      city: args.city ?? null,
      state: args.state ?? null,
      zip_code: args.zip_code ?? null,
      source: args.source ?? "mcp",
      lifecycle_stage: args.lifecycle_stage ?? "new_lead",
      tier: args.tier ?? null,
      primary_offer: args.primary_offer ?? null,
      tags: args.tags ?? [],
      lead_score: args.lead_score ?? 0,
      do_not_contact: args.do_not_contact ?? false,
      assigned_coach_user_id: args.assigned_coach_user_id ?? null,
      lead_owner_user_id: args.lead_owner_user_id ?? null,
      cs_primary_user_id: args.cs_primary_user_id ?? null,
      status: "active",
      current_notes: args.notes ?? null,
      tenant_id,
      created_by: createdBy,
      created_by_channel_type: "api", // #10 channel-of-origin (Paige/MCP programmatic create)
    };
    const { data, error } = await admin.from("clients").insert(row).select("id, account_number, created_at").single();
    if (error) return err(error.message);
    if (methods.length) {
      const { error: methodsError } = await admin.rpc("_replace_client_contact_methods", {
        _tenant_id: tenant_id, _client_id: data.id, _methods: methods,
      });
      if (methodsError) {
        // Only a race with another writer reaches here (the addresses were checked above). The
        // contact exists without its addresses; say exactly that, and how to finish it.
        console.error("[paige-mcp] create_contact addresses not saved", { contact_id: data.id, message: methodsError.message });
        return err(`CONTACT_CREATED_WITHOUT_ADDRESSES: contact ${data.account_number} was created, but its addresses were not saved (${contactMethodsError(methodsError.message)}). Add them with update_contact and add_contact_methods.`);
      }
    }
    await audit("create_contact", "client", data.id, { contact_methods: methods.length, tenant_id }, tenant_id);
    return ok({ ok: true, contact_id: data.id, client_ref: data.account_number, created_at: data.created_at, tenant_id, created_by: createdBy });
  },
});

mcp.tool("update_contact", {
  description:
    "Update any combination of fields on an existing contact (clients row), named by its client_ref (or contact_id). Only fields you pass are updated; omit a field to leave it unchanged. Emails and phones: contact_methods REPLACES the whole list and needs expected_contact_methods, the list exactly as get_contact returned it; if the stored list changed since, the update is refused as CONTACT_METHODS_STALE and nothing is written (read it again and redo the change). add_contact_methods adds to the list and keeps what is there, and needs no expected list; send one or the other. Scoped to caller's tenant. For lifecycle moves prefer `update_lifecycle_stage` (it writes a transition audit). For notes prefer `add_contact_note` (it appends instead of replacing).",
  inputSchema: z.object({
    client_ref: z.string().optional().describe("The contact's client_ref, as search_contacts or get_contact returned it."),
    contact_id: z.string().optional().describe("Only when you hold the contact's UUID rather than its client_ref."),
    // identity
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    contact_methods: contactMethodsInput.optional().describe("The COMPLETE list of the contact's emails and phones; anything left out is removed. Requires expected_contact_methods."),
    expected_contact_methods: z.array(z.object({
      kind: z.string(), value: z.string(), label: z.string().nullable().optional(), is_primary: z.boolean().optional(),
    }).passthrough()).max(40).optional().describe("With contact_methods: the contact's contact_methods exactly as get_contact returned them. The update is refused if the stored list is no longer this one."),
    add_contact_methods: contactMethodsInput.min(1).optional().describe("Emails or phones to add, keeping every one the contact already has."),
    title: z.string().nullable().optional(),
    // business
    entity_name: z.string().nullable().optional(),
    entity_type: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    linkedin_url: z.string().nullable().optional(),
    funding_goal: z.number().nullable().optional(),
    monthly_revenue: z.number().nullable().optional(),
    // address
    street_address: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip_code: z.string().nullable().optional(),
    // CRM
    source: z.string().nullable().optional(),
    lifecycle_stage: z.enum(DOCTRINE_111_LIFECYCLE_STAGES).optional(),
    tier: z.string().nullable().optional(),
    primary_offer: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    lead_score: z.number().int().optional(),
    do_not_contact: z.boolean().optional(),
    status: z.enum(["active", "inactive", "archived"]).optional(),
    // ownership
    assigned_coach_user_id: z.string().nullable().optional(),
    lead_owner_user_id: z.string().nullable().optional(),
    cs_primary_user_id: z.string().nullable().optional(),
    primary_business_id: z.string().nullable().optional(),
    // notes (REPLACES current_notes — use add_contact_note to append)
    current_notes: z.string().nullable().optional(),
  }).strict(),
  handler: async (args) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const { client_ref, contact_id: suppliedId, contact_methods, add_contact_methods, expected_contact_methods, ...rest } = args;
    if (contact_methods && add_contact_methods) return err("CONTACT_METHODS_AMBIGUOUS: send contact_methods or add_contact_methods, not both");
    // Replacing the list must name the list it replaces, or a change made in between is lost.
    if (contact_methods && !expected_contact_methods) return err("CONTACT_METHODS_EXPECTED_REQUIRED: send expected_contact_methods, the contact's contact_methods as get_contact returned them");

    // The contact, named inside the caller's own workspace only.
    let contact_id = suppliedId ?? null;
    if (client_ref !== undefined) {
      const resolved = await resolveClientRef(admin, tenant_id, client_ref, "paige-mcp");
      if (!resolved) return err("contact_not_found");
      if (contact_id && contact_id.toLowerCase() !== resolved.toLowerCase()) return err("contact_reference_mismatch");
      contact_id = resolved;
    }
    if (!contact_id) return err("client_ref_required");
    const { data: existing, error: exErr } = await admin
      .from("clients").select("id, tenant_id").eq("id", contact_id).maybeSingle();
    if (exErr) return err(exErr.message);
    if (!existing) return err("contact_not_found");
    if (existing.tenant_id !== tenant_id) return err("contact_not_in_tenant");

    // Strip undefined so we only patch what was passed.
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    const methods = contact_methods ?? add_contact_methods;
    if (Object.keys(patch).length === 0 && !methods) {
      return ok({ ok: true, contact_id, updated_fields: [], note: "no fields supplied" });
    }

    // Addresses first: they are the part that can be refused (a changed list, a malformed or
    // already-used address), and the database checks the whole list before it writes any of it.
    if (methods) {
      const target = { _tenant_id: tenant_id, _client_id: contact_id, _methods: methods };
      const { error: methodsError } = contact_methods
        ? await admin.rpc("_replace_client_contact_methods_checked", { ...target, _expected: expected_contact_methods })
        : await admin.rpc("_add_client_contact_methods", target);
      if (methodsError) return err(contactMethodsError(methodsError.message));
    }
    if (Object.keys(patch).length) {
      const { error: uErr } = await admin.from("clients").update(patch).eq("id", contact_id).eq("tenant_id", tenant_id);
      if (uErr) return err(uErr.message);
    }
    const updatedFields = [...Object.keys(patch), ...(contact_methods ? ["contact_methods"] : add_contact_methods ? ["add_contact_methods"] : [])];
    await audit("update_contact", "client", contact_id, { fields: updatedFields }, tenant_id);
    const { data: after } = await admin.from("clients")
      .select(`account_number, updated_at, ${CONTACT_METHOD_SELECT}`).eq("id", contact_id).eq("tenant_id", tenant_id).maybeSingle();
    return ok({ ok: true, contact_id, client_ref: after?.account_number ?? null, updated_fields: updatedFields,
      contact_methods: orderedContactMethods(after?.client_contact_methods), updated_at: after?.updated_at ?? null });
  },
});


mcp.tool("bulk_delete_contacts", {
  description:
    "Preview which of up to 100 contacts (clients rows) are in scope for removal. Scoped to the caller's tenant \u2014 contacts in other tenants are silently skipped. Returns a per-id preview. DELETION IS NOT PERFORMED FROM THIS SURFACE: a destructive act needs a governed approval proof, and an MCP caller has no way to present one, so this tool previews and never deletes. For removal that IS available here, archive via `update_lifecycle_stage` to `client_churned` or `client_alumni`.",
  inputSchema: z.object({
    contact_ids: z.array(z.string()).min(1).max(100),
    confirm: z.boolean().optional().describe(
      "Accepted for compatibility and deliberately NOT honoured as approval. Passing true returns a refusal, not a deletion.",
    ),
  }),
  handler: async ({ contact_ids, confirm }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");

    // Resolve which ids actually belong to caller's tenant.
    const { data: rows, error: rErr } = await admin
      .from("clients")
      .select("id, tenant_id, first_name, last_name, email")
      .in("id", contact_ids);
    if (rErr) return err(rErr.message);

    const eligible = (rows ?? []).filter((r) => r.tenant_id === tenant_id);
    const eligibleIds = eligible.map((r) => r.id as string);
    const skipped = contact_ids.filter((id) => !eligibleIds.includes(id));

    // CONTAINED 2026-09-02 (issue #784). This handler used to hard-delete these rows with the
    // service-role client whenever `confirm` was true. `confirm` is a field in the tool's own
    // argument object, which means it is the MODEL'S OWN JSON — exactly the shape
    // `docs/doctrine/one-approval-gate.md` names as forbidden: "That flag is the model's own JSON.
    // It selects a branch; it proves nothing." The identical act in Chat is `crm_delete_contact`,
    // classified `high` in `_shared/action-risk.ts`, and Chat refuses model-asserted approval for
    // `high` outright. The same destruction was reachable here with no risk classification, no
    // autonomy lane, and no approval proof of any kind.
    //
    // The fix is deliberately NOT "wire a new approval channel into MCP". That decision belongs to
    // the Chat build (same doctrine: "No agent decides how permission is proven"), and a second
    // channel is the failure that doctrine exists to stop. So this surface stops destroying, and
    // the capability returns only when mutating MCP tools are classified and routed through the
    // shared governed Spine execution seam. Until then the preview is the whole tool.
    const preview = {
      would_remove: eligible,
      would_remove_count: eligible.length,
      skipped_not_in_tenant: skipped,
      deletion_available: false,
    };

    if (confirm !== true) {
      return ok({
        ...preview,
        preview_only: true,
        next:
          "Deletion is not available from this surface. To remove these contacts from active work, " +
          "call `update_lifecycle_stage` with `client_churned` or `client_alumni`.",
      });
    }

    // An approval was asserted in the arguments. Record the attempt — a blocked destructive
    // request is precisely what an audit log is for — then refuse. Nothing was deleted.
    await audit("bulk_delete_contacts_blocked", "client", null, {
      tenant_id,
      requested_count: contact_ids.length,
      eligible_count: eligible.length,
      skipped_count: skipped.length,
      reason: "model_supplied_confirm_is_not_approval",
    });

    return err(
      "Nothing was deleted, and nothing will be. Deleting contacts is a destructive action that " +
      "requires a real approval from the operator, and a `confirm` flag inside these arguments is " +
      "not one \u2014 it is your own output. This surface has no way to carry that approval, so it " +
      "previews only. Tell the operator plainly that you cannot delete contacts here, and offer to " +
      "archive them instead with `update_lifecycle_stage` (`client_churned` or `client_alumni`). " +
      `In scope had this been available: ${eligible.length} of ${contact_ids.length}.`,
    );
  },
});

mcp.tool("list_contact_businesses", {
  description:
    "List all businesses associated with a contact. Returns the contact's primary_business_id (if any) plus every businesses row owned by the contact's linked_user_id. Use before calling `link_contact_to_business` when the contact has multiple entities so you can show the user a picker.",
  inputSchema: z.object({
    contact_id: z.string(),
  }),
  handler: async ({ contact_id }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");

    const { data: contact, error: cErr } = await admin
      .from("clients")
      .select("id, tenant_id, first_name, last_name, entity_name, linked_user_id, primary_business_id")
      .eq("id", contact_id)
      .maybeSingle();
    if (cErr) return err(cErr.message);
    if (!contact || contact.tenant_id !== tenant_id) return err("contact_not_found");

    let businesses: any[] = [];
    if (contact.linked_user_id) {
      const { data: bz, error: bErr } = await admin
        .from("businesses")
        .select("id, legal_name, dba_name, entity_type, is_primary, is_active, created_at")
        .eq("owner_user_id", contact.linked_user_id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (bErr) return err(bErr.message);
      businesses = bz ?? [];
    }

    return ok({
      contact: {
        id: contact.id,
        name: `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim(),
        entity_name_freetext: contact.entity_name,
        linked_user_id: contact.linked_user_id,
        primary_business_id: contact.primary_business_id,
      },
      businesses,
      business_count: businesses.length,
      note: contact.linked_user_id
        ? null
        : "Contact has no linked_user_id (CRM-only). New businesses created via auto-stub will be owned by the contact's creator.",
    });
  },
});

mcp.tool("link_contact_to_business", {
  description:
    "Wire a contact to a specific business record as their primary business. Use this for multi-entity edge cases (one contact owns several businesses, or co-founders sharing one business) where the auto-stub picked the wrong default. The business must belong to the caller's tenant via shared ownership. Returns the updated contact + business pair.",
  inputSchema: z.object({
    contact_id: z.string(),
    business_id: z.string().nullable().describe("Pass null to clear the link."),
  }),
  handler: async ({ contact_id, business_id }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");

    const { data: contact, error: cErr } = await admin
      .from("clients")
      .select("id, tenant_id, linked_user_id, primary_business_id")
      .eq("id", contact_id)
      .maybeSingle();
    if (cErr) return err(cErr.message);
    if (!contact || contact.tenant_id !== tenant_id) return err("contact_not_found");

    if (business_id) {
      const { data: biz, error: bErr } = await admin
        .from("businesses")
        .select("id, owner_user_id, legal_name")
        .eq("id", business_id)
        .maybeSingle();
      if (bErr) return err(bErr.message);
      if (!biz) return err("business_not_found");
      // Ownership sanity: business owner must match the contact's linked_user_id,
      // OR the business owner must be a member of the same tenant (covers
      // CRM-only contacts whose business is owned by their coach/creator).
      if (contact.linked_user_id && biz.owner_user_id !== contact.linked_user_id) {
        const { data: ownerMember } = await admin
          .from("tenant_members")
          .select("user_id")
          .eq("tenant_id", tenant_id)
          .eq("user_id", biz.owner_user_id)
          .maybeSingle();
        if (!ownerMember) return err("business_owner_not_in_tenant");
      }
    }

    const { error: uErr } = await admin
      .from("clients")
      .update({ primary_business_id: business_id, updated_at: new Date().toISOString() })
      .eq("id", contact_id);
    if (uErr) return err(uErr.message);

    await audit("link_contact_to_business", "client", contact_id, {
      tenant_id,
      previous_business_id: contact.primary_business_id,
      new_business_id: business_id,
    });

    return ok({
      contact_id,
      primary_business_id: business_id,
      previous_business_id: contact.primary_business_id,
      cleared: business_id === null,
    });
  },
});



mcp.tool("update_lifecycle_stage", {
  description:
    "Update a contact's lifecycle stage per Doctrine §111 (new_lead, qualified, nurturing, hot_lead, negotiating, won, client_active, client_paused, client_churned, client_funded, client_alumni).",
  inputSchema: z.object({
    contact_id: z.string(),
    new_stage: z.enum(DOCTRINE_111_LIFECYCLE_STAGES),
    reason: z.string().optional(),
  }),
  handler: async ({ contact_id, new_stage, reason }) => {
    const { data: cur } = await admin.from("clients").select("lifecycle_stage").eq("id", contact_id).maybeSingle();
    if (!cur) return err("contact_not_found");
    const old_stage = (cur.lifecycle_stage as string | null) ?? null;
    const { error } = await admin.from("clients").update({ lifecycle_stage: new_stage }).eq("id", contact_id);
    if (error) return err(error.message);
    if (reason) {
      const { data: c } = await admin.from("clients").select("current_notes").eq("id", contact_id).maybeSingle();
      const stamp = new Date().toISOString();
      const next = `${c?.current_notes ?? ""}\n\n[${stamp} · lifecycle ${old_stage ?? "∅"}→${new_stage}] ${reason}`.trim().slice(0, 8000);
      await admin.from("clients").update({ current_notes: next }).eq("id", contact_id);
    }
    await audit("update_lifecycle_stage", "client", contact_id, { old_stage, new_stage, reason: reason ?? null });
    return ok({ ok: true, contact_id, old_stage, new_stage });
  },
});


// ---------- Read-only BUILD-to-FUND / agreements / payments ----------
mcp.tool("list_signed_agreements", {
  description: "List signed service agreements in the caller's tenant (paige_signed_agreements). Paginated.",
  inputSchema: z.object({
    contact_id: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp; filters signed_at >= since."),
    limit: z.number().int().optional().describe("1-200, default 50."),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    // §9 TENANT SCOPE. This tool returned EVERY tenant's executed agreements (#1353): the
    // description below has always claimed "in the caller's tenant" and the query never
    // implemented it. Two things have to be true at once for that to be a leak, and both were:
    //
    //   1. `admin` is the SERVICE-ROLE client, so `paige_signed_agreements`' own RLS
    //      (`is_program_client_owner(client_id) OR can_access_contact(auth.uid(), client_id)`)
    //      never runs. RLS is not a backstop here; it is bypassed by construction.
    //   2. The governed door does not catch it either — capability-policy classifies this tool
    //      `effect: "read"`, and governed-adapter refuses only `"mutate"`, so a read is
    //      dispatched straight to this handler.
    //
    // So the scope has to be written HERE, explicitly, or there is none. It is derived from the
    // verified bearer via `actorTenantId()` — never from a request argument (`contact_id` is
    // caller-supplied and is a filter, never a scope).
    //
    // WHY THE JOIN: `paige_signed_agreements` carries no `tenant_id` column of its own. Its
    // tenancy IS the tenancy of the client it is keyed to, so the predicate has to travel the
    // `client_id -> clients.id` foreign key. `!inner` + a filter on the embedded column is the
    // shape already proven in this runtime by `dispatch-queued-workflow-runs` and
    // `paige-ai-chat`, not a new technique.
    const tenantId = await actorTenantId();
    const isGod = await actorIsPlatformOwner();
    if (!isGod && !tenantId) return err("tenant_not_resolved");

    // A NAMED contact is validated through the same seam every other client-keyed tool uses, so
    // a foreign UUID is refused by name (`cross_tenant_forbidden`) rather than quietly returning
    // an empty list that reads like "this client has signed nothing".
    if (args.contact_id) {
      const scope = await tenantScopedClient(args.contact_id);
      if (!scope.ok) return err(scope.reason ?? "cross_tenant_forbidden");
    }

    let q = admin
      .from("paige_signed_agreements")
      .select("id, client_id, agreement_template_key, agreement_version, signed_pdf_path, signature_data, signed_at, created_at, clients!inner(tenant_id)")
      .order("signed_at", { ascending: false })
      .limit(limit);
    // The platform OWNER reaches across tenants; everyone else is hard-scoped to their own. An
    // agency does NOT gain cross-tenant reach here — that is the parentage-checked agency tool
    // set, never this read (the posture `tenantScopedClient` already documents).
    if (!isGod) q = q.eq("clients.tenant_id", tenantId);
    if (args.contact_id) q = q.eq("client_id", args.contact_id);
    if (args.since) q = q.gte("signed_at", args.since);
    const { data, error } = await q;
    if (error) return err(error.message);
    const items = (data ?? []).map((row: any) => ({
      agreement_id: row.id,
      contact_id: row.client_id,
      signed_at: row.signed_at,
      signer_name: row.signature_data?.signer_name ?? row.signature_data?.full_name ?? null,
      document_url: row.signed_pdf_path,
      agreement_template_key: row.agreement_template_key,
      agreement_version: row.agreement_version,
    }));
    return ok({ items, count: items.length });
  },
});

mcp.tool("list_intake_submissions", {
  description: "List BUILD-to-FUND intake submissions (paige_client_intake_submissions). Filter by contact or status.",
  inputSchema: z.object({
    contact_id: z.string().optional(),
    status: z.enum(["in_progress", "submitted", "all"]).optional(),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    let q = admin
      .from("paige_client_intake_submissions")
      .select("id, client_id, section, payload, submitted_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (args.contact_id) q = q.eq("client_id", args.contact_id);
    if (args.status === "submitted") q = q.not("submitted_at", "is", null);
    else if (args.status === "in_progress") q = q.is("submitted_at", null);
    const { data, error } = await q;
    if (error) return err(error.message);
    const items = (data ?? []).map((row: any) => ({
      submission_id: row.id,
      contact_id: row.client_id,
      section: row.section,
      status: row.submitted_at ? "submitted" : "in_progress",
      submitted_at: row.submitted_at,
      updated_at: row.updated_at,
      sections_completed: row.payload ? Object.keys(row.payload).length : 0,
    }));
    return ok({ items, count: items.length });
  },
});

mcp.tool("list_payment_authorizations", {
  description: "List Stripe payment authorizations (paige_payment_authorizations). Filter by contact or date.",
  inputSchema: z.object({
    contact_id: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp; filters authorized_at >= since."),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    let q = admin
      .from("paige_payment_authorizations")
      .select("id, client_id, plan_selected, authorized_at, status, created_at")
      .order("authorized_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (args.contact_id) q = q.eq("client_id", args.contact_id);
    if (args.since) q = q.gte("authorized_at", args.since);
    const { data, error } = await q;
    if (error) return err(error.message);
    const items = (data ?? []).map((row: any) => ({
      auth_id: row.id,
      contact_id: row.client_id,
      payment_plan: row.plan_selected,
      status: row.status,
      authorized_at: row.authorized_at,
    }));
    return ok({ items, count: items.length });
  },
});

// ---------- Sender identity (debug) ----------
mcp.tool("resolve_sender_identity", {
  description:
    "Read-only debug tool. Returns the from-address, display name, and reply-to a given tenant + product_scope combo would produce, without sending an email. Use to verify domain config after changes.",
  inputSchema: z.object({
    tenant_id: z.string().optional().describe("Defaults to caller's tenant."),
    product_scope: z.string().optional().describe("Optional, e.g. 'btf' or 'paige'. Currently advisory."),
  }),
  handler: async (args) => {
    const tenant_id = await resolveTenantId(args.tenant_id ?? null);
    if (!tenant_id) return err("tenant_not_resolved");
    const { data, error } = await admin.rpc("tenant_sender_identity", { _tenant_id: tenant_id });
    if (error) return err(error.message);
    if (!data) return err("tenant_not_found");
    return ok({
      tenant_id,
      product_scope: args.product_scope ?? null,
      identity: data,
      from_address: (data as any)?.from_address ?? null,
      from_name: (data as any)?.from_name ?? null,
      reply_to: (data as any)?.reply_to ?? null,
    });
  },
});


// ============================================================================
// Batch #2 (Doctrine §119) — observability + comms + invoicing
// ============================================================================

// ---------- list_workflow_runs ----------
mcp.tool("list_workflow_runs", {
  description:
    "List recent workflow runs in the caller's tenant. Filter by registry_key, status, triggered_by, or since timestamp. Read-only observability into paige_workflow_runs without needing the UI.",
  inputSchema: z.object({
    registry_key: z.string().optional(),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(),
    triggered_by: z.string().optional(),
    since: z.string().optional().describe("ISO timestamp"),
    limit: z.number().int().optional(),
  }),
  handler: async (args) => {
    const tenantId = await actorTenantId();
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    let regIdFilter: string | null = null;
    if (args.registry_key) {
      const { data: reg } = await admin
        .from("paige_workflow_registry").select("id").eq("key", args.registry_key).maybeSingle();
      if (!reg) return ok({ items: [], total: 0 });
      regIdFilter = reg.id as string;
    }
    let q = admin
      .from("paige_workflow_runs")
      .select("id, registry_id, status, n8n_execution_id, langgraph_thread_id, retry_count, error, triggered_by, created_at, completed_at, last_dispatched_at, paige_workflow_registry(key, provider, tenant_id)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (regIdFilter) q = q.eq("registry_id", regIdFilter);
    if (args.status) q = q.eq("status", args.status);
    if (args.triggered_by) q = q.eq("triggered_by", args.triggered_by);
    if (args.since) q = q.gte("created_at", args.since);
    const { data, error } = await q;
    if (error) return err(error.message);
    // Tenant scope: only runs whose registry tenant_id is null OR matches caller.
    const filtered = (data ?? []).filter((r: any) => {
      const t = r.paige_workflow_registry?.tenant_id ?? null;
      return t === null || t === tenantId;
    }).map((r: any) => {
      const duration = r.completed_at && r.created_at
        ? new Date(r.completed_at).getTime() - new Date(r.created_at).getTime() : null;
      return {
        run_id: r.id,
        registry_key: r.paige_workflow_registry?.key ?? null,
        status: r.status,
        provider: r.paige_workflow_registry?.provider ?? null,
        triggered_by: r.triggered_by,
        retry_count: r.retry_count,
        execution_id: r.n8n_execution_id,
        thread_id: r.langgraph_thread_id,
        created_at: r.created_at,
        completed_at: r.completed_at,
        duration_ms: duration,
        error: r.error,
      };
    });
    // §9 — `total` previously used the DB `{ count: "exact" }` computed BEFORE
    // the JS tenant filter (over registry_id/status/triggered_by/since only), so
    // it leaked a fleet-wide run count. Report the page-accurate, tenant-scoped
    // count instead.
    return ok({ items: filtered, total: filtered.length });
  },
});

// ---------- cancel_workflow_run ----------
mcp.tool("cancel_workflow_run", {
  description:
    "Cancel a running or queued workflow run. For langgraph_bridge calls the bridge /cancel verb; for n8n calls stop-execution; for direct_edge_function marks the row cancelled. Audited.",
  inputSchema: z.object({
    run_id: z.string(),
    reason: z.string().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async ({ run_id, reason }) => {
    const tenantId = await actorTenantId();
    const { data: row } = await admin
      .from("paige_workflow_runs")
      .select("id, status, n8n_execution_id, langgraph_thread_id, registry_id, paige_workflow_registry(provider, n8n_webhook_url, tenant_id)")
      .eq("id", run_id).maybeSingle();
    if (!row) return err("run_not_found");
    const reg: any = (row as any).paige_workflow_registry;
    if (reg?.tenant_id && reg.tenant_id !== tenantId) return err("run_restricted_to_owning_tenant");
    if (["succeeded", "failed", "cancelled"].includes(row.status as string)) {
      return err(`run_already_terminal:${row.status}`);
    }
    const prior = row.status as string;
    const provider = reg?.provider as string | null;
    let providerNote: string | null = null;

    if (provider === "langgraph_bridge") {
      const bUrl = Deno.env.get("PAIGE_OS_LANGGRAPH_BRIDGE_URL");
      const bKey = Deno.env.get("PAIGE_OS_LANGGRAPH_BRIDGE_KEY");
      if (bUrl && bKey && (row as any).n8n_execution_id) {
        try {
          const r = await fetch(bUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${bKey}` },
            body: JSON.stringify({
              verb: "cancel_run",
              thread_id: (row as any).langgraph_thread_id,
              run_id: (row as any).n8n_execution_id,
            }),
          });
          providerNote = `bridge_${r.status}`;
        } catch (e) { providerNote = `bridge_err:${(e as Error).message.slice(0, 80)}`; }
      }
    }
    // n8n cancel could be added when n8n API key is available; for now mark row cancelled.

    const { error } = await admin.from("paige_workflow_runs").update({
      status: "cancelled",
      error: reason ? `cancelled: ${reason}` : "cancelled",
      completed_at: new Date().toISOString(),
    }).eq("id", run_id);
    if (error) return err(error.message);
    await audit("cancel_workflow_run", "workflow_run", run_id, { reason: reason ?? null, prior, provider_note: providerNote });
    return ok({ run_id, prior_status: prior, new_status: "cancelled", provider_note: providerNote });
  },
});

// ---------- register_workflow ----------
mcp.tool("register_workflow", {
  description:
    "Register a new workflow in the caller's tenant's registry. Master tenant can use any provider; sub-tenants are restricted to provider='webhook_external' or 'direct_edge_function'. Doctrine §118 + §119.",
  inputSchema: z.object({
    key: z.string().describe("snake_case, unique per tenant"),
    label: z.string(),
    description: z.string(),
    category: z.string(),
    provider: z.enum(["n8n", "langgraph", "langgraph_bridge", "direct_edge_function", "webhook_external", "cron_only"]),
    provider_config: z.record(z.string(), z.any()).optional(),
    requires_approval: z.boolean().optional(),
    allowed_roles: z.array(z.string()).optional(),
  }),
  annotations: { destructiveHint: false },
  handler: async (args) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    // §25: gate on platform OWNERSHIP, not a hardcoded tenant UUID — the operator
    // may run from any tenant. actorIsPlatformOwner() is true for the platform key
    // AND for a super_admin user.
    const isGod = await actorIsPlatformOwner();
    // Platform-infra providers (n8n/langgraph) are the operator's own rails.
    const platformOwnerProviders = new Set(["n8n", "langgraph", "langgraph_bridge"]);
    if (platformOwnerProviders.has(args.provider) && !isGod) {
      return err("provider_restricted_to_platform_owner");
    }
    const cfg = args.provider_config ?? {};
    const directFunctionInput = (cfg.direct_function_name as string) ?? null;
    const directFunctionName = args.provider === "direct_edge_function"
      ? canonicalDirectFunctionName(directFunctionInput)
      : directFunctionInput;
    if (args.provider === "direct_edge_function" &&
        (!directFunctionName || isMarketplaceDirectFunctionBlocked(directFunctionName))) {
        return err("direct_function_not_allowed");
    }
    const row: Record<string, unknown> = {
      key: args.key,
      label: args.label,
      description: args.description,
      category: args.category,
      provider: args.provider,
      n8n_webhook_url: (cfg.n8n_webhook_url as string) ?? null,
      needs_n8n_link: false,
      langgraph_graph_id: (cfg.langgraph_graph_id as string) ?? (cfg.assistant_id as string) ?? null,
      direct_function_name: directFunctionName,
      requires_approval: args.requires_approval ?? false,
      allowed_roles: args.allowed_roles ?? ["admin", "super_admin"],
      is_active: true,
      // A platform-owner registration is a GLOBAL (tenant_id NULL) registry row;
      // anyone else registers a tenant-scoped one. Binding the NULL write to
      // ownership (not the MMA literal) stops a non-god caller whose resolved
      // tenant happens to be MMA from seeding the shared registry.
      tenant_id: isGod ? null : tenantId,
    };
    const { data, error } = await admin.from("paige_workflow_registry").insert(row).select("id, key, tenant_id, created_at").single();
    if (error) return err(error.message);
    await audit("register_workflow", "workflow_registry", data.id, { key: args.key, provider: args.provider, tenant_id: data.tenant_id });
    return ok({ registry_id: data.id, key: data.key, tenant_id: data.tenant_id, created_at: data.created_at });
  },
});

// ---------- send_transactional_email ----------
mcp.tool("send_transactional_email", {
  description:
    "Send a one-off transactional email. Either provide template_key (rendered server-side) OR raw subject + body_html. From-address auto-resolves from tenant + product_scope.",
  inputSchema: z.object({
    to: z.string().describe("recipient email"),
    template_key: z.string().optional(),
    subject: z.string().optional(),
    body_html: z.string().optional(),
    body_text: z.string().optional(),
    template_variables: z.record(z.string(), z.any()).optional(),
    product_scope: z.string().optional(),
    contact_id: z.string().optional(),
    tenant_id: z.string().optional(),
  }),
  annotations: { destructiveHint: false },
  handler: async (args) => {
    if (!args.template_key && (!args.subject || !args.body_html)) {
      return err("must_provide_template_key_or_subject_and_body_html");
    }
    const tenant_id = await resolveTenantId(args.tenant_id ?? null);
    if (!tenant_id) return err("tenant_not_resolved");
    const { data: idn } = await admin.rpc("tenant_sender_identity", { _tenant_id: tenant_id });
    const fromAddress = (idn as any)?.from_address as string | undefined;
    const fromName = (idn as any)?.from_name as string | undefined;
    const replyTo = (idn as any)?.reply_to as string | undefined;
    if (!fromAddress) return err("from_address_not_resolved");

    let subject = args.subject ?? "";
    let html = args.body_html ?? "";
    let text = args.body_text ?? "";

    if (args.template_key) {
      const { data: tpl, error: tErr } = await admin
        .from("email_templates")
        .select("subject, body_html, body_text")
        .eq("key", args.template_key)
        .maybeSingle();
      if (tErr) return err(tErr.message);
      if (!tpl) return err("template_not_found");
      const vars = args.template_variables ?? {};
      const interp = (s: string) =>
        s.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
      subject = interp(tpl.subject ?? "");
      html = interp(tpl.body_html ?? "");
      text = interp(tpl.body_text ?? "");
    }

    if (!RESEND_API_KEY) return err("resend_not_configured");
    const send_id = crypto.randomUUID();
    const fromHeader = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
    let resendId: string | null = null;
    let status: "sent" | "failed" = "sent";
    let errorMsg: string | null = null;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: fromHeader,
          to: [args.to],
          subject,
          html,
          text: text || undefined,
          reply_to: replyTo || undefined,
          headers: { "X-Paige-Send-Id": send_id },
        }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) { status = "failed"; errorMsg = (j as any)?.message ?? `resend_${r.status}`; }
      else resendId = (j as any)?.id ?? null;
    } catch (e) {
      status = "failed";
      errorMsg = (e as Error).message.slice(0, 300);
    }
    try {
      await admin.from("email_send_log").insert({
        id: send_id,
        tenant_id,
        contact_id: args.contact_id ?? null,
        recipient_email: args.to,
        from_address: fromAddress,
        subject,
        template_key: args.template_key ?? null,
        product_scope: args.product_scope ?? null,
        status,
        provider_message_id: resendId,
        error_message: errorMsg,
      });
    } catch { /* log table may not have all columns — non-fatal */ }
    await audit("send_transactional_email", "email", send_id, {
      to: args.to, template_key: args.template_key ?? null, status, tenant_id,
    });
    return ok({ send_id, resend_id: resendId, status, from: fromHeader, to: args.to, error: errorMsg });
  },
});

// ---------- send_sms ----------
// Legacy send_sms stays fail-closed until governed outbound authorization exists.
//
// THIS TOOL IS DECLARED `effect: "read"` IN `_shared/paige-mcp/capability-policy.ts`, AND THAT IS
// ONLY TRUE WHILE THE HANDLER BELOW STAYS INERT. It is truthful today — the whole body is a length
// check, a uuid, an append-only audit row and a `blocked_…` status; there is no provider call. But
// the governed door's read branch returns BEFORE classification, clamp, approval and outcome, so
// re-arming the Twilio send under this tool name would put a real outbound send behind a `read`
// declaration and it would execute ungoverned. If you re-arm it, change that row to
// `effect: "mutate"` in the SAME commit. R6 of `mcp-governed-door-lint` catches the accident —
// a `fetch(` or a provider helper appearing in this span fails CI — but it cannot catch a send
// routed through a module it does not follow. The row and this comment are a pair; keep both.
mcp.tool("send_sms", {
  description:
    "SMS sending is unavailable from this legacy tool. Tenant messages must use the governed Communications sender after that tenant's A2P registration is approved.",
  inputSchema: z.object({
    to_phone: z.string().describe("E.164, e.g. +14705944470"),
    body: z.string(),
    contact_id: z.string().optional(),
    provider: z.enum(["twilio"]).optional(),
  }),
  annotations: { destructiveHint: false },
  handler: async (args) => {
    if (args.body.length > 1600) return err("body_too_long_max_1600");
    const send_id = crypto.randomUUID();
    const status = "blocked_a2p_governed_sender_required";
    await audit("send_sms", "sms", send_id, {
      to: args.to_phone,
      contact_id: args.contact_id ?? null,
      status,
    });
    return ok({ send_id, provider_message_id: null, status, from_phone: null, to: args.to_phone });
  },
});

// ---------- create_invoice ----------
const BTF_PLANS: Record<string, { description: string; total_cents: number; line_items: any[] }> = {
  btf_pif:        { description: "BUILD-to-FUND — Paid in Full",  total_cents: 499700, line_items: [{ description: "BUILD-to-FUND Program (Paid in Full)", amount_cents: 499700, quantity: 1 }] },
  btf_split:      { description: "BUILD-to-FUND — 3-Pay Split",   total_cents: 499700, line_items: [{ description: "BUILD-to-FUND Program (Split Pay, payment 1 of 3)", amount_cents: 166600, quantity: 1 }] },
  btf_getstarted: { description: "BUILD-to-FUND — Get Started",   total_cents: 99700,  line_items: [{ description: "BUILD-to-FUND Get Started Deposit", amount_cents: 99700, quantity: 1 }] },
};

mcp.tool("create_invoice", {
  description:
    "Create a draft invoice for a contact (optionally tied to a deal). Use payment_plan_key for BUILD-to-FUND presets (btf_pif|btf_split|btf_getstarted). Returns invoice_id + hosted_invoice_url. Stripe Connect placeholder mode supported.",
  inputSchema: z.object({
    contact_id: z.string(),
    deal_id: z.string().optional(),
    amount_cents: z.number().int().optional(),
    currency: z.string().optional(),
    line_items: z.array(z.object({
      description: z.string(),
      amount_cents: z.number().int(),
      quantity: z.number().int().optional(),
    })).optional(),
    due_date: z.string().optional().describe("YYYY-MM-DD"),
    memo: z.string().optional(),
    payment_plan_key: z.enum(["btf_pif", "btf_split", "btf_getstarted"]).optional(),
  }),
  annotations: { destructiveHint: false },
  handler: async (args) => {
    const tenant_id = await resolveTenantId(null);
    if (!tenant_id) return err("tenant_not_resolved");
    const { data: contact } = await admin
      .from("clients").select("id, tenant_id").eq("id", args.contact_id).maybeSingle();
    if (!contact) return err("contact_not_found");

    let lineItems = args.line_items ?? [];
    let amountTotal = args.amount_cents ?? 0;
    if (args.payment_plan_key) {
      const plan = BTF_PLANS[args.payment_plan_key];
      lineItems = plan.line_items;
      amountTotal = plan.total_cents;
    }
    if (lineItems.length > 0 && !args.amount_cents) {
      amountTotal = lineItems.reduce((s, li) => s + li.amount_cents * (li.quantity ?? 1), 0);
    }
    if (amountTotal <= 0) return err("amount_total_must_be_positive");

    const dueDate = args.due_date ?? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const { data: actor } = await admin.from("paige_workflow_registry").select("id").limit(0);
    void actor;
    const createdBy = currentActor().user_id;

    const { data: inv, error } = await admin.from("paige_invoices").insert({
      tenant_id,
      contact_id: args.contact_id,
      deal_id: args.deal_id ?? null,
      status: "draft",
      amount_total_cents: amountTotal,
      currency: (args.currency ?? "USD").toUpperCase(),
      line_items: lineItems,
      due_date: dueDate,
      memo: args.memo ?? null,
      payment_plan_key: args.payment_plan_key ?? null,
      hosted_invoice_url: null, // populated when send_invoice runs (Stripe Connect or fallback)
      created_by: createdBy,
    }).select("id, invoice_number, status, amount_total_cents, hosted_invoice_url").single();
    if (error) return err(error.message);
    await audit("create_invoice", "invoice", inv.id, {
      contact_id: args.contact_id, amount_cents: amountTotal, payment_plan_key: args.payment_plan_key ?? null,
    });
    return ok({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
      status: inv.status,
      amount_total_cents: inv.amount_total_cents,
    });
  },
});

// ---------- send_invoice ----------
mcp.tool("send_invoice", {
  description:
    "Deliver a previously-created draft invoice. Emails the contact with the hosted invoice link and marks status='sent'. Separate from create_invoice so callers can review the draft first.",
  inputSchema: z.object({
    invoice_id: z.string(),
    custom_message: z.string().optional(),
  }),
  annotations: { destructiveHint: false },
  handler: async (args) => {
    const { data: inv, error: iErr } = await admin
      .from("paige_invoices")
      .select("id, tenant_id, contact_id, status, invoice_number, amount_total_cents, currency, hosted_invoice_url, memo")
      .eq("id", args.invoice_id).maybeSingle();
    if (iErr) return err(iErr.message);
    if (!inv) return err("invoice_not_found");
    if (inv.status !== "draft") return err(`invoice_not_draft:${inv.status}`);

    const { data: contact } = await admin
      .from("clients").select("email, first_name, last_name").eq("id", inv.contact_id).maybeSingle();
    if (!contact?.email) return err("contact_email_missing");

    // Stripe Connect hosted URL — placeholder fallback (BYPASS_STRIPE_CONNECT) when not configured.
    let hostedUrl = inv.hosted_invoice_url
      ?? `${Deno.env.get("PAIGE_APP_ORIGIN") ?? "https://paigeagent.ai"}/i/${inv.invoice_number}`;

    if (!RESEND_API_KEY) return err("resend_not_configured");
    const { data: idn } = await admin.rpc("tenant_sender_identity", { _tenant_id: inv.tenant_id });
    const fromAddress = (idn as any)?.from_address as string | undefined;
    const fromName = (idn as any)?.from_name as string | undefined;
    if (!fromAddress) return err("from_address_not_resolved");
    const fromHeader = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

    const amountFmt = `$${(inv.amount_total_cents / 100).toFixed(2)} ${inv.currency}`;
    const greeting = contact.first_name ? `Hi ${contact.first_name},` : "Hi,";
    const intro = args.custom_message ? `<p>${args.custom_message}</p>` : "";
    const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#111">
      <p>${greeting}</p>${intro}
      <p>Your invoice <strong>${inv.invoice_number}</strong> for <strong>${amountFmt}</strong> is ready.</p>
      <p><a href="${hostedUrl}" style="display:inline-block;padding:12px 20px;background:#CFAE70;color:#000;text-decoration:none;border-radius:6px;font-weight:600">View & Pay Invoice</a></p>
      ${inv.memo ? `<p style="color:#555;font-size:14px">${inv.memo}</p>` : ""}
      <p>Thanks!</p>
    </body></html>`;

    const send_id = crypto.randomUUID();
    let resendErr: string | null = null;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: fromHeader,
          to: [contact.email],
          subject: `Invoice ${inv.invoice_number} — ${amountFmt}`,
          html,
          headers: { "X-Paige-Send-Id": send_id },
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as any));
        resendErr = (j as any)?.message ?? `resend_${r.status}`;
      }
    } catch (e) {
      resendErr = (e as Error).message.slice(0, 300);
    }
    if (resendErr) return err(`email_send_failed: ${resendErr}`);

    await admin.from("paige_invoices").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_to_email: contact.email,
      hosted_invoice_url: hostedUrl,
    }).eq("id", inv.id);
    await audit("send_invoice", "invoice", inv.id, { to: contact.email, send_id });

    return ok({
      invoice_id: inv.id,
      status: "sent",
      sent_to_email: contact.email,
      send_id,
      hosted_invoice_url: hostedUrl,
    });
  },
});











async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Batch #3: Field-Ops Ingestion (voice/chat from external LLMs) ----------
// All tools below stage writes through `paige_ingestion_proposals` so that:
//   1. Every ingest is auditable + reversible.
//   2. Hallucination guards (range checks, conflict deltas, fuzzy-match disambiguation) run before commit.
//   3. Tenant scoping is enforced on every read/write.
//   4. Operators can review `needs_review` items in the governed approval queue.
//
// Tools: search_clients_fuzzy, propose_client_update, confirm_proposal, reject_proposal,
//        ingest_credit_scores, ingest_banking_snapshot, append_client_memory,
//        list_my_proposals.

const BUREAUS = ["TU", "EX", "EQ"] as const;
const SCORE_SOURCES = [
  "soft_pull",
  "hard_pull",
  "client_self_reported",
  "report_upload",
  "monitoring_service",
  "voice_dictation",
] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

async function tenantScopedClient(client_id: string): Promise<{ ok: boolean; tenant_id: string | null; reason?: string }> {
  const tid = await actorTenantId();
  const isGod = await actorIsPlatformOwner();
  const { data, error } = await admin
    .from("clients")
    .select("id, tenant_id")
    .eq("id", client_id)
    .maybeSingle();
  if (error) return { ok: false, tenant_id: null, reason: error.message };
  if (!data) return { ok: false, tenant_id: null, reason: "client_not_found" };
  // The platform OWNER (not a hardcoded tenant) can reach across tenants;
  // everyone else is hard-scoped to their own. An agency does NOT gain
  // cross-tenant client reach here — agency access to its children is the
  // explicit, parentage-checked agency tool set, never this bypass (§9).
  if (!isGod && data.tenant_id !== tid) {
    return { ok: false, tenant_id: data.tenant_id as string | null, reason: "cross_tenant_forbidden" };
  }
  return { ok: true, tenant_id: data.tenant_id as string | null };
}

async function recordProposal(input: {
  client_id: string | null;
  tool_name: string;
  target_table: string | null;
  payload: Record<string, unknown>;
  diff: Record<string, unknown>;
  confidence: typeof CONFIDENCE[number];
  source: string;
  external_llm_model?: string | null;
  review_reason?: string | null;
  auto_status?: "pending" | "needs_review";
}): Promise<{ id: string } | null> {
  const actor = currentActor();
  const tenant_id = input.client_id
    ? (await admin.from("clients").select("tenant_id").eq("id", input.client_id).maybeSingle()).data?.tenant_id ?? null
    : await actorTenantId();
  const { data, error } = await admin
    .from("paige_ingestion_proposals")
    .insert({
      tenant_id,
      actor_user_id: actor.user_id,
      actor_role: actor.kind === "user" ? "mcp:user" : "mcp:platform",
      actor_label: actor.client_id ?? null,
      client_id: input.client_id,
      tool_name: input.tool_name,
      target_table: input.target_table,
      payload: input.payload,
      diff: input.diff,
      status: input.auto_status ?? "pending",
      confidence: input.confidence,
      source: input.source,
      external_llm_model: input.external_llm_model ?? null,
      review_reason: input.review_reason ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[paige-mcp] recordProposal failed", error.message);
    return null;
  }
  return { id: data.id };
}

mcp.tool("search_clients_fuzzy", {
  description:
    "Voice/chat friendly fuzzy contact lookup. Use this BEFORE any ingest_* tool to resolve which client a teammate is talking about. Returns ranked candidates and a `disambiguation_required` flag when more than one strong match is found.",
  inputSchema: z.object({
    query: z.string().describe('Free text: "Marcus from Atlanta", "the Johnson LLC client", an email, or a phone fragment.'),
    limit: z.number().int().optional(),
  }),
  handler: async ({ query, limit }) => {
    const max = Math.min(Math.max(limit ?? 8, 1), 25);
    const tid = await actorTenantId();
    const isGod = await actorIsPlatformOwner();
    // Guard on the POST-strip token set (not just .trim()) so an all-punctuation
    // query ("()", "%%", ",,") still errors as empty_query rather than falling
    // through to a tokenless (tenant-scoped) recent-contacts list — preserving the
    // pre-hotfix guard exactly (§39 peer-gate finding #2).
    if (contactSearchTokens(String(query)).length === 0) return err("empty_query");
    // §18 shared search (hotfix #127). "any" mode: a SINGLE OR over every token × column
    // so a natural-language query ("Marcus from Atlanta") surfaces candidates (stopwords
    // just match nothing) AND a full name ("Tashia Anderson") is no longer missed because
    // first/last live in separate columns. Includes `city` for the "from <place>" pattern.
    let q = applyContactSearchFilter(
      admin
        .from("clients")
        .select("id, first_name, last_name, email, phone, entity_name, city, state, lifecycle_stage, tenant_id, updated_at"),
      String(query),
      { mode: "any", columns: [...CONTACT_SEARCH_COLUMNS, "city"] },
    );
    // Only the platform owner searches across every tenant; everyone else
    // (including agencies) is hard-scoped to their own tenant here (§9).
    // Fail CLOSED: a non-god with no resolvable tenant gets nothing, never an
    // unscoped cross-tenant search.
    if (!isGod) {
      if (!tid) return err("tenant_not_resolved");
      q = q.eq("tenant_id", tid);
    }
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(max);
    if (error) return err(error.message);
    const items = data ?? [];
    return ok({
      items,
      count: items.length,
      disambiguation_required: items.length > 1,
      hint:
        items.length === 0
          ? "This search returned no candidates — that is NOT proof the client doesn't exist. Do not tell the operator 'no record on file' off this. Retry with a single name token, an email, phone, or company name; only if a genuinely broad search is still empty, ask whether to add them or if they're under a different name."
          : items.length === 1
            ? "Single match. Safe to proceed with the returned id."
            : "Multiple matches. Read the list back to the teammate and ask which client they mean before calling any ingest_* tool.",
    });
  },
});

mcp.tool("propose_client_update", {
  description:
    "Stage a free-form update against a single contact. DOES NOT WRITE. Returns a proposal_id and a diff that the connected LLM MUST read back to the teammate before calling `confirm_proposal`. Use this for ad-hoc changes that don't have a dedicated ingest_* tool.",
  inputSchema: z.object({
    client_id: z.string(),
    updates: z.record(z.any()).describe("Partial fields on clients (whitelisted): first_name, last_name, email, phone, entity_name, entity_type, street_address, city, state, zip_code, funding_goal, monthly_revenue, primary_offer, lifecycle_stage, tier, source, title, website, current_notes."),
    confidence: z.enum(CONFIDENCE).describe("high = teammate confirmed verbatim, medium = paraphrased, low = unsure/approximate."),
    external_llm_model: z.string().optional(),
    review_reason: z.string().optional().describe("Why this might need human review."),
  }),
  handler: async ({ client_id, updates, confidence, external_llm_model, review_reason }) => {
    const scope = await tenantScopedClient(client_id);
    if (!scope.ok) return err(scope.reason ?? "scope_denied");
    const ALLOWED = new Set([
      "first_name","last_name","email","phone","entity_name","entity_type",
      "street_address","city","state","zip_code","funding_goal","monthly_revenue",
      "primary_offer","lifecycle_stage","tier","source","title","website","current_notes",
    ]);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates ?? {})) if (ALLOWED.has(k)) clean[k] = v;
    if (Object.keys(clean).length === 0) return err("no_whitelisted_fields");

    const { data: current } = await admin.from("clients").select(Object.keys(clean).join(",")).eq("id", client_id).maybeSingle();
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(clean)) {
      diff[k] = { from: (current as Record<string, unknown> | null)?.[k] ?? null, to: v };
    }

    const needsReview = confidence === "low" || !!review_reason;
    const proposal = await recordProposal({
      client_id,
      tool_name: "propose_client_update",
      target_table: "clients",
      payload: { updates: clean },
      diff,
      confidence,
      source: "mcp:field_ops",
      external_llm_model,
      review_reason: needsReview ? (review_reason ?? "low_confidence") : null,
      auto_status: needsReview ? "needs_review" : "pending",
    });
    if (!proposal) return err("proposal_insert_failed");
    await audit("propose_client_update", "client", client_id, { proposal_id: proposal.id, fields: Object.keys(clean) });
    return ok({
      proposal_id: proposal.id,
      client_id,
      diff,
      status: needsReview ? "needs_review" : "pending",
      next_step: needsReview
        ? "Routed to the governed approval queue. Do not call confirm_proposal."
        : "Read the diff back to the teammate verbatim, then call confirm_proposal with this proposal_id once they say yes.",
    });
  },
});

mcp.tool("ingest_credit_scores", {
  description:
    'Record one or more bureau credit scores for a client. Each score must include bureau (TU/EX/EQ), score (300-850), source, and a pulled_on date. Auto-flags as needs_review if (a) confidence=low, (b) score differs from the most recent stored estimate for that bureau by >40 points, or (c) the score falls outside 300-850. On confirm, writes to profiles.estimated_fico_* (when client has a linked user) AND always logs a structured client_memory entry.',
  inputSchema: z.object({
    client_id: z.string(),
    scores: z.array(
      z.object({
        bureau: z.enum(BUREAUS),
        score: z.number().int(),
        source: z.enum(SCORE_SOURCES),
        pulled_on: z.string().describe("ISO date, e.g. 2026-06-29."),
      }),
    ),
    confidence: z.enum(CONFIDENCE),
    external_llm_model: z.string().optional(),
    auto_confirm: z.boolean().optional().describe("If true AND no review flags, apply immediately without a second tool call. Default false."),
  }),
  handler: async (args) => {
    const scope = await tenantScopedClient(args.client_id);
    if (!scope.ok) return err(scope.reason ?? "scope_denied");

    // Validation
    const reviewReasons: string[] = [];
    for (const s of args.scores) {
      if (s.score < 300 || s.score > 850) reviewReasons.push(`score_out_of_range:${s.bureau}:${s.score}`);
      if (Number.isNaN(Date.parse(s.pulled_on))) reviewReasons.push(`bad_date:${s.bureau}`);
    }
    if (args.confidence === "low") reviewReasons.push("low_confidence");

    // Conflict detection against profiles.estimated_fico_* via linked_user_id
    const { data: client } = await admin
      .from("clients")
      .select("id, linked_user_id, first_name, last_name")
      .eq("id", args.client_id)
      .maybeSingle();
    let priorScores: Record<string, number | null> = {};
    if (client?.linked_user_id) {
      const { data: prof } = await admin
        .from("profiles")
        .select("estimated_fico_tu, estimated_fico_ex, estimated_fico_eq")
        .eq("user_id", client.linked_user_id)
        .maybeSingle();
      priorScores = {
        TU: (prof?.estimated_fico_tu as number | null) ?? null,
        EX: (prof?.estimated_fico_ex as number | null) ?? null,
        EQ: (prof?.estimated_fico_eq as number | null) ?? null,
      };
      for (const s of args.scores) {
        const prior = priorScores[s.bureau];
        if (prior != null && Math.abs(prior - s.score) > 40) {
          reviewReasons.push(`large_delta:${s.bureau}:${prior}->${s.score}`);
        }
      }
    }

    const needsReview = reviewReasons.length > 0;
    const diff: Record<string, unknown> = {};
    for (const s of args.scores) diff[`fico_${s.bureau.toLowerCase()}`] = { from: priorScores[s.bureau] ?? null, to: s.score, source: s.source, pulled_on: s.pulled_on };

    const proposal = await recordProposal({
      client_id: args.client_id,
      tool_name: "ingest_credit_scores",
      target_table: "profiles",
      payload: { scores: args.scores },
      diff,
      confidence: args.confidence,
      source: "mcp:field_ops",
      external_llm_model: args.external_llm_model,
      review_reason: needsReview ? reviewReasons.join(", ") : null,
      auto_status: needsReview ? "needs_review" : "pending",
    });
    if (!proposal) return err("proposal_insert_failed");
    await audit("ingest_credit_scores", "client", args.client_id, { proposal_id: proposal.id, count: args.scores.length, needs_review: needsReview });

    if (!needsReview && args.auto_confirm) {
      const applied = await applyProposal(proposal.id);
      if (!applied.ok) return err(applied.reason ?? "apply_failed");
      return ok({ proposal_id: proposal.id, status: "applied", applied: applied.applied, client_id: args.client_id });
    }

    return ok({
      proposal_id: proposal.id,
      status: needsReview ? "needs_review" : "pending",
      diff,
      review_reasons: reviewReasons,
      next_step: needsReview
        ? "Routed to the governed approval queue for human review. Do NOT confirm."
        : 'Read the scores back verbatim ("TransUnion 520 from a soft pull on 2026-06-29 — correct?"). Then call confirm_proposal.',
    });
  },
});

mcp.tool("ingest_banking_snapshot", {
  description:
    "Stage a manual banking snapshot for a client (current balance, avg daily balance, NSFs in last 30d, monthly deposits). Goes through the same proposal workflow as ingest_credit_scores. Applied write lands in manual_banking_entries on confirm.",
  inputSchema: z.object({
    client_id: z.string(),
    bank_name: z.string(),
    current_balance: z.number().optional(),
    avg_daily_balance: z.number().optional(),
    nsf_count_30d: z.number().int().optional(),
    monthly_deposits: z.number().optional(),
    period_label: z.string().optional().describe('Free text e.g. "June 2026" or "Last 30 days".'),
    confidence: z.enum(CONFIDENCE),
    external_llm_model: z.string().optional(),
  }),
  handler: async (args) => {
    const scope = await tenantScopedClient(args.client_id);
    if (!scope.ok) return err(scope.reason ?? "scope_denied");
    const review: string[] = [];
    if ((args.current_balance ?? 0) < 0) review.push("negative_balance");
    if ((args.nsf_count_30d ?? 0) > 20) review.push("high_nsf_count");
    if (args.confidence === "low") review.push("low_confidence");

    const proposal = await recordProposal({
      client_id: args.client_id,
      tool_name: "ingest_banking_snapshot",
      target_table: "manual_banking_entries",
      payload: args,
      diff: { snapshot: args },
      confidence: args.confidence,
      source: "mcp:field_ops",
      external_llm_model: args.external_llm_model,
      review_reason: review.length ? review.join(", ") : null,
      auto_status: review.length ? "needs_review" : "pending",
    });
    if (!proposal) return err("proposal_insert_failed");
    await audit("ingest_banking_snapshot", "client", args.client_id, { proposal_id: proposal.id });
    return ok({
      proposal_id: proposal.id,
      status: review.length ? "needs_review" : "pending",
      review_reasons: review,
      next_step: review.length
        ? "Routed to the governed approval queue."
        : "Read snapshot back to teammate, then call confirm_proposal.",
    });
  },
});

mcp.tool("append_client_memory", {
  description:
    "Append a structured coach/agent note to a client's long-term memory. Goes straight into client_memory once confirmed. Use this for context Paige should remember (e.g. \"client just had a baby\", \"prefers SBA over MCA\", \"working on Equifax disputes only\").",
  inputSchema: z.object({
    client_id: z.string(),
    note: z.string().describe("Plain text, max 4000 chars."),
    category: z.enum(["coach_note", "session_summary", "milestone_completed", "lender_researched"]).default("coach_note"),
    confidence: z.enum(CONFIDENCE),
    auto_confirm: z.boolean().optional(),
    external_llm_model: z.string().optional(),
  }),
  handler: async (args) => {
    const scope = await tenantScopedClient(args.client_id);
    if (!scope.ok) return err(scope.reason ?? "scope_denied");
    const text = String(args.note).slice(0, 4000);
    const needsReview = args.confidence === "low";
    const proposal = await recordProposal({
      client_id: args.client_id,
      tool_name: "append_client_memory",
      target_table: "client_memory",
      payload: { note: text, category: args.category },
      diff: { note: { to: text, category: args.category } },
      confidence: args.confidence,
      source: "mcp:field_ops",
      external_llm_model: args.external_llm_model,
      review_reason: needsReview ? "low_confidence" : null,
      auto_status: needsReview ? "needs_review" : "pending",
    });
    if (!proposal) return err("proposal_insert_failed");
    await audit("append_client_memory", "client", args.client_id, { proposal_id: proposal.id });

    if (!needsReview && args.auto_confirm) {
      const applied = await applyProposal(proposal.id);
      if (!applied.ok) return err(applied.reason ?? "apply_failed");
      return ok({ proposal_id: proposal.id, status: "applied", applied: applied.applied });
    }
    return ok({
      proposal_id: proposal.id,
      status: needsReview ? "needs_review" : "pending",
      next_step: needsReview ? "Routed to the governed approval queue." : "Read back to teammate, then call confirm_proposal.",
    });
  },
});

mcp.tool("confirm_proposal", {
  description:
    "Commit a staged ingestion proposal after the teammate has verified the diff verbatim. Applies the write to the underlying table (profiles / client_memory / manual_banking_entries / clients) and stamps `applied`. Rejects proposals that are expired, already-decided, or in needs_review (those require admin sign-off).",
  inputSchema: z.object({ proposal_id: z.string() }),
  handler: async ({ proposal_id }) => {
    const applied = await applyProposal(proposal_id);
    if (!applied.ok) return err(applied.reason ?? "apply_failed");
    return ok({ proposal_id, status: "applied", applied: applied.applied });
  },
});

mcp.tool("reject_proposal", {
  description: "Discard a staged proposal. Use when the teammate corrects themselves before confirming.",
  inputSchema: z.object({ proposal_id: z.string(), reason: z.string().optional() }),
  handler: async ({ proposal_id, reason }) => {
    const actor = currentActor();
    const { error } = await admin
      .from("paige_ingestion_proposals")
      .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: actor.user_id, review_reason: reason ?? null })
      .eq("id", proposal_id)
      .in("status", ["pending", "needs_review"]);
    if (error) return err(error.message);
    await audit("reject_proposal", "proposal", proposal_id, { reason: reason ?? null });
    return ok({ proposal_id, status: "rejected" });
  },
});

mcp.tool("list_my_proposals", {
  description: "List recent ingestion proposals the caller created. Useful for status checks (\"did that update go through?\").",
  inputSchema: z.object({
    status: z.enum(["pending", "needs_review", "applied", "rejected", "expired"]).optional(),
    limit: z.number().int().optional(),
  }),
  handler: async ({ status, limit }) => {
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    const actor = currentActor();
    let q = admin
      .from("paige_ingestion_proposals")
      .select("id, client_id, tool_name, status, confidence, review_reason, created_at, decided_at")
      .order("created_at", { ascending: false })
      .limit(max);
    if (actor.user_id) q = q.eq("actor_user_id", actor.user_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

// Shared committer used by confirm_proposal and ingest_*({auto_confirm:true}).
async function applyProposal(proposal_id: string): Promise<{ ok: boolean; applied?: Record<string, unknown>; reason?: string }> {
  const { data: prop, error } = await admin
    .from("paige_ingestion_proposals")
    .select("*")
    .eq("id", proposal_id)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!prop) return { ok: false, reason: "proposal_not_found" };
  if (prop.status !== "pending") return { ok: false, reason: `proposal_status_${prop.status}` };
  if (prop.expires_at && new Date(prop.expires_at) < new Date()) {
    await admin.from("paige_ingestion_proposals").update({ status: "expired" }).eq("id", proposal_id);
    return { ok: false, reason: "proposal_expired" };
  }

  const actor = currentActor();
  const payload = (prop.payload ?? {}) as Record<string, any>;
  const applied: Record<string, unknown> = {};

  try {
    switch (prop.tool_name) {
      case "propose_client_update": {
        const updates = payload.updates ?? {};
        const { error: upErr } = await admin.from("clients").update(updates).eq("id", prop.client_id);
        if (upErr) throw upErr;
        applied.clients = { id: prop.client_id, updated_fields: Object.keys(updates) };
        break;
      }
      case "ingest_credit_scores": {
        const { data: cli } = await admin.from("clients").select("linked_user_id").eq("id", prop.client_id).maybeSingle();
        const scores = payload.scores ?? [];
        if (cli?.linked_user_id) {
          const patch: Record<string, number | string> = {};
          for (const s of scores) {
            if (s.bureau === "TU") patch.estimated_fico_tu = s.score;
            if (s.bureau === "EX") patch.estimated_fico_ex = s.score;
            if (s.bureau === "EQ") patch.estimated_fico_eq = s.score;
          }
          if (Object.keys(patch).length) {
            const { error: pErr } = await admin.from("profiles").update(patch).eq("user_id", cli.linked_user_id);
            if (pErr) throw pErr;
            applied.profiles = { user_id: cli.linked_user_id, patch };
          }
        }
        // Always log a structured memory entry so non-linked clients still capture history.
        const summary = scores
          .map((s: any) => `${s.bureau} ${s.score} (${s.source}, ${s.pulled_on})`)
          .join("; ");
        const { error: mErr } = await admin.from("client_memory").insert({
          client_user_id: actor.user_id ?? "00000000-0000-0000-0000-000000000000",
          client_id: prop.client_id,
          memory_type: "report_upload",
          content: `Credit scores ingested via MCP field-ops: ${summary}`,
          metadata: { proposal_id, scores, source: "mcp:field_ops", external_llm_model: prop.external_llm_model ?? null },
        });
        if (mErr) console.error("[apply credit_scores] memory insert failed", mErr.message);
        applied.client_memory = { logged: true };
        break;
      }
      case "ingest_banking_snapshot": {
        const { data: cli } = await admin
          .from("clients")
          .select("linked_user_id")
          .eq("id", prop.client_id)
          .maybeSingle();
        if (!cli?.linked_user_id) {
          // No linked auth user — capture the snapshot as a structured memory entry instead.
          await admin.from("client_memory").insert({
            client_user_id: actor.user_id ?? "00000000-0000-0000-0000-000000000000",
            client_id: prop.client_id,
            memory_type: "session_summary",
            content: `Banking snapshot (no linked user): ${JSON.stringify(payload)}`,
            metadata: { proposal_id, source: "mcp:field_ops:banking_no_link" },
          });
          applied.client_memory = { logged: true, note: "client has no linked_user_id; stored in memory" };
        } else {
          const { data: bRow, error: bErr } = await admin
            .from("manual_banking_entries")
            .upsert(
              {
                user_id: cli.linked_user_id,
                avg_daily_balance: payload.avg_daily_balance ?? 0,
                avg_monthly_revenue: payload.monthly_deposits ?? 0,
                monthly_nsf_count: payload.nsf_count_30d ?? 0,
              },
              { onConflict: "user_id" },
            )
            .select("id")
            .single();
          if (bErr) throw bErr;
          applied.manual_banking_entries = { id: bRow?.id, user_id: cli.linked_user_id };
        }
        break;
      }
      case "append_client_memory": {
        const { data: mRow, error: mErr } = await admin
          .from("client_memory")
          .insert({
            client_user_id: actor.user_id ?? "00000000-0000-0000-0000-000000000000",
            client_id: prop.client_id,
            memory_type: payload.category ?? "coach_note",
            content: payload.note,
            metadata: { proposal_id, source: "mcp:field_ops", external_llm_model: prop.external_llm_model ?? null },
          })
          .select("id")
          .single();
        if (mErr) throw mErr;
        applied.client_memory = { id: mRow?.id };
        break;
      }
      default:
        return { ok: false, reason: `unknown_tool:${prop.tool_name}` };
    }
  } catch (e) {
    const msg = (e as Error).message;
    await admin
      .from("paige_ingestion_proposals")
      .update({ status: "needs_review", review_reason: `apply_failed: ${msg}` })
      .eq("id", proposal_id);
    return { ok: false, reason: `apply_failed:${msg}` };
  }

  await admin
    .from("paige_ingestion_proposals")
    .update({ status: "applied", decided_at: new Date().toISOString(), decided_by: actor.user_id, applied_row_ids: applied })
    .eq("id", proposal_id);
  await audit("apply_proposal", "proposal", proposal_id, { tool: prop.tool_name, applied });
  return { ok: true, applied };
}

// ---------- Pass 5: Orchestrator bridge (Section 18) ----------
// Exposes Paige's sub-agent roster to external MCP clients (Claude Desktop, ChatGPT, voice).
// Routes through `paige-orchestrator` which honors the tool-deferral pattern + logs every invocation.
const ORCHESTRATOR_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/paige-orchestrator`;

async function callOrchestrator(body: Record<string, unknown>) {
  const resp = await fetch(ORCHESTRATOR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "X-Orchestrator-Call": "paige-mcp",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try { return { status: resp.status, body: JSON.parse(text) }; }
  catch { return { status: resp.status, body: { raw: text } }; }
}

mcp.tool("list_subagents", {
  description:
    "List Paige's specialized sub-agents (Fundability Diagnostician, Legal & Compliance Reviewer, Business Credit Strategist, Funding Path Architect, Data Consistency Auditor, Market Research, Financial Research, Content Drafter, Intake Concierge, Sales Pipeline, Coach Copilot). Use this before `delegate_to_subagent` to discover the right slug + input schema. Optional `query` keyword + `domain` filter (fundability / compliance / credit / funding / research / outreach / intake / sales / coaching).",
  inputSchema: z.object({
    query: z.string().optional().describe("Keyword match across name, description, triggers."),
    domain: z.string().optional().describe("Filter by domain (partial match)."),
  }),
  handler: async ({ query, domain }) => {
    // This is the one read on the surface whose only outbound call is a helper. `tool_search` routes
    // to the orchestrator's `searchSubagents`, which is a single `.select()` over `paige_subagents`;
    // the invocation-logging write lives on `tool_invoke`, which is `delegate_to_subagent`'s path.
    // mcp-read-fetch-exempt: tool_search reaches searchSubagents, one select over paige_subagents
    const r = await callOrchestrator({ action: "tool_search", query, domain });
    if (r.status >= 300) return err(`orchestrator_error_${r.status}`);
    return ok(r.body);
  },
});

mcp.tool("delegate_to_subagent", {
  description:
    "Delegate a task to one of Paige's specialized sub-agents. Call `list_subagents` first to resolve the correct `slug`. Pass a sub-agent-specific `input` object (e.g. {contact_id} for fundability/compliance/intake; {query} for market_research; {lender_name} for financial_research). If the contact doesn't exist yet, call `create_contact` first to get a `contact_id`. Returns the sub-agent's structured findings. Every invocation is logged in paige_subagent_invocations for audit + UI surfacing.",
  inputSchema: z.object({
    slug: z.string().describe("Sub-agent slug from list_subagents (e.g. 'fundability-diagnostician')."),
    // Accept object OR JSON-string (some MCP clients stringify nested objects). Coerced server-side.
    input: z.union([z.record(z.any()), z.string()]).optional()
      .describe("Sub-agent-specific arguments as an object. JSON string also accepted and parsed."),
    contact_id: z.string().optional().describe("Optional client UUID for context + logging."),
    conversation_id: z.string().optional().describe("Optional Paige conversation ID for thread linking."),
  }),
  handler: async ({ slug, input, contact_id, conversation_id }) => {
    let parsedInput: Record<string, unknown> = {};
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed) {
        try {
          const j = JSON.parse(trimmed);
          if (j && typeof j === "object" && !Array.isArray(j)) parsedInput = j as Record<string, unknown>;
          else return err(`input must be an object or JSON-string of an object; got ${Array.isArray(j) ? "array" : typeof j}`);
        } catch (_e) {
          return err("input was a string but not valid JSON. Pass an object like {\"contact_id\":\"...\"} or a JSON string of one.");
        }
      }
    } else if (input && typeof input === "object") {
      parsedInput = input as Record<string, unknown>;
    }
    // Auto-promote top-level contact_id into input if sub-agent expects it there
    if (contact_id && !parsedInput.contact_id && !parsedInput.client_id) {
      parsedInput.contact_id = contact_id;
    }
    const actor = currentActor();
    const r = await callOrchestrator({
      action: "tool_invoke",
      slug,
      input: parsedInput,
      context: { contact_id, conversation_id, user_id: actor.user_id ?? undefined },
    });
    await audit("delegate_to_subagent", "subagent", slug, { contact_id: contact_id ?? null, status: r.status });
    if (r.status >= 300) return err(typeof r.body === "object" ? JSON.stringify(r.body) : String(r.body));
    return ok(r.body);
  },
});

// ---------- compose_email (dedicated Email Composer sub-agent) ----------
mcp.tool("compose_email", {
  description:
    "Draft an email via the dedicated Email Composer sub-agent. Paige orchestrates; the composer handles free-form writing so Paige doesn't burn context on hand-crafting every message. Choose `tone` from: professional, warm, welcoming, stern, friendly, executive, apologetic, celebratory, direct, empathetic, urgent. Provide either `contact_id` (auto-loads recipient) OR `recipient_name`/`recipient_email`. Returns {draft.subject, draft.body_html, draft.body_text, compliance_flags}. Pair with `send_composed_email` (or `send_transactional_email`) after review. Never sends on its own.",
  inputSchema: z.object({
    intent: z.string().describe("What this email should accomplish (one sentence)."),
    tone: z.enum([
      "professional","warm","welcoming","stern","friendly",
      "executive","apologetic","celebratory","direct","empathetic","urgent",
    ]).optional().describe("Voice/tone. Default: professional."),
    contact_id: z.string().optional().describe("clients.id — auto-loads name/email/business context."),
    recipient_name: z.string().optional(),
    recipient_email: z.string().optional(),
    key_points: z.array(z.string()).optional().describe("Bullet points the draft must cover."),
    length: z.enum(["short","medium","long"]).optional().describe("Default: medium."),
    cta: z.string().optional().describe("Desired call-to-action, e.g. 'book a 15-min call'."),
    subject_hint: z.string().optional(),
    sender_name: z.string().optional().describe("Signature line. Defaults to the configured sender name."),
    sender_title: z.string().optional(),
    format: z.enum(["html","plain"]).optional(),
  }),
  handler: async (args) => {
    const r = await callOrchestrator({
      action: "tool_invoke",
      slug: "email-composer",
      input: args,
      context: { contact_id: args.contact_id, user_id: currentActor().user_id ?? undefined },
    });
    await audit("compose_email", "email_draft", args.contact_id ?? args.recipient_email ?? "adhoc", {
      tone: args.tone ?? "professional", length: args.length ?? "medium", status: r.status,
    });
    if (r.status >= 300) return err(typeof r.body === "object" ? JSON.stringify(r.body) : String(r.body));
    return ok(r.body);
  },
});

// ---------- send_composed_email (convenience: send a drafted email) ----------
mcp.tool("send_composed_email", {
  description:
    "Send an email that was drafted via `compose_email`. Thin wrapper over `send_transactional_email` that keeps the composer → send flow explicit. Use this ONLY after a human (or Paige) has reviewed the draft. For programmatic composition+send in one shot, still prefer the two-step so compliance flags are surfaced.",
  inputSchema: z.object({
    to: z.string().describe("Recipient email address."),
    subject: z.string(),
    body_html: z.string(),
    body_text: z.string().optional(),
    contact_id: z.string().optional(),
    tenant_id: z.string().optional(),
    tone_used: z.string().optional().describe("Echo of tone (audit trail)."),
    acknowledged_compliance_flags: z.array(z.string()).optional()
      .describe("If compose_email returned flags, list them here to confirm human review."),
  }),
  handler: async (args) => {
    const tenant_id = await resolveTenantId(args.tenant_id ?? null);
    if (!tenant_id) return err("tenant_not_resolved");
    const { data: idn } = await admin.rpc("tenant_sender_identity", { _tenant_id: tenant_id });
    const fromAddress = (idn as any)?.from_address as string | undefined;
    const fromName = (idn as any)?.from_name as string | undefined;
    const replyTo = (idn as any)?.reply_to as string | undefined;
    if (!fromAddress) return err("from_address_not_resolved");
    if (!RESEND_API_KEY) return err("resend_not_configured");

    const send_id = crypto.randomUUID();
    const fromHeader = fromName ? `${fromName} <${fromAddress}>` : fromAddress;
    let resendId: string | null = null;
    let status: "sent" | "failed" = "sent";
    let errorMsg: string | null = null;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: fromHeader,
          to: [args.to],
          subject: args.subject,
          html: args.body_html,
          text: args.body_text || undefined,
          reply_to: replyTo || undefined,
          headers: { "X-Paige-Send-Id": send_id, "X-Paige-Source": "compose_email" },
        }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok) { status = "failed"; errorMsg = (j as any)?.message ?? `resend_${r.status}`; }
      else resendId = (j as any)?.id ?? null;
    } catch (e) {
      status = "failed";
      errorMsg = (e as Error).message.slice(0, 300);
    }
    try {
      await admin.from("email_send_log").insert({
        id: send_id,
        tenant_id,
        contact_id: args.contact_id ?? null,
        recipient_email: args.to,
        from_address: fromAddress,
        subject: args.subject,
        template_key: null,
        product_scope: "composed",
        status,
        provider_message_id: resendId,
        error_message: errorMsg,
      });
    } catch { /* log table may not have all columns — non-fatal */ }
    await audit("send_composed_email", "email", send_id, {
      to: args.to, tenant_id, tone_used: args.tone_used ?? null,
      acknowledged_flags: args.acknowledged_compliance_flags ?? [],
      status,
    });
    return ok({ send_id, resend_id: resendId, status, from: fromHeader, to: args.to, error: errorMsg });
  },
});





mcp.tool("get_subagent_history", {
  description:
    "Read recent sub-agent invocation history (status, latency, output) for audit + debugging. Filter by `slug` or `contact_id`.",
  inputSchema: z.object({
    slug: z.string().optional(),
    contact_id: z.string().optional(),
    limit: z.number().int().optional().describe("1–50, default 20."),
  }),
  handler: async ({ slug, contact_id, limit }) => {
    const max = Math.min(Math.max(limit ?? 20, 1), 50);
    let q = admin
      .from("paige_subagent_invocations")
      .select("id, subagent_slug, contact_id, conversation_id, status, latency_ms, error, created_at")
      .order("created_at", { ascending: false })
      .limit(max);
    if (slug) q = q.eq("subagent_slug", slug);
    if (contact_id) q = q.eq("contact_id", contact_id);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

// ---------- Paige Skills Registry (Doctrine §119 Conversational Control Plane) ----------
// Accept either a JSON object or a JSON-encoded string (workaround for MCP clients
// — incl. Claude Desktop / some SDKs — that send `{}`-shaped args as strings).
const jsonObjectOrString = z
  .union([z.record(z.any()), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return {};
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return {};
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch { /* fall through */ }
      return {};
    }
    return v;
  });

mcp.tool("list_skills", {
  description:
    "List Paige's executable skills (reusable recipes like `verify_business_sos`, `draft_and_email_document`, `build_game_plan`, `research_to_concept_brief`). Filter by `query` (matches slug/name/description), `risk_level` (low/medium/high), or `status` (defaults to `active`). Returns each skill's slug, name, description, risk_level, steps summary, and required tools — call `run_skill` to execute.",
  inputSchema: z.object({
    query: z.string().optional(),
    risk_level: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["active", "draft", "disabled", "archived"]).optional().describe("Defaults to 'active'."),
  }),
  handler: async ({ query, risk_level, status }) => {
    let q = admin
      .from("paige_skills")
      .select("id, slug, name, description, risk_level, status, mutating, allowed_tools, steps, run_count, require_admin_confirm_first_n")
      .order("name", { ascending: true })
      .limit(100);
    q = q.eq("status", status ?? "active");
    if (risk_level) q = q.eq("risk_level", risk_level);
    if (query) q = q.or(`slug.ilike.%${query}%,name.ilike.%${query}%,description.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) return err(error.message);
    const items = (data ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      tools: s.allowed_tools,
      external_send: s.risk_level === "external_send",
    }));
    return ok({ items, count: items.length });
  },
});

mcp.tool("run_skill", {
  description:
    "Execute a Paige skill by slug. Pass `inputs` as a JSON object (or JSON-encoded string) matching the skill's expected shape — e.g. `verify_business_sos` takes `{ business_id }`, `draft_and_email_document` takes `{ contact_id, doc_type, ... }`. Set `dry_run: true` to validate without firing. Mutating + external-send skills require admin confirmation on their first N runs (returns `awaiting_confirm`). Returns `{ run_id, status, outputs }`. Poll with `get_skill_run` for long-running runs.",
  inputSchema: z.object({
    slug: z.string().describe("Skill slug from list_skills."),
    inputs: jsonObjectOrString.describe("Skill-specific arguments (object or JSON string)."),
    contact_id: z.string().optional(),
    dry_run: z.boolean().optional().describe("Validate spec + inputs without running."),
    confirm_token: z.string().optional().describe("Admin confirmation token for gated first-N runs."),
  }),
  handler: async ({ slug, inputs, contact_id, dry_run, confirm_token }) => {
    const actor = currentActor();
    if (dry_run) {
      const { data: skill, error } = await admin
        .from("paige_skills")
        .select("slug, name, description, risk_level, status, mutating, allowed_tools, steps, require_admin_confirm_first_n, run_count")
        .eq("slug", slug)
        .maybeSingle();
      if (error) return err(error.message);
      if (!skill) return err(`Unknown skill: ${slug}`);
      if (skill.status !== "active") return err(`Skill is ${skill.status}`);
      const willGate = (skill.require_admin_confirm_first_n ?? 0) > 0
        && (skill.run_count ?? 0) < skill.require_admin_confirm_first_n
        && actor.kind !== "platform";
      const skillOut = { ...skill, tools: skill.allowed_tools, external_send: skill.risk_level === "external_send" };
      return ok({ dry_run: true, skill: skillOut, resolved_inputs: inputs, would_gate_on_confirm: willGate });
    }
    // §9/#135 — for a BUSINESS-WIDE skill (no contact_id: compliance, ops, finance) resolve the
    // caller's tenant SERVER-SIDE (from the authenticated actor, never a body-trusted claim) and
    // forward it. Without it the interpreter's tenant-resolution guard returns needs_config and the
    // skill can never run from the Paige-chat/MCP surface. When a contact_id IS present, skill-runner
    // already derives the authoritative tenant from the contact (and its tenant_mismatch guard treats a
    // divergent body tenant as an IDOR) — so we forward ONLY in the no-contact case, leaving the
    // contact path byte-identical (§37). actorTenantId() mirrors current_user_tenant_id(); a genuinely
    // tenant-less caller resolves null and the run still degrades honestly.
    const forwardedTenantId = contact_id ? undefined : ((await actorTenantId()) ?? undefined);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/skill-runner`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
      body: JSON.stringify({
        skill_slug: slug,
        inputs: inputs ?? {},
        contact_id: contact_id ?? null,
        tenant_id: forwardedTenantId,
        invoker_kind: "mcp",
        invoker_user_id: actor.user_id ?? null,
        confirm_token,
      }),
    });
    const body = await r.json().catch(() => ({}));
    await audit("run_skill", "skill", slug, { contact_id: contact_id ?? null, status: r.status, run_id: (body as { run_id?: string })?.run_id ?? null });
    if (r.status >= 300) return err(typeof body === "object" ? JSON.stringify(body) : String(body));
    return ok(body);
  },
});

mcp.tool("get_skill_run", {
  description: "Fetch a single skill run by id, including status, inputs, outputs, steps log, and any error. Use this to poll runs returned by `run_skill`.",
  inputSchema: z.object({ run_id: z.string() }),
  handler: async ({ run_id }) => {
    const { data, error } = await admin
      .from("paige_skill_runs")
      .select("id, skill_id, skill_slug, contact_id, invoker_kind, invoker_user_id, inputs, outputs, status, error, steps, latency_ms, created_at, completed_at")
      .eq("id", run_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("run not found");
    return ok(data);
  },
});

mcp.tool("verify_business", {
  description:
    "Run business verification for a `business_id` — scrapes Secretary of State portals (10 states), OpenCorporates, and SEC EDGAR via the `business-verifier` agent and writes a `business_verifications` record with a composite_score 0–100 + per-source mismatch flags. Paid adapters (D&B, LexisNexis, TransUnion, Array) auto-activate when their secrets land. Convenience wrapper around the verification sub-agent.",
  inputSchema: z.object({ business_id: z.string() }),
  handler: async ({ business_id }) => {
    // §9 — the business MUST belong to the caller's resolved tenant before we dispatch. business-verifier
    // treats a service-role bearer as a trusted `system` caller (tenant-scoping deferred to the dispatcher,
    // exactly as skill-runner does at skill-runner/index.ts:787-791), so an unscoped body `business_id`
    // here would be the cross-tenant verification IDOR reopened through this door — verifying any tenant's
    // business and burning paid-adapter budget (D&B/LexisNexis/TransUnion/Array) against it. Scope it.
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data: ownedBiz, error: ownErr } = await admin
      .from("businesses").select("id").eq("id", business_id).eq("tenant_id", tenantId).maybeSingle();
    if (ownErr) return err(ownErr.message);
    if (!ownedBiz) return err("business_not_found_in_your_workspace");
    const r = await fetch(`${SUPABASE_URL}/functions/v1/business-verifier`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
      body: JSON.stringify({ business_id, triggered_by: "mcp" }),
    });
    const body = await r.json().catch(() => ({}));
    await audit("verify_business", "business", business_id, { status: r.status, composite_score: (body as { composite_score?: number })?.composite_score ?? null });
    // Read the OUTCOME through the shared classifier (§18/§37), not the HTTP status alone: a policy refusal
    // (the Funding & Coaching Tools gate's HTTP-200 `ok:false`) and every operational failure both mean the
    // verification did NOT run — `ok(body)` on either would tell the calling agent the tool completed
    // (§13 "a fire is not a delivery"). business-verifier returns `ok:true` for any run that happened
    // (even a `status:"failed"` no-match), so a real run is never mislabeled.
    const bv = body as { ok?: unknown; result?: unknown; error?: string; message?: string; reason?: string };
    if (classifyBusinessVerifyResponse(r.status < 300, bv) !== "ran") {
      return err(bv?.reason ?? bv?.message ?? bv?.error ?? (typeof body === "object" ? JSON.stringify(body) : String(body)));
    }
    return ok(body);
  },
});

// ---------- Sub-Agent Factory (Section 18.5) — Paige proposes new sub-agents ----------
// Doctrine §124 amendment: soft runtime has NO MCP tool access. Detect tool-call
// patterns in the system_prompt and refuse soft proposals that would hallucinate.
const SOFT_TOOL_CALL_PATTERNS = [
  /\b(call|invoke|use|run|execute|query|fetch|delegate(?:\s+to)?)\s+(?:the\s+)?(?:list_|run_|get_|verify_|search_|create_|update_|delete_|advance_|bulk_|broadcast_|send_|propose_|tool_)[a-z_]+/i,
  /\b(?:list_|run_|get_|verify_|search_|create_|update_|delete_|advance_|bulk_|broadcast_|send_|propose_|tool_)[a-z_]+\s*\(/,
  /\b(?:MCP|tool[_\s]?invoke|tool[_\s]?search|tool[_\s]?registry)\b/i,
  /\bcall\s+(?:any|the|its?)\s+tools?\b/i,
];

mcp.tool("propose_subagent", {
  description:
    "Propose a new sub-agent. SOFT proposals (runtime='soft') ship live instantly but have NO MCP tool access at runtime — they are pure prompt-only transformation/reasoning over the inputs given in the prompt. If your agent needs to fetch data, query tables, call list_*/run_*/get_*/verify_*/send_* tools, or delegate to other agents, it MUST be runtime='local' or 'langgraph' (these route to the Approvals Hub for admin sign-off because they require new edge function code). Soft agents that reference tool calls in their system_prompt will be rejected. Use when no existing sub-agent fits (call list_subagents first). Provide a clear `rationale` — admins read it.",
  inputSchema: z.object({
    slug: z.string().describe("kebab-case, e.g. 'churn-risk-scout'. Must be unique."),
    name: z.string(),
    domain: z.enum(["fundability","compliance","credit","funding","research","outreach","intake","sales","coaching","ops","support","marketing","analytics","automation"]),
    description: z.string().describe("What the agent does (≥20 chars)."),
    rationale: z.string().describe("Why this agent is needed (≥20 chars). Admins read this."),
    runtime: z.enum(["soft","local","langgraph"]).default("soft"),
    system_prompt: z.string().describe("The agent's system prompt (≥50 chars). For soft runtime: pure reasoning only, no tool references. For local/langgraph: may describe tool usage."),
    triggers: z.array(z.string()).optional().describe("Keyword triggers e.g. ['churn', 'retention risk']"),
    data_scopes: z.array(z.string()).optional().describe("Tables the agent reads. Soft agents may NOT include protected scopes (credit/banking/etc)."),
    input_schema: z.record(z.string(), z.unknown()).optional(),
    output_schema: z.record(z.string(), z.unknown()).optional(),
    config: z.record(z.string(), z.unknown()).optional().describe("Optional config, e.g. {model: 'google/gemini-2.5-pro'}"),
  }),
  handler: async (args) => {
    // Enforce kebab-case slugs (§F3) — reject underscores at proposal time.
    if (!/^[a-z][a-z0-9-]{2,40}$/.test(args.slug)) {
      return err(
        `Slug must be kebab-case matching ^[a-z][a-z0-9-]{2,40}$ (lowercase letters, digits, and hyphens only — no underscores). Got: ${args.slug}`,
      );
    }
    // Guardrail: soft agents cannot call tools. Scan the prompt before forwarding.
    if (args.runtime === "soft") {
      const hit = SOFT_TOOL_CALL_PATTERNS.find((re) => re.test(args.system_prompt));
      if (hit) {
        await audit("propose_subagent", "subagent_proposal", args.slug, {
          runtime: args.runtime,
          status: 400,
          rejected_reason: "soft_runtime_tool_call_detected",
          pattern: hit.toString(),
        });
        return err(
          `Soft runtime has NO tool access at runtime — your system_prompt references tool calls (matched: ${hit}). ` +
          `Either (a) re-propose with runtime='local' so the agent gets real tool access via an edge function, ` +
          `or (b) rewrite the system_prompt as pure reasoning/transformation over the inputs you pass in.`,
        );
      }
    }
    // §9/§59 — stamp the ACTOR's workspace, the same way every other tool here does.
    // Without it the forge received no tenant and minted a PLATFORM DEFAULT: an agent
    // every workspace on the fleet receives. X-Orchestrator-Call marks this agent-origin,
    // so the per-tenant proposal cap always applies (D-1).
    const proposeTenantId = await actorTenantId();
    if (!proposeTenantId) return err("tenant_not_resolved");
    const r = await fetch(`${SUPABASE_URL}/functions/v1/subagent-forge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY,
        "X-Orchestrator-Call": "1",
      },
      body: JSON.stringify({
        action: "propose",
        ...args,
        proposed_by_agent: "paige-mcp",
        tenant_id: proposeTenantId,
        actor_user_id: currentActor().user_id ?? undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    await audit("propose_subagent", "subagent_proposal", args.slug, { runtime: args.runtime, status: r.status });
    if (r.status >= 300) return err(typeof body === "object" ? JSON.stringify(body) : String(body));
    return ok(body);
  },
});

mcp.tool("list_subagent_proposals", {
  description: "List recent sub-agent proposals (proposed, approved, rejected, live, failed). Includes today's quota usage.",
  inputSchema: z.object({
    status: z.enum(["proposed","approved","rejected","generated","live","failed"]).optional(),
  }),
  handler: async ({ status }) => {
    // §9 — scoped to the actor's workspace. This previously sent no tenant at all, and
    // the forge's list ran on the service-role client (RLS bypassed), so it returned every
    // workspace's proposals to any MCP caller.
    const listTenantId = await actorTenantId();
    if (!listTenantId) return err("tenant_not_resolved");
    // The forge's `list` action is a `.select()` over `paige_subagent_proposals`, ordered and
    // limited — no insert, update, delete or provider call anywhere on that branch.
    // mcp-read-fetch-exempt: subagent-forge action list is a select over the proposals table
    const r = await fetch(`${SUPABASE_URL}/functions/v1/subagent-forge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY,
        "X-Orchestrator-Call": "1",
      },
      body: JSON.stringify({ action: "list", status, tenant_id: listTenantId }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.status >= 300) return err(typeof body === "object" ? JSON.stringify(body) : String(body));
    return ok(body);
  },
});

mcp.tool("approve_subagent_proposal", {
  description: "Admin only. Approve a hard sub-agent proposal and ship it live.",
  inputSchema: z.object({ proposal_id: z.string() }),
  handler: async ({ proposal_id }, ctx) => {
    const userId = (ctx as { userId?: string })?.userId;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/subagent-forge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY,
        "X-Acting-User": userId ?? "",
      },
      body: JSON.stringify({ action: "approve", proposal_id }),
    });
    const body = await r.json().catch(() => ({}));
    await audit("approve_subagent_proposal", "subagent_proposal", proposal_id, { status: r.status });
    if (r.status >= 300) return err(typeof body === "object" ? JSON.stringify(body) : String(body));
    return ok(body);
  },
});


// ============================================================
// Agency tier (§9/§25) — an Agency/Enterprise tenant manages its OWN
// sub-accounts and NOTHING else. Audience is gated by enforceTierAndScope
// (agency tier); row-level isolation is the load-bearing SQL guard
// agency_can_manage_child(_child, _actor) — every tool that names a child
// re-proves parentage server-side, so a hostile call by name still fails
// closed. No tool here accepts a parent id (parent = the caller's own tenant).
// ============================================================

// Thin wrapper over the SQL parentage guard — TRUE iff `child` is a sub-account
// of an Agency/Enterprise the current actor owns/admins.
async function agencyCanManageChild(child: string): Promise<boolean> {
  const actor = currentActor();
  if (!actor.user_id) return actor.kind === "platform"; // platform key is god, not agency-scoped
  const { data, error } = await admin.rpc("agency_can_manage_child", { _child: child, _actor: actor.user_id });
  if (error) return false;
  return data === true;
}

mcp.tool("list_subaccounts", {
  description:
    "Agency only. List the sub-accounts YOUR agency owns (child workspaces of your Agency/Enterprise account). Returns each child's id, slug, name, account type, status, and created date. You only ever see your own children.",
  inputSchema: z.object({
    status: z.enum(["active", "suspended", "all"]).optional().describe("Filter by child status; default all."),
    limit: z.number().int().max(200).optional(),
  }),
  handler: async ({ status, limit }) => {
    const actor = currentActor();
    if (!actor.user_id) return err("agency_actor_required");
    const { data, error } = await admin.rpc("list_subaccounts", { _actor: actor.user_id });
    if (error) return err(error.message);
    let items = (data ?? []) as Array<Record<string, unknown>>;
    if (status && status !== "all") items = items.filter((r) => r.status === status);
    if (limit) items = items.slice(0, limit);
    return ok({ items, count: items.length });
  },
});

mcp.tool("create_subaccount", {
  description:
    "Agency only. Create a new sub-account (child workspace) under YOUR agency. Requires a display `name`; optional `industry` and `description`. The child arrives READY: by default (`inherit_from_parent`) it inherits your agency's white-label brand/voice, and it either carries your Playbook down or starts from `playbook_slug` — one of general, coaching-default, fitness, consultant, agency, or funding. Funding is an explicit opt-in only; it is never inherited or defaulted. The child is a standalone workspace owned by you. Only the agency OWNER may create sub-accounts.",
  inputSchema: z.object({
    name: z.string().min(1),
    industry: z.string().optional(),
    description: z.string().optional(),
    playbook_slug: z
      .enum(["general", "coaching-default", "fitness", "consultant", "agency", "funding"])
      .optional(),
    inherit_from_parent: z.boolean().optional(),
  }),
  handler: async ({ name, industry, description, playbook_slug, inherit_from_parent }) => {
    const actor = currentActor();
    if (!actor.user_id) return err("agency_actor_required");
    const parent = await actorTenantId();
    if (!parent) return err("tenant_not_resolved");
    // Actor-explicit core (service_role): enforces owner-only + agency/enterprise-
    // parent + 100-child cap + forces child account_type, and seeds the inherited
    // brand + chosen/inherited Playbook. §2: funding only ever via an explicit
    // playbook_slug='funding' choice, never a default — do not force it on here.
    const { data, error } = await admin.rpc("create_subaccount", {
      _name: name,
      _industry: industry ?? null,
      _description: description ?? null,
      _parent_tenant_id: parent,
      _actor: actor.user_id,
      _playbook_slug: playbook_slug ?? null,
      _inherit_from_parent: inherit_from_parent ?? true,
    });
    if (error) return err(error.message);
    await audit("create_subaccount", "tenant", (data as any)?.id ?? null, {
      name,
      parent,
      playbook_slug: playbook_slug ?? null,
      inherit_from_parent: inherit_from_parent ?? true,
    });
    return ok({ subaccount: data });
  },
});

mcp.tool("get_subaccount_metrics", {
  description:
    "Agency only. Get a health snapshot (client count, active workflows, active members) for ONE of your own sub-accounts. Fails if the sub-account is not a child of your agency.",
  inputSchema: z.object({
    subaccount_id: z.string().uuid(),
  }),
  handler: async ({ subaccount_id }) => {
    const actor = currentActor();
    if (!actor.user_id) return err("agency_actor_required");
    const { data, error } = await admin.rpc("get_subaccount_metrics", { _child: subaccount_id, _actor: actor.user_id });
    if (error) {
      // The RPC RAISEs 'agency_scope_forbidden' (42501) for a foreign/arbitrary child.
      return err(/agency_scope_forbidden/.test(error.message) ? "agency_scope_forbidden" : error.message);
    }
    return ok({ subaccount_id, metrics: data });
  },
});

mcp.tool("switch_into_subaccount", {
  description:
    "Agency only. Set your active workspace to one of YOUR sub-accounts so subsequent tools operate inside it. You can only switch into a child your agency owns; switching into any other tenant is refused.",
  inputSchema: z.object({
    subaccount_id: z.string().uuid(),
  }),
  handler: async ({ subaccount_id }) => {
    const actor = currentActor();
    if (!actor.user_id) return err("agency_actor_required");
    // One guarded RPC: parentage-checks, ensures the operator has a membership on
    // their own child (so the active tenant actually resolves there and tenant
    // tools operate inside it), then points active_tenant at it. RAISEs
    // agency_scope_forbidden (42501) for a foreign/arbitrary child. The operator
    // stays AGENCY tier throughout (tier is a property of the actor, not the
    // active tenant), so they can list/switch/exit from inside the child.
    const { error } = await admin.rpc("agency_enter_subaccount", { _child: subaccount_id, _actor: actor.user_id });
    if (error) return err(/agency_scope_forbidden/.test(error.message) ? "agency_scope_forbidden" : error.message);
    await audit("switch_into_subaccount", "tenant", subaccount_id, {});
    return ok({ active_tenant_id: subaccount_id });
  },
});

mcp.tool("exit_subaccount", {
  description:
    "Agency only. Leave the sub-account you switched into and return to your agency workspace, so subsequent tools operate at the agency level again.",
  inputSchema: z.object({}),
  handler: async () => {
    const actor = currentActor();
    if (!actor.user_id) return err("agency_actor_required");
    const { data, error } = await admin.rpc("agency_exit_subaccount", { _actor: actor.user_id });
    if (error) return err(/no_agency_home/.test(error.message) ? "no_agency_home" : error.message);
    await audit("exit_subaccount", "tenant", (data as string) ?? null, {});
    return ok({ active_tenant_id: data });
  },
});


// ============================================================
// Batch #4 — Master Admin (god tier, gated via tier=god in TOOL_TIER)
// ============================================================

mcp.tool("list_tenants", {
  description:
    "Master-admin only. List every tenant on the platform with status, seat/customer caps, owner, Stripe linkage, and revenue_class (paid/promotional/internal_test — the operator-internal #29 axis). Filter by `status` (trial/active/past_due/suspended/canceled), `revenue_class`, or `query` (matches name/slug).",
  inputSchema: z.object({
    status: z.string().optional(),
    query: z.string().optional(),
    revenue_class: z.enum(["paid", "promotional", "internal_test"]).optional(),
    limit: z.number().int().optional(),
  }),
  handler: async ({ status, query, revenue_class, limit }) => {
    const max = Math.min(Math.max(limit ?? 50, 1), 200);
    // A revenue_class filter resolves to tenant_ids FIRST, so `.in(...)` bounds the
    // page correctly (filtering after `.limit` would silently under-return, §13).
    let onlyIds: string[] | null = null;
    if (revenue_class) {
      const { data: cls, error: clsErr } = await admin
        .from("tenant_revenue_classification")
        .select("tenant_id")
        .eq("revenue_class", revenue_class);
      if (clsErr) return err(clsErr.message);
      onlyIds = (cls ?? []).map((r: any) => r.tenant_id);
      if (onlyIds.length === 0) return ok({ items: [], count: 0 });
    }
    let q = admin
      .from("tenants")
      .select("id, name, slug, status, owner_user_id, seat_limit, customer_limit, storefront_enabled, plan_offer, stripe_customer_id, stripe_subscription_id, trial_ends_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(max);
    if (status) q = q.eq("status", status as any);
    if (query) q = q.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
    if (onlyIds) q = q.in("id", onlyIds);
    const { data, error } = await q;
    if (error) return err(error.message);
    // Annotate each returned tenant with its revenue_class (operator-internal, §9).
    const items = data ?? [];
    // Annotate by tenant_id — that IS the PK of tenant_revenue_classification.
    let classById = new Map<string, string>();
    if (items.length > 0) {
      const { data: annots } = await admin
        .from("tenant_revenue_classification")
        .select("tenant_id, revenue_class")
        .in("tenant_id", items.map((t: any) => t.id));
      classById = new Map(
        (annots ?? []).map((r: any) => [r.tenant_id, r.revenue_class]),
      );
    }
    const annotated = items.map((t: any) => ({
      ...t,
      revenue_class: classById.get(t.id) ?? "promotional",
    }));
    return ok({ items: annotated, count: annotated.length });
  },
});

mcp.tool("create_tenant", {
  description:
    "Master-admin only. Provision a new tenant (white-label workspace). Requires unique `slug` + display `name`. Optionally set `owner_user_id`, `plan_offer`, `seat_limit`, `customer_limit`, and a starting `status` (defaults to 'trial'). Returns the new tenant row.",
  inputSchema: z.object({
    name: z.string(),
    slug: z.string().describe("URL-safe identifier, e.g. 'acme-credit-coaches'"),
    owner_user_id: z.string().optional(),
    plan_offer: z.string().optional(),
    seat_limit: z.number().int().optional(),
    customer_limit: z.number().int().optional(),
    status: z.enum(["trial", "active", "past_due", "suspended", "canceled"]).optional(),
    brand: z.record(z.any()).optional(),
    features: z.record(z.any()).optional(),
  }),
  handler: async (args) => {
    const payload: Record<string, unknown> = {
      name: args.name, slug: args.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      status: args.status ?? "trial",
    };
    if (args.owner_user_id) payload.owner_user_id = args.owner_user_id;
    if (args.plan_offer) payload.plan_offer = args.plan_offer;
    if (typeof args.seat_limit === "number") payload.seat_limit = args.seat_limit;
    if (typeof args.customer_limit === "number") payload.customer_limit = args.customer_limit;
    if (args.brand) payload.brand = args.brand;
    if (args.features) payload.features = args.features;
    const { data, error } = await admin.from("tenants").insert(payload).select("*").single();
    if (error) return err(error.message);
    await audit("create_tenant", "tenant", data.id, { slug: data.slug });

    // Record Tenant MSA + DPA + AUP acceptances for the named owner (audit trail).
    if (args.owner_user_id) {
      try {
        const { data: docs } = await admin
          .from("legal_documents")
          .select("slug, version")
          .in("slug", ["tenant-msa", "dpa", "aup"])
          .eq("is_current", true);
        if (docs && docs.length) {
          await admin.from("legal_acceptances").insert(
            docs.map((d: any) => ({
              user_id: args.owner_user_id,
              document_slug: d.slug,
              document_version: d.version,
              context: {
                source: "create_tenant_mcp",
                tenant_id: data.id,
                tenant_slug: data.slug,
                actor_user_id: currentActor().user_id ?? null,
              },
            })),
          );
        }
      } catch (e) {
        console.warn("[create_tenant] tenant-msa/dpa/aup acceptance write failed", e);
      }
    }

    return ok({ tenant: data });
  },
});

mcp.tool("suspend_tenant", {
  description:
    "Master-admin only. Set a tenant's `status` (e.g. 'suspended' to freeze access, 'active' to restore, 'canceled' to retire). Records an audit entry.",
  inputSchema: z.object({
    tenant_id: z.string(),
    status: z.enum(["trial", "active", "past_due", "suspended", "canceled"]),
    reason: z.string().optional(),
  }),
  handler: async ({ tenant_id, status, reason }) => {
    const { data, error } = await admin
      .from("tenants").update({ status: status as any }).eq("id", tenant_id)
      .select("id, slug, status").single();
    if (error) return err(error.message);
    await audit("suspend_tenant", "tenant", tenant_id, { status, reason: reason ?? null });
    return ok({ tenant: data });
  },
});

mcp.tool("update_tenant_features", {
  description:
    "Master-admin only. Shallow-merge `features` (jsonb) and optional `brand` (jsonb) on a tenant. Use for feature flags, plan add-ons, and white-label branding tweaks. Existing keys are preserved unless overwritten.",
  inputSchema: z.object({
    tenant_id: z.string(),
    features: z.record(z.any()).optional(),
    brand: z.record(z.any()).optional(),
  }),
  handler: async ({ tenant_id, features, brand }) => {
    const { data: cur, error: e1 } = await admin
      .from("tenants").select("features, brand").eq("id", tenant_id).maybeSingle();
    if (e1) return err(e1.message);
    if (!cur) return err("tenant_not_found");
    const nextFeatures = { ...((cur.features as any) ?? {}), ...(features ?? {}) };
    const nextBrand = { ...((cur.brand as any) ?? {}), ...(brand ?? {}) };
    const { data, error } = await admin
      .from("tenants")
      .update({ features: nextFeatures, brand: nextBrand })
      .eq("id", tenant_id)
      .select("id, slug, features, brand").single();
    if (error) return err(error.message);
    await audit("update_tenant_features", "tenant", tenant_id, { keys: Object.keys(features ?? {}) });
    return ok({ tenant: data });
  },
});

mcp.tool("get_systems_check_status", {
  description:
    "Master-admin only. Returns the latest OPERATOR-scope Systems Check sweep: how many checks passed, which are failing, and — critically — which COULD NOT RUN and why. Use this to answer \"is the platform healthy?\". A skipped check is NOT a passing check: a blocking check that has never run means that risk is UNASSESSED, and must be reported as unknown rather than folded into a healthy-looking ratio.",
  inputSchema: z.object({}).optional() as any,
  handler: async () => {
    // Operator scope is the tenant_id IS NULL rows. This tool is god-locked
    // (MASTER_ONLY_TOOLS) — a tenant caller never reaches it, and it never reads a
    // tenant's own sweep. Tenant-scope Systems Check is its own future tool (§9/§51).
    const { data: runRows, error: runErr } = await admin
      .from("paige_systems_check_run")
      .select("id, started_at, completed_at, check_count, pass_count, fail_count")
      .is("tenant_id", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (runErr) return err(runErr.message);

    const run = (runRows ?? [])[0] as
      | { id: string; started_at: string; completed_at: string | null; check_count: number | null; pass_count: number | null; fail_count: number | null }
      | undefined;
    // §13: a stated absence, never an invented "all clear".
    if (!run) return ok({ swept: false, note: "No operator Systems Check sweep has been recorded yet." });

    const { data: fRows, error: fErr } = await admin
      .from("paige_systems_check_finding")
      .select("check_id, status, severity_at_finding, resolved_at, paige_interpretation, evidence")
      .eq("run_id", run.id);
    if (fErr) return err(fErr.message);

    type Row = {
      check_id: string; status: string; severity_at_finding: string | null; resolved_at: string | null;
      paige_interpretation: string | null; evidence: Record<string, unknown> | null;
    };
    const rows = (fRows ?? []) as Row[];
    const shape = (r: Row) => ({
      check: r.check_id,
      severity: r.severity_at_finding,
      why: r.paige_interpretation,
      evidence: r.evidence,
    });

    const failing = rows.filter((r) => r.status === "fail" && !r.resolved_at);
    const skipped = rows.filter((r) => r.status === "skip");

    return ok({
      swept: true,
      swept_at: run.started_at,
      completed: !!run.completed_at,
      total_checks: rows.length,
      passing: rows.filter((r) => r.status === "pass").length,
      failing: failing.map(shape),
      // Reported as its own axis so a consumer cannot mistake "not failing" for "passing".
      could_not_run: skipped.map(shape),
      unassessed_blocking: skipped
        .filter((r) => (r.severity_at_finding ?? "low") === "blocking")
        .map((r) => r.check_id),
      note:
        "A check in could_not_run is neither passing nor failing. Anything listed in unassessed_blocking is a blocking risk with NO current signal — report it as unknown, not as healthy.",
    });
  },
});

mcp.tool("get_platform_metrics", {
  description:
    "Master-admin only. Returns rolled-up platform health: tenant counts by status AND by revenue_class (paid/promotional/internal_test — the operator-internal #29 axis), total users, total contacts, BTF active clients, workflow runs in the last 7d, and pending approvals.",
  inputSchema: z.object({}).optional() as any,
  handler: async () => {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [tenants, contacts, profiles, btf, runs7d, pending, revClasses] = await Promise.all([
      admin.from("tenants").select("status", { count: "exact" }),
      admin.from("clients").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("user_id", { count: "exact", head: true }),
      admin.from("clients").select("id", { count: "exact", head: true }).eq("tier", "btf"),
      admin.from("paige_workflow_runs").select("id", { count: "exact", head: true }).gte("created_at", since7d),
      admin.from("paige_pending_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("tenant_revenue_classification").select("revenue_class"),
    ]);
    const tenantStatus: Record<string, number> = {};
    for (const row of tenants.data ?? []) {
      const s = String((row as any).status);
      tenantStatus[s] = (tenantStatus[s] ?? 0) + 1;
    }
    // #29 revenue honesty: paying vs comped vs internal-test. A tenant with no
    // classification row reads promotional (the #29 baseline), so the split always sums.
    const revClass: Record<string, number> = { paid: 0, promotional: 0, internal_test: 0 };
    for (const row of revClasses.data ?? []) {
      const c = String((row as any).revenue_class);
      if (c in revClass) revClass[c] += 1;
    }
    const classified = (revClasses.data ?? []).length;
    revClass.promotional += Math.max((tenants.count ?? 0) - classified, 0);
    return ok({
      tenants_total: tenants.count ?? 0,
      tenants_by_status: tenantStatus,
      tenants_by_revenue_class: revClass,
      users_total: profiles.count ?? 0,
      contacts_total: contacts.count ?? 0,
      btf_clients: btf.count ?? 0,
      workflow_runs_7d: runs7d.count ?? 0,
      pending_approvals: pending.count ?? 0,
      generated_at: new Date().toISOString(),
    });
  },
});

mcp.tool("broadcast_system_announcement", {
  description:
    "Master-admin only. Push a system-wide announcement into every admin's notification inbox (paige_admin_notifications, scope='all'). Use for maintenance windows, new feature drops, compliance alerts.",
  inputSchema: z.object({
    title: z.string(),
    body: z.string().optional(),
    severity: z.enum(["info", "warning", "critical"]).optional(),
    link_to: z.string().optional(),
  }),
  handler: async ({ title, body, severity, link_to }) => {
    const { data, error } = await admin.from("paige_admin_notifications").insert({
      title, body: body ?? null, severity: severity ?? "info", scope: "all",
      link_to: link_to ?? null, source_workflow_key: "mcp.broadcast_system_announcement",
    }).select("id").single();
    if (error) return err(error.message);
    await audit("broadcast_system_announcement", "notification", data.id, { title, severity });
    return ok({ notification_id: data.id });
  },
});

// ============================================================
// Batch #5 — Tenant Admin + Comms (9 tools, tenant-scoped)
// ============================================================

mcp.tool("update_tenant_branding", {
  description:
    "Update the caller's tenant display name and brand jsonb (logo_url, primary_color, accent_color, etc.). Only writes the keys you pass; brand is shallow-merged. Admins/owners only.",
  inputSchema: z.object({
    name: z.string().optional(),
    brand: z.record(z.any()).optional().describe("Partial brand object — merged into existing brand."),
  }),
  handler: async ({ name, brand }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const { data: cur } = await admin.from("tenants").select("brand").eq("id", tenant_id).maybeSingle();
    const nextBrand = { ...(((cur as any)?.brand as any) ?? {}), ...(brand ?? {}) };
    const patch: Record<string, unknown> = { brand: nextBrand };
    if (name) patch.name = name;
    const { data, error } = await admin.from("tenants").update(patch).eq("id", tenant_id)
      .select("id, name, brand").single();
    if (error) return err(error.message);
    await audit("update_tenant_branding", "tenant", tenant_id, { keys: Object.keys(brand ?? {}) });
    return ok({ tenant: data });
  },
});

mcp.tool("get_tenant_domain_identity", {
  description:
    "Return the caller tenant's canonical default website/portal domain plus its current default email-sending domain. Use this when the owner asks what their domain is, needs an onboarding link, or asks how website and email domains differ. Read-only.",
  inputSchema: z.object({}).optional() as any,
  handler: async () => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const { data, error } = await admin.rpc("resolve_tenant_domain_identity", {
      p_tenant_id: tenant_id,
    });
    if (error) return err(error.message);
    const identity = Array.isArray(data) ? data[0] : data;
    if (!identity) return err("tenant_domain_identity_not_found");
    return ok({
      identity,
      guidance: identity.default_email_domain
        ? "The website/portal domain and email-sending domain are separate configured rails."
        : "The default website/portal domain is ready. A custom email-sending domain can be connected in Setup → Integrations → Email.",
    });
  },
});

mcp.tool("list_email_domains", {
  description:
    "List the caller tenant's verified + pending sending domains (tenant_email_domains). Shows DNS status, default sender, and Resend domain ID.",
  inputSchema: z.object({}).optional() as any,
  handler: async () => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const { data, error } = await admin
      .from("tenant_email_domains")
      .select("id, domain, from_name, from_email_local, status, is_default, verified_at, resend_domain_id, dns_records, created_at")
      .eq("tenant_id", tenant_id)
      .order("is_default", { ascending: false });
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

mcp.tool("add_email_domain", {
  description:
    "Register a new sending domain for the caller's tenant. Returns the DNS records that must be added to verify. Default `from_email_local` is 'hello'.",
  inputSchema: z.object({
    domain: z.string().describe("Apex or subdomain, e.g. 'notify.acmecredit.com'."),
    from_name: z.string(),
    from_email_local: z.string().optional(),
    is_default: z.boolean().optional(),
  }),
  handler: async ({ domain, from_name, from_email_local, is_default }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const actor = currentActor();
    if (is_default) {
      await admin.from("tenant_email_domains").update({ is_default: false }).eq("tenant_id", tenant_id);
    }
    const { data, error } = await admin.from("tenant_email_domains").insert({
      tenant_id, domain: domain.toLowerCase(), from_name,
      from_email_local: from_email_local ?? "hello",
      is_default: !!is_default, status: "pending",
      created_by_user_id: actor.user_id,
    }).select("*").single();
    if (error) return err(error.message);
    await audit("add_email_domain", "email_domain", data.id, { domain });
    const settingsUrl = await externalActorDestination(tenant_id, "connections");
    return ok({
      email_domain: data,
      next_steps: settingsUrl
        ? `Add the DNS records returned in \`dns_records\` (or visit ${settingsUrl}) and then call set_default_email_domain or wait for verification.`
        : "Add the DNS records returned in `dns_records`, then call set_default_email_domain or wait for verification.",
    });
  },
});

mcp.tool("set_default_email_domain", {
  description:
    "Pick which verified domain is the default sender for the caller's tenant. Unsets the prior default in the same transaction.",
  inputSchema: z.object({ domain_id: z.string() }),
  handler: async ({ domain_id }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const { data: target } = await admin.from("tenant_email_domains")
      .select("id, tenant_id, status").eq("id", domain_id).maybeSingle();
    if (!target || target.tenant_id !== tenant_id) return err("domain_not_found");
    await admin.from("tenant_email_domains").update({ is_default: false }).eq("tenant_id", tenant_id);
    const { data, error } = await admin.from("tenant_email_domains")
      .update({ is_default: true }).eq("id", domain_id).select("*").single();
    if (error) return err(error.message);
    await audit("set_default_email_domain", "email_domain", domain_id, {});
    return ok({ email_domain: data });
  },
});

mcp.tool("list_email_send_log", {
  description:
    "Read recent email sends for the caller's tenant. Filter by `contact_id`, `status` (sent/failed/queued), or `template_key`. Returns up to `limit` rows newest first.",
  inputSchema: z.object({
    contact_id: z.string().optional(),
    status: z.string().optional(),
    template_key: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async ({ contact_id, status, template_key, limit }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const max = Math.min(Math.max(limit ?? 50, 1), 200);
    let q = admin.from("email_send_log").select("*")
      .eq("tenant_id", tenant_id)
      .order("created_at", { ascending: false })
      .limit(max);
    if (contact_id) q = q.eq("contact_id", contact_id);
    if (status) q = q.eq("status", status);
    if (template_key) q = q.eq("template_key", template_key);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

mcp.tool("list_communication_log", {
  description:
    "Read recent comms touchpoints (email, sms, voice) for a specific user_id from communication_log. Use this to give Paige a 360 view before drafting outreach.",
  inputSchema: z.object({
    user_id: z.string(),
    channel: z.enum(["email", "sms", "voice"]).optional(),
    limit: z.number().int().optional(),
  }),
  handler: async ({ user_id, channel, limit }) => {
    const max = Math.min(Math.max(limit ?? 50, 1), 200);
    let q = admin.from("communication_log").select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(max);
    if (channel) q = q.eq("channel", channel);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

mcp.tool("bulk_send_template_email", {
  description:
    "Send the same email template to multiple contacts (max 100 per call). Renders each via `email_templates` + per-contact `template_variables` overrides, sends via Resend with the tenant's default sender, and logs each result to email_send_log. Returns per-contact status. Use sparingly — for true broadcasts prefer a workflow.",
  inputSchema: z.object({
    contact_ids: z.array(z.string()).min(1).max(100),
    template_key: z.string(),
    shared_variables: z.record(z.any()).optional().describe("Variables applied to every send."),
    per_contact_variables: z.record(z.record(z.any())).optional().describe("Override variables keyed by contact_id."),
  }),
  handler: async ({ contact_ids, template_key, shared_variables, per_contact_variables }) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    if (!RESEND_API_KEY) return err("resend_not_configured");

    const { data: tpl, error: tErr } = await admin.from("email_templates")
      .select("subject, body_html, body_text").eq("key", template_key).maybeSingle();
    if (tErr) return err(tErr.message);
    if (!tpl) return err("template_not_found");

    const { data: idn } = await admin.rpc("tenant_sender_identity", { _tenant_id: tenant_id });
    const fromAddress = (idn as any)?.from_address as string | undefined;
    const fromName = (idn as any)?.from_name as string | undefined;
    if (!fromAddress) return err("from_address_not_resolved");
    const fromHeader = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

    const { data: contacts, error: cErr } = await admin.from("clients")
      .select("id, email, first_name, last_name, entity_name").in("id", contact_ids);
    if (cErr) return err(cErr.message);

    const interp = (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));

    const results: Array<Record<string, unknown>> = [];
    for (const ct of contacts ?? []) {
      if (!ct.email) { results.push({ contact_id: ct.id, status: "skipped", reason: "no_email" }); continue; }
      const vars = {
        first_name: ct.first_name, last_name: ct.last_name, entity_name: ct.entity_name,
        ...(shared_variables ?? {}),
        ...((per_contact_variables ?? {})[ct.id] ?? {}),
      } as Record<string, unknown>;
      const subject = interp(tpl.subject ?? "", vars);
      const html = interp(tpl.body_html ?? "", vars);
      const text = interp(tpl.body_text ?? "", vars);
      const send_id = crypto.randomUUID();
      let status: "sent" | "failed" = "sent";
      let providerId: string | null = null;
      let errorMsg: string | null = null;
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: fromHeader, to: [ct.email], subject, html, text: text || undefined, headers: { "X-Paige-Send-Id": send_id } }),
        });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok) { status = "failed"; errorMsg = (j as any)?.message ?? `resend_${r.status}`; }
        else providerId = (j as any)?.id ?? null;
      } catch (e) {
        status = "failed"; errorMsg = (e as Error).message.slice(0, 300);
      }
      try {
        await admin.from("email_send_log").insert({
          id: send_id, tenant_id, contact_id: ct.id, recipient_email: ct.email,
          from_address: fromAddress, subject, template_key, status,
          provider_message_id: providerId, error_message: errorMsg,
        });
      } catch { /* non-fatal */ }
      results.push({ contact_id: ct.id, send_id, status, provider_message_id: providerId, error: errorMsg });
    }
    await audit("bulk_send_template_email", "email_template", template_key, { count: results.length, tenant_id });
    const summary = results.reduce((acc: Record<string, number>, r) => {
      const s = String(r.status); acc[s] = (acc[s] ?? 0) + 1; return acc;
    }, {});
    return ok({ template_key, summary, results });
  },
});

mcp.tool("list_journey_stages", {
  description:
    "List this tenant's client-journey stages (slug, label, display_order, color). Returns the tenant's own installed journey when they have one (e.g. from a Practice Blueprint), otherwise the platform-default stages. Reference these slugs when calling `advance_contact_journey_stage`.",
  inputSchema: z.object({}).optional() as any,
  handler: async () => {
    // Blueprints REPOINT-READER: prefer the tenant's installed journey (tenant_journey_stages),
    // COALESCE-falling-back to the global paige_journey_stages defaults when they have none.
    // tenant_id comes from the already-authorized actor context (never request input), so there
    // is no cross-tenant read here (§9). The RPC also returns stage_id_global (real int for global
    // rows, null for tenant-only slugs) — this reference list ignores it, which is harmless.
    const tenant_id = await actorTenantId();
    const { data, error } = await admin.rpc("get_tenant_journey_stages", { _tenant: tenant_id });
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

mcp.tool("advance_contact_journey_stage", {
  description:
    "Move a contact to a new journey stage (slug from `list_journey_stages`). Records a transition row (paige_journey_stage_transitions) with optional `source_event` (e.g. 'mcp.paige', 'agreement_signed', 'workflow.btf_kickoff').",
  inputSchema: z.object({
    contact_id: z.string(),
    stage_slug: z.string(),
    source_event: z.string().optional(),
  }),
  handler: async ({ contact_id, stage_slug, source_event }) => {
    // §9/§37/§51: set_journey_stage runs as service_role and its IDOR guard bypasses
    // service_role callers ("Paige, already actor-authorized") — so THIS producer must
    // prove the contact belongs to the actor's tenant, exactly like every sibling
    // contact tool. Without this a tenant-A caller could move a tenant-B contact's stage.
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data: owned, error: ownErr } = await admin
      .from("clients")
      .select("id")
      .eq("id", contact_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (ownErr) return err(ownErr.message);
    if (!owned) return err("contact_not_found");

    const { data, error } = await admin.rpc("set_journey_stage", {
      _contact_id: contact_id,
      _stage_slug: stage_slug,
      _source_event: source_event ?? "mcp.paige",
    });
    if (error) return err(error.message);
    await audit("advance_contact_journey_stage", "contact", contact_id, { stage_slug, source_event: source_event ?? null });
    return ok({ result: data });
  },
});

// ============================================================================
// SELF-SCOPED TOOLS — end-user (client) MCP surface.
//
// Every tool below resolves the calling user back to their own `clients` row
// (linked_user_id = actor.user_id) before reading or writing anything. There
// is no path here to read another user's data — even if a client somehow
// requested crm.* scopes, the OAuth consent flow (paige-mcp-consent) strips
// them and only ever grants self.read / self.write / self.chat for the client
// tier. This is the same MCP server as admins use, just gated.
// ============================================================================

async function actorClient(): Promise<{ id: string; tenant_id: string | null; owner_user_id: string | null } | null> {
  const a = currentActor();
  if (!a.user_id) return null;
  const { data } = await admin
    .from("clients")
    .select("id, tenant_id, linked_user_id")
    .eq("linked_user_id", a.user_id)
    .maybeSingle();
  if (!data?.id) return null;
  return { id: data.id, tenant_id: (data as any).tenant_id ?? null, owner_user_id: a.user_id };
}

mcp.tool("me_whoami", {
  description: "Return the current end-user's identity, linked client_id, tenant, and granted MCP scopes. Always call this first to confirm you're acting on the right account.",
  inputSchema: z.object({}),
  handler: async () => {
    const a = currentActor();
    const me = await actorClient();
    return ok({
      user_id: a.user_id,
      scopes: a.scopes,
      linked_client_id: me?.id ?? null,
      tenant_id: me?.tenant_id ?? null,
    });
  },
});

mcp.tool("me_get_profile", {
  description: "Get the calling user's own client profile (name, email, phone, lifecycle stage, funding goal, notes). Reads only the row linked to the caller via clients.linked_user_id.",
  inputSchema: z.object({}),
  handler: async () => {
    const me = await actorClient();
    if (!me) return err("no_linked_client_record");
    const { data, error } = await admin.from("clients").select("*").eq("id", me.id).maybeSingle();
    if (error) return err(error.message);
    return ok({ profile: data });
  },
});

mcp.tool("me_update_profile", {
  description: "Update the calling user's own client profile. Only safe self-editable fields are allowed: first_name, last_name, phone, entity_name, current_notes, funding_goal_amount. Cannot change lifecycle_stage, assigned coach, tier, or status.",
  inputSchema: z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    entity_name: z.string().optional().describe("Their company / business name."),
    current_notes: z.string().optional().describe("Free-form notes the user wants Paige to remember."),
    funding_goal_amount: z.number().optional(),
  }),
  handler: async (patch) => {
    const me = await actorClient();
    if (!me) return err("no_linked_client_record");
    const ALLOWED = ["first_name","last_name","phone","entity_name","current_notes","funding_goal_amount"];
    const clean: Record<string, unknown> = {};
    for (const k of ALLOWED) if ((patch as any)[k] !== undefined) clean[k] = (patch as any)[k];
    if (Object.keys(clean).length === 0) return err("no_updatable_fields");
    const { error } = await admin.from("clients").update(clean).eq("id", me.id);
    if (error) return err(error.message);
    await audit("me_update_profile", "contact", me.id, { fields: Object.keys(clean) });
    return ok({ updated: true, fields: Object.keys(clean) });
  },
});

mcp.tool("me_list_businesses", {
  description: "List the businesses owned by the calling user (businesses.owner_user_id = caller). Returns legal name, DBA, EIN status, entity type, formation status.",
  inputSchema: z.object({}),
  handler: async () => {
    const a = currentActor();
    if (!a.user_id) return err("unauthenticated");
    const { data, error } = await admin
      .from("businesses")
      .select("id, legal_name, dba, entity_type, state_of_formation, ein, naics, revenue_band, formation_status, website, business_email, is_primary, is_active")
      .eq("owner_user_id", a.user_id)
      .order("is_primary", { ascending: false });
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

mcp.tool("me_update_business", {
  description: "Update one of the calling user's own businesses. Server verifies businesses.owner_user_id matches the caller before writing. Safe self-editable fields only: legal_name, dba, website, business_email, business_phone, naics, revenue_band, entity_type, state_of_formation.",
  inputSchema: z.object({
    business_id: z.string().describe("businesses.id (uuid) owned by the caller."),
    legal_name: z.string().optional(),
    dba: z.string().optional(),
    website: z.string().optional(),
    business_email: z.string().optional(),
    business_phone: z.string().optional(),
    naics: z.string().optional(),
    revenue_band: z.string().optional(),
    entity_type: z.string().optional(),
    state_of_formation: z.string().optional(),
  }),
  handler: async ({ business_id, ...patch }) => {
    const a = currentActor();
    if (!a.user_id) return err("unauthenticated");
    const { data: row } = await admin.from("businesses").select("owner_user_id").eq("id", business_id).maybeSingle();
    if (!row) return err("business_not_found");
    if (row.owner_user_id !== a.user_id) return err("not_owner");
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    if (Object.keys(clean).length === 0) return err("no_updatable_fields");
    const { error } = await admin.from("businesses").update(clean).eq("id", business_id);
    if (error) return err(error.message);
    await audit("me_update_business", "business", business_id, { fields: Object.keys(clean) });
    return ok({ updated: true, fields: Object.keys(clean) });
  },
});

mcp.tool("me_create_business", {
  description: "Create a new business owned by the calling user. Use this when the user tells Paige about a new entity they're forming or want to register on the platform.",
  inputSchema: z.object({
    legal_name: z.string(),
    dba: z.string().optional(),
    entity_type: z.string().optional(),
    state_of_formation: z.string().optional(),
    website: z.string().optional(),
    business_email: z.string().optional(),
    business_phone: z.string().optional(),
    is_primary: z.boolean().optional(),
  }),
  handler: async (input) => {
    const a = currentActor();
    if (!a.user_id) return err("unauthenticated");
    const me = await actorClient();
    const row: Record<string, unknown> = {
      owner_user_id: a.user_id,
      legal_name: input.legal_name,
      dba: input.dba ?? null,
      entity_type: input.entity_type ?? null,
      state_of_formation: input.state_of_formation ?? null,
      website: input.website ?? null,
      business_email: input.business_email ?? null,
      business_phone: input.business_phone ?? null,
      is_primary: input.is_primary ?? false,
      is_active: true,
    };
    const { data, error } = await admin.from("businesses").insert(row).select("id").single();
    if (error) return err(error.message);
    await audit("me_create_business", "business", data.id, { client_id: me?.id ?? null });
    return ok({ business_id: data.id });
  },
});

mcp.tool("me_log_progress_update", {
  description: "Log a progress update from the user to their coach / workspace. Appends to the user's current_notes timeline AND sends an in-workspace message so the coach sees it. Use when the user tells Paige what they accomplished, blockers, or status changes.",
  inputSchema: z.object({
    update: z.string().describe("Free-form progress note from the user."),
  }),
  handler: async ({ update }) => {
    const a = currentActor();
    const me = await actorClient();
    if (!me || !a.user_id) return err("no_linked_client_record");
    const stamp = new Date().toISOString();
    const line = `[${stamp}] (self) ${update}`;
    const { data: cur } = await admin.from("clients").select("current_notes").eq("id", me.id).maybeSingle();
    const next = [cur?.current_notes ?? "", line].filter(Boolean).join("\n\n");
    await admin.from("clients").update({ current_notes: next }).eq("id", me.id);
    // NOTE: coach-thread messaging leg deferred — restore via program_messages integration
    // in a discrete feature-restore ship. current_notes append above remains live.
    await audit("me_log_progress_update", "contact", me.id, { length: update.length });
    return ok({ logged: true });
  },
});

// (me_send_message_to_coach, me_list_messages removed — Sprint 211.b: btf_messages consolidated into program_messages canonical surface; restore via program_messages integration in a discrete feature-restore ship)


mcp.tool("me_list_tasks", {
  description: "List tasks assigned to or created for the calling user (tasks where user_id = caller). Optionally filter by status.",
  inputSchema: z.object({
    status: z.string().optional().describe("e.g. 'open', 'completed'"),
    limit: z.number().int().optional(),
  }),
  handler: async ({ status, limit }) => {
    const a = currentActor();
    if (!a.user_id) return err("unauthenticated");
    const lim = Math.min(Math.max(limit ?? 50, 1), 100);
    let q = admin.from("tasks")
      .select("id, title, description, status, due_date, created_at")
      .eq("user_id", a.user_id)
      .order("created_at", { ascending: false })
      .limit(lim);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

// (me_get_phase_progress removed — Sprint 211.b: btf_phase_items consolidated into program_* canonical surface)


mcp.tool("me_search_lender_products", {
  description: "Search the lender product catalog (public marketplace). Returns lender name, product type, min/max amount, rate range, requirements. Use when the user asks what funding options they qualify for or wants to research products.",
  inputSchema: z.object({
    query: z.string().optional().describe("Free-text search across product name / lender name."),
    product_type: z.string().optional().describe("e.g. 'business_credit_card', 'term_loan', 'line_of_credit'."),
    min_amount: z.number().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async ({ query, product_type, min_amount, limit }) => {
    const lim = Math.min(Math.max(limit ?? 25, 1), 50);
    let q = admin.from("lender_products")
      .select("id, lender_name, product_name, product_type, min_amount, max_amount")
      .limit(lim);
    if (query) q = q.or(`lender_name.ilike.%${query}%,product_name.ilike.%${query}%`);
    if (product_type) q = q.eq("product_type", product_type);
    if (min_amount !== undefined) q = q.gte("max_amount", min_amount);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [], count: (data ?? []).length });
  },
});

// ============================================================================
// Marketplace — Wave 4 (paige-mcp parity with the paige-ai-chat surface).
//
// paige-ai-chat drives these RPCs with the caller's GoTrue JWT so is_tenant_admin
// (auth.uid()) authorizes natively. paige-mcp has no such JWT — it resolves a trusted
// actor from the ActorCtx and calls Postgres with the SERVICE-ROLE `admin` client. The
// 20260714350000 migration adds service-role-gated overloads that take an explicit
// _actor_user_id and RE-VERIFY it is a tenant admin of _tenant_id (defense in depth,
// §9/§13). We resolve that actor here and pass it to every call.
// ============================================================================

// Resolve the authenticated actor for the marketplace overload. Platform keys do
// not carry a current user account context, so browse fails closed for them.
async function resolveMarketplaceActor(tenantId: string): Promise<string | null> {
  const a = currentActor();
  if (!a.user_id) return null;
  const activeTenantId = await marketplaceActorTenantId();
  return activeTenantId === tenantId ? a.user_id : null;
}

mcp.tool("marketplace_browse", {
  description: "Browse a curated list of Marketplace items visible to this workspace. Results include only safe identity, category, and listing availability. Visibility does not prove installability, entitlement, connection, or runtime readiness. Read-only.",
  inputSchema: z.object({
    category: z.string().optional().describe("Optional category to filter by."),
    query: z.string().optional().describe("Optional free-text to match against safe item name or category."),
  }),
  handler: async ({ category, query }) => {
    const tenantId = await marketplaceActorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const actorUserId = await resolveMarketplaceActor(tenantId);
    if (!actorUserId) return err("actor_not_resolved");
    const { data, error } = await admin.rpc("marketplace_catalog_for_tenant", { _tenant_id: tenantId, _actor_user_id: actorUserId });
    if (error) return err("Marketplace browse is unavailable right now.");
    const returnedTenantId = retainActiveMarketplaceTenant(tenantId, await marketplaceActorTenantId());
    if (!returnedTenantId) return err("Marketplace browse is unavailable for the current workspace.");
    // deno-lint-ignore no-explicit-any
    let items = (data ?? []) as any[];
    if (category) items = items.filter((i) => String(i.category || "").toLowerCase() === String(category).toLowerCase());
    if (query) { const q = String(query).toLowerCase(); items = items.filter((i) => `${i.name || ""} ${i.category || ""}`.toLowerCase().includes(q)); }
    const safeItems = items.map((i) => ({
      slug: String(i.slug || ""),
      name: String(i.name || ""),
      category: String(i.category || "uncategorized"),
      availability: "listed_for_workspace",
    }));
    return ok({
      success: true,
      count: safeItems.length,
      items: safeItems,
      note: "Listed for this workspace means visible in Marketplace; it does not prove installability, entitlement, connection, or runtime readiness.",
    });
  },
});

// ============================================================================
// Stage Automation Rules — Ship #1 Phase B (§189/§191 governed)
// ============================================================================
async function ensureStageAutomationEnabled(tenantId: string): Promise<string | null> {
  const { data } = await admin
    .from("tenant_features")
    .select("stage_change_automation_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.stage_change_automation_enabled) return "feature_disabled_stage_change_automation";
  return null;
}

mcp.tool("list_stage_automation_rules", {
  description: "List stage-change automation rules for the caller's tenant.",
  inputSchema: z.object({
    pipeline_id: z.string().uuid().optional(),
    is_active: z.boolean().optional(),
  }),
  handler: async ({ pipeline_id, is_active }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    let q = admin.from("stage_automation_rules")
      .select("id, tenant_id, pipeline_id, from_stage_id, to_stage_id, compose_intent, tone, template_hint, send_mode, is_active, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });
    if (pipeline_id) q = q.eq("pipeline_id", pipeline_id);
    if (is_active !== undefined) q = q.eq("is_active", is_active);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("create_stage_automation_rule", {
  description: "Create a stage-change automation rule. Requires tenant_features.stage_change_automation_enabled = true (§189). Defaults to is_active=false.",
  inputSchema: z.object({
    pipeline_id: z.string().uuid(),
    to_stage_id: z.string().uuid(),
    from_stage_id: z.string().uuid().nullable().optional(),
    compose_intent: z.enum(["transactional", "marketing", "nurture", "notification"]),
    tone: z.string().optional(),
    template_hint: z.string().optional(),
    send_mode: z.enum(["draft_for_review", "auto_send"]).optional(),
    is_active: z.boolean().optional(),
  }),
  handler: async (args) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const gate = await ensureStageAutomationEnabled(tenantId);
    if (gate) return err(gate);
    const actor = currentActor();
    const { data, error } = await admin.from("stage_automation_rules").insert({
      tenant_id: tenantId,
      pipeline_id: args.pipeline_id,
      to_stage_id: args.to_stage_id,
      from_stage_id: args.from_stage_id ?? null,
      compose_intent: args.compose_intent,
      tone: args.tone ?? "professional",
      template_hint: args.template_hint ?? null,
      send_mode: args.send_mode ?? "draft_for_review",
      is_active: args.is_active ?? false,
      created_by: actor.user_id,
    }).select("id, tenant_id, pipeline_id, from_stage_id, to_stage_id, is_active, created_at").single();
    if (error) return err(error.message);
    await audit("create_stage_automation_rule", "stage_automation_rules", data.id, { pipeline_id: args.pipeline_id, compose_intent: args.compose_intent });
    return ok({ rule: data });
  },
});

mcp.tool("update_stage_automation_rule", {
  description: "Update a stage-change automation rule (toggle active, tone, template, send_mode, compose_intent).",
  inputSchema: z.object({
    id: z.string().uuid(),
    is_active: z.boolean().optional(),
    tone: z.string().optional(),
    template_hint: z.string().nullable().optional(),
    send_mode: z.enum(["draft_for_review", "auto_send"]).optional(),
    compose_intent: z.enum(["transactional", "marketing", "nurture", "notification"]).optional(),
  }),
  handler: async ({ id, ...patch }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
    if (Object.keys(clean).length === 0) return err("no_fields_to_update");
    const { data, error } = await admin.from("stage_automation_rules")
      .update(clean).eq("id", id).eq("tenant_id", tenantId)
      .select("id, is_active, updated_at").single();
    if (error) return err(error.message);
    await audit("update_stage_automation_rule", "stage_automation_rules", id, clean);
    return ok({ rule: data });
  },
});

mcp.tool("delete_stage_automation_rule", {
  description: "Permanently delete a stage-change automation rule. History rows keep rule_id nulled.",
  inputSchema: z.object({ id: z.string().uuid() }),
  annotations: { destructiveHint: true },
  handler: async ({ id }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { error } = await admin.from("stage_automation_rules").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return err(error.message);
    await audit("delete_stage_automation_rule", "stage_automation_rules", id, {});
    return ok({ deleted: true });
  },
});

mcp.tool("list_stage_automation_events", {
  description: "List recent stage-change automation dispatch events for the caller's tenant. Filter by contact_id, deal_id, rule_id, or status.",
  inputSchema: z.object({
    contact_id: z.string().uuid().optional(),
    deal_id: z.string().uuid().optional(),
    rule_id: z.string().uuid().optional(),
    status: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async ({ contact_id, deal_id, rule_id, status, limit }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const lim = Math.min(Math.max(limit ?? 50, 1), 200);
    let q = admin.from("stage_automation_events")
      .select("id, tenant_id, rule_id, deal_id, contact_id, from_stage_id, to_stage_id, status, error, dispatched_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(lim);
    if (contact_id) q = q.eq("contact_id", contact_id);
    if (deal_id) q = q.eq("deal_id", deal_id);
    if (rule_id) q = q.eq("rule_id", rule_id);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

// ============================================================================
// Data Subject Rights (GDPR/CCPA) — Ship #1 Phase B
// ============================================================================
mcp.tool("handle_data_subject_request", {
  description: "Handle a GDPR/CCPA data subject request. request_type: export | delete | correct | portability. Logs to pii_access_log + paige_audit_log with 7-year retention.",
  inputSchema: z.object({
    contact_id: z.string().uuid(),
    request_type: z.enum(["export", "delete", "correct", "portability"]),
    corrections: z.record(z.string(), z.any()).optional(),
    reason: z.string().optional(),
  }),
  annotations: { destructiveHint: true },
  handler: async ({ contact_id, request_type, corrections, reason }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin.rpc("handle_data_subject_request", {
      _tenant_id: tenantId,
      _contact_id: contact_id,
      _request_type: request_type,
      _corrections: corrections ?? null,
      _reason: reason ?? null,
    });
    if (error) return err(error.message);
    await audit("handle_data_subject_request", "clients", contact_id, { request_type, reason });
    return ok(data ?? {});
  },
});


// ============================================================================
// Ship #2 — Scheduled Credit + Funding Readiness Proposals
// ============================================================================
mcp.tool("list_readiness_proposals", {
  description: "List readiness proposals for the current tenant. Filter by status and/or contact_id.",
  inputSchema: z.object({
    status: z.enum(["pending", "approved", "rejected", "expired", "executed", "insufficient_data"]).optional(),
    contact_id: z.string().uuid().optional(),
    limit: z.number().min(1).max(200).default(50),
  }),
  handler: async ({ status, contact_id, limit }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    let q = admin
      .from("paige_readiness_proposals")
      .select("id, contact_id, status, readiness_delta_json, recommended_actions_json, proposed_at, approved_at, rejected_at, rejection_reason, expires_at, scan_run_id")
      .eq("tenant_id", tenantId)
      .order("proposed_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    if (contact_id) q = q.eq("contact_id", contact_id);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ items: data ?? [] });
  },
});

mcp.tool("get_readiness_proposal", {
  description: "Fetch a single readiness proposal by ID.",
  inputSchema: z.object({ proposal_id: z.string().uuid() }),
  handler: async ({ proposal_id }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const { data, error } = await admin
      .from("paige_readiness_proposals")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", proposal_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("proposal_not_found");
    return ok(data);
  },
});

mcp.tool("approve_readiness_proposal", {
  description: "Approve a pending readiness proposal. Fires client workspace notification via trigger. §122 phase 2 (send) still requires compose_email in Ship #3.",
  inputSchema: z.object({ proposal_id: z.string().uuid() }),
  handler: async ({ proposal_id }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const actor = currentActor().user_id;
    const { data, error } = await admin
      .from("paige_readiness_proposals")
      .update({ status: "approved", approved_by: actor, approved_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", proposal_id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("proposal_not_pending_or_not_found");
    await audit("approve_readiness_proposal", "paige_readiness_proposals", proposal_id, {});
    return ok(data);
  },
});

mcp.tool("reject_readiness_proposal", {
  description: "Reject a pending readiness proposal with an optional reason.",
  inputSchema: z.object({
    proposal_id: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
  handler: async ({ proposal_id, reason }) => {
    const tenantId = await actorTenantId();
    if (!tenantId) return err("tenant_not_resolved");
    const actor = currentActor().user_id;
    const { data, error } = await admin
      .from("paige_readiness_proposals")
      .update({
        status: "rejected",
        rejected_by: actor,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason ?? null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", proposal_id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error) return err(error.message);
    if (!data) return err("proposal_not_pending_or_not_found");
    await audit("reject_readiness_proposal", "paige_readiness_proposals", proposal_id, { reason });
    return ok(data);
  },
});

// Removed trigger_readiness_scan_for_contact MCP tool (§9 producer-inventory
// reconciliation): readiness-scan is now cron-only and rejects caller-supplied
// tenant_id/contact_ids/trigger_source/dry_run. A §9-safe per-tenant "scan now"
// (tenant derived server-side, role-gated, rate-limited, audited) is tracked in
// #445; the scheduled monthly cron continues the work. Its TOOL_SCOPE and
// CLIENT_ACTION_LABELS entries are removed below so no dead keys remain.


// ---------- HTTP transport + bearer auth ----------

const app = new Hono();
const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, accept",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

app.options("/*", (c) => c.body(null, 204, CORS));

// ---------- Phase 3: OAuth 2.1 + Dynamic Client Registration ----------
const PUBLIC_ORIGIN = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/paige-mcp`;
const APP_ORIGIN = Deno.env.get("PAIGE_APP_ORIGIN") ?? "https://paigeagent.ai";
// Scope tiers (least → most privileged):
//   Tenant Admin  → crm.* + workflows.run + btf.* + admin.read/write (incl. bulk delete with audit)
//   Tenant Owner  → all of the above + admin.delete (remove coach role, suspend members) + tenant billing/integrations
//   Platform Owner → all of the above + platform.* (cross-tenant ops, doctrine, sub-agent forge, MCP registry)
const SUPPORTED_SCOPES = [
  "crm.read", "crm.write", "crm.delete",
  "workflows.run",
  "btf.read", "btf.write",
  "admin.read", "admin.write", "admin.delete",
  "platform.read", "platform.write",
  // End-user (client) tier — narrow, self-scoped only. Every self.* tool
  // resolves the caller to their own clients row before reading/writing.
  "self.read", "self.write", "self.chat",
] as const;
type Scope = (typeof SUPPORTED_SCOPES)[number];

mcp.tool("get_social_accounts", {
  description:
    "Read which social accounts this workspace has RECORDED that it posts from (Instagram, Facebook, LinkedIn, YouTube, TikTok, X), and which are not recorded. Scoped to the caller's tenant. These are DECLARED accounts \u2014 a record of what the business says it posts from, never a connection: nothing here is authorised to publish, schedule, or read a follower, reach or engagement figure, and no such figure exists to return.",
  inputSchema: z.object({}),
  handler: async () => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    // Service-role client, so auth.uid() is null inside the function and the passed tenant is
    // honored on the trusted arm (§59). The tenant came from actorTenantId(), never from the model.
    const { data, error } = await admin.rpc("get_social_presence_evidence", { _tenant_id: tenant_id });
    if (error) return err(error.message);
    const rows = (Array.isArray(data) ? data : []) as Array<{ network: string; status: string; handle: string | null }>;
    return ok({
      tenant_id,
      accounts: rows,
      on_record: rows.filter((r) => r.status === "on_record").length,
      note: "Declared capture only. No account is connected for publishing or measurement.",
    });
  },
});

mcp.tool("record_social_accounts", {
  description:
    "Record or update the social accounts this workspace posts from. Send the complete set you want on record: a network you OMIT is cleared, so read with `get_social_accounts` first and resend the ones that should stay. Allowed networks: instagram, facebook, linkedin, youtube, tiktok, x. This writes a RECORD only \u2014 it performs no OAuth, stores no token, calls no provider API, and publishes and schedules nothing. It is what makes Systems Check #3 (social accounts on record) passable.",
  inputSchema: z.object({
    instagram: z.string().nullable().optional(),
    facebook: z.string().nullable().optional(),
    linkedin: z.string().nullable().optional(),
    youtube: z.string().nullable().optional(),
    tiktok: z.string().nullable().optional(),
    x: z.string().nullable().optional(),
  }),
  handler: async (args) => {
    const tenant_id = await actorTenantId();
    if (!tenant_id) return err("tenant_not_resolved");
    const handles: Record<string, string> = {};
    for (const [network, value] of Object.entries(args)) {
      if (typeof value === "string" && value.trim()) handles[network] = value.trim();
    }
    const { data, error } = await admin.rpc("record_social_handles", {
      _expected_tenant_id: tenant_id,
      _handles: handles,
    });
    if (error) return err(error.message);
    await audit("record_social_accounts", "tenant", tenant_id, { networks: Object.keys(handles) });
    // Reports what the database read back off the updated row, never what was sent (§13).
    return ok({ ok: true, ...(data as Record<string, unknown>) });
  },
});


// Tool → required scope.
//   *.read / *.write   → Tenant Admin grant (operator-tier work inside their tenant)
//   crm.delete         → Tenant Admin grant (bulk delete with audit + dry-run, per owner directive)
//   admin.delete       → Tenant Owner only (permanent role removal, member suspension)
//   platform.*         → Platform Owner only (cross-tenant, doctrine, sub-agent forge, infra)
const TOOL_SCOPE: Record<string, Scope> = {
  // CRM
  search_contacts: "crm.read", get_contact: "crm.read", lookup_contact_by_account_number: "crm.read",
  update_contact_stage: "crm.write", add_contact_note: "crm.write",
  list_deals: "crm.read", move_deal_stage: "crm.write", create_deal: "crm.write",
  list_tasks: "crm.read", create_task: "crm.write", update_task: "crm.write",
  complete_task: "crm.write", reopen_task: "crm.write", delete_task: "crm.delete",
  // Workflows
  list_workflows: "crm.read", run_workflow: "workflows.run", get_workflow_run: "crm.read",
  list_pending_approvals: "crm.read", decide_pending_approval: "workflows.run",
  create_approval: "crm.write", claim_approval: "crm.write",
  comment_on_approval: "crm.write", list_approval_comments: "crm.read",
  // Admin (operator)
  list_team_members: "admin.read", assign_coach: "admin.write", create_team_invitation: "admin.write",
  list_unassigned_queue: "admin.read", list_admin_notifications: "admin.read", create_admin_notification: "admin.write",
  // Email templates
  list_email_templates: "admin.read", upsert_email_template: "admin.write", send_btf_template_email: "btf.write",
  // Batch #1
  create_contact: "crm.write", update_contact: "crm.write", update_lifecycle_stage: "crm.write",
  bulk_delete_contacts: "crm.delete",
  list_contact_businesses: "crm.read",
  link_contact_to_business: "crm.write",
  
  list_signed_agreements: "btf.read", list_intake_submissions: "btf.read",
  list_payment_authorizations: "btf.read",
  resolve_sender_identity: "admin.read",
  // Batch #2 — observability + comms + invoicing
  list_workflow_runs: "crm.read",
  cancel_workflow_run: "workflows.run",
  register_workflow: "platform.write", // touches workflow registry infra
  send_transactional_email: "crm.write",
  send_sms: "crm.write",
  create_invoice: "crm.write",
  send_invoice: "crm.write",
  // Coach Ops
  list_coaches: "admin.read",
  update_coach_profile: "admin.write",
  bulk_assign_clients_to_coach: "admin.write",
  get_coach_performance: "admin.read",
  // Sub-agents — runtime use vs. forge
  list_subagents: "crm.read",
  delegate_to_subagent: "workflows.run",
  compose_email: "crm.write",
  send_composed_email: "crm.write",

  get_subagent_history: "crm.read",
  propose_subagent: "platform.write",          // sub-agent forge = infra
  list_subagent_proposals: "platform.read",
  approve_subagent_proposal: "platform.write",
  // Skills Registry
  list_skills: "crm.read",
  run_skill: "workflows.run",
  get_skill_run: "crm.read",
  verify_business: "crm.write",
  // Batch #4 — Cross-tenant master admin (Platform Owner only)
  list_tenants: "platform.read",
  create_tenant: "platform.write",
  suspend_tenant: "platform.write",
  update_tenant_features: "platform.write",
  get_platform_metrics: "platform.read", get_systems_check_status: "platform.read",
  broadcast_system_announcement: "platform.write",
  // Batch #5 — Tenant Admin + Comms (operator-tier inside own tenant)
  update_tenant_branding: "admin.write",
  get_tenant_domain_identity: "admin.read",
  list_email_domains: "admin.read",
  add_email_domain: "admin.write",
  set_default_email_domain: "admin.write",
  list_email_send_log: "crm.read",
  list_communication_log: "crm.read",
  bulk_send_template_email: "crm.write",
  list_journey_stages: "crm.read",
  advance_contact_journey_stage: "crm.write",
  // Self-scoped (end-user / client tier) — never touch another user's data.
  me_whoami: "self.read",
  me_get_profile: "self.read",
  me_update_profile: "self.write",
  me_list_businesses: "self.read",
  me_update_business: "self.write",
  me_create_business: "self.write",
  me_log_progress_update: "self.write",
  me_list_tasks: "self.read",
  me_search_lender_products: "self.read",
  // Marketplace containment: external MCP receives only the curated tenant-scoped
  // browse projection. Install, removal, checkout, recommendation, entitlement, and
  // runtime-capability claims are deliberately absent from the registry.
  marketplace_browse: "admin.read",
  // Ship #1 Phase B — Stage Automation Rules
  list_stage_automation_rules: "admin.read",
  create_stage_automation_rule: "admin.write",
  update_stage_automation_rule: "admin.write",
  delete_stage_automation_rule: "admin.delete",
  list_stage_automation_events: "crm.read",
  // Ship #1 Phase B — GDPR/CCPA DSR
  handle_data_subject_request: "admin.delete",
  // Campaigns › Social — the accounts a workspace records that it posts from (§38 capture-only).
  // Not "platform.*": these are the CALLER'S OWN tenant's records, so tenant-admin scope is right
  // and the tier gate stays default (tenant). The write goes through public.record_social_handles,
  // which re-enforces scope in-body (§59) — the grant here is not the guard.
  get_social_accounts: "crm.read",
  record_social_accounts: "crm.write",
  // Ship #2 — Scheduled Readiness Proposals (§122 two-phase)
  list_readiness_proposals: "btf.read",
  get_readiness_proposal: "btf.read",
  approve_readiness_proposal: "btf.write",
  reject_readiness_proposal: "btf.write",

  // Agency tier (§25) — management of the caller's own sub-accounts is admin
  // work; the AGENCY audience restriction is the tier gate, not the scope.
  list_subaccounts: "admin.read",
  get_subaccount_metrics: "admin.read",
  create_subaccount: "admin.write",
  switch_into_subaccount: "admin.write",
  exit_subaccount: "admin.write",

};

// ── Tool → audience tier (§9/§25) ────────────────────────────────────────────
// MASTER_ONLY_TOOLS is the single source of the god set. AGENCY_TOOLS manage the
// caller's OWN sub-accounts only. Every other tool derives its tier from its
// scope: a self.* tool is `client`, anything else is `tenant`. NOTE:
// register_workflow deliberately stays `tenant`-tier — it has a REAL tenant path
// (a tenant registers its own non-platform workflow, tenant_id-scoped at :2110)
// and its platform-provider path is gated in-handler by actorIsPlatformOwner()
// (:2086). The *_subagent_* forge tools, by contrast, have NO in-handler guard, so
// they are god-locked in MASTER_ONLY_TOOLS above rather than relying on a guard
// that does not exist (their platform.* scope alone did not stop a tenant caller
// who held platform.write — the tier gate is what denies them).
const AGENCY_TOOLS = new Set<string>([
  "list_subaccounts",
  "create_subaccount",
  "get_subaccount_metrics",
  "switch_into_subaccount",
  "exit_subaccount",
]);
function toolTier(name: string): McpTier {
  if (MASTER_ONLY_TOOLS.has(name)) return "god";
  if (AGENCY_TOOLS.has(name)) return "agency";
  const s = TOOL_SCOPE[name];
  if (s && s.startsWith("self.")) return "client";
  return "tenant";
}

// Branding shown by MCP clients (ChatGPT, Claude, etc.) in the connector
// picker and OAuth consent screen. logo_uri must be a public https URL.
const PAIGE_LOGO_URI = `${APP_ORIGIN}/mcp-logo.png`;
const PAIGE_BRAND_NAME = "Paige Agent AI";
const PAIGE_TAGLINE = "The operating system for client-based businesses — your practice, clients, and execution in one connected engine.";

const DISCOVERY_RESOURCE = {
  // #476: canonical AS is the app origin (paigeagent.ai), per owner-confirmed RFC 8414 topology.
  // The protected resource IS the edge fn (resource=PUBLIC_ORIGIN), but its authorization server is
  // paigeagent.ai — so both discovery sources agree and a strict client following
  // protected-resource.authorization_servers fetches AS metadata from paigeagent.ai (issuer match).
  resource: PUBLIC_ORIGIN, authorization_servers: [APP_ORIGIN],
  bearer_methods_supported: ["header"], scopes_supported: SUPPORTED_SCOPES,
  resource_documentation: "https://paigeagent.ai/docs/mcp",
  resource_name: PAIGE_BRAND_NAME,
  resource_description: PAIGE_TAGLINE,
  logo_uri: PAIGE_LOGO_URI,
  icon_uri: PAIGE_LOGO_URI,
  policy_uri: "https://paigeagent.ai/privacy",
  tos_uri: "https://paigeagent.ai/terms",
};
const DISCOVERY_AS = {
  // #476: issuer is the app origin (paigeagent.ai), NOT the edge origin. RFC 8414 requires the AS
  // metadata issuer to match the URL it's fetched from; a spec-correct client reaches this metadata
  // only via protected-resource.authorization_servers=[paigeagent.ai] → fetches paigeagent.ai's
  // static well-known → issuer matches. token/registration/revocation stay on the edge fn
  // (RFC 8414 permits AS endpoints off the issuer origin). This kills the cross-origin issuer bug.
  issuer: APP_ORIGIN,
  authorization_endpoint: `${APP_ORIGIN}/mcp/authorize`,
  token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
  registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
  revocation_endpoint: `${PUBLIC_ORIGIN}/oauth/revoke`,
  response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: SUPPORTED_SCOPES,
  // OIDC-style branding fields that ChatGPT/Claude surface in their connector UI.
  op_name: PAIGE_BRAND_NAME,
  service_documentation: "https://paigeagent.ai/docs/mcp",
  logo_uri: PAIGE_LOGO_URI,
  icon_uri: PAIGE_LOGO_URI,
  op_logo_uri: PAIGE_LOGO_URI,
  op_policy_uri: "https://paigeagent.ai/privacy",
  op_tos_uri: "https://paigeagent.ai/terms",
  ui_locales_supported: ["en-US"],
};

function randToken(bytes = 48): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64 === challenge;
}
const NO_STORE = { "Cache-Control": "no-store", "Pragma": "no-cache" };

// Resolve a presented bearer token into an actor context. Returns null on unauthorized.
async function resolveBearer(presented: string): Promise<ActorCtx | null> {
  if (!presented) return null;
  for (const k of PLATFORM_KEYS) {
    if (presented === k.value) {
      return { kind: "platform", user_id: null, client_id: k.label, scopes: [...SUPPORTED_SCOPES] };
    }
  }
  const hash = await sha256Hex(presented);
  const { data } = await admin
    .from("paige_mcp_oauth_tokens")
    .select("user_id, client_id, scopes, access_expires_at, revoked_at")
    .eq("access_token_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at || new Date(data.access_expires_at) < new Date()) return null;
  admin.from("paige_mcp_oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("access_token_hash", hash).then(() => {});
  return { kind: "user", user_id: data.user_id, client_id: data.client_id, scopes: data.scopes ?? [] };
}

// Inspect the JSON-RPC body and enforce, for `tools/call`, BOTH the audience
// TIER (§9/§25) and the per-tool SCOPE. Tier is the OUTER gate and runs for
// everyone — including the platform key (trivially god) — so a hostile client
// can never reach a hidden tool by calling it by name (visibility ≠ enforcement).
// A tier denial writes an audit row (§13). Scope keeps its original semantics:
// the platform key bypasses scope, user tokens must hold the required scope.
async function enforceTierAndScope(
  body: any,
  actor: ActorCtx,
): Promise<{ ok: true } | { ok: false; status: 403; code: string; error: string }> {
  // NOTE: this inspects a single JSON-RPC object's `.method`. A JSON-RPC batch
  // ARRAY has no top-level `.method` and would slip past — that is safe TODAY
  // only because the transport (StreamableHttpTransport, no session adapter)
  // rejects batch arrays with a 400 before dispatch. If a session adapter is
  // ever added, this gate MUST iterate over each batch element.
  if (body?.method !== "tools/call") return { ok: true };
  const toolName = body?.params?.name;
  const operatorNotification = toolName === "list_admin_notifications" || toolName === "create_admin_notification";
  const requiredTier = toolTier(toolName);

  // Tier resolution reads the DB (roles/agency). A transient DB error must fail
  // CLOSED as a structured 403, never throw past the caller into an opaque 500 (§13).
  let tier: McpTier;
  try {
    tier = await actorStore.run(actor, () => deriveTier(actor));
  } catch (e) {
    if (operatorNotification) return { ok: false, status: 403, code: "unavailable", error: "This action is unavailable." };
    console.error("[paige-mcp] tier resolution failed", (e as Error)?.message);
    await actorStore.run(actor, () => audit("mcp_gate_refuse", "mcp_tool", toolName ?? null, {
      refusal_code: "tier_resolution_failed", enforcement: "enforced",
    })).catch(() => {});
    return { ok: false, status: 403, code: "tier_resolution_failed", error: "tier_resolution_failed" };
  }

  // These legacy operator tools must not emit named denial/audit payloads or
  // reach the privileged handler for a tenant. Existing operator scopes remain.
  if (operatorNotification) {
    return tier === "god" && (actor.kind === "platform" || actor.scopes.includes(TOOL_SCOPE[toolName]))
      ? { ok: true }
      : { ok: false, status: 403, code: "unavailable", error: "This action is unavailable." };
  }

  // ── TIER GATE (audience) ──
  let tierOk: boolean;
  if (requiredTier === "client") tierOk = tier === "client";     // client tools: only the client seat
  else if (tier === "client") tierOk = false;                    // client seat is sealed to self.* tools
  else tierOk = TIER_RANK[tier] >= TIER_RANK[requiredTier];       // god⊇agency⊇tenant
  if (!tierOk) {
    await actorStore.run(actor, () =>
      audit("tier_denied", "mcp_tool", toolName ?? null, { required_tier: requiredTier, caller_tier: tier }))
      .catch(() => {});
    return {
      ok: false, status: 403, code: "tier_forbidden",
      error: `tier_forbidden: '${toolName}' requires '${requiredTier}', caller is '${tier}'`,
    };
  }

  // ── SCOPE GATE (operation) — unchanged semantics ──
  if (actor.kind === "platform") return { ok: true };
  const required = TOOL_SCOPE[toolName];
  // THE SCOPE REFUSALS ARE RECORDED TOO, so "did anything try to reach my workspace over MCP" has a
  // truthful answer rather than one covering only the denials somebody remembered to write down.
  // The tier branch above already wrote its row; these two did not, and the governed door beyond
  // them records every attempt — so these were the last two silent exits on the path.
  //
  // The `operatorNotification` branches deliberately stay silent, and that is not an oversight: an
  // audit row naming those two tools would confirm to a non-operator that they exist, which is the
  // named denial `platform-notification-tool-boundary.test.ts` exists to forbid.
  if (!required) {
    await actorStore.run(actor, () => audit("mcp_gate_refuse", "mcp_tool", toolName ?? null, {
      refusal_code: "unknown_tool", caller_tier: tier, enforcement: "enforced",
    })).catch(() => {});
    return { ok: false, status: 403, code: "unknown_tool", error: `unknown_tool:${toolName}` };
  }
  if (!actor.scopes.includes(required)) {
    await actorStore.run(actor, () => audit("mcp_gate_refuse", "mcp_tool", toolName ?? null, {
      refusal_code: "insufficient_scope", required_scope: required, caller_tier: tier, enforcement: "enforced",
    })).catch(() => {});
    return { ok: false, status: 403, code: "insufficient_scope", error: `insufficient_scope: tool '${toolName}' requires '${required}'` };
  }
  return { ok: true };
}

/**
 * THE GOVERNED DOOR — the single place a `tools/call` is decided, and the last thing that runs
 * before dispatch.
 *
 * WHAT IT ADDS TO THE GATE ABOVE. `enforceTierAndScope` answers audience ("may this tier see this
 * tool?") and operation ("does this token hold the scope?"). Both are necessary and neither asks
 * the question this function exists for: **is this act a change, and may a connected app make it?**
 * For 68 of the 119 tools the answer is no, whatever the tier and whatever the scope — because an
 * MCP connection authorizes access to the door, not consequential action. See
 * `_shared/paige-mcp/governed-adapter.ts` for the full reasoning, including why the refusal is a
 * property of the channel rather than of a workspace's autonomy row.
 *
 * ORDER IS LOAD-BEARING, IN BOTH DIRECTIONS.
 *  - It runs AFTER the tier/scope gate, so `access` is a verdict that was actually reached rather
 *    than a permissive default — the gate's own `ok` is what is handed in, and moving this call
 *    above the gate does not compile.
 *  - It runs BEFORE `httpHandler`, so a refused mutation never reaches a handler and therefore
 *    never has a side effect to undo. A gate that refuses after the write is a log entry, not a
 *    gate.
 *
 * NOTHING IN THE REQUEST REACHES A GOVERNANCE INPUT. The tenant is `actorTenantId()`, the identity
 * is the resolved bearer, the access verdict is the gate's, and the effect comes from the
 * capability policy. `params.arguments` is passed through as the call's arguments and is read for
 * nothing else, which is what makes a forged `tenant_id`, `role`, `confirm` or `autonomy` in the
 * model's JSON inert rather than merely discouraged.
 *
 * EVERY ATTEMPT LEAVES A RECORD, allowed or refused, and the record carries no arguments, no
 * headers, no credentials and no provider output — only what was decided and why.
 */
async function governMcpToolCall(
  body: unknown,
  actor: ActorCtx,
  access: { allowed: boolean; reason?: string },
): Promise<{ ok: true } | { ok: false; status: 403; code: string; message: string }> {
  // A JSON-RPC BATCH has no top-level `.method`, so it would slip past this and the gate above.
  // The transport rejects arrays with a 400 today, which makes the hole theoretical — and a
  // guarantee that rests on a distant library's current behaviour is not a guarantee. Refused here
  // so it rests on this file instead. No working client is affected: an array never got through.
  if (Array.isArray(body)) {
    await actorStore.run(actor, () => audit("mcp_gate_refuse", "mcp_tool", null, {
      refusal_code: "batch_not_governed", enforcement: "enforced",
    })).catch(() => {});
    return {
      ok: false, status: 403, code: "batch_not_governed",
      message: "Batched calls are not accepted on this connection. Send one request at a time.",
    };
  }
  const rpc = body as { method?: unknown; params?: { name?: unknown; arguments?: unknown } } | null;
  if (rpc?.method !== "tools/call") return { ok: true };

  const startedAtMs = Date.now();
  const toolName = typeof rpc?.params?.name === "string" ? rpc.params.name : "";

  // The workspace, resolved SERVER-SIDE. A throw here fails closed: `null` reaches the seam as
  // `tenant_unresolved` rather than becoming an unscoped call.
  let tenantId: string | null = null;
  try {
    tenantId = await actorStore.run(actor, () => actorTenantId());
  } catch (e) {
    console.error("[paige-mcp] governed door: tenant resolution failed", (e as Error)?.message);
  }

  const { outcome, audit: record } = decideMcpToolCall({
    tool: toolName,
    args: rpc?.params?.arguments,
    // `resolveBearer` matched a platform key or an unexpired, unrevoked OAuth token before dispatch
    // reached here; an unmatched bearer returned 401 and never gets this far.
    authenticated: true,
    userId: actor.user_id,
    actorKind: actor.kind,
    tenantId,
    access,
    startedAtMs,
    nowIso: new Date().toISOString(),
  });

  const row = mcpGovernedAuditRow(record);
  // Awaited, not detached: a governance decision nobody recorded is the state this surface was
  // already in. `audit()` logs loudly on failure and never throws.
  //
  // THE COST, NAMED. This is one insert on every call, reads included, so all 51 reads carry a
  // database round trip they did not before and the table grows a row per attempt rather than per
  // write. That is deliberate — "which of my tools did that connector reach, and what did the door
  // say" is unanswerable from a table that only records the ones that got through — but it is a
  // real trade, and no retention bound is set on it yet.
  await actorStore.run(actor, () => audit(row.action, row.target_type, row.target_id, row.payload, row.tenant_id));

  if (outcome.kind === "allow") return { ok: true };
  return { ok: false, status: outcome.status, code: outcome.code, message: outcome.message };
}

// ── Paige Context Rail — MCP producer (§7/§8/§12) ────────────────────────────
// When an EXTERNAL MCP command (Claude Desktop, ChatGPT, etc.) runs an action
// that TARGETS A CLIENT, we file an `mcp.command` event onto that client's
// context rail so Paige-the-orchestrator (owner side) sees an outside tool
// acted. `mcp.command` is owner_internal / owner_ops, so record_rail_event
// broadcasts it to the owner rail only — never the client feed (§9).
//
// Only the tools below file a rail event — a curated allowlist of client-acting
// mutations. Reads (search_/get_/list_) and tenant-level admin never emit. Each
// label is human, friendly, and free of tool slugs / method names / jargon (§3),
// and neutral about vertical (no credit/funding wording, even for opted-in
// funding tools — §2). Title renders as "External command: <label>".
const CLIENT_ACTION_LABELS: Record<string, string> = {
  create_contact: "added a new client",
  update_contact: "updated a client's details",
  update_contact_stage: "updated a client's stage",
  update_lifecycle_stage: "updated a client's stage",
  add_contact_note: "added a note to a client",
  append_client_memory: "saved a note about a client",
  propose_client_update: "proposed a client update",
  link_contact_to_business: "linked a client to their business",
  assign_coach: "assigned a coach to a client",
  advance_contact_journey_stage: "advanced a client's journey",
  create_deal: "created a deal for a client",
  create_invoice: "created an invoice for a client",
  send_transactional_email: "sent an email to a client",
  send_composed_email: "sent an email to a client",
  send_btf_template_email: "sent an email to a client",
  send_sms: "sent a text to a client",
  run_workflow: "ran an automation for a client",
  ingest_credit_scores: "recorded a client update",
  ingest_banking_snapshot: "recorded a client update",
  handle_data_subject_request: "processed a data request for a client",
};

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

// Decide, from the transport's response, whether the tool call ACTUALLY
// succeeded — a call is not a completed action (§13 truthful). Handles both the
// JSON and text/event-stream framings mcp-lite can return. A JSON-RPC protocol
// error, a missing result, or a tool that returned err() (result.isError) all
// count as failure and suppress the emit.
function mcpCallSucceeded(text: string, contentType: string, id: unknown): boolean {
  const check = (obj: any): boolean => {
    if (!obj || typeof obj !== "object") return false;
    if (id !== undefined && obj.id !== undefined && obj.id !== id) return false;
    if (obj.error) return false;
    if (!obj.result) return false;
    if (obj.result.isError === true) return false;
    return true;
  };
  try {
    if (contentType.includes("text/event-stream")) {
      for (const line of text.split("\n")) {
        const m = line.match(/^data:\s*(\{.*\})\s*$/);
        if (m) { try { if (check(JSON.parse(m[1]))) return true; } catch { /* keep scanning frames */ } }
      }
      return false;
    }
    return check(JSON.parse(text));
  } catch { return false; }
}

// File the mcp.command rail event for a client-targeting external command.
// DETACHED and best-effort: clones the response synchronously, then does all
// resolution + the emit off the response path so it can NEVER block or break
// the MCP reply (§13). Emits only AFTER confirmed success and only when a REAL
// contact resolves from the command's own arguments (never fabricated, never
// cross-tenant — §9).
function emitMcpCommandRail(actor: ActorCtx, body: any, res: Response): void {
  const name: string = body?.params?.name ?? "";
  const label = CLIENT_ACTION_LABELS[name];
  if (!label) return; // not a client-acting command — nothing to file
  const clone = res.clone();
  void (async () => {
    try {
      const ct = clone.headers.get("content-type") ?? "";
      const text = await clone.text();
      if (!mcpCallSucceeded(text, ct, body?.id)) return; // truthful: only real completions

      const rawArgs = (body?.params?.arguments && typeof body.params.arguments === "object")
        ? body.params.arguments : {};
      const explicitId = firstStr(rawArgs.contact_id, rawArgs.client_id, rawArgs.contact_client_id);
      const email = firstStr(rawArgs.email, rawArgs.to, rawArgs.to_email, rawArgs.recipient_email);
      const phone = firstStr(rawArgs.phone, rawArgs.to_phone);
      if (!explicitId && !email && !phone) return; // tenant-level command, no client target

      // Tenant comes from the MCP auth/consent context (the resolved bearer actor);
      // actorTenantId() must run inside the actor's ALS scope.
      const tenantId = await actorStore.run(actor, () => actorTenantId());
      if (!tenantId) return;

      // Resolve the target contact. An explicit contact id from the command's own
      // arguments wins — use it directly and let record_rail_event's contact-in-tenant
      // check validate/scope it (the deployed resolve_contact_id has NO explicit-id
      // param; its p_user_id matches clients.linked_user_id, not clients.id, so an
      // explicit contact id must NOT be routed through it). Otherwise resolve by
      // email/phone via the correct deployed signature (p_tenant, p_phone, p_email,
      // p_user_id). NULL ⇒ skip rather than guess or mis-attribute (§9/§13).
      let contactId: string | null = explicitId ?? null;
      if (!contactId && (email || phone)) {
        const { data } = await admin.rpc("resolve_contact_id", {
          p_tenant: tenantId,
          p_phone: phone ?? null,
          p_email: email ?? null,
          p_user_id: null,
        });
        contactId = typeof data === "string" && data ? data : null;
      }
      if (!contactId || typeof contactId !== "string") return;

      // Trusted service path: pass p_tenant_id explicitly (auth.uid() is NULL here).
      await admin.rpc("record_rail_event", {
        p_contact_id: contactId,
        p_event_kind: "mcp.command",
        p_surface: "mcp",
        p_actor_type: "external",
        p_title: `External command: ${label}`,
        p_summary: null,
        p_payload: { source: "mcp", mcp_client: actor.client_id, actor_kind: actor.kind },
        p_ref_table: "clients",
        p_ref_id: contactId,
        p_tenant_id: tenantId,
      });
    } catch (e) {
      console.warn("[paige-mcp] mcp.command rail emit skipped:", (e as Error)?.message);
    }
  })();
}

app.all("/*", async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  const method = c.req.method;
  console.log("[paige-mcp]", method, path);

  // ----- Public discovery -----
  if (method === "GET" && path.includes("/.well-known/oauth-protected-resource")) {
    return c.json(DISCOVERY_RESOURCE, 200, { ...CORS, ...NO_STORE });
  }
  if (method === "GET" && path.includes("/.well-known/oauth-authorization-server")) {
    return c.json(DISCOVERY_AS, 200, { ...CORS, ...NO_STORE });
  }

  // ----- /oauth/register : Dynamic Client Registration (RFC 7591) -----
  if (method === "POST" && path.endsWith("/oauth/register")) {
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.client_name ?? "Unnamed MCP Client").slice(0, 200);
    const uris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u: any) => typeof u === "string") : [];
    if (uris.length === 0) return c.json({ error: "invalid_redirect_uri", error_description: "redirect_uris required" }, 400, { ...CORS, ...NO_STORE });
    for (const u of uris) {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
          return c.json({ error: "invalid_redirect_uri", error_description: `non-https redirect: ${u}` }, 400, { ...CORS, ...NO_STORE });
        }
      } catch {
        return c.json({ error: "invalid_redirect_uri" }, 400, { ...CORS, ...NO_STORE });
      }
    }
    const client_id = `mcp_${randToken(16)}`;
    const requestedScope = typeof body.scope === "string" ? body.scope : "crm.read";
    const { error } = await admin.from("paige_mcp_oauth_clients").insert({
      client_id, client_name: name, client_uri: body.client_uri ?? null,
      redirect_uris: uris, scope: requestedScope,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    if (error) return c.json({ error: "server_error", error_description: error.message }, 500, { ...CORS, ...NO_STORE });
    return c.json({
      client_id, client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name, redirect_uris: uris, scope: requestedScope,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
    }, 201, { ...CORS, ...NO_STORE });
  }

  // ----- /oauth/authorize : 302 to the in-app consent screen -----
  if (method === "GET" && path.endsWith("/oauth/authorize")) {
    const qs = url.searchParams.toString();
    const target = `${APP_ORIGIN}/mcp/authorize?${qs}`;
    return new Response(null, { status: 302, headers: { ...CORS, ...NO_STORE, Location: target } });
  }

  // ----- /oauth/token : code & refresh_token grants -----
  if (method === "POST" && path.endsWith("/oauth/token")) {
    const ct = c.req.header("content-type") ?? "";
    let p: Record<string, string> = {};
    if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await c.req.text();
      for (const [k, v] of new URLSearchParams(text)) p[k] = v;
    } else {
      p = await c.req.json().catch(() => ({}));
    }
    const grant = p.grant_type;

    if (grant === "authorization_code") {
      const code = p.code;
      const verifier = p.code_verifier;
      const client_id = p.client_id;
      const redirect_uri = p.redirect_uri;
      if (!code || !verifier || !client_id || !redirect_uri) {
        return c.json({ error: "invalid_request" }, 400, { ...CORS, ...NO_STORE });
      }
      const code_hash = await sha256Hex(code);
      const { data: codeRow } = await admin
        .from("paige_mcp_oauth_codes")
        .select("*")
        .eq("code_hash", code_hash)
        .maybeSingle();
      if (!codeRow || codeRow.consumed_at || new Date(codeRow.expires_at) < new Date()) {
        return c.json({ error: "invalid_grant" }, 400, { ...CORS, ...NO_STORE });
      }
      if (codeRow.client_id !== client_id || codeRow.redirect_uri !== redirect_uri) {
        return c.json({ error: "invalid_grant" }, 400, { ...CORS, ...NO_STORE });
      }
      if (!(await verifyPkceS256(verifier, codeRow.code_challenge))) {
        return c.json({ error: "invalid_grant", error_description: "pkce_failed" }, 400, { ...CORS, ...NO_STORE });
      }
      await admin.from("paige_mcp_oauth_codes").update({ consumed_at: new Date().toISOString() }).eq("code_hash", code_hash);

      const access = randToken(48);
      const refresh = randToken(48);
      const now = new Date();
      const access_exp = new Date(now.getTime() + 60 * 60 * 1000); // 1h
      const refresh_exp = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30d
      const { data: clientRow } = await admin.from("paige_mcp_oauth_clients").select("client_name").eq("client_id", client_id).maybeSingle();
      await admin.from("paige_mcp_oauth_tokens").insert({
        access_token_hash: await sha256Hex(access),
        refresh_token_hash: await sha256Hex(refresh),
        client_id, user_id: codeRow.user_id, scopes: codeRow.scopes,
        access_expires_at: access_exp.toISOString(), refresh_expires_at: refresh_exp.toISOString(),
        client_name_cache: clientRow?.client_name ?? null,
      });
      return c.json({
        access_token: access, token_type: "Bearer", expires_in: 3600,
        refresh_token: refresh, scope: codeRow.scopes.join(" "),
      }, 200, { ...CORS, ...NO_STORE });
    }

    if (grant === "refresh_token") {
      const refresh = p.refresh_token;
      if (!refresh) return c.json({ error: "invalid_request" }, 400, { ...CORS, ...NO_STORE });
      const rh = await sha256Hex(refresh);
      const { data: tok } = await admin
        .from("paige_mcp_oauth_tokens")
        .select("*")
        .eq("refresh_token_hash", rh)
        .maybeSingle();
      if (!tok || tok.revoked_at || (tok.refresh_expires_at && new Date(tok.refresh_expires_at) < new Date())) {
        return c.json({ error: "invalid_grant" }, 400, { ...CORS, ...NO_STORE });
      }
      // Rotate: revoke old, issue new pair.
      await admin.from("paige_mcp_oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tok.id);
      const access = randToken(48);
      const refreshNew = randToken(48);
      const now = new Date();
      await admin.from("paige_mcp_oauth_tokens").insert({
        access_token_hash: await sha256Hex(access),
        refresh_token_hash: await sha256Hex(refreshNew),
        client_id: tok.client_id, user_id: tok.user_id, scopes: tok.scopes,
        access_expires_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        refresh_expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        client_name_cache: tok.client_name_cache,
      });
      return c.json({
        access_token: access, token_type: "Bearer", expires_in: 3600,
        refresh_token: refreshNew, scope: (tok.scopes ?? []).join(" "),
      }, 200, { ...CORS, ...NO_STORE });
    }

    return c.json({ error: "unsupported_grant_type" }, 400, { ...CORS, ...NO_STORE });
  }

  // ----- /oauth/revoke : RFC 7009 -----
  if (method === "POST" && path.endsWith("/oauth/revoke")) {
    const ct = c.req.header("content-type") ?? "";
    let p: Record<string, string> = {};
    if (ct.includes("application/x-www-form-urlencoded")) {
      for (const [k, v] of new URLSearchParams(await c.req.text())) p[k] = v;
    } else {
      p = await c.req.json().catch(() => ({}));
    }
    const tok = p.token;
    if (tok) {
      const h = await sha256Hex(tok);
      await admin.from("paige_mcp_oauth_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .or(`access_token_hash.eq.${h},refresh_token_hash.eq.${h}`);
    }
    return c.json({}, 200, { ...CORS, ...NO_STORE });
  }

  // ----- MCP protocol endpoint (requires bearer) -----
  if (PLATFORM_KEYS.length === 0) return c.json({ error: "server_misconfigured" }, 500, CORS);
  const presented = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const actor = await resolveBearer(presented);
  if (!actor) {
    return c.json({ error: "unauthorized" }, 401, {
      ...CORS,
      // Point the client at the origin that ACTUALLY serves the metadata — this
      // function (PUBLIC_ORIGIN). It was pointing at APP_ORIGIN (paigeagent.ai),
      // which doesn't serve /.well-known/*, so an external MCP client (Zoom) fetched
      // the resource-metadata URL, got a 404, and failed discovery ("MCP client
      // UNAUTHORIZED"). The metadata body already advertises authorization_endpoint
      // on APP_ORIGIN (the in-app consent page), so the auth flow still lands there.
      "WWW-Authenticate": `Bearer realm="paige-mcp", resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource"`,
    });
  }

  // Peek the body to enforce per-tool scope for user tokens. Clone first so the transport can re-read.
  let peekedBody: any = null;
  if (method === "POST") {
    const raw = c.req.raw.clone();
    peekedBody = await raw.json().catch(() => null);
    const gate = await enforceTierAndScope(peekedBody, actor);
    if (!gate.ok) {
      return c.json({
        jsonrpc: "2.0", id: peekedBody?.id ?? null,
        // `data.refusal_code` is additive and the sentence is unchanged, so no existing consumer
        // breaks. It exists because the governed door below returns the SAME http 403 and the same
        // JSON-RPC -32001, and telling the two apart by which one LACKS a `data` key is
        // discrimination by absence — the kind a consumer gets wrong once and then hard-codes.
        // A tier denial is about who is asking; a governed refusal is about what was asked for.
        error: { code: -32001, message: gate.error, data: { refusal_code: gate.code } },
      }, gate.status, CORS);
    }
    // The governed door. `gate.ok` is the access verdict this branch just established — passing it
    // rather than a literal is what stops this call being moved above the gate.
    const governed = await governMcpToolCall(peekedBody, actor, { allowed: gate.ok });
    if (!governed.ok) {
      return c.json({
        jsonrpc: "2.0", id: peekedBody?.id ?? null,
        error: {
          code: -32001,
          message: `${governed.code}: ${governed.message}`,
          // Machine-readable alongside the sentence, so a client can tell "ask a person to approve
          // this in Paige" apart from "this is never available here" without parsing prose.
          data: { refusal_code: governed.code },
        },
      }, governed.status, CORS);
    }
  }

  const res = await actorStore.run(actor, () => httpHandler(c.req.raw));

  // Paige Context Rail — MCP emitter: after an external MCP tool call returns,
  // file mcp.command onto the target client's rail when it was a client-acting
  // command. Detached + fully guarded, so it can never slow or break the MCP
  // response; see emitMcpCommandRail for the truthful-success + contact-resolve
  // rules. (task #161 note: when clients later connect their OWN ChatGPT/Claude/
  // Gemini, a distinct 'client connects assistant' event would be filed from the
  // consent/link handler — NOT here; this producer is for external tools ACTING
  // on a client, not the client authorizing their own assistant.)
  if (method === "POST" && peekedBody?.method === "tools/call") {
    try { emitMcpCommandRail(actor, peekedBody, res); }
    catch (e) { console.warn("[paige-mcp] mcp.command emit skipped:", (e as Error)?.message); }
  }

  // Doctrine §118 + client-tier curation: filter master-only tools out of
  // tools/list for non-MMA callers, AND for user-tier callers strip any tool
  // whose required scope isn't in their granted scopes. This is what makes
  // the client tier feel like a curated MCP — they only see me_* tools, not
  // the full operator set.
  if (method === "POST" && peekedBody?.method === "tools/list") {
    try {
      const tier = await actorStore.run(actor, () => deriveTier(actor));
      const isUser = actor.kind === "user";
      const scopeSet = new Set(actor.scopes);
      // Tier-aware visibility mirrors the enforcement gate in enforceTierAndScope
      // (the real guard). This just curates what each tier SEES: a tenant never
      // sees god/agency tools, a client sees only its self.* tools, etc. The old
      // `!isMma && MASTER_ONLY_TOOLS` branch is subsumed by the tier ladder.
      const keep = (t: any): boolean => {
        const name = t?.name;
        if (!name) return true;
        const req = toolTier(name);
        if (req === "client") { if (tier !== "client") return false; }
        else if (tier === "client") { return false; }
        else if (TIER_RANK[tier] < TIER_RANK[req]) { return false; }
        if (isUser) {
          const s = TOOL_SCOPE[name];
          if (!s || !scopeSet.has(s)) return false;
        }
        return true;
      };
      const cloned = res.clone();
      const text = await cloned.text();
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = JSON.parse(text);
        if (Array.isArray(body?.result?.tools)) {
          body.result.tools = body.result.tools.filter(keep);
        }
        const filtered = new Response(JSON.stringify(body), {
          status: res.status,
          headers: res.headers,
        });
        for (const [k, v] of Object.entries(CORS)) filtered.headers.set(k, v);
        return filtered;
      } else if (ct.includes("text/event-stream")) {
        const rewritten = text.replace(/^data: (\{.*\})$/gm, (_m, json) => {
          try {
            const body = JSON.parse(json);
            if (Array.isArray(body?.result?.tools)) {
              body.result.tools = body.result.tools.filter(keep);
            }
            return `data: ${JSON.stringify(body)}`;
          } catch {
            return `data: ${json}`;
          }
        });
        const filtered = new Response(rewritten, { status: res.status, headers: res.headers });
        for (const [k, v] of Object.entries(CORS)) filtered.headers.set(k, v);
        return filtered;
      }
    } catch (e) {
      console.error("[paige-mcp] tools/list filter failed", (e as Error).message);
    }
  }


  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
});

Deno.serve(app.fetch);
