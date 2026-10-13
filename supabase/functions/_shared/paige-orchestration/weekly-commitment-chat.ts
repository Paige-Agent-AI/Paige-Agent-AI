// Read-only integration handoff for the incumbent Chat/Live owners. This module is
// deliberately not admitted to any turn while INT-346 and rendered review are held.
// Caller must supply its authenticated JWT client; the RPC resolves current tenant
// and active owner itself. No service-role read, model-provided tenant or schedule control.
export const WEEKLY_COMMITMENT_STATUS_TOOL = {
  type: "function",
  function: {
    name: "weekly_commitment_status",
    description: "Read the owner's saved weekly internal commitment checks: approved schedule, last verified run, exceptions and next run. Does not create, authorize, edit, resume or run checks. A missing or unknown outcome is not completion.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
} as const;

type CallerDb = { rpc(name: string): PromiseLike<{ data: unknown; error: unknown }> };
export async function readWeeklyCommitmentStatus(callerJwtDb: CallerDb): Promise<
  { status: "available"; source: "canonical_process_and_act_receipts"; checks: unknown }
  | { status: "unavailable"; reason: "canonical_read_failed" }
> {
  try {
    const { data, error } = await callerJwtDb.rpc("get_weekly_commitment_checks");
    const value = data != null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
    if (error || value?.ok !== true || value.scope !== "personal_planning_commitments" || !Array.isArray(value.checks)) {
      return { status: "unavailable", reason: "canonical_read_failed" };
    }
    return { status: "available", source: "canonical_process_and_act_receipts", checks: data };
  } catch {
    return { status: "unavailable", reason: "canonical_read_failed" };
  }
}
