import type { MissionTargetTool } from "../../supabase/functions/_shared/business-mission-targets/native";
import { validMissionTarget, type MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";
import type { TargetScope } from "./mission-target-client";

type Scope = Pick<TargetScope, "actorId" | "tenantId" | "missionId">;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type TargetAttempt = { version: 1; scope: Scope; tool: MissionTargetTool; args: Record<string, unknown> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const revision = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const scopeKey = (s: Scope) => [s.actorId, s.tenantId, s.missionId].every(uuid)
  ? `paige:mission-target-intent:${s.actorId}:${s.tenantId}:${s.missionId}` : null;
function validAttempt(value: unknown, scope: Scope): value is TargetAttempt {
  if (!scopeKey(scope) || !object(value) || value.version !== 1 || !object(value.scope) || !object(value.args)
    || value.scope.actorId !== scope.actorId || value.scope.tenantId !== scope.tenantId || value.scope.missionId !== scope.missionId
    || !["mission_target_save", "mission_target_transition"].includes(String(value.tool))) return false;
  const a = value.args;
  if (!uuid(a.request_key) || a.mission_id !== scope.missionId || !revision(a.expected_mission_revision)
    || typeof a.reason !== "string" || !a.reason.trim() || a.reason.length > 1200
    || (a.target_id == null ? a.expected_target_revision != null : !uuid(a.target_id) || !revision(a.expected_target_revision))) return false;
  const keys = ["request_key", "mission_id", "expected_mission_revision", "target_id", "expected_target_revision", "reason",
    ...(value.tool === "mission_target_save" ? ["definition", "metric_evidence_ref"] : ["to_state"])];
  if (Object.keys(a).some(k => !keys.includes(k))) return false;
  if (value.tool === "mission_target_transition") return uuid(a.target_id) && ["active", "paused", "retired"].includes(String(a.to_state));
  return object(a.definition) && typeof a.metric_evidence_ref === "string" && /^aneb_v1_[0-9a-f]{64}$/.test(a.metric_evidence_ref)
    && validMissionTarget({ ...a.definition, id: a.target_id ?? a.request_key, tenant_id: scope.tenantId, mission_id: scope.missionId,
      revision: a.expected_target_revision ?? 1, state: "active" } as unknown as MissionTarget);
}

/** The incumbent scoped sessionStorage pattern: ephemeral UI intent, never an execution/receipt store. */
export function readTargetAttempt(storage: StoragePort, scope: Scope): { kind: "absent" | "unavailable" } | { kind: "retained"; attempt: TargetAttempt } {
  try {
    const key = scopeKey(scope); if (!key) return { kind: "unavailable" };
    const raw = storage.getItem(key); if (raw === null) return { kind: "absent" };
    if (raw.length > 16000) return { kind: "unavailable" };
    const value: unknown = JSON.parse(raw);
    return validAttempt(value, scope) ? { kind: "retained", attempt: value } : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}

/** Readback must succeed before the writer. An unresolved original cannot acquire fresh CAS/key/args. */
export function retainTargetAttempt(storage: StoragePort, scope: Scope, attempt: TargetAttempt): boolean {
  try {
    const key = scopeKey(scope); if (!key || !validAttempt(attempt, scope)) return false;
    const previous = readTargetAttempt(storage, scope), raw = JSON.stringify(attempt);
    if (raw.length > 16000 || previous.kind === "unavailable"
      || previous.kind === "retained" && JSON.stringify(previous.attempt) !== raw) return false;
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch { return false; }
}

/** Caller uses only after a verified write/activity or definite refusal. Does not cancel a server request. */
export function settleTargetAttempt(storage: StoragePort, scope: Scope, requestKey: string): boolean {
  try {
    const key = scopeKey(scope); if (!key) return false;
    const previous = readTargetAttempt(storage, scope);
    if (previous.kind === "unavailable" || previous.kind === "retained" && previous.attempt.args.request_key !== requestKey) return false;
    storage.removeItem(key); return storage.getItem(key) === null;
  } catch { return false; }
}
