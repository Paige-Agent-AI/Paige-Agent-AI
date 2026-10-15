import type { MissionRpcPort } from "../business-mission-tenant-brain.ts";
import { validMissionTarget, type MissionTarget } from "./contract.ts";

export type MissionTargetTool = "mission_target_save" | "mission_target_transition";
type Recorder = (run: { tenantId: string; actorId: string; capabilityKey: MissionTargetTool; outcome: "capability_succeeded"; runId: string }) => Promise<boolean>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const revision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (object(v)) return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v) ?? "null";
};
const code = (error: { message?: string } | null, fallback: string) => error?.message?.match(/\b(?:MISSION_[A-Z_]+|ANALYTICS_[A-Z_]+|ACTIVE_ACCOUNT_CHANGED)\b/)?.[0] ?? fallback;

/** Domain readback adapter for the existing native mission door, not an authority or approval engine. */
export async function executeVerifiedMissionTargetMutation(input: {
  caller: MissionRpcPort; expectedTenantId: string; actorId: string;
  tool: MissionTargetTool; args: Record<string, unknown>; recordRun: Recorder;
}): Promise<Record<string, unknown>> {
  const fail = (message: string, mayHavePersisted = false) => ({ success: false, verified: false, code: message, mutationMayHavePersisted: mayHavePersisted });
  const a = input.args;
  const keys = ["request_key", "mission_id", "expected_mission_revision", "target_id", "expected_target_revision", "reason",
    ...(input.tool === "mission_target_save" ? ["definition", "metric_evidence_ref"] : ["to_state"])];
  if (!uuid(a.request_key) || !uuid(a.mission_id) || !revision(a.expected_mission_revision)
    || !uuid(input.expectedTenantId) || !uuid(input.actorId)
    || typeof a.reason !== "string" || !a.reason.trim() || a.reason.trim().length > 1200
    || (a.target_id == null ? a.expected_target_revision != null : !uuid(a.target_id) || !revision(a.expected_target_revision))
    || (input.tool === "mission_target_transition" && (!uuid(a.target_id) || !["active", "paused", "retired"].includes(String(a.to_state))))
    || (input.tool === "mission_target_save" && (!object(a.definition) || typeof a.metric_evidence_ref !== "string" || !/^aneb_v1_[0-9a-f]{64}$/.test(a.metric_evidence_ref)))
    || Object.keys(a).some(k => !keys.includes(k))) return fail("MISSION_TARGET_ARGUMENTS_INVALID");
  const ownsScope = async () => {
    const r = await input.caller.rpc("current_user_tenant_id", {});
    return !r.error && r.data === input.expectedTenantId;
  };
  try { if (!await ownsScope()) return fail("ACTIVE_ACCOUNT_CHANGED"); }
  catch { return fail("MISSION_TENANT_NOT_RESOLVED"); }
  // Existing owner-scoped canonical reader. It checks current ownership even for a receipt replay.
  try {
    const selected = await input.caller.rpc("get_business_mission", { p_mission_id: a.mission_id });
    if (selected.error) return fail(code(selected.error, "MISSION_READ_FAILED"));
    if (!object(selected.data) || !object(selected.data.mission) || selected.data.mission.id !== a.mission_id) return fail("MISSION_READBACK_INVALID");
    if (!await ownsScope()) return fail("ACTIVE_ACCOUNT_CHANGED");
  } catch { return fail("MISSION_READ_OUTCOME_UNKNOWN"); }
  const common = { p_request_key: a.request_key, p_mission_id: a.mission_id, p_expected_mission_revision: a.expected_mission_revision,
    p_target_id: a.target_id ?? null, p_expected_target_revision: a.expected_target_revision ?? null, p_reason: a.reason };
  const writer = input.tool === "mission_target_save"
    ? { name: "save_business_mission_target", args: { ...common, p_definition: a.definition, p_metric_evidence_ref: a.metric_evidence_ref } }
    : { name: "transition_business_mission_target", args: { ...common, p_to_state: a.to_state } };
  let result: Record<string, unknown>;
  try {
    const write = await input.caller.rpc(writer.name, writer.args);
    if (write.error) {
      // PostgREST also returns network/gateway failures through `error` rather
      // than throwing. Only a transaction-aborting PostgreSQL SQLSTATE proves
      // refusal; otherwise preserve the same request for receipt reconciliation.
      const sqlState = (write.error as { code?: unknown }).code;
      const refused = typeof sqlState === "string" && /^(?:22|23|40|42|P0)[0-9A-Z]{3}$/.test(sqlState);
      return refused ? fail(code(write.error, "MISSION_TARGET_WRITE_FAILED"))
        : fail("MISSION_TARGET_WRITE_OUTCOME_UNKNOWN", true);
    }
    if (!object(write.data)) return fail("MISSION_TARGET_WRITE_RESULT_INVALID", true);
    result = write.data;
  } catch { return fail("MISSION_TARGET_WRITE_OUTCOME_UNKNOWN", true); }
  if (result.ok !== true || result.mission_id !== a.mission_id || !uuid(result.target_id)
    || !uuid(result.receipt_id) || result.request_key !== a.request_key
    || !revision(result.revision) || (a.target_id != null && result.target_id !== a.target_id)
    || result.revision !== (a.target_id == null ? 1 : Number(a.expected_target_revision) + 1)) return fail("MISSION_TARGET_WRITE_RESULT_INVALID", true);
  let target: MissionTarget;
  const operation = input.tool === "mission_target_transition" ? "target_transition" : a.target_id == null ? "target_create" : "target_revise";
  try {
    if (!await ownsScope()) return fail("ACTIVE_ACCOUNT_CHANGED", true);
    // Exact immutable revision permits truthful same-request reconciliation after later edits.
    // Reading only the latest would falsely turn a committed replay into an unverified failure.
    const read = await input.caller.rpc("get_business_mission_target_revision", { p_target_id: result.target_id, p_revision: result.revision });
    if (read.error) return fail(code(read.error, "MISSION_TARGET_READ_FAILED"), true);
    if (!object(read.data)) return fail("MISSION_TARGET_READBACK_INVALID", true);
    target = read.data as unknown as MissionTarget;
    if (!validMissionTarget(target) || target.tenant_id !== input.expectedTenantId || target.id !== result.target_id
      || target.mission_id !== a.mission_id || target.revision !== result.revision || target.state !== result.state) return fail("MISSION_TARGET_READBACK_MISMATCH", true);
    if (input.tool === "mission_target_save") {
      if (!object(a.definition)) return fail("MISSION_TARGET_READBACK_MISMATCH", true);
      const definition = { ...a.definition, title: typeof a.definition.title === "string" ? a.definition.title.trim() : a.definition.title };
      const stored = { title: target.title, metric: target.metric, period: target.period, comparison: target.comparison,
        desired_value: target.desired_value, upper_value: target.upper_value };
      if (stable(stored) !== stable(definition)) return fail("MISSION_TARGET_READBACK_MISMATCH", true);
    } else if (target.state !== a.to_state) return fail("MISSION_TARGET_READBACK_MISMATCH", true);
    const receipt = await input.caller.rpc("get_business_mission_target_receipt", { p_request_key: a.request_key });
    if (receipt.error || !object(receipt.data) || receipt.data.id !== result.receipt_id
      || receipt.data.request_key !== a.request_key || receipt.data.mission_id !== a.mission_id || receipt.data.operation !== operation
      || !object(receipt.data.result) || receipt.data.result.target_id !== target.id
      || receipt.data.result.revision !== target.revision || receipt.data.result.state !== target.state
      || receipt.data.result.receipt_id !== result.receipt_id || receipt.data.result.request_key !== a.request_key) return fail("MISSION_TARGET_RECEIPT_UNVERIFIED", true);
    if (!await ownsScope()) return fail("ACTIVE_ACCOUNT_CHANGED", true);
  } catch { return fail("MISSION_TARGET_READ_OUTCOME_UNKNOWN", true); }
  let railRecorded = false;
  try {
    railRecorded = await input.recordRun({ tenantId: input.expectedTenantId, actorId: input.actorId,
      capabilityKey: input.tool, outcome: "capability_succeeded", runId: a.request_key });
  } catch { /* The canonical write is verified; a Rail outage must not invite a second intent. */ }
  return { success: true, verified: true, replayed: result.replayed === true, railRecorded,
    target, receipt: { id: result.receipt_id, requestKey: a.request_key, revision: target.revision, operation },
    note: railRecorded ? "Target revision saved and verified; activity recorded. Actual performance is read separately."
      : "Target revision saved and verified. Its activity record could not be confirmed; reconcile the same request. Actual performance is read separately." };
}
