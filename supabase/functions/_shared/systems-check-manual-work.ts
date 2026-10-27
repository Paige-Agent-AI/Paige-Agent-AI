// Private original-Systems adapter, not an HTTP entry point, drainer or authority
// engine. The original host's private purpose branch supplies its
// service client, registered original runners and bounded native cancellation
// scopes AFTER governed admission. Native RPCs remain the permission/lease issuer.
import { awaitSystemsCheckCapture, runSystemsCheck } from "./systems-check-runner.ts";
import type { RunSystemsCheckOptions } from "./systems-check-runner.ts";

export type ManualSystemsWorkResult = {
  workId: string;
  confirmation: "unconfirmed";
} | {
  workId: string;
  confirmation: "confirmed";
  workStatus: "succeeded";
  runId: string;
};

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
/** Shared transport shape only, never actor, lease or execution authority. */
export const isManualSystemsWorkId = uuid;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const counter = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
function oneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !record(data[0])) throw new Error("SYSTEMS_WORK_UNCONFIRMED");
  return data[0];
}

/** One native claim and at most one original unfiltered capture. A lost reply,
 * current-authority refusal, expired lease or interrupted write is unconfirmed,
 * never a fabricated persisted state or permission to retry. No key leaves here.
 * settlementSignal is invoked once AFTER capture awaiting ends: the host must
 * return a fresh bounded, non-aborted native scope, not the cancelled scan scope. */
export async function consumeManualSystemsCheckWork(options: {
  admin: RunSystemsCheckOptions["admin"];
  workId: string;
  captureSignal: AbortSignal;
  settlementSignal: () => AbortSignal;
}): Promise<ManualSystemsWorkResult> {
  const { admin, workId, captureSignal, settlementSignal } = options;
  if (!uuid(workId) || !(captureSignal instanceof AbortSignal) || typeof settlementSignal !== "function") {
    throw new Error("SYSTEMS_WORK_INTERNAL_CONTEXT_INVALID");
  }
  const unconfirmed: ManualSystemsWorkResult = { workId, confirmation: "unconfirmed" };
  let claim: Record<string, unknown>;
  try {
    const reply = await awaitSystemsCheckCapture(() => admin.rpc("_start_manual_systems_check_work", {
      p_work: workId,
    }).abortSignal(captureSignal), captureSignal, workId, "work_claim");
    if (reply.error) return unconfirmed;
    claim = oneRow(reply.data);
    const payload = claim.request_payload;
    if (Object.keys(claim).length !== 8 || claim.work_id !== workId || claim.work_status !== "claimed"
      || claim.attempt_count !== 1 || !uuid(claim.tenant_id) || !uuid(claim.initiating_user_id)
      || !(claim.thread_id === null || uuid(claim.thread_id))
      || typeof claim.server_idempotency_key !== "string" || !claim.server_idempotency_key
      || !record(payload) || Object.keys(payload).length !== 4 || payload.version !== 1
      || payload.scope !== "tenant" || payload.scan_flavor !== "manual" || payload.action_filing !== "none") return unconfirmed;
  } catch { return unconfirmed; }

  const key = claim.server_idempotency_key as string;
  try {
    await runSystemsCheck({
      admin, tenantId: claim.tenant_id as string, scanFlavor: "manual", scope: "tenant", actionFiling: "none",
      manualCaptureRunId: workId, manualCaptureSignal: captureSignal,
      manualCaptureCheckpoint: async () => {
        const reply = await admin.rpc("heartbeat_paige_durable_work", {
          _work_id: workId, _server_idempotency_key: key, _lease_seconds: 300,
        }).abortSignal(captureSignal);
        if (reply.error) throw new Error("SYSTEMS_WORK_UNCONFIRMED");
        const row = oneRow(reply.data);
        if (Object.keys(row).length !== 3 || row.work_status !== "claimed"
          || !counter(row.work_version) || !timestamp(row.work_lease_until)) throw new Error("SYSTEMS_WORK_UNCONFIRMED");
        return true;
      },
    });
  } catch {
    // The ORIGINAL native finalizer may still establish a completed source run
    // after interrupted awaiting. A partial/late write is not claimed rolled back.
  }
  try {
    const signal = settlementSignal();
    if (!(signal instanceof AbortSignal) || signal === captureSignal || signal.aborted) return unconfirmed;
    const reply = await awaitSystemsCheckCapture(() => admin.rpc("transition_paige_durable_work", {
      _work_id: workId, _server_idempotency_key: key, _new_status: "succeeded",
      // This is only the native request marker. The finalizer derives the actual
      // complete run/findings and original Rail receipt in its own transaction.
      _terminal_outcome: { verified_readback: true }, _reconciled: false,
    }).abortSignal(signal), signal, workId, "work_settlement");
    if (reply.error) return unconfirmed;
    const row = oneRow(reply.data);
    if (Object.keys(row).length !== 5 || row.work_status !== "succeeded" || row.work_attempt_count !== 1
      || !counter(row.work_version) || row.work_lease_until !== null || !timestamp(row.work_settled_at)) return unconfirmed;
    return { workId, confirmation: "confirmed", workStatus: "succeeded", runId: workId };
  } catch { return unconfirmed; }
}
