// Trigger a workflow from paige_workflow_registry.
// Routes by provider: n8n (webhook), langgraph (API), direct_edge_function (invoke), cron_only (rejected).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { contactHintsFromPayload, emitAutomationRail } from "../_shared/railAutomation.ts";
import { canonicalDirectFunctionName, isMarketplaceDirectFunctionBlocked } from "../_shared/marketplace-authority-containment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Fail-closed activation gate (readiness requirement 9) ─────────────────
// No budget/cost control and no Trust Compass consult exists on the workflow
// execution path. Until both do, this entry point refuses to dispatch. §58:
// a deliberate, called-out block on a previously ungated path — it removes no
// working behaviour (paige_workflow_runs has never held a row) and must be
// lifted only through the activation contract, never by flipping this alone.
const EXECUTION_ENABLED = (Deno.env.get("WORKFLOW_EXECUTION_ENABLED") ?? "").toLowerCase() === "true";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonRes({ error: "unauthorized" }, 401);

  // §9/§53/§59 — SERVER-DERIVED tenant. `user_roles` has no tenant_id, so
  // has_role(uid,'admin') is PLATFORM-WIDE: migration 20260919000000 recorded
  // that 'global admin' is approximately "every tenant owner". A role check
  // alone therefore authorises nothing about WHICH workflow may be triggered.
  // The caller's tenant is resolved server-side and used to scope the lookup
  // below; it is never taken from the request body.
  const [{ data: isAdmin }, { data: callerTenantId }, { data: isOperator }] =
    await Promise.all([
      admin.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      userClient.rpc("current_user_tenant_id"),
      userClient.rpc("is_platform_operator"),
    ]);
  if (!isAdmin) return jsonRes({ error: "forbidden" }, 403);

  let body: { registry_key: string; payload?: Record<string, unknown> };
  try { body = await req.json(); } catch { return jsonRes({ error: "invalid_json" }, 400); }
  if (!body?.registry_key) return jsonRes({ error: "missing_registry_key" }, 400);

  // §9 — THE TENANT SCOPE. Previously this looked the registry row up by `key`
  // alone, through the RLS-BYPASSING service-role client, so any tenant's admin
  // or coach could trigger ANY tenant's workflow by knowing its key. The row's
  // tenant_id was even read further down (for the rail) while never being used
  // as a filter.
  //
  // Registry rows come in two kinds, and they have different authorities:
  //   - tenant-scoped (tenant_id = X)  → only a caller whose server-derived
  //     tenant is X may trigger it.
  //   - platform-scoped (tenant_id IS NULL) → operator authority only
  //     (is_platform_operator), NEVER a tenant-level app_role. All 23 shipped
  //     registry rows are platform-scoped, so this is the live path.
  const { data: registry, error: regErr } = await admin
    .from("paige_workflow_registry")
    .select("*")
    .eq("key", body.registry_key)
    .eq("is_active", true)
    .maybeSingle();
  if (regErr || !registry) return jsonRes({ error: "workflow_not_found" }, 404);

  const registryTenantId = (registry as { tenant_id?: string | null }).tenant_id ?? null;
  const authorised = registryTenantId === null
    ? isOperator === true
    : Boolean(callerTenantId) && registryTenantId === callerTenantId;
  if (!authorised) {
    // Same shape as a genuine miss: a caller must not be able to probe which
    // workflow keys exist in other tenants by reading the error apart.
    return jsonRes({ error: "workflow_not_found" }, 404);
  }

  if (!EXECUTION_ENABLED) {
    return jsonRes({
      error: "workflow_execution_disabled",
      message: "Workflow execution is gated off. Nothing was queued or dispatched.",
      missing_contracts: ["budget_or_cost_control", "trust_compass_autonomy_consult"],
    }, 503);
  }

  const payload = body.payload ?? {};

  // Pre-flight: cron_only workflows can't be manually triggered.
  if (registry.provider === "cron_only") {
    return jsonRes({
      error: "cron_only_workflow",
      message: "This workflow runs on a schedule and cannot be triggered manually.",
    }, 400);
  }

  // Pre-flight: missing route info.
  if (registry.provider === "n8n" && (!registry.n8n_webhook_url || registry.needs_n8n_link)) {
    return jsonRes({
      error: "needs_n8n_link",
      message: "Workflow is curated but not yet linked to a live n8n workflow. Connect n8n in Settings → Integrations → n8n to link it.",
    }, 409);
  }
  if (registry.provider === "langgraph" && !registry.langgraph_graph_id) {
    return jsonRes({ error: "langgraph_graph_id_missing" }, 409);
  }
  let directFunctionName: string | null = null;
  if (registry.provider === "direct_edge_function") {
    if (!registry.direct_function_name) {
      return jsonRes({ error: "direct_function_name_missing" }, 409);
    }
    directFunctionName = canonicalDirectFunctionName(registry.direct_function_name);
    if (!directFunctionName || isMarketplaceDirectFunctionBlocked(directFunctionName)) {
      return jsonRes({ error: "direct_function_not_allowed" }, 409);
    }
  }
  // Requirement 14 — re-entrancy bound. A registry row naming a workflow entry
  // point as its direct target would recurse without limit; nothing in the run
  // record carries a depth counter, so refuse structurally.
  if (
    registry.provider === "direct_edge_function" &&
    ["trigger-workflow", "dispatch-queued-workflow-runs"].includes(String(directFunctionName))
  ) {
    return jsonRes({ error: "re_entrant_target_refused" }, 409);
  }

  const { data: run, error: runErr } = await admin
    .from("paige_workflow_runs")
    .insert({
      registry_id: registry.id,
      // The run inherits the REGISTRY's tenant, server-derived — never a body value.
      tenant_id: registryTenantId,
      triggered_by_user_id: user.id,
      payload,
      status: "queued",
    })
    .select("*")
    .single();
  if (runErr || !run) return jsonRes({ error: "run_insert_failed", detail: runErr?.message }, 500);

  let newStatus: "running" | "failed" | "succeeded" = "running";
  let errorText: string | null = null;
  let executionId: string | null = null;
  let resultJson: unknown = null;

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);

    if (registry.provider === "n8n") {
      const res = await fetch(registry.n8n_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, paige_run_id: run.id, triggered_by: user.id }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        newStatus = "failed";
        errorText = `n8n_${res.status}: ${(await res.text()).slice(0, 300)}`;
      } else {
        const j = await res.json().catch(() => ({}));
        executionId = j?.executionId ?? j?.execution_id ?? null;
      }
    } else if (registry.provider === "langgraph") {
      const lgKey = Deno.env.get("LANGGRAPH_API_KEY");
      const lgBase = Deno.env.get("LANGGRAPH_BASE_URL");
      if (!lgKey || !lgBase) {
        newStatus = "failed";
        errorText = "LANGGRAPH_API_KEY or LANGGRAPH_BASE_URL not configured";
      } else {
        const res = await fetch(`${lgBase.replace(/\/$/, "")}/runs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": lgKey,
          },
          body: JSON.stringify({
            assistant_id: registry.langgraph_graph_id,
            input: payload,
            metadata: { paige_run_id: run.id, triggered_by: user.id },
          }),
          signal: controller.signal,
        });
        clearTimeout(t);
        if (!res.ok) {
          newStatus = "failed";
          errorText = `langgraph_${res.status}: ${(await res.text()).slice(0, 300)}`;
        } else {
          const j = await res.json().catch(() => ({}));
          executionId = j?.run_id ?? j?.id ?? null;
          resultJson = j;
        }
      }
    } else if (registry.provider === "direct_edge_function") {
      // Forward to the target edge function with the user's auth.
      const targetUrl = `${supabaseUrl}/functions/v1/${directFunctionName}`;
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          apikey: anonKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(t);
      const txt = await res.text();
      try { resultJson = JSON.parse(txt); } catch { resultJson = { raw: txt.slice(0, 1000) }; }
      if (!res.ok) {
        newStatus = "failed";
        errorText = `direct_${res.status}: ${txt.slice(0, 300)}`;
      } else {
        newStatus = "succeeded";
      }
    } else {
      // Unknown/unsupported provider (e.g. a langgraph_bridge row that should route
      // via the dispatcher, not here): nothing was dispatched. Mark failed so the run
      // status is truthful AND the rail emitter below (which skips 'failed') never
      // files an automation.fired for a workflow that was never sent (§13).
      newStatus = "failed";
      errorText = `unsupported_provider: ${registry.provider}`;
    }
  } catch (e) {
    newStatus = "failed";
    errorText = (e as Error).message.slice(0, 500);
  }

  // §13/requirement 15 — this write is what makes the run record TRUE. If it
  // fails, the caller must not be told the run reached `newStatus`: the row is
  // still whatever it was, and reporting otherwise is the silent-success failure
  // this readiness pass exists to remove.
  const { error: finalErr } = await admin
    .from("paige_workflow_runs")
    .update({
      status: newStatus,
      n8n_execution_id: executionId,
      error: errorText,
      result: resultJson as never,
      completed_at: newStatus === "running" ? null : new Date().toISOString(),
    })
    .eq("id", run.id);
  if (finalErr) {
    return jsonRes({
      run_id: run.id,
      status: "unknown",
      error: `run_status_write_failed: ${finalErr.message}`,
      dispatch_outcome: newStatus,
      dispatch_error: errorText,
    }, 500);
  }

  // Rail (owner_ops) — file automation.fired/.completed for the run's client, if one
  // resolves. Best-effort + non-blocking (§13): a rail failure can't affect the run.
  // A dispatch that FAILED to fire is not reported. 'succeeded' (synchronous
  // direct_edge_function) fired AND completed; 'running' (async n8n/langgraph) only fired.
  if (newStatus === "running" || newStatus === "succeeded") {
    const hints = contactHintsFromPayload(payload);
    const railBase = {
      tenantId: (registry as { tenant_id?: string | null }).tenant_id ?? null,
      contactId: hints.contactId, email: hints.email, phone: hints.phone,
      workflowName: (registry as { label?: string | null }).label ?? null,
      refTable: "paige_workflow_runs", refId: run.id,
    };
    await emitAutomationRail(admin, { ...railBase, phase: "fired" });
    if (newStatus === "succeeded") await emitAutomationRail(admin, { ...railBase, phase: "completed" });
  }

  return jsonRes({
    run_id: run.id,
    status: newStatus,
    n8n_execution_id: executionId,
    error: errorText,
    result: resultJson,
  });
});
