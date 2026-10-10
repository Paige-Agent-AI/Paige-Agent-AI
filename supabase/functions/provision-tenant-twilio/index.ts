// Comms C-2a — tenant Twilio subaccount PROVISIONING / backfill (SUPER-ADMIN ONLY).
//
// One-shot, idempotent backfill over the tenants that have NO
// tenant_twilio_subaccounts row. The per-tenant steps live in the ONE shared
// core (_shared/twilio-provision.ts, §18) that the governed tenant setup
// action (comms-setup-calling) also executes — this edge is the privileged
// operator's batch wrapper: enumeration, allowlist, adopt map, dry-run, report.
//
// C-2a API-KEY AUTH (owner-confirmed 2026-07-28, Path A): under MASTER API-Key auth
// Twilio's POST /Accounts.json returns the subaccount `sid` but OMITS `auth_token`, so
// we no longer depend on it. Every provisioned/adopted subaccount instead gets its OWN
// API Key (SK… + secret) via createSubaccountApiKey; the secret is Vault-only (§34).
//
// ORPHAN ADOPTION: the `adopt` body map ({tenant_id: existing_subaccount_sid}) lets the
// operator reconcile subaccounts that already exist at Twilio but never got a DB row (a
// failed prior run). Idempotent: a tenant that already HAS a row is excluded from targets.
//
// DOCTRINE
//  §9  Super-admin gate on the caller JWT (is_platform_owner). Tenant ids come from the
//      DB enumeration + operator allowlist, never an unscoped body write.
//  §13 Honest: masterCreds unset => needs_config, provision NOTHING (the core reports
//      blocked_needs_config per tenant; this wrapper surfaces it once). Real SIDs only.
//  §Scope  This fn provisions tenant subaccounts ONLY. Number import/purchase is out of
//      scope (the dedicated import seam C-2s-A / D2 and comms-purchase-number own those).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { masterCreds } from "../_shared/twilio.ts";
import { provisionTenantTwilio, type TenantProvisionResult } from "../_shared/twilio-provision.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Optional request body — a backfill with no body provisions ALL unprovisioned tenants. */
interface ProvisionBody {
  /** Optional allowlist: provision ONLY these tenant ids (still super-admin, still idempotent). */
  tenant_ids?: string[];
  /** When true, report who WOULD be provisioned without calling Twilio or writing anything. */
  dry_run?: boolean;
  /**
   * ORPHAN ADOPTION (C-2a): map of tenant_id → an EXISTING Twilio subaccount SID that was
   * already created at Twilio (under the master account) but never got a DB row (a failed
   * prior run). For a tenant present here the core SKIPS createSubaccount and instead
   * ADOPTS the given SID — mint a subaccount API Key on it + write the row. When `adopt` is
   * present it also acts as an implicit allowlist (unioned with tenant_ids).
   */
  adopt?: Record<string, string>;
}

/** Per-tenant outcome in the report (§13 — real SIDs or a real error, never a fake). */
interface TenantResult {
  tenant_id: string;
  name: string | null;
  status: "provisioned" | "adopted" | "skipped_existing" | "failed" | "would_provision" | "would_adopt" | "blocked_needs_config";
  subaccount_sid?: string | null; // REAL Twilio ACxx… on success, else omitted
  api_key_sid?: string | null;     // REAL Twilio SK… on success, else omitted (NEVER the secret, §34)
  twiml_app_sid?: string | null;   // C-2v (#140 A1): REAL Twilio AP… voice app SID, or null if minting failed
  twiml_app_error?: string | null; // C-2v: non-fatal — the subaccount row is written; app can be re-minted (idempotent)
  error?: string | null;
}

/** Project the shared core's result onto the backfill's stable report shape. */
function toTenantResult(r: TenantProvisionResult): TenantResult {
  return {
    tenant_id: r.tenant_id,
    name: r.name,
    status: r.outcome,
    subaccount_sid: r.subaccount_sid ?? undefined,
    api_key_sid: r.api_key_sid ?? undefined,
    twiml_app_sid: r.twiml_app_sid ?? undefined,
    twiml_app_error: r.twiml_app_error ?? undefined,
    error: r.error ?? undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Super-admin gate (§9): is_platform_owner() on the caller JWT. Reject everyone else. ──
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: isOwner } = await userClient.rpc("is_platform_owner");
  if (isOwner !== true) return json({ error: "forbidden" }, 403);

  // ── §13: master creds must exist BEFORE we touch anything. Absent => needs_config, provision NOTHING. ──
  const master = masterCreds();
  if (!master) {
    return json({
      needs_config: true,
      error: "twilio_master_not_configured",
      message: "The master Twilio credentials (TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET) are not set as edge secrets. No tenant was provisioned.",
      provisioned: 0,
      results: [],
    });
  }

  let body: ProvisionBody = {};
  try { body = (await req.json()) as ProvisionBody; } catch { body = {}; }
  const filterIds = Array.isArray(body.tenant_ids) ? body.tenant_ids.filter((x) => typeof x === "string") : null;
  const dryRun = body.dry_run === true;

  // ── Orphan-adoption map (C-2a): tenant_id → EXISTING subaccount SID. Keep only well-formed
  //    string→string entries; the keys also act as an implicit allowlist (unioned below). ──
  const adoptMap: Record<string, string> = {};
  if (body.adopt && typeof body.adopt === "object" && !Array.isArray(body.adopt)) {
    for (const [k, v] of Object.entries(body.adopt)) {
      if (typeof k === "string" && typeof v === "string" && v.length > 0) adoptMap[k] = v;
    }
  }
  const adoptKeys = Object.keys(adoptMap);

  // Service-role client for ALL data reads/writes (§9: the INSERT trigger must see
  // current_user_tenant_id()=null so the EXPLICIT tenant_id is honored).
  const admin = createClient(supabaseUrl, serviceKey);

  // ── Compute the unprovisioned set: all tenants MINUS those that already have a subaccount row. ──
  const { data: tenants, error: tErr } = await admin
    .from("tenants")
    .select("id, name");
  if (tErr) return json({ error: `tenants_read_failed: ${tErr.message}` }, 500);

  const { data: existing, error: eErr } = await admin
    .from("tenant_twilio_subaccounts")
    .select("tenant_id");
  if (eErr) return json({ error: `subaccounts_read_failed: ${eErr.message}` }, 500);

  const provisionedSet = new Set<string>((existing ?? []).map((r: { tenant_id: string }) => r.tenant_id));

  let targets = (tenants ?? []).filter((t: { id: string }) => !provisionedSet.has(t.id));
  // Allowlist = explicit tenant_ids ∪ adopt keys. When either is present, restrict to it so
  // `{adopt:{…}}` alone targets exactly the orphans (and never mass-provisions everyone else).
  if (filterIds || adoptKeys.length > 0) {
    const allow = new Set<string>([...(filterIds ?? []), ...adoptKeys]);
    targets = targets.filter((t: { id: string }) => allow.has(t.id));
  }

  if (dryRun) {
    const results: TenantResult[] = targets.map((t: { id: string; name: string | null }) => {
      const adoptSid = adoptMap[t.id];
      return adoptSid
        ? { tenant_id: t.id, name: t.name ?? null, status: "would_adopt", subaccount_sid: adoptSid }
        : { tenant_id: t.id, name: t.name ?? null, status: "would_provision" };
    });
    return json({
      dry_run: true,
      unprovisioned_count: targets.length,
      adopt_count: results.filter((r) => r.status === "would_adopt").length,
      results,
    });
  }

  // ── Provision/adopt loop via the ONE shared core. Continue on per-tenant failure;
  //    report each honestly (§13). ──
  let provisioned = 0;
  let adopted = 0;
  const results: TenantResult[] = [];
  for (const t of targets) {
    const r = await provisionTenantTwilio(admin as unknown as Parameters<typeof provisionTenantTwilio>[0], {
      tenantId: t.id,
      tenantName: t.name ?? null,
      adoptSid: adoptMap[t.id],
    });
    if (r.outcome === "provisioned") provisioned++;
    if (r.outcome === "adopted") adopted++;
    results.push(toTenantResult(r));
  }

  return json({
    provisioned,
    adopted,
    unprovisioned_count: targets.length,
    failed: results.filter((r) => r.status === "failed").length,
    results, // REAL SIDs / SK ids per tenant — no fabricated identifiers, no secrets (§13/§34)
  });
});
