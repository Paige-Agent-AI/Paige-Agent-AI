// Shared workflow dispatcher used by both paige-mcp (inline on run_workflow)
// and dispatch-queued-workflow-runs (pg_cron sweeper for orphaned rows).
//
// Routes a queued paige_workflow_runs row to its declared provider:
//   - n8n                  → POST webhook
//   - langgraph            → POST direct to LANGGRAPH_BASE_URL/runs
//   - langgraph_bridge     → POST to MMA OS langgraph-bridge (Doctrine §117 Opt 2)
//   - direct_edge_function → invoke Paige edge function by name (synchronous)
//   - cron_only            → fail fast (registry says this only runs from cron)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { contactHintsFromPayload, emitAutomationRail } from "./railAutomation.ts";
import { platformOperatorTenantId } from "./platform-operator-tenant.ts";
import { canonicalDirectFunctionName, isMarketplaceDirectFunctionBlocked, isServiceDispatchDirectFunctionAllowed } from "./marketplace-authority-containment.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type DispatchOpts = {
  runId: string;
  provider: string | null;
  n8nWebhookUrl: string | null;
  needsN8nLink: boolean | null;
  langgraphGraphId: string | null;
  directFunctionName: string | null;
  payload: Record<string, unknown>;
  /** When invoked from the sweeper we want to bump retry_count. */
  isRetry?: boolean;
  /**
   * Doctrine §118 provider gate. When provided (e.g. from paige-mcp.run_workflow),
   * n8n and langgraph_bridge are restricted to the MMA tenant — those route to the
   * platform owner's shared infra and must not be reachable by other tenants.
   * Omit (e.g. from the cron sweeper) to bypass the gate for system-level retries.
   */
  callerTenantId?: string | null;
  /**
   * Optional rail hints so the automation.fired/.completed emit can avoid a lookup.
   * When absent, they're resolved from the run's registry row (label) and payload
   * (contact). A caller like paige-mcp can pass these straight through.
   */
  workflowLabel?: string | null;
  contactId?: string | null;
};

// Doctrine §118 / §200: n8n + langgraph_bridge are platform-owner-only shared infra.
// The platform-owner tenant is now resolved from config-as-data (the operator's
// designated system tenant), never a hardcoded/stale id — see platformOperatorTenantId.
const PLATFORM_OWNER_PROVIDERS = new Set(["n8n", "langgraph_bridge"]);

export type DispatchResult = {
  status: "running" | "succeeded" | "failed";
  executionId?: string | null;
  threadId?: string | null;
  error?: string | null;
};

export async function dispatchWorkflowRun(opts: DispatchOpts): Promise<DispatchResult> {
  const { runId, provider, payload } = opts;

  const baseStamp = {
    last_dispatched_at: new Date().toISOString(),
  } as Record<string, unknown>;

  const updateRun = async (patch: Record<string, unknown>) => {
    const full = { ...baseStamp, ...patch };
    if (opts.isRetry) {
      // Use raw SQL to increment retry_count atomically.
      const { data } = await admin
        .from("paige_workflow_runs")
        .select("retry_count")
        .eq("id", runId)
        .maybeSingle();
      full.retry_count = ((data?.retry_count as number | null) ?? 0) + 1;
    }
    await admin.from("paige_workflow_runs").update(full).eq("id", runId);
  };

  // ── Rail (owner_ops) — file automation.fired/.completed for the run's client.
  // Best-effort + NON-BLOCKING (§13). Skipped on retries: the sweeper re-dispatches
  // runs that ALREADY emitted when first created, so only a first-attempt dispatch
  // (e.g. paige-mcp.run_workflow, where isRetry is falsy) emits — no double-counting.
  let railCache: {
    tenantId: string | null; contactId: string | null;
    email: string | null; phone: string | null; label: string | null;
  } | null = null;
  const resolveRail = async () => {
    if (railCache) return railCache;
    const hints = contactHintsFromPayload(opts.payload);
    let tenantId: string | null = opts.callerTenantId ?? null;
    let label: string | null = opts.workflowLabel ?? null;
    const contactId: string | null = opts.contactId ?? hints.contactId;
    if (!tenantId || !label) {
      try {
        const { data } = await admin
          .from("paige_workflow_runs")
          .select("registry:paige_workflow_registry(label, tenant_id)")
          .eq("id", runId)
          .maybeSingle();
        const reg = (data as { registry?: { label?: string; tenant_id?: string } } | null)?.registry ?? null;
        if (!tenantId) tenantId = reg?.tenant_id ?? null;
        if (!label) label = reg?.label ?? null;
      } catch { /* best-effort */ }
    }
    railCache = { tenantId, contactId, email: hints.email, phone: hints.phone, label };
    return railCache;
  };
  const fireRail = async (phase: "fired" | "completed") => {
    if (opts.isRetry) return;
    try {
      const r = await resolveRail();
      await emitAutomationRail(admin, {
        tenantId: r.tenantId, contactId: r.contactId, email: r.email, phone: r.phone,
        workflowName: r.label, phase, refTable: "paige_workflow_runs", refId: runId,
      });
    } catch { /* never throw */ }
  };

  if (!provider || provider === "cron_only") {
    const errText = provider === "cron_only" ? "cron_only_workflow" : "no_provider_configured";
    await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
    return { status: "failed", error: errText };
  }

  // Doctrine §118 / §200 provider gate — n8n + langgraph_bridge are platform-owner only.
  // Resolve the operator's designated system tenant (config-as-data), then refuse any
  // tenant caller whose id isn't it. RESTRICT-DON'T-OPEN: the operator-tenant compare
  // stays a plain `!==` INSIDE the block — never folded into the precondition — so when
  // the operator tenant is unset (null), a real (truthy) callerTenantId is still `!== null`
  // and still blocked. A god caller resolves callerTenantId=null and bypasses via the
  // precondition; the cron sweeper omits callerTenantId (undefined) and bypasses too.
  if (
    opts.callerTenantId !== undefined &&
    opts.callerTenantId !== null &&
    PLATFORM_OWNER_PROVIDERS.has(provider)
  ) {
    const operatorTenantId = await platformOperatorTenantId(admin);
    if (opts.callerTenantId !== operatorTenantId) {
      const errText = "provider_restricted_to_platform_owner";
      await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
      return { status: "failed", error: errText };
    }
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    // ---------- n8n ----------
    if (provider === "n8n") {
      if (!opts.n8nWebhookUrl || opts.needsN8nLink) {
        const errText = "needs_n8n_link";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      const res = await fetch(opts.n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, paige_run_id: runId, source: "mcp" }),
        signal: controller.signal,
      });
      const txt = await res.text();
      if (!res.ok) {
        const errText = `n8n_${res.status}: ${txt.slice(0, 300)}`;
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      let executionId: string | null = null;
      try {
        const j = JSON.parse(txt);
        executionId = j?.executionId ?? j?.execution_id ?? null;
      } catch { /* webhook may return plain text */ }
      await updateRun({ status: "running", n8n_execution_id: executionId });
      await fireRail("fired");
      return { status: "running", executionId };
    }

    // ---------- LangGraph direct ----------
    if (provider === "langgraph") {
      const lgKey = Deno.env.get("LANGGRAPH_API_KEY");
      const lgBase = Deno.env.get("LANGGRAPH_BASE_URL");
      if (!lgKey || !lgBase || !opts.langgraphGraphId) {
        const errText = "langgraph_not_configured";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      const res = await fetch(`${lgBase.replace(/\/$/, "")}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": lgKey },
        body: JSON.stringify({
          assistant_id: opts.langgraphGraphId,
          input: payload,
          metadata: { paige_run_id: runId, source: "mcp" },
        }),
        signal: controller.signal,
      });
      const txt = await res.text();
      if (!res.ok) {
        const errText = `langgraph_${res.status}: ${txt.slice(0, 300)}`;
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      let j: any = null;
      try { j = JSON.parse(txt); } catch { /* */ }
      const executionId = j?.run_id ?? j?.id ?? null;
      const threadId = j?.thread_id ?? null;
      await updateRun({ status: "running", n8n_execution_id: executionId, langgraph_thread_id: threadId, result: j });
      await fireRail("fired");
      return { status: "running", executionId, threadId };
    }

    // ---------- LangGraph via MMA OS bridge (Doctrine §117 Option 2) ----------
    if (provider === "langgraph_bridge") {
      const bridgeUrl = Deno.env.get("PAIGE_OS_LANGGRAPH_BRIDGE_URL");
      const bridgeKey = Deno.env.get("PAIGE_OS_LANGGRAPH_BRIDGE_KEY");
      if (!bridgeUrl || !bridgeKey) {
        const errText = "langgraph_bridge_not_configured";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      // workflow_key is what MMA OS treats as assistant_id; the registry stores it
      // as either langgraph_graph_id (preferred) or falls back to payload.workflow_key.
      const assistantId =
        opts.langgraphGraphId ??
        (payload?.workflow_key as string | undefined) ??
        null;
      if (!assistantId) {
        const errText = "langgraph_bridge_missing_assistant_id";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      const res = await fetch(bridgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bridgeKey}`,
        },
        body: JSON.stringify({
          verb: "fire_agent",
          assistant_id: assistantId,
          input: payload,
          wait: false,
          metadata: { paige_run_id: runId, source: "paige_mcp" },
        }),
        signal: controller.signal,
      });
      const txt = await res.text();
      let body: any = null;
      try { body = JSON.parse(txt); } catch { /* keep null */ }
      if (!res.ok || body?.ok === false) {
        const errText = `langgraph_bridge_${res.status}: ${txt.slice(0, 400)}`;
        await updateRun({
          status: "failed",
          error: errText,
          result: body ?? { raw: txt.slice(0, 1000) },
          completed_at: new Date().toISOString(),
        });
        return { status: "failed", error: errText };
      }
      const threadId: string | null = body?.thread_id ?? null;
      const executionId: string | null = body?.run_id ?? null;
      await updateRun({
        status: "running",
        n8n_execution_id: executionId,
        langgraph_thread_id: threadId,
        result: body?.run ?? body ?? null,
      });
      await fireRail("fired");
      return { status: "running", executionId, threadId };
    }

    // ---------- Direct edge function (synchronous) ----------
    if (provider === "direct_edge_function") {
      if (!opts.directFunctionName) {
        const errText = "direct_function_name_missing";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      const directFunctionName = canonicalDirectFunctionName(opts.directFunctionName);
      if (!directFunctionName || isMarketplaceDirectFunctionBlocked(directFunctionName)) {
        const errText = "direct_function_not_allowed";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      // INT-310: this call carries the SERVICE-ROLE bearer and a caller-shaped body, so only an
      // allowlisted target (one that derives tenant/actor server-side) may receive it.
      if (!isServiceDispatchDirectFunctionAllowed(directFunctionName)) {
        const errText = "direct_function_not_allowlisted";
        await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
        return { status: "failed", error: errText };
      }
      const url = `${SUPABASE_URL}/functions/v1/${directFunctionName}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ ...payload, paige_run_id: runId, source: "mcp" }),
        signal: controller.signal,
      });
      const txt = await res.text();
      let resultJson: unknown;
      try { resultJson = JSON.parse(txt); } catch { resultJson = { raw: txt.slice(0, 1000) }; }
      if (!res.ok) {
        const errText = `direct_${res.status}: ${txt.slice(0, 300)}`;
        await updateRun({
          status: "failed", error: errText, result: resultJson as never,
          completed_at: new Date().toISOString(),
        });
        return { status: "failed", error: errText };
      }
      await updateRun({
        status: "succeeded", result: resultJson as never,
        completed_at: new Date().toISOString(),
      });
      // Synchronous provider — it fired AND completed in this call (§13 truthful).
      await fireRail("fired");
      await fireRail("completed");
      return { status: "succeeded" };
    }

    const errText = `unknown_provider:${provider}`;
    await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
    return { status: "failed", error: errText };
  } catch (e) {
    const errText = (e as Error).message.slice(0, 500);
    await updateRun({ status: "failed", error: errText, completed_at: new Date().toISOString() });
    return { status: "failed", error: errText };
  } finally {
    clearTimeout(t);
  }
}
