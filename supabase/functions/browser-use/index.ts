// deno-lint-ignore-file no-explicit-any
// Paige Secure Browser request boundary. The external worker path remains deliberately unavailable
// until every vendor gate in the approved MVP plan is independently cleared.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { recordCapabilityRun } from "../_shared/capability-record.ts";
import {
  normalizeSecureBrowserTarget,
  normalizeSecureBrowserPurpose,
  validateSecureBrowserScope,
  type SecureBrowserScope,
} from "../_shared/secure-browser-contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "session_required" }, 401);
  const token = authorization.slice(7).trim();
  if (!token) return json({ error: "session_required" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: userData, error: authError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (authError || !user) return json({ error: "session_invalid" }, 401);

  // The active workspace is the requested workspace. Do not fall back to another membership when it
  // is missing or stale: a tenant switch must fail closed rather than file the run elsewhere.
  const { data: profile } = await admin
    .from("profiles")
    .select("active_tenant_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const tenantId = typeof profile?.active_tenant_id === "string" ? profile.active_tenant_id : null;
  if (!tenantId) return json({ error: "active_workspace_required" }, 403);

  const [
    { data: membership, error: membershipError },
    { data: isAdmin, error: adminError },
    { data: isAgencyManager, error: agencyError },
    { data: isPlatformOwner, error: platformOwnerError },
  ] = await Promise.all([
    admin.from("tenant_members").select("role,is_owner,status").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle(),
    admin.rpc("is_tenant_admin_as", { _actor: user.id, _tenant: tenantId }),
    admin.rpc("agency_can_manage_child", { _child: tenantId, _actor: user.id }),
    admin.rpc("is_platform_owner", { _user_id: user.id }),
  ]);
  if ((membershipError && adminError && agencyError && platformOwnerError) ||
      (isAdmin !== true && isAgencyManager !== true && isPlatformOwner !== true)) {
    return json({ error: "not_authorized" }, 403);
  }

  // Read the flag from the same resolved tenant snapshot. Calling tenant_has_feature() through the
  // user JWT would independently re-resolve the active tenant and create an account-switch race.
  const { data: tenant, error: flagError } = await admin
    .from("tenants")
    .select("features")
    .eq("id", tenantId)
    .maybeSingle();
  const features = tenant?.features && typeof tenant.features === "object" ? tenant.features as Record<string, unknown> : {};
  if (flagError || features.secure_browser !== true) {
    return json({ status: "unavailable", reason: "feature_not_enabled" }, 404);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const purposeValue = body.purpose ?? body.goal;
  const targetValue = body.target ?? body.start_url;
  let purpose = "";
  const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  if (!threadId || !idempotencyKey) {
    return json({ error: "purpose_thread_and_idempotency_required" }, 400);
  }
  let target: { origin: string; displayHost: string };
  let scope: SecureBrowserScope;
  try {
    purpose = normalizeSecureBrowserPurpose(typeof purposeValue === "string" ? purposeValue : "");
    target = normalizeSecureBrowserTarget(typeof targetValue === "string" ? targetValue : "");
    scope = validateSecureBrowserScope(body.scope);
    if (!scope.allowedOrigins.includes(target.origin)) {
      return json({ error: "target_outside_scope" }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "secure_browser_request_invalid" }, 400);
  }

  const relatedContactId = typeof body.related_contact_id === "string" ? body.related_contact_id : null;
  const relatedBusinessId = typeof body.related_business_id === "string" ? body.related_business_id : null;
  if (relatedContactId) {
    const { data } = await admin.from("clients").select("id").eq("id", relatedContactId).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return json({ error: "related_contact_outside_workspace" }, 403);
  }
  if (relatedBusinessId) {
    const { data } = await admin.from("businesses").select("id").eq("id", relatedBusinessId).eq("tenant_id", tenantId).maybeSingle();
    if (!data) return json({ error: "related_business_outside_workspace" }, 403);
  }

  const directRole = membership?.status === "active" ? membership.role : null;
  const actorKind = isPlatformOwner === true
    ? "platform_owner"
    : directRole === "owner" || membership?.is_owner === true
      ? "owner"
      : directRole === "admin" && isAdmin === true
      ? "admin"
      : isAgencyManager === true
        ? "authorized_representative"
        : null;
  if (!actorKind) return json({ error: "not_authorized" }, 403);
  const { data: result, error: requestError } = await admin.rpc("secure_browser_request_unavailable", {
    p_tenant: tenantId,
    p_actor: user.id,
    p_actor_kind: actorKind,
    p_thread: threadId,
    p_purpose: purpose,
    p_target_origin: target.origin,
    p_target_display_host: target.displayHost,
    p_scope: scope,
    p_idempotency_key: idempotencyKey,
  });
  if (requestError || !result || typeof result !== "object") {
    console.error("[secure-browser] request record failed", { reason: requestError?.message ?? "empty_result" });
    return json({ error: "request_record_failed" }, 500);
  }
  const response = result as Record<string, unknown>;
  const receiptId = typeof response.receiptId === "string" ? response.receiptId : null;
  const railRecorded = receiptId
    ? await recordCapabilityRun(admin, {
        tenantId,
        actorId: user.id,
        capabilityKey: "paige_secure_browser",
        outcome: "capability_unreachable",
        runId: receiptId,
      })
    : false;

  return json({
    ...response,
    status: "unavailable",
    railEvidence: railRecorded ? "recorded" : "not_recorded",
    message: "Paige Secure Browser is under setup for this workspace.",
  });
});
