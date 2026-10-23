// systems-check-runners/connections_healthy.ts — Check #11 (runner_key: connections_healthy).
//
// EXP10 ALG-12 completion: the SCHEDULED exception-detection home for MCP connection health. The
// staleness derivation shipped with list_integration_surface (20271113510000) makes health
// evidence-bearing on READ; this check is what makes it RE-CHECKED on the existing cron cadence —
// the scheduled Systems Check runner (20260816150000) files remediation actions DELTA-ONLY, so a
// connection that newly errors or goes stale surfaces as an owner action exactly once, never spam.
//
// SEAM (reuse ONLY this): tenant_mcp_connections — an AGGREGATE COUNT per state class, never a
// selected row (same discipline as external_automation_detected). The staleness predicate is the
// SAME semantic as the surface's: status='connected' AND (last_probed_at IS NULL OR older than
// 7 days). One definition, two readers, zero drift: if the interval ever changes in the surface,
// it changes here in the same commit.
//
// HONEST SCOPE (§13): this sees the LEGACY registry (the live write path for every tenant MCP
// connection today, which v2 dual-reads). It does not probe providers — a cron that poked every
// tenant's external servers unbidden would be its own incident — it detects the RECORDED state:
// a row the last real probe left in error, or a connected-claiming row nobody has re-verified in
// over 7 days. Vacuous pass: a tenant with no MCP connections passes (automation_wired owns the
// "should you connect one" question; this check owns "is what you connected healthy").
//
// §51 tenant-scoped; §32 fail-loud.

import type { CheckRunner } from "../systems-check-runner.ts";
import { throwOnDbError, errorResult } from "./_kit.ts";

export const runnerKey = "connections_healthy";

/** The one staleness interval, named once. Mirrors list_integration_surface's derivation exactly. */
const STALE_AFTER_DAYS = 7;

export const run: CheckRunner = async (ctx, _row) => {
  const { admin, tenantId } = ctx;
  try {
    // DETERMINISTIC AGGREGATES. Three counts, no rows: erroring, stale-claimed, and configured
    // total. No provider name, URL, token state or tool schema crosses the seam.
    const [errRes, staleRes, totalRes] = await Promise.all([
      admin.from("tenant_mcp_connections")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("status", "error"),
      admin.from("tenant_mcp_connections")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("status", "connected")
        .or(`last_probed_at.is.null,last_probed_at.lt.${daysAgoIso(STALE_AFTER_DAYS)}`),
      admin.from("tenant_mcp_connections")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("enabled", true),
    ]);
    throwOnDbError(errRes.error, "tenant_mcp_connections(error)");
    throwOnDbError(staleRes.error, "tenant_mcp_connections(stale)");
    throwOnDbError(totalRes.error, "tenant_mcp_connections(total)");

    const erroring = errRes.count ?? 0;
    const stale = staleRes.count ?? 0;
    const configured = totalRes.count ?? 0;
    const pass = erroring + stale === 0;

    return {
      status: pass ? "pass" : "fail",
      evidence: {
        configured_connections: configured,
        erroring_connections: erroring,
        stale_connections: stale,
        stale_after_days: STALE_AFTER_DAYS,
        scope_note:
          "Recorded registry state only (the live MCP registry) — the check does not probe providers; it flags a recorded error or a connected-claiming row unverified for over 7 days",
      },
      interpretation: pass
        ? configured === 0
          ? "No MCP connections are configured (nothing to be unhealthy)."
          : "Every configured connection is recorded healthy and was verified within the last 7 days."
        : `${erroring} connection${erroring === 1 ? "" : "s"} recorded in error and ${stale} stale (connected but unverified for over ${STALE_AFTER_DAYS} days) — re-verify or reconnect them in Settings → Integrations.`,
    };
  } catch (e) {
    return errorResult(e, runnerKey);
  }
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
