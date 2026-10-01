// deno-lint-ignore-file no-explicit-any
// SmartCredit: pull owner 3-bureau snapshot — FUNDING ELIGIBILITY LENS ONLY.
// PAIGE_SCOPE_GUARD: no dispute / repair / FCRA workflows here.
//
// GOVERNED AUTHORITY (mirrors nav-pull-profile via the shared _shared/contact-authz door). This was
// `requireAdmin`-gated (GLOBAL user_roles admin — tenant-AGNOSTIC, §53/§59 trap), then trusted the body
// `contact_id`, read `clients` via a SERVICE-ROLE client with NO tenant filter, contacted the PAID
// SmartCredit API, and wrote `paige_owner_credit_snapshots` (a consumer 3-bureau credit snapshot — highly
// sensitive PII). So any global admin of any tenant could pull + persist ANY tenant's contact's consumer
// credit (§9 cross-tenant IDOR) and burn provider budget. FIX: authenticate the caller — verified user
// JWT → `person` (actor = auth.uid()); else bearer == service-role key → trusted `system`; else 401.
// Authorize a person via `can_access_contact(auth.uid(), contact_id)` — the canonical tenant-scoped helper
// the target table's own RLS uses. Actor from the JWT, never the body. Authorize BEFORE any provider
// contact or write (a denied caller burns ZERO budget). Governed audit receipt on every decision.
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertNoDisputeFields } from "../_shared/scopeGuard.ts";
import {
  authorizeContactScopedAction,
  buildContactScopedAudit,
  contactScopedGovernedAuditRow,
  type ContactScopedAuthzDeps,
  type ContactScopedGovernedAudit,
  type ContactScopedPrincipal,
} from "../_shared/contact-authz/governed-adapter.ts";
import {
  resolveFundingCoachingGate,
  fundingGateAuditRow,
  recordFundingGateDecision,
} from "../_shared/funding-coaching-gate.ts";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses } from "../_shared/contact-methods.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CAPABILITY = "smartcredit_pull_snapshot";
const ACTION_TYPE = "smartcredit_snapshot";
const ACTION_PREFIX = "smartcredit_pull";

/** Write ONE governed-decision row to `paige_audit_log` (service-role). For a REFUSED pull this is the
 *  ONLY trace. Non-fatal; supabase-js resolves a DB rejection as `{ error }` rather than throwing, so
 *  inspect and log it loudly (mirrors business-verifier / nav-pull). */
async function writeGovernedAudit(admin: any, actorUserId: string | null, audit: ContactScopedGovernedAudit): Promise<void> {
  try {
    const row = contactScopedGovernedAuditRow(audit);
    const { error } = await admin.from("paige_audit_log").insert({
      actor_user_id: actorUserId,
      actor_role: `${ACTION_PREFIX}:${audit.principal}`,
      ...row,
    });
    if (error) console.error("smartcredit-pull-snapshot governed audit not recorded", error.message ?? String(error));
  } catch (e) {
    console.error("smartcredit-pull-snapshot governed audit not recorded (threw)", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── AUTHENTICATE — person (verified user JWT) or system (trusted service-role caller) ─────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "unauthorized", message: "Authorization is required." }, 401);
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await authClient.auth.getUser();

  let principal: ContactScopedPrincipal;
  let callerUserId: string | null;
  if (user) {
    principal = "person";
    callerUserId = user.id;
  } else if (bearer && bearer === SERVICE_KEY) {
    principal = "system";
    callerUserId = null;
  } else {
    return jsonResponse({ error: "unauthorized", message: "Invalid or unauthorized token." }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const { contact_id } = body ?? {};
  if (!contact_id) return jsonResponse({ error: "contact_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAtMs = Date.now();

  // ── AUTHORIZE — BEFORE any scope processing, provider contact or write (a denied caller burns nothing)
  const authzDeps: ContactScopedAuthzDeps = {
    callerCanAccessContact: async () => {
      if (!callerUserId) return false;
      const { data, error } = await admin.rpc("can_access_contact", { _user_id: callerUserId, _contact_id: contact_id });
      if (error) {
        console.error("smartcredit-pull-snapshot can_access_contact check failed", error.message ?? String(error));
        return false;
      }
      return data === true;
    },
  };

  const authz = await authorizeContactScopedAction(authzDeps, { principal, callerUserId });
  if (!authz.allowed) {
    await writeGovernedAudit(
      admin,
      callerUserId,
      buildContactScopedAudit({
        capability: CAPABILITY, actionType: ACTION_TYPE, actionPrefix: ACTION_PREFIX,
        principal, userId: callerUserId, contactId: contact_id, tenantId: null,
        authzBasis: authz.basis, allowed: false, startedAtMs, nowIso: new Date().toISOString(),
      }),
    );
    return jsonResponse({ error: "not_authorized", message: authz.reason }, 403);
  }

  // PAIGE_SCOPE_GUARD (FCRA): no dispute/repair fields — an authorized caller can still send a
  // scope-violating body; record it and refuse. (Runs after authz so a denied caller is 403'd first.)
  const violation = assertNoDisputeFields(body);
  if (violation) {
    await admin.from("audit_logs").insert({
      user_id: callerUserId,
      entity: "smartcredit-pull-snapshot",
      action: "scope_violation",
      data: { field: violation },
    });
    return jsonResponse({ error: "scope_violation", field: violation }, 400);
  }

  // Resolve the CONTACT's workspace (server-side, never the body) — both the Funding & Coaching Tools
  // gate scope and the provider call need it. The caller is already authorized for this contact above.
  // The provider is asked about the contact's PRIMARY email.
  const { data: contactRow } = await admin
    .from("clients")
    .select(`id, first_name, last_name, tenant_id, ${CLIENT_CONTACT_METHODS_EMBED}`)
    .eq("id", contact_id)
    .maybeSingle();
  const contact = withPrimaryAddresses(contactRow);
  if (!contact) return jsonResponse({ error: "contact not found" }, 404);
  const contactTenantId = (contact.tenant_id ?? null) as string | null;

  // ── FUNDING & COACHING TOOLS GATE (owner ruling 2026-09-13) — FAIL CLOSED before any provider contact ──
  // SmartCredit is one of ten finance/credit providers in the optional Funding & Coaching Tools package
  // (§2: finance is never a platform default). It runs ONLY when the CONTACT's workspace holds the package
  // AND has the required Financial connection/consent. Absent either → setup_required / unavailable, NO
  // SmartCredit contact, NO snapshot write. Today the package is unseeded, so this refuses for every tenant.
  const fundingGate = await resolveFundingCoachingGate(admin, { tenantId: contactTenantId, providerKey: "smartcredit" });
  if (!fundingGate.allowed) {
    await recordFundingGateDecision(admin, {
      actorUserId: callerUserId,
      actorRole: `${ACTION_PREFIX}:${principal}`,
      row: fundingGateAuditRow({
        actionPrefix: ACTION_PREFIX, capability: CAPABILITY, targetType: ACTION_TYPE, providerKey: "smartcredit",
        tenantId: contactTenantId, subjectKind: "contact", subjectId: contact_id,
        verdict: fundingGate, startedAtMs, nowIso: new Date().toISOString(),
      }),
    });
    // `activated:false` + `message` match SmartCredit's existing "not available" idiom so any consumer
    // keying on that shape stays honest (§37), alongside the canonical `available/result/state/reason`.
    return jsonResponse({ available: false, activated: false, result: fundingGate.result, state: fundingGate.state, reason: fundingGate.reason, message: fundingGate.reason }, 200);
  }

  // Config / provider readiness — platform-global, not tenant data; an unconfigured provider is an
  // honest no-op (no pull, so no execute audit), exactly as before.
  const { data: cfg } = await admin.from("paige_config").select("smartcredit_enabled").eq("id", 1).maybeSingle();
  if (!cfg?.smartcredit_enabled) return jsonResponse({ activated: false, message: "SmartCredit not yet enabled" }, 200);

  const apiKey = Deno.env.get("SMARTCREDIT_API_KEY");
  if (!apiKey) return jsonResponse({ activated: false, message: "SMARTCREDIT_API_KEY missing" }, 200);

  // The governed execute receipt, scoped to the CONTACT's own tenant (server-resolved, never the body).
  await writeGovernedAudit(
    admin,
    callerUserId,
    buildContactScopedAudit({
      capability: CAPABILITY, actionType: ACTION_TYPE, actionPrefix: ACTION_PREFIX,
      principal, userId: callerUserId, contactId: contact_id, tenantId: (contact.tenant_id ?? null) as string | null,
      authzBasis: authz.basis, allowed: true, startedAtMs, nowIso: new Date().toISOString(),
    }),
  );

  let snapshot: Record<string, unknown> = {};
  try {
    const res = await fetch("https://api.smartcredit.com/v1/snapshot", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: contact.email }),
    });
    if (!res.ok) {
      const text = await res.text();
      return jsonResponse({ error: "smartcredit_api_error", status: res.status, body: text }, 502);
    }
    snapshot = await res.json();
  } catch (e) {
    return jsonResponse({ error: "smartcredit_fetch_failed", detail: String((e as Error).message) }, 502);
  }

  const bureaus = (snapshot.bureaus as Array<{ bureau: string; score: number; factors?: unknown[] }>) ?? [];
  const inserts = bureaus
    .filter((b) => ["experian", "equifax", "transunion"].includes(b.bureau?.toLowerCase()))
    .map((b) => ({
      contact_id,
      bureau: b.bureau.toLowerCase(),
      score: b.score,
      factors: b.factors ?? [],
    }));

  if (inserts.length === 0) return jsonResponse({ ok: true, snapshots: 0 });

  const { data, error } = await admin
    .from("paige_owner_credit_snapshots")
    .insert(inserts)
    .select("id, bureau, score");
  if (error) return jsonResponse({ error: error.message }, 500);

  // Funding-eligibility lens: highest mid-bureau score → strong/moderate/limited
  const top = Math.max(...(data ?? []).map((d) => d.score ?? 0));
  const eligibility = top >= 700 ? "strong" : top >= 640 ? "moderate" : "limited";

  return jsonResponse({ ok: true, snapshots: data, funding_eligibility: eligibility });
});
