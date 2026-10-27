// Unregistered original-Systems consumer. The eventual canonical Gateway/Trust
// caller must supply its verified context and ORIGINAL bounded private dispatch.
// These ports are internal, never HTTP/model arguments or a new approval/runtime.
import { awaitSystemsCheckRequest, isManualSystemsWorkId as uuid } from "./systems-check-wait.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { DURABLE_JOB_STATES, type DurableJobState } from "./durable-job/mod.ts";

type Client = SupabaseClient;
export type ManualSystemsWork = {
  id: string; status: DurableJobState; createdAt: string; updatedAt: string; settledAt: string | null;
  /** Last stored owner-safe wording, not present worker liveness or instructions. */
  safeSummary: string | null;
};
export type ManualSystemsRequestContext = { actorId: string; tenantId: string; intentId: string; threadId: string | null };
export type ManualSystemsRequestResult = {
  readback: "unconfirmed";
  workId?: string;
} | {
  readback: "available";
  resumedExisting: boolean;
  /** A transport receipt only. False never proves absence of delivery/effect. */
  dispatchAcknowledged: boolean;
  work: ManualSystemsWork;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const state = (value: unknown): value is DurableJobState => typeof value === "string" && DURABLE_JOB_STATES.some(s => s === value);
const time = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function oneRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0])) throw new Error("SYSTEMS_WORK_REQUEST_UNCONFIRMED");
  return value[0];
}

/** One home for the ORIGINAL twelve-field caller-JWT Work projection. The native
 * reader owns current authority; this helper creates no eligibility or state. */
export async function readManualSystemsWork(caller: Client, workId: string, signal: AbortSignal): Promise<ManualSystemsWork | null> {
  const reply = await awaitSystemsCheckRequest(() => caller.rpc("get_paige_durable_work", { _work_id: workId }).abortSignal(signal), signal);
  if (reply.error) return null;
  const row = oneRow(reply.data);
  if (Object.keys(row).length !== 12 || row.work_id !== workId || row.capability_key !== "systems.check"
    || row.work_kind !== "systems_check" || !state(row.work_status) || row.attempt_count !== 1 || row.max_attempts !== 1
    || !(row.safe_summary === null || (typeof row.safe_summary === "string" && row.safe_summary.length <= 1_200))
    || !time(row.created_at) || !time(row.updated_at) || !(row.settled_at === null || time(row.settled_at))
    || (row.work_status === "succeeded" && !time(row.settled_at))) return null;
  return { id: workId, status: row.work_status, createdAt: row.created_at, updatedAt: row.updated_at, settledAt: row.settled_at, safeSummary: row.safe_summary };
}

/** No timers/retry/state store. The original host owns native cancellation scopes.
 * A resumed request ONLY reads its original Work, including claimed/prepared work;
 * native `claimed` alone does not establish that a scan started. Caller auth and
 * native current authority remain mandatory, not asserted by context field names. */
export async function prepareManualSystemsRequest(ports: {
  context: ManualSystemsRequestContext;
  caller: Client;
  admin: Client;
  requestSignal: AbortSignal;
  observationSignal: () => AbortSignal;
  dispatch: (workId: string, signal: AbortSignal) => PromiseLike<{ status: number }>;
}): Promise<ManualSystemsRequestResult> {
  const { context, caller, admin, requestSignal, observationSignal, dispatch } = ports;
  if (!record(context)) return { readback: "unconfirmed" };
  // A later host/workspace mutation cannot retarget the original request.
  const c = { actorId: context.actorId, tenantId: context.tenantId, intentId: context.intentId, threadId: context.threadId };
  if (!uuid(c.actorId) || !uuid(c.tenantId) || !uuid(c.intentId) || !(c.threadId === null || uuid(c.threadId))
    || !(requestSignal instanceof AbortSignal) || typeof observationSignal !== "function" || typeof dispatch !== "function") {
    return { readback: "unconfirmed" };
  }
  let workId: string, resumed: boolean;
  try {
    const user = await awaitSystemsCheckRequest(() => caller.auth.getUser(), requestSignal);
    if (user.error || user.data?.user?.id !== c.actorId) return { readback: "unconfirmed" };
    const reply = await awaitSystemsCheckRequest(() => admin.rpc("_create_manual_systems_check_work", {
      p_actor: c.actorId, p_tenant: c.tenantId, p_intent: c.intentId, p_thread: c.threadId,
    }).abortSignal(requestSignal), requestSignal);
    if (reply.error) return { readback: "unconfirmed" };
    const row = oneRow(reply.data);
    if (Object.keys(row).length !== 4 || !uuid(row.work_id) || !state(row.work_status)
      || !Number.isSafeInteger(row.work_version) || Number(row.work_version) < 1 || typeof row.resumed_existing !== "boolean"
      || (!row.resumed_existing && row.work_status !== "claimed")) return { readback: "unconfirmed" };
    workId = row.work_id; resumed = row.resumed_existing;
  } catch { return { readback: "unconfirmed" }; }

  let dispatchAcknowledged = false;
  if (!resumed) {
    try {
      const response = await awaitSystemsCheckRequest(() => dispatch(workId, requestSignal), requestSignal);
      dispatchAcknowledged = response.status === 202;
    } catch { /* A lost acknowledgement cannot justify another dispatch. */ }
  }
  try {
    const signal = observationSignal();
    if (!(signal instanceof AbortSignal) || signal === requestSignal || signal.aborted) return { readback: "unconfirmed", workId };
    const work = await readManualSystemsWork(caller, workId, signal);
    return work ? { readback: "available", resumedExisting: resumed, dispatchAcknowledged, work }
      : { readback: "unconfirmed", workId };
  } catch { return { readback: "unconfirmed", workId }; }
}
