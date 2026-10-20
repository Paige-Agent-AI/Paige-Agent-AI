// Read-only integration handoff for the incumbent Chat/Live owners. This module is
// deliberately not admitted to any turn while INT-346 and rendered review are held.
// Caller must supply its authenticated JWT client; the RPC resolves current tenant
// and active owner itself. No service-role read, model-provided tenant or schedule control.
// Future model binding must use the existing Capability Kit and current admission.
// This handoff supplies only the caller-JWT reader, never a parallel tool declaration.

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
