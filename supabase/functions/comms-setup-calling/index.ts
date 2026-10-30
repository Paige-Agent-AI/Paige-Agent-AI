// INT-345 K-3 — the GOVERNED, TENANT-AUTHORIZED calling-setup seam.
//
// One deliberate click (Settings → Registration, or PAIGE through the governed
// comms_setup_calling action) connects this workspace's calling account by
// executing the ONE shared provisioning core (_shared/twilio-provision.ts) —
// the same steps the privileged backfill runs. This seam is NOT the backfill:
// it provisions exactly ONE tenant, the CALLER'S OWN, derived from the verified
// JWT (§9 — never a body value), after an owner/admin authority gate.
//
// What it deliberately does NOT do: buy a number, pick a primary, provision at
// signup/login/shell-mount, or expose the raw backfill to tenant credentials
// (provision-tenant-twilio keeps its is_platform_owner gate untouched). The
// four facts stay four facts: account configured ≠ number purchased ≠ primary
// selected ≠ calling READY — the response reports each, and "ready" appears
// only when a qualified primary number is actually selected (Send from this).
//
// DOCTRINE
//  §9  Tenant is server-derived (current_user_tenant_id). Authority: platform
//      owner acting in-tenant OR an admin of THIS tenant — mirrored from
//      comms-purchase-number's gate. Refusal happens BEFORE any provider call.
//  §13 Honest: dry_run reports the plan; blocked_needs_config means the
//      platform's master Twilio credentials are absent (nothing happened);
//      per-step statuses name the exact failed step; the post-run readback is
//      the canonical tenant_comms_readiness().calling block — never a guess.
//  §18 One core, one seam: _shared/twilio.ts + _shared/twilio-provision.ts;
//      no second Twilio client, no inline REST.
//  §34  No secret ever leaves the Vault write. The receipt carries steps and
//      identifiers (SK/SIDs), never the API-key secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { provisionTenantTwilio } from "../_shared/twilio-provision.ts";
import type { SupabaseAdminLike } from "../_shared/twilio.ts";

// RAIL: the CHAT path is the one recorder (recordCommsRun → classifyCommsRun), exactly
// like every sibling comms act — a Settings-click act writes no capability_run, same
// as a Settings purchase. The edge never self-records (round-3 P1: a hand-rolled
// outcome here wrote "connected" for blocked/no-op runs and doubled the chat receipt).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The ONLY tunable is dry_run (report the plan, touch nothing). */
interface SetupBody {
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── AuthN + authority (§9). Tenant + identity derived from the JWT, never the body. ──
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  const scope = await Promise.resolve(userClient.rpc("current_user_tenant_id")).catch(() => null);
  if (!scope || scope.error) return json({ error: "calling_authority_unavailable" }, 503);
  const tenantId = scope.data;
  if (!tenantId || typeof tenantId !== "string") {
    return json({ needs_config: true, error: "tenant_not_resolved" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  try {
    const owner = await userClient.rpc("is_platform_owner");
    if (owner.error) return json({ error: "calling_authority_unavailable" }, 503);
    if (owner.data !== true) {
      const role = await admin.rpc("is_tenant_admin_as", { _actor: user.id, _tenant: tenantId });
      if (role.error) return json({ error: "calling_authority_unavailable" }, 503);
      if (role.data !== true) return json({ error: "forbidden", message: "You don't have permission to set up calling for this workspace." }, 403);
    }
    const current = await userClient.rpc("current_user_tenant_id");
    if (current.error) return json({ error: "calling_authority_unavailable" }, 503);
    if (current.data !== tenantId) return json({ error: "workspace_changed" }, 409);
  } catch { return json({ error: "calling_authority_unavailable" }, 503); }

  let body: SetupBody = {};
  try { body = (await req.json()) as SetupBody; } catch { body = {}; }
  const dryRun = body.dry_run === true;

  // Service-role client for ALL writes (§9: the INSERT trigger must see
  // current_user_tenant_id()=null so the EXPLICIT tenant_id is honored).
  const { data: tenantRow } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName = typeof tenantRow?.name === "string" ? tenantRow.name : null;

  try {
    const owner = await userClient.rpc("is_platform_owner");
    if (owner.error) return json({ error: "calling_authority_unavailable" }, 503);
    if (owner.data !== true) {
      const role = await admin.rpc("is_tenant_admin_as", { _actor: user.id, _tenant: tenantId });
      if (role.error) return json({ error: "calling_authority_unavailable" }, 503);
      if (role.data !== true) return json({ error: "forbidden" }, 403);
    }
    const current = await userClient.rpc("current_user_tenant_id");
    if (current.error) return json({ error: "calling_authority_unavailable" }, 503);
    if (current.data !== tenantId) return json({ error: "workspace_changed" }, 409);
  } catch { return json({ error: "calling_authority_unavailable" }, 503); }
  const result = await provisionTenantTwilio(admin as unknown as SupabaseAdminLike, {
    tenantId,
    tenantName,
    dryRun,
  });

  // ── Readback (§13): the canonical readiness record's calling block, through the
  //    caller's OWN JWT (the RPC's in-body scope guard re-verifies authority).
  //    Dry runs report the plan only — nothing changed, so nothing is re-read.
  let calling: Record<string, unknown> | null = null;
  if (!dryRun) {
    const { data: readiness, error: rErr } = await userClient.rpc("tenant_comms_readiness");
    if (!rErr && readiness && typeof readiness === "object") {
      const rec = readiness as { calling?: Record<string, unknown> };
      calling = rec.calling ?? null;
    }
  }

  if (result.outcome === "blocked_needs_config") {
    return json({
      needs_config: true,
      error: "twilio_master_not_configured",
      message: "Calling setup is temporarily unavailable — the platform's calling connection is being restored. Nothing was changed; try again later.",
      outcome: result.outcome,
    });
  }

  return json({
    outcome: result.outcome,
    steps: result.steps,
    subaccount_sid: result.subaccount_sid ?? null,
    twiml_app_sid: result.twiml_app_sid ?? null,
    twiml_app_error: result.twiml_app_error ?? null,
    error: result.error ?? null,
    // The four facts, from the canonical readback — never asserted from the write.
    calling,
    message: dryRun
      ? undefined
      : result.outcome === "failed"
        ? "Calling setup didn't finish. The exact failed step is in `steps` — nothing else was changed; try again."
        : result.outcome === "skipped_existing"
          ? "This workspace's calling account is already set up."
          : "Calling account connected. Next: buy a number in Settings → Registration, then choose it with \"Send from this\" in Settings → Communications.",
  });
});
