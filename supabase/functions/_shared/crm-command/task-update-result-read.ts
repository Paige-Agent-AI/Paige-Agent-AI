import { readOperationsTask, type OperationsTaskReadCaller } from "../operations-task-read.ts";
import { isSoloStandalone } from "../solo-classification.ts";
import { resolveWorkspaceAuthority } from "../workspace-authority.ts";
import type { OpportunityReadClient } from "./opportunity-result-read.ts";

const ACTION = "task.update";
const CAPABILITY = "crm_update_task";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown) =>
  typeof v === "string" && v.length === 36 && UUID.test(v) ? v.toLowerCase() : null;
const instant = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 64 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(v, key));
const refused = () => ({ status: 403, body: { ok: false, outcome: "refused", code: "CRM_RESULT_FORBIDDEN" } });
const notFound = () => ({ status: 404, body: { ok: false, outcome: "not_found", code: "CRM_RESULT_NOT_FOUND" } });
const unavailable = () => ({ status: 503, body: { ok: false, outcome: "unavailable", code: "CRM_RESULT_UNAVAILABLE" } });

/** Re-read one original internal task update. The authenticated CRM door owns caller identity. */
export async function inspectTaskUpdateReceipt({ raw, actorId: actor, caller, admin }: {
  raw: unknown;
  actorId: string;
  caller: OperationsTaskReadCaller;
  admin: OpportunityReadClient;
}) {
  const request = record(raw);
  const locator = record(request?.inspect_task_update_result);
  const actorId = uuid(actor);
  const tenantId = uuid(request?.expected_tenant_id);
  const taskId = uuid(locator?.task_id);
  const correlationId = uuid(locator?.correlation_id);
  if (!request || !locator || !actorId || !tenantId || !taskId || !correlationId
    || !only(request, ["expected_tenant_id", "inspect_task_update_result"]) || !only(locator, ["task_id", "correlation_id"])) {
    return { status: 400, body: { ok: false, outcome: "refused", code: "CRM_RESULT_REQUEST_INVALID" } };
  }

  const scope = {
    actorId, tenantId, workspaceId: tenantId, accountShape: "solo" as const,
    role: null, actAsClientId: null, scopeEpoch: 0,
  };
  const revalidateScope = async () => {
    const authority = await resolveWorkspaceAuthority(caller, admin, actorId, tenantId);
    if (!authority.seat) return false;
    const { data, error } = await admin.from("tenants")
      .select("id,status,account_type,parent_tenant_id,account_number").eq("id", tenantId).maybeSingle();
    const row = record(data);
    return !error && row?.id === tenantId && typeof row.account_type === "string" && row.parent_tenant_id === null
      && isSoloStandalone({ account_type: row.account_type, parent_tenant_id: null })
      && typeof row.account_number === "number" && Number.isSafeInteger(row.account_number) && row.account_number > 0
      && typeof row.status === "string" && ["trial", "active", "past_due"].includes(row.status);
  };
  const readTask = () => readOperationsTask(scope, { caller, currentIdentity: () => scope, revalidateScope }, { task_id: taskId });

  try {
    const initial = await readTask();
    if (initial.status === "refused") return refused();
    if (initial.status !== "available") return unavailable();
    if (!initial.found) return notFound();

    const [command, rail] = await Promise.all([
      admin.from("crm_command_results").select("actor_user_id,tenant_id,action,result")
        .eq("tenant_id", tenantId).eq("actor_user_id", actorId)
        .eq("action", ACTION).eq("result->>correlation_id", correlationId).maybeSingle(),
      admin.from("paige_workspace_events")
        .select("id,tenant_id,actor_id,source_kind,source_id,source_revision,capability_key,outcome,occurred_at,detail")
        .eq("tenant_id", tenantId).eq("actor_id", actorId).eq("source_kind", "capability_run")
        .eq("source_id", correlationId).eq("source_revision", 0)
        .eq("capability_key", CAPABILITY).eq("outcome", "capability_succeeded").maybeSingle(),
    ]);

    const current = await readTask();
    if (current.status === "refused") return refused();
    if (current.status !== "available" || command.error || rail.error) return unavailable();
    if (!current.found || command.data === null) return notFound();

    const stored = record(command.data), event = record(rail.data);
    const result = record(stored?.result), readback = record(result?.readback), detail = record(event?.detail);
    const receiptId = uuid(event?.id);
    if (!receiptId || stored?.actor_user_id !== actorId || stored?.tenant_id !== tenantId || stored.action !== ACTION
      || result?.ok !== true || result.outcome !== "succeeded" || result.action !== ACTION || result.receipt_recorded !== true
      || uuid(result.correlation_id) !== correlationId || uuid(readback?.id) !== taskId || readback?.absent === true
      || !instant(readback?.updated_at) || event?.actor_id !== actorId || event.tenant_id !== tenantId
      || event.source_kind !== "capability_run" || event.source_revision !== 0 || event.source_id !== correlationId
      || event.capability_key !== CAPABILITY || event.outcome !== "capability_succeeded" || !instant(event.occurred_at)
      || detail?.action !== ACTION || detail.record_kind !== "task" || uuid(detail.record_id) !== taskId) {
      return unavailable();
    }

    return { status: 200, body: { ok: true, outcome: "recorded", receipt: {
      id: receiptId, action: ACTION, correlation_id: correlationId, record_id: taskId,
      recorded_at: event.occurred_at, committed_updated_at: readback.updated_at,
    } } };
  } catch {
    return unavailable();
  }
}
