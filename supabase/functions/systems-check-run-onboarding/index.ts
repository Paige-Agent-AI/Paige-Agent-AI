// systems-check-run-onboarding — the ONBOARDING flavor of the Systems Check runner (task #80, L2).
//
// Runs the FULL enabled 10-check catalog for ONE tenant and files a remediation action for EVERY fail
// (actionFiling:'all') — onboarding wants the complete picture surfaced, not a delta. This is the
// first-run scan a coach (or the operator, or a future provision_tenant hook) triggers to see where a
// fresh account stands across comms / website / social / automation / company info / CRM / pipeline /
// revenue / payments.
//
// AUTH — verify_jwt = FALSE (declared in config.toml), mirroring systems-check-run-operator. The function
// FAILS CLOSED in-function to one of two gates (§9/§588 — tenant/identity is NEVER trusted from an
// anonymous body):
//   • internal caller (service-role bearer OR valid x-cron-token) — the PROVISIONING enqueue. A brand-new
//     tenant (create_subaccount / tenant-signup) has no user session yet, so the first onboarding scan is
//     fired server-side and MUST name its target via body.tenant_id. This is trusted at exactly the same
//     level as the daily cron that scans EVERY tenant (a service context holding the service key / vault
//     cron token — never a browser). enqueue_onboarding_systems_check() is the sole DB-side producer.
//   • a user/owner JWT — resolveTenantFromJwt (UNCHANGED): tenant derived from the VERIFIED JWT, or an
//     owner-gated body.tenant_id. Lowering the gateway gate to verify_jwt=false does NOT weaken this path
//     — resolveTenantFromJwt does full JWT verification in-function (getUser + is_platform_owner); an
//     anon/tenant-less caller with no internal token falls through to it and is rejected 401.
//
// §18: imports the ONE core (runSystemsCheck) + the runner registration barrel (side-effect). It writes
// NO DB rows itself — the core is the SOLE writer of paige_systems_check_run / _finding (§37).

import { runSystemsCheck } from "../_shared/systems-check-runner.ts";
import "../_shared/systems-check-runners/index.ts"; // side-effect: registers the 10 runner modules (§18)
import { adminClient, corsHeaders, isAuthorizedInternalCaller, json, resolveTenantFromJwt } from "../_shared/systems-check-http.ts";
import { handleManualSystemsWork } from "../_shared/systems-check-manual-http.ts";

declare const EdgeRuntime: { waitUntil(task: Promise<void>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Explicit private Work purpose; ordinary onboarding/provisioning stays below.
  if (new URL(req.url).searchParams.has("manual_work")) {
    return handleManualSystemsWork(req, { admin: adminClient(),
      defer: typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function"
        ? task => EdgeRuntime.waitUntil(task) : undefined });
  }

  let body: { tenant_id?: string } = {};
  body = (await req.json().catch(() => ({}))) as { tenant_id?: string };

  const admin = adminClient();

  let tenantId: string | null = null;
  let isOwner = false;
  let triggerSource = "onboarding";

  const internal = await isAuthorizedInternalCaller(req, admin);
  if (internal) {
    // Trusted server context (provisioning enqueue / cron) — MUST carry an explicit tenant_id (no JWT to
    // derive it from). §9: only reachable with the service key or the vault cron token, never a browser.
    tenantId = typeof body.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;
    if (!tenantId) return json(400, { error: "tenant_id_required_for_internal_caller" });
    triggerSource = "provisioning";
  } else {
    const resolved = await resolveTenantFromJwt(req, body.tenant_id ?? null);
    if (resolved.error) return json(resolved.error.status, resolved.error.body);
    if (!resolved.tenantId) return json(400, { error: "no_tenant_resolved" });
    tenantId = resolved.tenantId;
    isOwner = resolved.isOwner;
  }

  try {
    const summary = await runSystemsCheck({
      admin,
      tenantId,
      scanFlavor: "onboarding",
      actionFiling: "all",
      triggeredBy: { source: triggerSource, owner_initiated: isOwner },
    });
    return json(200, { ok: true, ...summary });
  } catch (e) {
    // Fail-loud (§13/§32) — never a fabricated success. The core self-heals per-check errors internally;
    // reaching here means a top-level failure (e.g. run-row insert), which we report honestly.
    console.error("[systems-check-run-onboarding] scan failed:", (e as Error)?.message);
    return json(500, { error: "scan_failed", detail: (e as Error)?.message ?? "unknown" });
  }
});
