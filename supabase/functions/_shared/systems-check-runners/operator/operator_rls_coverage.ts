// operator/operator_rls_coverage.ts — OPERATOR check #4 (runner_key: operator_rls_coverage).
//
// SEAM (reuse ONLY this): the operator_rls_coverage_audit() SECURITY DEFINER RPC (20260816170000),
// gated is_platform_operator() OR service_role. It audits public base tables via pg_catalog and returns
// counts + the capped lists of tables WITHOUT RLS and tables with RLS-but-no-policy. §18 one home.
//
// VERDICT (ANT-165 truth fix): fail if ANY public base table lacks RLS, OR any table has RLS enabled,
// zero policies AND a direct anon/authenticated/public DML grant — the effective-exposure verdict
// computed by the audit's blocking_exposure_count. RLS-with-no-policy and no such grant is default-deny:
// reported informationally, not a failure. Fail-closed on real exposure is unchanged. §13 honest.
// §32 fail-loud: an RPC error throws → status:'error'.

import type { CheckRunner } from "../../systems-check-runner.ts";
import { throwOnDbError, errorResult } from "../_kit.ts";

export const runnerKey = "operator_rls_coverage";

export const run: CheckRunner = async (ctx, _row) => {
  const { admin } = ctx;
  try {
    const { data, error } = await admin.rpc("operator_rls_coverage_audit");
    throwOnDbError(error, "operator_rls_coverage_audit");
    const audit = (data ?? {}) as Record<string, unknown>;

    const noRlsCount = Number(audit.tables_without_rls_count ?? 0);
    const noPolCount = Number(audit.tables_rls_no_policy_count ?? 0);
    // ANT-165: block on effective exposure, not policy-count alone. Older audit versions
    // (pre-blocking_exposure_count) fall back to the strict count verdict — never weaker.
    const blockingCount = audit.blocking_exposure_count == null
      ? noRlsCount + noPolCount
      : Number(audit.blocking_exposure_count);
    const pass = blockingCount === 0;

    const gaps: string[] = [];
    if (noRlsCount > 0) gaps.push(`${noRlsCount} table(s) without RLS`);
    const grantedCount = Number(audit.rls_no_policy_with_dml_grant_count ?? 0);
    if (grantedCount > 0) gaps.push(`${grantedCount} table(s) with RLS, no policy AND a direct DML grant`);
    const defaultDenyCount = noPolCount - grantedCount;

    return {
      status: pass ? "pass" : "fail",
      evidence: audit,
      interpretation: pass
        ? `RLS coverage is complete — ${audit.rls_enabled}/${audit.total_tables} public base tables have row-level security; no effective exposure.${defaultDenyCount > 0 ? ` ${defaultDenyCount} RLS table(s) have no policy and no direct DML grant (default-deny; policy authoring debt).` : ""}`
        : `RLS exposure: ${gaps.join("; ")}. Coverage ${audit.rls_enabled}/${audit.total_tables} (${audit.coverage_ratio ?? "n/a"}).`,
      metric: typeof audit.coverage_ratio === "number"
        ? { name: "rls_coverage_ratio", value: audit.coverage_ratio as number }
        : undefined,
    };
  } catch (e) {
    return errorResult(e, runnerKey);
  }
};
