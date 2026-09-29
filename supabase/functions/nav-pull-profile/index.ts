// deno-lint-ignore-file no-explicit-any
// Nav.com: pull a business credit profile for a contact.
// SCOPE: business credit only. PAIGE_SCOPE_GUARD applies.
//
// GOVERNED AUTHORITY (mirrors business-verifier): this endpoint was `requireAdmin`-gated — a GLOBAL
// `user_roles` admin role, tenant-AGNOSTIC (§53/§59 trap) — then trusted the BODY `contact_id`, read
// `clients` via a SERVICE-ROLE client with NO tenant filter, contacted the PAID Nav.com API, and wrote
// `paige_business_credit_profiles`. So any global admin could pull ANY tenant's contact's business
// credit (§9 cross-tenant IDOR) and burn provider budget. The fix: authenticate the caller (verified
// user JWT → `person`, actor = auth.uid(); else the bearer == service-role key → trusted `system` — the
// `nav-refresh-scores` cron; else 401), authorize a person against the CONTACT's OWN tenant via
// `can_access_contact(auth.uid(), contact_id)` (the canonical tenant-scoped helper the target table's RLS
// itself uses — super_admin / tenant owner-admin / agency parent / direct-or-coach relationship), derive
// the actor from the JWT never the body, authorize BEFORE any provider contact or write (a denied caller
// burns ZERO budget), and write a governed audit receipt for every decision. The `high` risk class is
// recorded honestly; the §67 autonomy clamp is deferred UPSTREAM (see the adapter header).
import { corsHeaders, jsonResponse } from "../_shared/adminAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fireAndForgetBridge } from "../_shared/mmaOsBridge.ts";
import {
  authorizeNavPull,
  buildNavPullAudit,
  navPullGovernedAuditRow,
  type NavPullAuthzDeps,
  type NavPullGovernedAudit,
  type NavPullPrincipal,
} from "../_shared/nav-pull-profile/governed-adapter.ts";
import {
  resolveFundingCoachingGate,
  fundingGateAuditRow,
  recordFundingGateDecision,
} from "../_shared/funding-coaching-gate.ts";

const NAV_API = "https://api.nav.com/v1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

/**
 * Write ONE governed-decision row to `paige_audit_log` (service-role). For a REFUSED pull this is the
 * ONLY trace, since a refusal contacts no provider and writes no profile. Non-fatal: a logging failure
 * never changes the decision. supabase-js resolves a DB rejection as `{ error }` rather than throwing,
 * so inspect and log the returned error loudly (mirrors business-verifier's writeGovernedVerifyAudit).
 */
async function writeGovernedNavAudit(
  admin: any,
  actorUserId: string | null,
  audit: NavPullGovernedAudit,
): Promise<void> {
  try {
    const row = navPullGovernedAuditRow(audit);
    const { error } = await admin.from("paige_audit_log").insert({
      actor_user_id: actorUserId,
      actor_role: `nav_pull:${audit.principal}`,
      ...row,
    });
    if (error) {
      console.error("nav-pull-profile governed audit not recorded", error.message ?? String(error));
    }
  } catch (e) {
    console.error("nav-pull-profile governed audit not recorded (threw)", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── AUTHENTICATE — person (verified user JWT) or system (trusted service-role caller) ─────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "unauthorized", message: "Authorization is required." }, 401);
  }
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await authClient.auth.getUser();

  let principal: NavPullPrincipal;
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

  const { contact_id } = await req.json().catch(() => ({}));
  if (!contact_id) return jsonResponse({ error: "contact_id required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAtMs = Date.now();

  // ── AUTHORIZE — BEFORE any contact read, provider contact or write (a denied caller burns no budget)
  // The person path resolves the canonical tenant-scoped contact helper, keyed on the VERIFIED uid
  // (explicit `_user_id`), never a body field. A cross-tenant caller — or a non-existent contact, which
  // resolves no access row — is refused uniformly (no existence oracle). System (the cron) is allowed.
  const authzDeps: NavPullAuthzDeps = {
    callerCanAccessContact: async () => {
      if (!callerUserId) return false;
      const { data, error } = await admin.rpc("can_access_contact", {
        _user_id: callerUserId,
        _contact_id: contact_id,
      });
      if (error) {
        console.error("nav-pull-profile can_access_contact check failed", error.message ?? String(error));
        return false;
      }
      return data === true;
    },
  };

  const authz = await authorizeNavPull(authzDeps, { principal, callerUserId });

  if (!authz.allowed) {
    // The ONLY trace of a refused pull. Tenant is not resolved for a denied caller (no contact read).
    await writeGovernedNavAudit(
      admin,
      callerUserId,
      buildNavPullAudit({
        principal,
        userId: callerUserId,
        contactId: contact_id,
        tenantId: null,
        authzBasis: authz.basis,
        allowed: false,
        startedAtMs,
        nowIso: new Date().toISOString(),
      }),
    );
    return jsonResponse({ error: "not_authorized", message: authz.reason }, 403);
  }

  // Authorized. Resolve the CONTACT's workspace (server-side, never the body) — both the Funding &
  // Coaching Tools gate scope and the provider call need it.
  const { data: contact } = await admin
    .from("clients")
    .select("id, business_name, ein, tenant_id")
    .eq("id", contact_id)
    .maybeSingle();
  if (!contact) return jsonResponse({ error: "contact not found" }, 404);
  const contactTenantId = (contact.tenant_id ?? null) as string | null;

  // ── FUNDING & COACHING TOOLS GATE (owner ruling 2026-09-13) — FAIL CLOSED before any provider contact ──
  // Nav business-credit is one of ten finance/credit providers in the optional Funding & Coaching Tools
  // package (§2: finance is never a platform default). It runs ONLY when the CONTACT's workspace holds the
  // package AND has the required Financial connection/consent. Absent either → setup_required / unavailable,
  // NO Nav contact, NO profile write. Today the package is unseeded, so this refuses for every tenant —
  // including the nav-refresh-scores cron (a `system` caller), which correctly no-ops per contact.
  const fundingGate = await resolveFundingCoachingGate(admin, { tenantId: contactTenantId, providerKey: "nav" });
  if (!fundingGate.allowed) {
    await recordFundingGateDecision(admin, {
      actorUserId: callerUserId,
      actorRole: `nav_pull:${principal}`,
      row: fundingGateAuditRow({
        actionPrefix: "nav_pull", capability: "nav_pull_business_credit", targetType: "business_credit_profile",
        providerKey: "nav", tenantId: contactTenantId, subjectKind: "contact", subjectId: contact_id,
        verdict: fundingGate, startedAtMs, nowIso: new Date().toISOString(),
      }),
    });
    // `activated:false` + `message` keep the existing BusinessCreditAdmin consumer honest (§37): it keys
    // on `activated === false` to warn, so without these it would falsely toast "Profile refreshed".
    return jsonResponse({ available: false, activated: false, result: fundingGate.result, state: fundingGate.state, reason: fundingGate.reason, message: fundingGate.reason }, 200);
  }

  // Nav configuration is platform-global, not tenant data — an unconfigured provider is an honest no-op
  // (no pull, so no execute audit), exactly as before.
  const apiKey = Deno.env.get("NAV_API_KEY");
  const partnerId = Deno.env.get("NAV_PARTNER_ID");
  if (!apiKey || !partnerId) {
    return jsonResponse({ activated: false, message: "Nav not yet configured" }, 200);
  }

  // The governed execute receipt, scoped to the CONTACT's own tenant (server-resolved, never the body).
  await writeGovernedNavAudit(
    admin,
    callerUserId,
    buildNavPullAudit({
      principal,
      userId: callerUserId,
      contactId: contact_id,
      tenantId: (contact.tenant_id ?? null) as string | null,
      authzBasis: authz.basis,
      allowed: true,
      startedAtMs,
      nowIso: new Date().toISOString(),
    }),
  );

  let navData: Record<string, unknown> = {};
  try {
    const res = await fetch(`${NAV_API}/business-credit/profile`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "X-Partner-Id": partnerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ein: contact.ein, business_name: contact.business_name }),
    });
    if (!res.ok) {
      const text = await res.text();
      return jsonResponse({ error: "nav_api_error", status: res.status, body: text }, 502);
    }
    navData = await res.json();
  } catch (e) {
    return jsonResponse({ error: "nav_fetch_failed", detail: String((e as Error).message) }, 502);
  }

  const scores = (navData.scores as Record<string, number>) ?? {};
  const tradeLines = (navData.trade_lines as unknown[]) ?? [];
  const navProfileId = (navData.profile_id as string) ?? null;

  // Fetch prior profile for delta detection
  const { data: prior } = await admin
    .from("paige_business_credit_profiles")
    .select("id, scores, history")
    .eq("contact_id", contact_id)
    .maybeSingle();

  const now = new Date().toISOString();
  const history = Array.isArray(prior?.history) ? [...prior!.history] : [];
  history.push({ at: now, scores });

  const payload = {
    contact_id,
    business_name: contact.business_name,
    ein: contact.ein,
    nav_profile_id: navProfileId,
    scores,
    trade_lines: tradeLines,
    last_pulled_at: now,
    history: history.slice(-50),
  };

  let saved: { id: string } | null = null;
  if (prior?.id) {
    const { data } = await admin
      .from("paige_business_credit_profiles")
      .update(payload)
      .eq("id", prior.id)
      .select("id")
      .single();
    saved = data;
  } else {
    const { data } = await admin
      .from("paige_business_credit_profiles")
      .insert(payload)
      .select("id")
      .single();
    saved = data;
  }

  // Threshold delta -> bridge
  const { data: cfg } = await admin
    .from("paige_config")
    .select("nav_threshold_delta")
    .eq("id", 1)
    .maybeSingle();
  const threshold = (cfg?.nav_threshold_delta as number) ?? 20;
  const priorScores = (prior?.scores ?? {}) as Record<string, number>;
  for (const [scoreType, newVal] of Object.entries(scores)) {
    const oldVal = priorScores[scoreType];
    if (typeof oldVal === "number" && Math.abs(newVal - oldVal) >= threshold) {
      fireAndForgetBridge("business_credit_score_changed", {
        contact_id,
        business_name: contact.business_name,
        score_type: scoreType,
        old_value: oldVal,
        new_value: newVal,
        delta: newVal - oldVal,
        snapshot_id: saved?.id,
      });
    }
  }

  return jsonResponse({ ok: true, profile_id: saved?.id, scores });
});
