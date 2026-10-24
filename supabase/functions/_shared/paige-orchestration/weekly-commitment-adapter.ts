import type { DispatchInput, DispatchResult } from "./adapters.ts";
import { stableRunId } from "../capability-record.ts";
import { actReceiptRunSeed } from "./outcomes.ts";

// One synchronous internal observation, through the existing claimed native act.
// The RPC validates the canonical process/event/act, current owner and approved revision;
// commits the private Planning snapshot, act outcome and minimized Rail receipt together.
// No provider, Planning mutation or schedule authority is available to this adapter.
async function call(input: DispatchInput, readback: boolean): Promise<DispatchResult> {
  if (input.subjectTable !== "paige_automations" || !input.eventId || !input.actId || !input.correlationRef) {
    return { outcome: "failed", error: "weekly_commitment_invalid_subject", detail: {} };
  }
  const args: Record<string, unknown> = {
    _automation_id: input.subjectId, _event_id: input.eventId,
    _act_id: input.actId, _correlation: input.correlationRef,
  };
  try {
    const receiptId = await stableRunId(actReceiptRunSeed(input.eventId, input.actId));
    if (!readback) args._receipt_id = receiptId;
    const { data, error } = await input.db.rpc(
      readback ? "read_weekly_commitment_check" : "execute_weekly_commitment_check", args,
    );
    // Only an explicit SQLSTATE is a definitive database rejection. A transport/server
    // error can arrive after commit: reconcile by the same occurrence, never invent failure.
    if (error) {
      const code = typeof error.code === "string" ? error.code : "";
      const definitive = !readback && /^(22|23|42|P0)/.test(code);
      return { outcome: definitive ? "failed" : "ambiguous", error: error.message ?? "weekly_commitment_rpc_error",
        detail: { reason: definitive ? "canonical_rejection" : "canonical_outcome_unconfirmed" } };
    }
    const value = data != null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const detail = value.detail != null && typeof value.detail === "object" && !Array.isArray(value.detail)
      ? value.detail as Record<string, unknown> : {};
    // The same original occurrence must own BOTH the committed observation and receipt.
    // A success-shaped response for another work identity never confirms this act.
    if (value.outcome === "executed" && detail.confirmed_via === "weekly_commitment_observation"
      && value.error === null && value.receipt_id === receiptId && detail.receipt_id === receiptId
      && detail.automation_id === input.subjectId && detail.event_id === input.eventId && detail.act_id === input.actId) {
      return { outcome: "executed", providerRef: null, detail, error: null };
    }
    if (value.outcome === "failed") return { outcome: "failed", providerRef: null, detail: { ...detail, proven_absent: false },
      error: typeof value.error === "string" ? value.error : "weekly_commitment_failed" };
    // Only the native no-observation result can admit original claim recovery.
    // Contradictory success/receipt/error metadata must not become retry permission.
    const provenAbsent = readback && value.outcome === "ambiguous" && value.error === "weekly_check_not_observed"
      && detail.proven_absent === true && value.receipt_id === undefined
      && detail.receipt_id === undefined && detail.confirmed_via === undefined;
    return { outcome: "ambiguous", providerRef: null,
      detail: { reason: "canonical_outcome_unconfirmed", proven_absent: provenAbsent }, error: null };
  } catch {
    return { outcome: "ambiguous", providerRef: null, detail: { reason: "canonical_transport_unknown" }, error: null };
  }
}

export const weeklyCommitmentExecutor = {
  capability: { id: "planning_weekly_commitment_check", effect: "read" as const },
  dispatch: (input: DispatchInput) => call(input, false),
  readback: (_providerRef: string | null, input: DispatchInput) => call(input, true),
};
