// Sub-Agent Factory — Section 18.5
// AUTHORS `paige_subagents` rows (concept 3 in docs/doctrine/skills-vocabulary.md — Paige's
// team MEMBERS / specialists, §14/§34 L5) — NOT `paige_skills` recipes (that's skill-forge,
// concept 1) and NOT `marketplace_items` (concept 2). Delegated to via delegate_to_subagent.
// Lets Paige (and admins) propose new sub-agents. Soft proposals auto-ship.
// Hard proposals (need new edge function) route to the Approvals Hub.

import { createClient } from "npm:@supabase/supabase-js@2";
import { looksLikeFinanceAgent } from "../_shared/finance-gate.ts";
import { decideSubagentAuthority } from "../_shared/subagent-authority.ts";
import { isJobKind, DEFAULT_SUBAGENT_JOB_KIND } from "../_shared/model-router.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { adminClient, isAuthorizedInternalCaller } from "../_shared/systems-check-http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DAILY_PROPOSAL_CAP = 10;
const SLUG_RE = /^[a-z][a-z0-9-]{2,40}$/;
const VALID_DOMAINS = new Set([
  "fundability", "compliance", "credit", "funding", "research",
  "outreach", "intake", "sales", "coaching", "ops", "support",
  "marketing", "analytics", "automation",
]);
// Soft agents may never request these data scopes — keeps Paige from
// auto-spinning an agent that touches raw PII/financial tables.
const PROTECTED_SCOPES = new Set([
  "credit_report_personal_info", "credit_accounts", "credit_negative_items",
  "banking_relationships", "connected_bank_accounts",
  "plaid_transactions", "credit_inquiries", "tier_state",
  "user_roles", "_internal_secrets", "connected_bank_account_secrets",
]);

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

export interface Caller {
  userId: string | null;
  /** TENANT-LEVEL `admin` app_role. `user_roles` is GLOBAL and carries no tenant, so this
   *  alone is authority over NOTHING outside the caller's own workspace (§59). */
  isAdmin: boolean;
  /** §53 platform-operator tier — super_admin OR platform_admin. The ONLY authority that
   *  crosses a tenant boundary. */
  isOperator: boolean;
  /** The caller's active workspace, derived SERVER-SIDE. Never read from the body. */
  tenantId: string | null;
}

const ANON_CALLER: Caller = { userId: null, isAdmin: false, isOperator: false, tenantId: null };

async function getCaller(req: Request): Promise<Caller> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return { ...ANON_CALLER };
  const { data } = await supabase.auth.getUser(auth.slice(7));
  const userId = data.user?.id ?? null;
  if (!userId) return { ...ANON_CALLER };

  const { data: roles } = await supabase
    .from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");

  // `is_platform_operator()` and `current_user_tenant_id()` are SECURITY DEFINER over
  // `auth.uid()`, which is NULL on the service-role client — calling them with `supabase`
  // would silently answer "not an operator, no tenant" for everyone. They must be asked
  // through the CALLER's own JWT, which is also what makes the answer unspoofable.
  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  });

  let isOperator = false;
  let tenantId: string | null = null;
  try {
    const [{ data: op }, { data: tid }] = await Promise.all([
      authed.rpc("is_platform_operator"),
      authed.rpc("current_user_tenant_id"),
    ]);
    isOperator = op === true;
    tenantId = typeof tid === "string" && UUID_RE.test(tid) ? tid : null;
  } catch (e) {
    // Fail CLOSED: an unresolved caller is the least-privileged caller, never a wider one.
    console.error("[subagent-forge] caller authority resolution failed:", (e as Error).message);
    isOperator = false;
    tenantId = null;
  }

  return { userId, isAdmin, isOperator, tenantId };
}

/** Thin adapter: the rule itself lives in `_shared/subagent-authority.ts` (§18 one home,
 *  and it is unit-tested there against the full §51 tier matrix). This turns its decision
 *  into the HTTP refusal this function speaks. */
function denyIfNotAuthorized(
  caller: Caller,
  rowTenantId: string | null,
  noun: string,
): Response | null {
  const d = decideSubagentAuthority(caller, rowTenantId, noun);
  return d.allowed ? null : fail(d.reason, d.status);
}


// Quota is PER-TENANT (D-5): one tenant can't exhaust the factory for everyone.
// tenant_id NULL = the platform/operator lane.
async function quotaToday(tenantId: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  let q = supabase.from("paige_subagent_factory_quota").select("*").eq("quota_date", today);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data } = await q.maybeSingle();
  return data ?? { quota_date: today, tenant_id: tenantId, proposals_count: 0, soft_shipped: 0, hard_shipped: 0 };
}

async function bumpQuota(tenantId: string | null, field: "proposals_count" | "soft_shipped" | "hard_shipped") {
  // Atomic server-side increment — no read-then-write race.
  await supabase.rpc("bump_subagent_quota", { _tenant_id: tenantId, _field: field });
}

// Doctrine §116 enforcement: scan proposed system_prompt for hardcoded
// real-person names ("First Last") and business-suffix patterns.
const SAFE_NAME_ALLOWLIST = new Set([
  "Mogul Maker", "Maker Academy", "Mogul Academy",
  "Paige Agent", "Lovable Cloud", "Lovable AI",
  "First Last", "John Doe", "Jane Doe",
  "United States", "New York", "Los Angeles",
]);
const BUSINESS_SUFFIX_RE = /\b[A-Z][A-Za-z0-9&'-]+(?:\s+[A-Z][A-Za-z0-9&'-]+)*\s+(LLC|Inc|Corp|Corporation|Capital|Group|Holdings|Partners|Ventures|Bank|Financial)\b/;
const FIRST_LAST_RE = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;

function scanDoctrine116(prompt: string): string | null {
  const biz = prompt.match(BUSINESS_SUFFIX_RE);
  if (biz) return `business-name pattern: "${biz[0]}"`;
  const matches = prompt.match(FIRST_LAST_RE) ?? [];
  for (const m of matches) {
    if (!SAFE_NAME_ALLOWLIST.has(m)) return `first+last name pattern: "${m}"`;
  }
  return null;
}

function validateProposal(p: Record<string, unknown>) {
  const errors: string[] = [];
  const slug = String(p.slug ?? "").toLowerCase();
  if (!SLUG_RE.test(slug)) errors.push("slug must match ^[a-z][a-z0-9-]{2,40}$");
  if (!p.name || String(p.name).length < 3) errors.push("name required (min 3 chars)");
  if (!p.domain || !VALID_DOMAINS.has(String(p.domain))) {
    errors.push(`domain must be one of: ${[...VALID_DOMAINS].join(", ")}`);
  }
  if (!p.description || String(p.description).length < 20) errors.push("description required (min 20 chars)");
  if (!p.rationale || String(p.rationale).length < 20) errors.push("rationale required (explain why this agent is needed)");
  if (!p.system_prompt || String(p.system_prompt).length < 50) errors.push("system_prompt required (min 50 chars)");
  const runtime = String(p.runtime ?? "soft");
  if (!["soft", "local", "langgraph"].includes(runtime)) errors.push("runtime must be soft|local|langgraph");

  const scopes = (p.data_scopes ?? []) as string[];
  if (runtime === "soft") {
    for (const s of scopes) {
      if (PROTECTED_SCOPES.has(s)) errors.push(`soft agents may not access protected scope: ${s}`);
    }
  }

  if (p.system_prompt) {
    // Strip the agent's OWN name from the prompt before the §116 person-name scan —
    // an agent's descriptive name ("Session Prep Writer") is not a hardcoded client
    // name, and the scanner's "two capitalized words" heuristic would false-positive
    // on it and block every legitimate forge. (§116 scan is defense-in-depth; the real
    // §2 gate is financeGate, and archetype phrasing is instructed in the tool schema.)
    const ownName = String(p.name ?? "").trim();
    let promptForScan = String(p.system_prompt);
    if (ownName) {
      promptForScan = promptForScan.split(ownName).join(" ");
      for (const tok of ownName.split(/\s+/)) {
        if (tok.length > 2) promptForScan = promptForScan.replace(new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
      }
    }
    const hit = scanDoctrine116(promptForScan);
    if (hit) {
      errors.push(
        `Doctrine §116: sub-agent prompts must use archetype phrasing only. ` +
        `Replace named individuals with 'a client', 'the contact', 'their business'. Matched ${hit}.`,
      );
    }
  }

  // §34-L5: normalize + validate config.job_kind — the routing key invokeSoft reads to pick the
  // agent's cost/quality tier via the model-router. ABSENT → default it to internal_first_draft
  // (an internal draft Paige integrates). PRESENT-but-invalid → REJECT (422): a silent typo would
  // mis-route the agent (e.g. downgrade a client-facing final to a cheap open model), so we reject
  // rather than swallow it. isJobKind/DEFAULT_SUBAGENT_JOB_KIND come from the model-router — the ONE
  // source of truth, so author-time validation can never skew from invoke-time routing (§18).
  // A PRESENT config must be a plain object — a string/array/number is malformed and would be
  // silently dropped, so REJECT it (422) rather than swallow it (§13). Absent config → fresh {}.
  const configPresent = p.config !== undefined && p.config !== null;
  const configIsObject = configPresent && typeof p.config === "object" && !Array.isArray(p.config);
  if (configPresent && !configIsObject) {
    errors.push(`config must be an object, got ${Array.isArray(p.config) ? "array" : typeof p.config}`);
  }
  const cfg = configIsObject ? (p.config as Record<string, unknown>) : {};
  if (cfg.job_kind === undefined || cfg.job_kind === null) {
    cfg.job_kind = DEFAULT_SUBAGENT_JOB_KIND;
  } else if (!isJobKind(cfg.job_kind)) {
    errors.push(`config.job_kind "${String(cfg.job_kind)}" is not a known job_kind`);
  }
  // Persist the normalized config back onto the body so the default rides through to the row
  // (actionPropose inserts body.config). On a validation error the caller returns before insert.
  (p as Record<string, unknown>).config = cfg;

  return { slug, runtime, errors };
}

// §2 finance gate: funding/credit specialists are NEVER a platform default and
// never forged for a tenant that hasn't turned that offer on. A tenant WITH the
// funding skill enabled may forge one, and it is tenant-scoped (never a NULL default).
// Classification (domain OR keyword) lives in _shared/finance-gate.ts — the ONE home
// paige-orchestrator's read-time gate shares, so author-time and read-time never skew (§18).
function financeGate(
  body: Record<string, unknown>,
  opts: { fundingEnabled: boolean; tenantId: string | null },
): string | null {
  if (!looksLikeFinanceAgent(body)) return null;
  // Platform default (no tenant) finance agents are prohibited outright (§2/§9).
  if (!opts.tenantId) {
    return "Funding/credit specialists can't live in the platform default team (§2). They ship only as a tenant's own opt-in offer.";
  }
  if (!opts.fundingEnabled) {
    return "This looks like a funding/credit specialist, but this workspace hasn't enabled the funding offer. Tell the operator they can turn it on as a Playbook preset, then it can be created — don't force it here.";
  }
  return null;
}

async function actionPropose(
  body: Record<string, unknown>,
  caller: Caller,
  ctx: { tenantId: string | null; fundingEnabled: boolean; agentOrigin: boolean },
) {
  const { slug, runtime, errors } = validateProposal(body);
  if (errors.length) return fail("Validation failed", 422, errors);

  // A null tenant mints a PLATFORM DEFAULT — an agent every workspace receives, and one
  // a soft proposal may auto-ship. Creating one is "altering platform-default agents",
  // so it answers to the operator tier, exactly like disabling one. `ctx.tenantId` is
  // resolved server-side in the dispatcher; this is the second lock on the same door.
  if (ctx.tenantId === null && !caller.isOperator) {
    return fail(
      "Only the platform operator can create a platform-default agent. Propose it inside your own workspace instead.",
      403,
    );
  }

  // §2 finance gate — before anything is written.
  const financeErr = financeGate(body, { fundingEnabled: ctx.fundingEnabled, tenantId: ctx.tenantId });
  if (financeErr) return fail(financeErr, 422);

  // Slug must not collide with an existing agent (global unique — TOCTOU-safe via the DB constraint too).
  const { data: existing } = await supabase
    .from("paige_subagents").select("slug").eq("slug", slug).maybeSingle();
  if (existing) return fail(`slug already in use: ${slug}`, 409);

  // Per-tenant spin-rate cap. Agent-origin calls are NEVER admin (D-1), so the cap always applies to Paige.
  const quota = await quotaToday(ctx.tenantId);
  if (quota.proposals_count >= DAILY_PROPOSAL_CAP && !caller.isAdmin) {
    return fail(`daily proposal cap reached (${DAILY_PROPOSAL_CAP}). Try again tomorrow or have an admin override.`, 429);
  }

  const { data: proposal, error } = await supabase
    .from("paige_subagent_proposals")
    .insert({
      proposed_slug: slug,
      proposed_name: body.name,
      domain: body.domain,
      description: body.description,
      rationale: body.rationale,
      runtime,
      system_prompt: body.system_prompt,
      input_schema: body.input_schema ?? {},
      output_schema: body.output_schema ?? {},
      triggers: body.triggers ?? [],
      data_scopes: body.data_scopes ?? [],
      config: body.config ?? {},
      status: "proposed",
      proposed_by: caller.userId,
      proposed_by_agent: body.proposed_by_agent ?? "paige-orchestrator",
      tenant_id: ctx.tenantId, // §9 stamp — tenant-forged agents are tenant-scoped
    })
    .select("*").single();
  if (error) return fail(error.message, 500);
  await bumpQuota(ctx.tenantId, "proposals_count");

  // Soft proposals: auto-ship. Hard proposals: route to Approvals Hub.
  if (runtime === "soft") {
    return await shipProposal(proposal.id, caller.userId, ctx.tenantId);
  }
  return await routeForApproval(proposal.id, caller.userId);
}

async function shipProposal(proposalId: string, actorId: string | null, tenantIdHint?: string | null) {
  const { data: p, error: fetchErr } = await supabase
    .from("paige_subagent_proposals").select("*").eq("id", proposalId).single();
  if (fetchErr || !p) return fail("Proposal not found", 404);
  if (p.status === "live") return ok({ ok: true, message: "Already live", proposal: p });

  // The live agent inherits the proposal's tenant scope (§9) — never widens to a default.
  const tenantId = tenantIdHint !== undefined ? tenantIdHint : (p.tenant_id ?? null);

  // Insert into registry
  const { data: agent, error: insErr } = await supabase
    .from("paige_subagents")
    .insert({
      slug: p.proposed_slug,
      name: p.proposed_name,
      domain: p.domain,
      description: p.description,
      runtime: p.runtime,
      system_prompt: p.system_prompt,
      input_schema: p.input_schema,
      output_schema: p.output_schema,
      triggers: p.triggers,
      config: p.config,
      enabled: true,
      auto_generated: true,
      created_by: actorId,
      display_order: 999,
      tenant_id: tenantId,
    })
    .select("id,slug").single();
  if (insErr) {
    await supabase.from("paige_subagent_proposals")
      .update({ status: "failed", error: insErr.message, reviewed_at: new Date().toISOString() })
      .eq("id", proposalId);
    return fail(insErr.message, 500);
  }

  await supabase.from("paige_subagent_proposals").update({
    status: "live",
    resulting_subagent_id: agent.id,
    reviewed_by: actorId,
    reviewed_at: new Date().toISOString(),
  }).eq("id", proposalId);
  await bumpQuota(tenantId, p.runtime === "soft" ? "soft_shipped" : "hard_shipped");

  return ok({ ok: true, message: "Sub-agent is live", slug: agent.slug, id: agent.id, runtime: p.runtime });
}

async function routeForApproval(proposalId: string, actorId: string | null) {
  const { data: p } = await supabase
    .from("paige_subagent_proposals").select("*").eq("id", proposalId).single();
  if (!p) return fail("Proposal not found", 404);

  const { data: approval, error } = await supabase
    .from("paige_pending_approvals")
    .insert({
      type: "other", // constrained set; the real semantic lives in category
      category: "subagent_creation",
      status: "pending",
      summary: `New specialist: ${p.proposed_name} — ${p.description}`,
      draft_content: {
        proposal_id: proposalId, slug: p.proposed_slug, name: p.proposed_name,
        runtime: p.runtime, domain: p.domain, rationale: p.rationale, description: p.description,
      },
      metadata: { proposal_id: proposalId, source: "subagent-forge", kind: "subagent_creation" },
      visible_to_roles: ["admin"],
      requires_role: "admin",
      risk_level: p.runtime === "langgraph" ? "high" : "medium",
      source: "subagent-forge",
      submitted_by_user_id: actorId,
      tenant_id: p.tenant_id ?? null,
    })
    .select("id").single();
  if (error) return fail(`Approval routing failed: ${error.message}`, 500);

  await supabase.from("paige_subagent_proposals")
    .update({ approval_id: approval.id, status: "proposed" })
    .eq("id", proposalId);

  return ok({
    ok: true,
    message: "Hard proposal routed to the Approvals Hub for admin sign-off.",
    proposal_id: proposalId,
    approval_id: approval.id,
    status: "pending_approval",
  });
}

async function actionApprove(body: Record<string, unknown>, caller: Caller) {
  const id = String(body.proposal_id ?? "");
  if (!id) return fail("proposal_id required", 400);
  const { data: p } = await supabase
    .from("paige_subagent_proposals").select("*").eq("id", id).maybeSingle();
  if (!p) return fail("Not found", 404);

  // Approving SHIPS an agent, so it answers to the same authority rule as disabling one:
  // a platform-default proposal is the operator's, a tenant proposal is that tenant's.
  const denied = denyIfNotAuthorized(caller, p.tenant_id ?? null, "proposal");
  if (denied) return denied;

  if (p.status === "live") return ok({ ok: true, message: "Already live" });
  return await shipProposal(id, caller.userId);
}

async function actionReject(body: Record<string, unknown>, caller: Caller) {
  const id = String(body.proposal_id ?? "");
  if (!id) return fail("proposal_id required", 400);

  const { data: p, error: readErr } = await supabase
    .from("paige_subagent_proposals").select("id, tenant_id").eq("id", id).maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!p) return fail("Not found", 404);

  const denied = denyIfNotAuthorized(caller, p.tenant_id ?? null, "proposal");
  if (denied) return denied;

  let q = supabase
    .from("paige_subagent_proposals")
    .update({
      status: "rejected",
      reviewed_by: caller.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: String(body.notes ?? ""),
    }).eq("id", id);
  if (!caller.isOperator) q = q.eq("tenant_id", caller.tenantId);

  const { error } = await q;
  if (error) return fail(error.message, 500);
  return ok({ ok: true });
}

async function actionList(
  body: Record<string, unknown>,
  caller: Caller,
  ctx: { tenantId: string | null },
) {
  const status = body.status ? String(body.status) : null;
  let q = supabase.from("paige_subagent_proposals")
    .select("*").order("created_at", { ascending: false }).limit(50);
  if (status) q = q.eq("status", status);

  // This runs on the service-role client, which BYPASSES RLS — so the tenant filter has to
  // be here, or one workspace reads every other workspace's proposals (§9). The operator
  // sees the fleet; every other caller sees exactly the workspace the dispatcher resolved
  // for them (their own, or the one an agent-origin caller had stamped upstream).
  if (!caller.isOperator) {
    if (!ctx.tenantId) {
      return ok({ ok: true, proposals: [], quota: await quotaToday(null), cap: DAILY_PROPOSAL_CAP, scope: "none" });
    }
    q = q.eq("tenant_id", ctx.tenantId);
  }

  const { data, error } = await q;
  if (error) return fail(error.message, 500);
  const quota = await quotaToday(ctx.tenantId);
  return ok({
    ok: true,
    proposals: data ?? [],
    quota,
    cap: DAILY_PROPOSAL_CAP,
    scope: caller.isOperator ? "fleet" : "workspace",
  });
}

async function actionDisable(body: Record<string, unknown>, caller: Caller) {
  const slug = String(body.slug ?? "");
  if (!slug) return fail("slug required", 400);

  // Read the target FIRST: `slug` is globally unique, so the row decides the authority
  // question. Without this the update reached every workspace's agents by name alone.
  const { data: target, error: readErr } = await supabase
    .from("paige_subagents").select("slug, tenant_id").eq("slug", slug).maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!target) return fail("Not found", 404);

  const denied = denyIfNotAuthorized(caller, target.tenant_id ?? null, "agent");
  if (denied) return denied;

  let q = supabase.from("paige_subagents")
    .update({ enabled: false, auto_disabled_reason: String(body.reason ?? "manual disable") })
    .eq("slug", slug);
  // The write repeats the scope the check just granted, so a row that changes owner
  // between the read and the write cannot widen the blast radius (TOCTOU).
  if (!caller.isOperator) q = q.eq("tenant_id", caller.tenantId);

  const { error } = await q;
  if (error) return fail(error.message, 500);
  return ok({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // INT-313 — X-Orchestrator-Call is a SIGNAL any client can set, never authority. Agent-origin
  // semantics (a body tenant_id + actor_user_id honoured below) belong only to the canonical internal
  // caller (exact service-role bearer / verified cron token: the orchestrator, paige-ai-chat, paige-mcp).
  // A caller that claims agent origin without being one is refused before anything is read or written.
  const claimsAgentOrigin = req.headers.get("X-Orchestrator-Call") === "1";
  if (claimsAgentOrigin && !(await isAuthorizedInternalCaller(req, adminClient()))) {
    return fail("Agent-origin calls must come from a trusted internal caller.", 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return fail("Invalid JSON", 400); }

  const caller = await getCaller(req);
  const action = String(body.action ?? "propose");

  // D-1 — AGENT-ORIGIN INVARIANT. When Paige (or any agent) calls via the
  // orchestrator/chat with the service-role key, the request carries
  // X-Orchestrator-Call:1. Such a call is NEVER admin (so the per-tenant cap
  // always applies) and can NEVER approve/reject a proposal — approval stays a
  // human-only surface. actor_user_id is trusted only for attribution. This holds
  // structurally regardless of which token was used, so a future refactor can't
  // reintroduce "Paige is the admin".
  const agentOrigin = req.headers.get("X-Orchestrator-Call") === "1";
  if (agentOrigin) {
    caller.isAdmin = false;
    // An agent never holds OPERATOR authority either. In practice getCaller already
    // resolves both to false on the service-role token, but D-1 is a structural
    // invariant and is asserted here so no future auth refactor can hand Paige the
    // one tier that crosses a tenant boundary.
    caller.isOperator = false;
    if (typeof body.actor_user_id === "string") caller.userId = body.actor_user_id;
    if (action === "approve" || action === "reject") {
      return fail("Agent-originated calls cannot approve or reject proposals — that's a human-only action.", 403);
    }
  }
  // Tenant + funding context. The body's tenant_id is HONOURED ONLY where it is already
  // trustworthy: an agent-origin call had it stamped by paige-ai-chat from a server-resolved
  // persona, and the platform operator may legitimately target any workspace (or null, for a
  // platform default). Every other caller is pinned to their OWN active workspace, so passing
  // someone else's tenant_id — or omitting it to mint a fleet-wide default — does nothing.
  const bodyTenant = typeof body.tenant_id === "string" && UUID_RE.test(body.tenant_id)
    ? body.tenant_id
    : null;
  const ctx = {
    tenantId: (agentOrigin || caller.isOperator) ? bodyTenant : caller.tenantId,
    fundingEnabled: body.funding_enabled === true,
    agentOrigin,
  };

  try {
    switch (action) {
      case "propose":  return await actionPropose(body, caller, ctx);
      case "approve":  return await actionApprove(body, caller);
      case "reject":   return await actionReject(body, caller);
      case "list":     return await actionList(body, caller, ctx);
      case "disable":  return await actionDisable(body, caller);
      default: return fail(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    console.error("[subagent-forge]", e);
    return fail((e as Error).message ?? "Internal error", 500);
  }
});
