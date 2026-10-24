// systems-check-runners/connections_healthy.ts — Check #11 (runner_key: connections_healthy).
//
// EXP10 ALG-12 completion: the SCHEDULED exception-detection home for MCP connection health. The
// staleness derivation shipped with list_integration_surface (20271113510000) makes health
// evidence-bearing on READ; this check is what makes it RE-CHECKED on the existing cron cadence —
// the scheduled Systems Check runner (20260816150000) files remediation actions DELTA-ONLY, so a
// connection that newly errors or goes stale surfaces as an owner action exactly once, never spam.
//
// SEAM (reuse ONLY these three stores, AGGREGATE head-counts, never a selected row — same
// discipline as external_automation_detected; the SAME three stores list_integration_surface's
// MCP halves read, so a row degraded on the surface is detected here and nowhere else):
//   • tenant_mcp_connections — the legacy registry (live store for legacy-projected rows)
//   • mcp_connections (legacy_source IS NULL) — the NATIVE gateway store (live store for rows
//     created through the gateway door: generic-remote servers, Slack via the EXP10 descriptor)
//   • tenant_n8n_connections — the n8n API-key facet (its own live store)
//
// The staleness predicate is the SAME semantic in every store (the surface's derivation):
// a connected-claiming row whose last probe/sync is older than 7 days, or absent. One interval,
// named once; if it ever changes in the surface it changes here in the same commit.
//
// HONEST SCOPE (§13): this detects the RECORDED state across all three stores — a row the last
// real probe left in error, or a connected-claiming row nobody has re-verified in over 7 days.
// It does not probe providers (a cron that poked every tenant's external servers unbidden would
// be its own incident). Vacuous pass: a tenant with no configured connections passes
// (automation_wired owns the "should you connect one" question; this check owns "is what you
// connected healthy"). Email channel connectors are deliberately out of scope — comms has its
// own check (comms_configured).
//
// §51 tenant-scoped; §32 fail-loud.

import type { CheckRunner } from "../systems-check-runner.ts";
import { throwOnDbError, errorResult } from "./_kit.ts";

export const runnerKey = "connections_healthy";

/** The one staleness interval, named once. Mirrors list_integration_surface's derivation exactly. */
const STALE_AFTER_DAYS = 7;

function staleCutoffIso(): string {
  return new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export const run: CheckRunner = async (ctx, _row) => {
  const { admin, tenantId } = ctx;
  const cutoff = staleCutoffIso();
  try {
    // DETERMINISTIC AGGREGATES. Counts only, no rows: no provider name, URL, token state or
    // tool schema crosses any seam. Six reads, three stores, two classes each.
    const reads = await Promise.all([
      // legacy registry
      admin.from("tenant_mcp_connections").select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("status", "error"),
      admin.from("tenant_mcp_connections").select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("status", "connected")
        .or(`last_probed_at.is.null,last_probed_at.lt.${cutoff}`),
      // native gateway store (legacy_source IS NULL rows only — projections are lineage-tracked
      // duplicates of legacy rows already counted above)
      admin.from("mcp_connections").select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).is("legacy_source", null).eq("status", "error"),
      admin.from("mcp_connections").select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).is("legacy_source", null).eq("status", "connected")
        .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`),
      // n8n API-key facet
      admin.from("tenant_n8n_connections").select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("status", "error"),
      admin.from("tenant_n8n_connections").select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("status", "connected")
        .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`),
    ]);
    const tables = [
      "tenant_mcp_connections(error)", "tenant_mcp_connections(stale)",
      "mcp_connections(error)", "mcp_connections(stale)",
      "tenant_n8n_connections(error)", "tenant_n8n_connections(stale)",
    ];
    reads.forEach((r, i) => throwOnDbError((r as { error?: unknown }).error, tables[i]));

    const erroring =
      (reads[0] as { count?: number }).count! + (reads[2] as { count?: number }).count! +
      (reads[4] as { count?: number }).count!;
    const stale =
      (reads[1] as { count?: number }).count! + (reads[3] as { count?: number }).count! +
      (reads[5] as { count?: number }).count!;
    const pass = erroring + stale === 0;

    return {
      status: pass ? "pass" : "fail",
      evidence: {
        erroring_connections: erroring,
        stale_connections: stale,
        stale_after_days: STALE_AFTER_DAYS,
        stores_read: ["tenant_mcp_connections", "mcp_connections(native)", "tenant_n8n_connections"],
        scope_note:
          "Recorded registry state across all three MCP connection stores (the same stores the integrations surface reads) — the check does not probe providers; it flags a recorded error or a connected-claiming row unverified for over 7 days. Zero counts with no configured connections is an honest vacuous pass (automation_wired owns the should-you-connect question).",
      },
      interpretation: pass
        ? erroring + stale === 0
          ? "No connection is recorded in error or overdue for re-verification."
          : ""
        : `${erroring} connection${erroring === 1 ? "" : "s"} recorded in error and ${stale} stale (connected but unverified for over ${STALE_AFTER_DAYS} days) — re-verify or reconnect them in Settings → Integrations.`,
    };
  } catch (e) {
    return errorResult(e, runnerKey);
  }
};
