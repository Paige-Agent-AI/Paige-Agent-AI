// Paige Orchestrator — Section 18 doctrine
// Tool-deferral pattern: exposes tool_search + tool_invoke to Paige.
// Routes invocations to local Edge Functions or to LangGraph via paige-bridge.

import { createClient } from "npm:@supabase/supabase-js@2";
import { routedChatCompletion, pickRoute, isJobKind, JOB_KINDS, DEFAULT_SUBAGENT_JOB_KIND, type JobKind } from "../_shared/model-router.ts";
import { looksLikeFinanceAgent } from "../_shared/finance-gate.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { recordCapabilityRun } from "../_shared/capability-record.ts";
import { idempotencyKey } from "../_shared/durable-job/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LANGGRAPH_BRIDGE_URL = Deno.env.get("LANGGRAPH_BRIDGE_URL") ?? "";
const LANGGRAPH_BRIDGE_KEY = Deno.env.get("LANGGRAPH_BRIDGE_API_KEY") ?? "";

const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// A tenant_id must be a real uuid before it ever touches a PostgREST filter (§9): the tenant scope is
// the ONLY isolation boundary here because this fn queries with the SERVICE-ROLE client (RLS is bypassed).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// §2/#206: funding is an opt-in offer, never a default — a tenant without funding enabled must not see
// or invoke a funding/credit sub-agent. Classification (domain OR keyword) is the ONE shared home in
// _shared/finance-gate.ts, identical to the gate subagent-forge applies at creation time (§18).

/** Resolved, TRUSTED tenant scope for a request. tenant_id is a validated uuid or null (null = the caller
 *  sees only platform-default agents — safe). Never derived from an unverified request body for a user. */
interface TenantScope {
  tenantId: string | null;
  fundingEnabled: boolean;
  callerId: string | null;
  // §9: is this the trusted service-role (platform operator) path, decided by the EXACT-key match
  // below — never a decoded `role` claim. A WRITE gate (set_agent_job_kind) reuses this signal so it
  // never re-derives service-vs-user; a forged token can't reach the operator branch.
  isService: boolean;
}

/**
 * §9 tenant resolution — the security boundary. TWO trusted paths, never trust a user's body tenant_id:
 *   • SERVICE-ROLE caller (e.g. paige-ai-chat, which already resolved tenant from the user's JWT upstream):
 *     accept a uuid-VALIDATED body.tenant_id + body.funding_enabled. A malformed tenant_id is rejected
 *     (400) so it can never reach the filter.
 *   • USER (or anon) caller: derive tenant SERVER-SIDE from the JWT via get_paige_persona_context()
 *     (SECURITY DEFINER, resolves from auth.uid()), which returns the verified tenant_id AND funding_enabled.
 *     body.tenant_id is IGNORED entirely. An anon token (no user) resolves to null → defaults only.
 * Returns null tenantId on any miss (honest degrade to platform-defaults, never fail-open to all tenants).
 */
async function resolveTenantScope(req: Request, payload: OrchestratorRequest): Promise<TenantScope | { error: string; status: number }> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { error: "Missing bearer token", status: 401 };
  const token = auth.slice(7);
  // Defense-in-depth (§9/§13): trust the service path only on an EXACT match to the real service-role
  // key — not on an unverified `role` claim decoded from the token. This removes the silent dependency
  // on the gateway's verify_jwt=true; even if that config ever changed, a forged `role:service_role`
  // token can't enter the trusted branch. Internal callers (paige-ai-chat, paige-mcp) send this literal.
  const isServiceRole = token === SERVICE_ROLE_KEY;

  if (isServiceRole) {
    // Trusted internal caller — it resolved tenant upstream. Still uuid-validate before the filter (§9).
    const bodyTenant = (payload as { tenant_id?: string | null }).tenant_id ?? null;
    if (bodyTenant !== null && !UUID_RE.test(String(bodyTenant))) {
      return { error: "Invalid tenant_id", status: 400 };
    }
    const fundingEnabled = (payload as { funding_enabled?: boolean }).funding_enabled === true;
    return { tenantId: bodyTenant, fundingEnabled, callerId: payload.context?.user_id ?? null, isService: true };
  }

  // User/anon caller — derive server-side; the body's tenant_id is never trusted.
  const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: userData } = await authed.auth.getUser(token);
  const callerId = userData.user?.id ?? null;
  let tenantId: string | null = null;
  let fundingEnabled = false;
  try {
    const { data, error } = await authed.rpc("get_paige_persona_context");
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      const t = row?.tenant_id ?? null;
      tenantId = typeof t === "string" && UUID_RE.test(t) ? t : null;
      fundingEnabled = row?.funding_enabled === true;
    }
  } catch (_e) {
    tenantId = null; // honest degrade to platform-defaults; never widen scope on an error
  }
  return { tenantId, fundingEnabled, callerId, isService: false };
}

/**
 * INT-308 — the trusted-actor boundary. ONE downstream context is built AFTER authentication,
 * from verified state only; the raw caller context is never spread forward again:
 *   • JWT/anon caller: user_id IS the verified callerId — always. A caller-supplied
 *     context.user_id is IGNORED (and surfaced as a tamper signal), never forwarded, never
 *     used for attribution. Identity is not request input.
 *   • SERVICE-ROLE caller: it may name an acting user (a canonical PAIGE service resolved the
 *     real user upstream), but when BOTH the resolved tenant and the actor are present the
 *     association is PROVEN server-side (active tenant_members row for actor+tenant) —
 *     tenant A paired with tenant B's user FAILS CLOSED instead of being forwarded.
 * contact_id / conversation_id pass through unchanged. Audit finding (INT-308 record):
 * NEITHER is read as identity/tenant authority downstream, but contact_id IS an unscoped
 * cross-tenant data-selector in several local specialists (they load clients by id with the
 * service role and no tenant filter) — a PRE-EXISTING input-validation gap, equally reachable
 * via input.contact_id, deliberately out of this hotfix's fence.
 */
async function buildTrustedContext(
  payload: OrchestratorRequest,
  scope: TenantScope,
): Promise<{ ctx: NonNullable<OrchestratorRequest["context"]> } | { error: string; status: number }> {
  const supplied = payload.context?.user_id ?? null;
  if (scope.isService) {
    const acting = supplied && UUID_RE.test(supplied) ? supplied : null;
    if (supplied && !acting) return { error: "Invalid acting user_id", status: 400 };
    if (acting && scope.tenantId) {
      const { data: member, error: memberErr } = await supabase
        .from("tenant_members").select("tenant_id").limit(1)
        .eq("user_id", acting).eq("tenant_id", scope.tenantId).eq("status", "active");
      if (memberErr) throw memberErr;
      const associated = Array.isArray(member) ? member.length > 0 : !!member;
      if (!associated) {
        return { error: "Acting user is not a member of the resolved workspace", status: 403 };
      }
    }
    return { ctx: { ...payload.context, user_id: acting ?? undefined } };
  }
  if (supplied && supplied !== scope.callerId) {
    console.warn("[paige-orchestrator] INT-308: caller-supplied context.user_id ignored — identity is not request input");
  }
  return { ctx: { ...payload.context, user_id: scope.callerId ?? undefined } };
}

type Action = "tool_search" | "tool_invoke" | "list_subagents" | "inspect" | "set_agent_job_kind";

interface OrchestratorRequest {
  action: Action;
  query?: string;
  domain?: string;
  slug?: string;
  job_kind?: string; // §34-L5: the routing tier to set on a soft agent (set_agent_job_kind)
  input?: Record<string, unknown>;
  context?: {
    contact_id?: string;
    conversation_id?: string;
    user_id?: string;
  };
}

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function fail(error: string, status = 400, details?: unknown) {
  return new Response(JSON.stringify({ ok: false, error, details }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function searchSubagents(query?: string, domain?: string, tenantId?: string | null, fundingEnabled = false) {
  let q = supabase
    .from("paige_subagents")
    // system_prompt is selected only so the §2 finance filter (below) sees the SAME signal fields the
    // tool_invoke guard does — keeps the listing gate symmetric with the invoke gate. It is filtered
    // out of the returned rows before they leave this function (see below).
    .select("slug,name,domain,description,runtime,triggers,display_order,system_prompt")
    .eq("enabled", true)
    .order("display_order");

  // §9 isolation: platform defaults (tenant_id null) + THIS tenant's own agents only. tenantId is a
  // trusted, uuid-validated value from resolveTenantScope (never a raw request body) — the filter is
  // parameterized (no string-interpolated injection): null tenant → defaults only.
  q = tenantId ? q.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) : q.is("tenant_id", null);

  if (domain) q = q.ilike("domain", `%${domain}%`);
  const { data, error } = await q;
  if (error) throw error;

  // §2/#206: hide funding/credit agents (by domain OR keyword) from a tenant that hasn't opted in.
  // system_prompt was selected ONLY to feed that classifier — strip it before any row leaves this
  // function so an agent's internal prompt never rides out in a tool_search response (§9/§13).
  const raw = data ?? [];
  const rows = (fundingEnabled ? raw : raw.filter((r) => !looksLikeFinanceAgent(r)))
    .map(({ system_prompt: _sp, ...rest }) => rest);

  if (!query) return rows;

  const needle = query.toLowerCase();
  return rows
    .map((row) => {
      const hay = [
        row.name,
        row.description,
        row.domain,
        ...(row.triggers ?? []),
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      if (hay.includes(needle)) score += 5;
      for (const t of row.triggers ?? []) {
        if (needle.includes(String(t).toLowerCase())) score += 3;
      }
      return { ...row, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _s, ...rest }) => rest);
}

// §34-L5 Talent — roster INSPECT. A read-only view of the §9-scoped roster with each agent's
// EFFECTIVE routing tier (what pickRoute resolves its config.job_kind to today) and honest health
// from its invocation history. It exposes NO system_prompt and NO raw config beyond job_kind (§9/§13).
interface AgentHealth {
  invocations: number;         // total invocation rows (every status)
  success_rate: number | null; // succeeded / (succeeded + failed) — over RESOLVED runs ONLY; null when
                               // none are resolved yet (never a fabricated score, §13)
  dispatched: number;          // async langgraph handoffs whose downstream outcome the orchestrator
                               // can't yet observe — NOT counted as success (would inflate the rate, §13)
  last_error: string | null;
}

// Aggregate per-slug health from paige_subagent_invocations. The invocations table carries NO
// tenant_id column, so we scope by the REQUESTING USER (invoked_by = callerId): a user belongs to
// exactly one tenant, so this is strictly WITHIN-tenant and can never leak another tenant's activity
// volume for a shared platform-default agent (§9). No caller id (or no slugs) → honest empty health.
async function rosterHealthMap(slugs: string[], callerId: string | null): Promise<Record<string, AgentHealth>> {
  const map: Record<string, AgentHealth> = {};
  for (const s of slugs) map[s] = { invocations: 0, success_rate: null, dispatched: 0, last_error: null };
  if (!callerId || slugs.length === 0) return map;

  const { data, error } = await supabase
    .from("paige_subagent_invocations")
    .select("subagent_slug,status,error,created_at")
    .in("subagent_slug", slugs)
    .eq("invoked_by", callerId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[orchestrator] inspect health query failed:", error.message);
    return map; // honest degrade to empty health, never a fabricated aggregate
  }

  const agg: Record<string, { total: number; succeeded: number; failed: number; dispatched: number; lastError: string | null; sawFailed: boolean }> = {};
  for (const row of (data ?? []) as Array<{ subagent_slug: string; status: string; error: string | null }>) {
    const a = agg[row.subagent_slug] ?? (agg[row.subagent_slug] = { total: 0, succeeded: 0, failed: 0, dispatched: 0, lastError: null, sawFailed: false });
    a.total++;
    if (row.status === "succeeded") a.succeeded++;
    else if (row.status === "failed") {
      a.failed++;
      // Rows are newest-first, so the FIRST failed row for a slug is its most recent failure — lock
      // its error in (even if that row's error is null) so an OLDER failure can't mislabel "last error".
      if (!a.sawFailed) { a.sawFailed = true; a.lastError = typeof row.error === "string" ? row.error : null; }
    } else if (row.status === "dispatched") a.dispatched++;
    // "pending" rows count only toward `invocations` (in-flight, outcome not yet known).
  }
  for (const s of slugs) {
    const a = agg[s];
    if (!a || a.total === 0) continue;
    const resolved = a.succeeded + a.failed; // dispatched + pending are outcome-UNKNOWN, excluded from the rate
    map[s] = {
      invocations: a.total,
      success_rate: resolved > 0 ? a.succeeded / resolved : null,
      dispatched: a.dispatched,
      last_error: a.lastError,
    };
  }
  return map;
}

async function inspectRoster(
  payload: OrchestratorRequest,
  tenantId: string | null,
  fundingEnabled: boolean,
  callerId: string | null,
) {
  let q = supabase
    .from("paige_subagents")
    // description + system_prompt + config are read ONLY to (a) feed the §2 finance classifier the
    // SAME signal fields search uses and (b) resolve job_kind. NONE of them leave this function —
    // inspect returns job_kind alone, never the description text, the prompt, or the raw config (§9/§13).
    .select("slug,name,domain,description,enabled,tenant_id,system_prompt,config,display_order")
    .order("display_order");
  // §9 isolation: platform defaults (tenant_id null) + THIS tenant's own agents only. Same trusted,
  // parameterized filter searchSubagents uses (tenantId is a uuid-or-null from resolveTenantScope).
  q = tenantId ? q.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) : q.is("tenant_id", null);
  if (payload.slug) q = q.eq("slug", payload.slug);
  if (payload.domain) q = q.ilike("domain", `%${payload.domain}%`);
  const { data, error } = await q;
  if (error) throw error;

  // §2/#206: hide funding/credit agents (by domain OR keyword) from a tenant that hasn't opted in —
  // the SAME gate search/invoke apply, so inspect can't become a side channel that discloses them.
  const raw = data ?? [];
  const visible = fundingEnabled ? raw : raw.filter((r) => !looksLikeFinanceAgent(r));
  const healthMap = await rosterHealthMap(visible.map((r) => r.slug as string), callerId);

  return visible.map((r) => {
    const cfg = (r.config ?? {}) as Record<string, unknown>;
    // Resolve job_kind EXACTLY as invokeSoft does at runtime (any string → pickRoute; else the
    // default) so effective_tier is what this agent WOULD actually route to — never a cheaper tier
    // than reality. A corrupt/legacy non-JobKind string routes to Claude reasoning via pickRoute's
    // safe default (§17); we surface that true tier, and the raw stored job_kind, honestly (§13).
    const rawJobKind = typeof cfg.job_kind === "string" ? cfg.job_kind : DEFAULT_SUBAGENT_JOB_KIND;
    return {
      slug: r.slug,
      name: r.name,
      domain: r.domain,
      enabled: r.enabled,
      tenant_id: r.tenant_id,
      job_kind: rawJobKind,
      effective_tier: pickRoute(rawJobKind as JobKind).tier, // what this agent routes to today (§14/§17)
      health: healthMap[r.slug as string],
    };
  });
}

// §34-L5 / §10 Talent — the Paige-governable seam to SWAP a soft agent's routing tier by voice/text
// (not DBA-only). It writes config.job_kind, the exact key invokeSoft reads to pick the model. §18: the
// ONLY update-an-agent's-config path — subagent-forge only proposes/approves/rejects/lists/disables; it
// has no config-update action. Reuses pickRoute/isJobKind (no rival router, §14/§34).
async function setAgentJobKind(
  payload: OrchestratorRequest,
  tenantId: string | null,
  callerId: string | null,
  isServiceCaller: boolean,
) {
  // Validate against the ONE runtime source of truth for JobKinds (model-router) so a typo can't
  // silently mis-route an agent (§13). Invalid → 422 with the known values named.
  const jobKind = payload.job_kind;
  if (!isJobKind(jobKind)) {
    return fail(
      `"${String(jobKind)}" is not a known job_kind. Valid job_kinds: ${[...JOB_KINDS].join(", ")}.`,
      422,
    );
  }
  if (!payload.slug || typeof payload.slug !== "string") {
    return fail("Missing slug for set_agent_job_kind", 400);
  }

  // §16/§17 GOVERNANCE gate: retuning an agent's routing tier changes its cost/quality behavior — a
  // governance mutation. A DIRECT (non-service) caller must therefore be an admin, mirroring subagent-forge
  // which gates EVERY paige_subagents mutation behind isAdmin. Paige's own calls arrive SERVICE-role
  // (paige-ai-chat resolved the operator/tenant upstream) and bypass this, so §10 "Paige-governable" still
  // holds — only a human hitting the orchestrator directly is gated. Checked BEFORE the agent is resolved
  // so a non-admin caller learns NOTHING about which slugs exist (every slug returns the same 403 — no
  // existence oracle). callerId is the AUTHENTICATED user id for a non-service caller (resolveTenantScope's
  // user branch sets it from getUser, never the body); an anon caller (null) resolves to no roles → 403.
  if (!isServiceCaller) {
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", callerId ?? "");
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
    if (!isAdmin) return fail("Admin only", 403);
  }

  // Resolve the target by slug — read its OWN scope + config + runtime + version (NOT tenant-filtered
  // here on purpose: the §9 decision below needs the agent's real tenant_id to owe the caller the correct
  // masked response, not a blanket 404 that would hide a legitimate own-agent target).
  const { data: agent, error } = await supabase
    .from("paige_subagents")
    .select("id,slug,tenant_id,runtime,config,version")
    .eq("slug", payload.slug)
    .maybeSingle();
  if (error) throw error;
  if (!agent) return fail(`Unknown sub-agent: ${payload.slug}`, 404);

  // §9 MUTATION scope — STRICTER than the read-only inspect (the #361/#149 lesson applied to a WRITE):
  //   • SERVICE-ROLE caller (platform operator) may update ANY agent, incl. a platform default (null).
  //   • NON-service caller (already proven admin above; tenantId is SERVER-DERIVED, never from the body):
  //       – its OWN tenant's agent (tenant_id === tenantId) → allowed.
  //       – a platform default (tenant_id null) → 403 (operator config is off-limits to a tenant; those
  //         rows are globally visible via inspect/search anyway, so a 403 discloses nothing new).
  //       – ANOTHER tenant's agent → 404 MASK — never disclose a cross-tenant slug exists (matches the
  //         invoke path's out-of-scope 404). Closes the cross-tenant existence oracle.
  if (!isServiceCaller) {
    if (agent.tenant_id === null) return fail("Not permitted to modify this agent", 403);
    if (agent.tenant_id !== tenantId) return fail(`Unknown sub-agent: ${payload.slug}`, 404);
  }

  // Per-agent model routing is a SOFT-runtime capability ONLY today — local agents hardcode their model
  // downstream and langgraph has no live agent, so a swap there would be a no-op we'd be lying about (§13).
  if (agent.runtime !== "soft") {
    return fail(
      `Per-agent job_kind routing applies only to soft sub-agents today; "${payload.slug}" is runtime='${String(agent.runtime)}'.`,
      422,
    );
  }

  // Resolve the OLD job_kind EXACTLY as invokeSoft/inspect do (raw string → pickRoute; absent → the
  // default) so before/after tiers are TRUTHFUL, never a cheaper tier than reality (§13). Guard config to
  // an object first — a spread of a non-object jsonb would corrupt the keys.
  const cfg = (agent.config && typeof agent.config === "object" && !Array.isArray(agent.config))
    ? (agent.config as Record<string, unknown>)
    : {};
  const oldJobKind = typeof cfg.job_kind === "string" ? cfg.job_kind : DEFAULT_SUBAGENT_JOB_KIND;

  // Merge job_kind into the existing config — PRESERVE every other config key — and bump version. The
  // update carries an OPTIMISTIC-LOCK guard (.eq version): if a concurrent set/disable already bumped the
  // row, this matches 0 rows and we return 409 rather than silently losing a write (the filtered-write-
  // returns-success trap). .select() surfaces the affected count — a filtered update is otherwise silent.
  const newConfig = { ...cfg, job_kind: jobKind };
  const nextVersion = (typeof agent.version === "number" ? agent.version : 0) + 1;
  const { data: updated, error: upErr } = await supabase
    .from("paige_subagents")
    .update({ config: newConfig, version: nextVersion })
    .eq("id", agent.id)
    .eq("version", agent.version)
    .select("id");
  if (upErr) throw upErr;
  if (!updated || updated.length === 0) {
    return fail("Agent was modified concurrently — re-read and retry", 409);
  }

  // §17 governance: an immutable who/when/what trail for the routing-tier change (the old job_kind is
  // otherwise overwritten with no history). Best-effort — a logging failure must NEVER fail the swap the
  // caller asked for (§13). Matches the platform paige_audit_log pattern (skill-forge/prompt-forge/mcp).
  await supabase.from("paige_audit_log").insert({
    action: "agent_job_kind_set",
    target_type: "paige_subagents",
    target_id: agent.id,
    tenant_id: agent.tenant_id,
    actor_user_id: (callerId && UUID_RE.test(callerId)) ? callerId : null,
    actor_role: isServiceCaller ? "service" : "admin",
    payload: { slug: agent.slug, before: oldJobKind, after: jobKind },
  }).then(() => {}, () => {});

  return ok({
    ok: true,
    slug: agent.slug,
    before: { job_kind: oldJobKind, tier: pickRoute(oldJobKind as JobKind).tier },
    after: { job_kind: jobKind, tier: pickRoute(jobKind).tier },
  });
}

async function logInvocation(row: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("paige_subagent_invocations")
    .insert(row)
    .select("id")
    .single();
  if (error) console.error("[orchestrator] log insert failed:", error.message);
  return data?.id as string | undefined;
}

async function updateInvocation(id: string, patch: Record<string, unknown>) {
  await supabase.from("paige_subagent_invocations").update(patch).eq("id", id);
}

/**
 * Receipt & Rail Contract (runway ③): every completed invocation records a correlated
 * capability receipt — the stitch that makes each specialist call provable on the Rail
 * and joinable to the actions it served (paige_actions.invocation_id) and its receipt
 * (job_attempt_id = subagent-invocation:<id>). Envelope-only detail: no input/output
 * content rides the receipt (the invocation row already stores those under its own
 * access rules). Honest outcomes: langgraph DISPATCH is capability_outcome_unknown —
 * a dispatch is not a completion. Actor: the tenant's active owner (the business the
 * specialist served); null tenant → the helper declines visibly.
 */
async function recordInvocationReceipt(opts: {
  invocationId: string | undefined;
  slug: string;
  runtime: string;
  tenantId: string | null;
  success: boolean;
  dispatched: boolean;
  latencyMs: number;
}): Promise<void> {
  if (!opts.invocationId || !opts.tenantId) return;
  try {
    const { data: m } = await supabase.from("tenant_members")
      .select("user_id").eq("tenant_id", opts.tenantId).eq("status", "active")
      .in("role", ["owner", "admin"]).limit(1);
    const actor = m?.[0]?.user_id ?? null;
    await recordCapabilityRun(supabase, {
      tenantId: opts.tenantId,
      actorId: actor,
      capabilityKey: "subagent_invoke",
      outcome: opts.dispatched
        ? "capability_outcome_unknown"
        : opts.success ? "capability_succeeded" : "capability_failed",
      agentSlug: opts.slug,
      correlation: { jobAttemptId: idempotencyKey("subagent-invocation", opts.invocationId, "run") },
      detail: {
        substrate: "paige-orchestrator",
        runtime: opts.runtime,
        latency_ms: opts.latencyMs,
        ...(opts.dispatched ? { note: "langgraph dispatch — completion unobserved" } : {}),
      },
    });
  } catch (e) {
    console.error("[orchestrator] invocation receipt failed:", (e as Error)?.message);
  }
}

async function invokeLocal(
  fnName: string,
  input: Record<string, unknown>,
  context: OrchestratorRequest["context"],
) {
  const url = `${SUPABASE_URL}/functions/v1/${fnName}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "X-Orchestrator-Call": "1",
    },
    body: JSON.stringify({ input, context }),
  });
  const text = await resp.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: resp.status, body };
}

async function dispatchLangGraph(
  graph: string,
  input: Record<string, unknown>,
  context: OrchestratorRequest["context"],
) {
  if (!LANGGRAPH_BRIDGE_URL || !LANGGRAPH_BRIDGE_KEY) {
    return {
      status: 503,
      body: {
        ok: false,
        error: "LangGraph bridge not configured",
        hint: "Set LANGGRAPH_BRIDGE_URL and LANGGRAPH_BRIDGE_API_KEY",
      },
    };
  }
  const resp = await fetch(LANGGRAPH_BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LANGGRAPH_BRIDGE_KEY}`,
    },
    body: JSON.stringify({ graph, input, context }),
  });
  const text = await resp.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: resp.status, body };
}

// Soft sub-agent runtime — prompt-only, executed against the Lovable AI Gateway.
// No new edge function required; Paige can spin these up on her own.
async function invokeSoft(
  agent: { slug: string; name: string; system_prompt: string | null; config: Record<string, unknown> | null },
  input: Record<string, unknown>,
  _context: OrchestratorRequest["context"],
  tenantId: string | null,
) {
  if (!agent.system_prompt) return { status: 500, body: { ok: false, error: `Soft agent ${agent.slug} missing system_prompt` } };
  const cfg = (agent.config ?? {}) as Record<string, unknown>;
  // §14 model routing: every agent picks the cheapest-capable model per its job tier.
  // Default 'internal_first_draft' (open-model-eligible) — a sub-agent's output is an
  // internal draft Paige integrates/reviews; an agent can override job_kind in its config
  // (e.g. a client-facing final → 'client_copy_final', which routes to Claude reasoning).
  const jobKind = (typeof cfg.job_kind === "string" ? cfg.job_kind : "internal_first_draft") as JobKind;
  const userPayload = typeof input === "string" ? input : JSON.stringify(input);
  try {
    // §34-L5 attribution: thread the trace ctx so this routed call lands in paige_llm_trace tagged with
    // WHICH agent ran it (agent_id is a TEXT column → the stable slug) and the caller's tenant — without
    // it these rows were writing agent_id=null. A null/absent tenant_id degrades gracefully in the L1
    // writer (#146/#355), so we never throw on a platform/anon caller. Attribution only — routing unchanged.
    const data = await routedChatCompletion(jobKind, {
      messages: [
        { role: "system", content: agent.system_prompt },
        { role: "user", content: userPayload },
      ],
      max_tokens: 2048,
    }, { agent_id: agent.slug, tenant_id: tenantId });
    const answer = (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content ?? "";
    if (!answer) return { status: 502, body: { ok: false, error: "Model returned no content" } };
    return { status: 200, body: { ok: true, agent: agent.slug, answer } };
  } catch (e) {
    return { status: 502, body: { ok: false, error: e instanceof Error ? e.message : "model_error" } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let payload: OrchestratorRequest;
  try {
    payload = (await req.json()) as OrchestratorRequest;
  } catch {
    return fail("Invalid JSON body", 400);
  }

  // §9 SECURITY: derive the tenant scope from a TRUSTED source (service-role body or JWT-derived), never
  // from an unverified user body. This is the only tenant boundary (service-role client bypasses RLS).
  const scope = await resolveTenantScope(req, payload);
  if ("error" in scope) return fail(scope.error, scope.status);
  const { tenantId, fundingEnabled, callerId, isService } = scope;
  // INT-308: the ONE trusted downstream context — built from verified state, never from the
  // raw caller context (see buildTrustedContext). Everything downstream (invocation
  // attribution + the local/soft/langgraph context envelope) reads THIS, and only this.
  let ctx: NonNullable<OrchestratorRequest["context"]>;
  try {
    const trusted = await buildTrustedContext(payload, scope);
    if ("error" in trusted) return fail(trusted.error, trusted.status);
    ctx = trusted.ctx;
  } catch (e) {
    // Fail CLOSED with the same JSON/CORS envelope every other error carries — an
    // identity-proof infrastructure error must never surface as a bare runtime 500
    // (and must never fall through to an unverified context).
    console.error("[paige-orchestrator] INT-308 identity proof failed:", (e as Error)?.message);
    return fail("Identity verification failed; invocation refused", 500);
  }

  try {
    if (payload.action === "list_subagents" || payload.action === "tool_search") {
      const matches = await searchSubagents(payload.query, payload.domain, tenantId, fundingEnabled);
      return ok({ ok: true, matches });
    }

    // §34-L5: roster inspect — §9-scoped read of the crew with effective tiers + honest health.
    if (payload.action === "inspect") {
      const agents = await inspectRoster(payload, tenantId, fundingEnabled, callerId);
      return ok({ ok: true, agents });
    }

    // §34-L5 / §10: swap a soft agent's routing tier (config.job_kind). §9 WRITE gate lives inside.
    if (payload.action === "set_agent_job_kind") {
      return await setAgentJobKind(payload, tenantId, callerId, isService);
    }

    if (payload.action !== "tool_invoke") {
      return fail(`Unknown action: ${String(payload.action)}`, 400);
    }
    if (!payload.slug) return fail("Missing slug for tool_invoke", 400);

    let invQ = supabase
      .from("paige_subagents")
      .select("slug,name,domain,description,runtime,edge_function,langgraph_graph,enabled,system_prompt,config,tenant_id")
      .eq("slug", payload.slug);
    // §9 isolation: only a platform default or THIS tenant's own agent is invocable. Parameterized, and
    // tenantId is a trusted uuid-or-null from resolveTenantScope (no request-body injection).
    invQ = tenantId ? invQ.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`) : invQ.is("tenant_id", null);
    const { data: agent, error } = await invQ.maybeSingle();
    if (error) throw error;
    if (!agent) return fail(`Unknown sub-agent: ${payload.slug}`, 404);
    // §2/#206: a funding/credit agent (by domain OR keyword) is invocable only by a funding-enabled
    // tenant. Return the SAME 404 as an unknown agent — never disclose that a gated agent exists.
    if (!fundingEnabled && looksLikeFinanceAgent(agent)) {
      return fail(`Unknown sub-agent: ${payload.slug}`, 404);
    }
    if (!agent.enabled) return fail(`Sub-agent disabled: ${payload.slug}`, 403);

    const startedAt = Date.now();
    const invocationId = await logInvocation({
      subagent_slug: agent.slug,
      invoked_by: ctx.user_id ?? null,
      contact_id: ctx.contact_id ?? null,
      conversation_id: ctx.conversation_id ?? null,
      input: payload.input ?? {},
      status: "pending",
      tenant_id: tenantId, // §9 attribution: the resolved request tenant, never caller-supplied
    });

    let result: { status: number; body: unknown };
    // §34-L5 / §13 SCOPE NOTE: per-agent model routing (config.job_kind → pickRoute) is wired for SOFT
    // agents ONLY today — a `local` target hardcodes its model inside its own edge function (unreachable
    // per-agent from here) and `langgraph` has no live agent. Extending per-agent routing to those runtimes
    // is a documented follow-up, deliberately NOT faked here (never claim a swap that does nothing, §13).
    if (agent.runtime === "local") {
      if (!agent.edge_function) return fail(`Sub-agent ${agent.slug} has no edge_function configured`, 500);
      result = await invokeLocal(agent.edge_function, payload.input ?? {}, ctx);
    } else if (agent.runtime === "soft") {
      result = await invokeSoft(
        { slug: agent.slug, name: agent.name, system_prompt: agent.system_prompt, config: agent.config },
        payload.input ?? {},
        ctx,
        tenantId,
      );
    } else {
      if (!agent.langgraph_graph) return fail(`Sub-agent ${agent.slug} has no langgraph_graph configured`, 500);
      result = await dispatchLangGraph(agent.langgraph_graph, payload.input ?? {}, ctx);
    }

    const latency = Date.now() - startedAt;
    const success = result.status >= 200 && result.status < 300;
    const isDispatch = agent.runtime === "langgraph" && success;

    if (invocationId) {
      await updateInvocation(invocationId, {
        status: success ? (isDispatch ? "dispatched" : "succeeded") : "failed",
        latency_ms: latency,
        output: result.body,
        error: success
          ? null
          : typeof result.body === "object" && result.body
          ? JSON.stringify(result.body).slice(0, 500)
          : String(result.body).slice(0, 500),
        langgraph_run_id:
          isDispatch && typeof result.body === "object" && result.body
            ? (result.body as Record<string, unknown>).run_id as string | undefined ?? null
            : null,
      });
    }

    await recordInvocationReceipt({
      invocationId,
      slug: agent.slug,
      runtime: agent.runtime,
      tenantId,
      success,
      dispatched: isDispatch,
      latencyMs: latency,
    });

    return ok(
      {
        ok: success,
        subagent: agent.slug,
        runtime: agent.runtime,
        latency_ms: latency,
        // §13/§14: surface the invocation id so a caller (e.g. the action-bus drainer) can attach it to
        // the artifact it produced — proving "her TEAM did this", auditable, not Paige acting alone.
        invocation_id: invocationId,
        result: result.body,
      },
      success ? 200 : result.status,
    );
  } catch (e) {
    console.error("[orchestrator] error", e);
    return fail((e as Error).message ?? "Internal error", 500);
  }
});
