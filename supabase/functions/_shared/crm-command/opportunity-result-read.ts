import { resolveWorkspaceAuthority } from "../workspace-authority.ts";
import { isSoloStandalone } from "../solo-classification.ts";

// Domain read beneath the existing authenticated CRM door, not a writer,
// approval or receipt store. actorId must come from that door's getUser().
type QueryResult = { data: unknown; error: unknown };
interface ReadQuery {
  select(columns: string): ReadQuery;
  eq(field: string, value: unknown): ReadQuery;
  maybeSingle(): PromiseLike<QueryResult>;
}
type Client = { from(table: string): ReadQuery; rpc(name: string): PromiseLike<QueryResult> };
type Answer = { status: number; body: Record<string, unknown> };
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown): string | null => typeof v === "string" && v.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const unavailable = (): Answer => ({ status: 503, body: { ok: false, outcome: "unavailable", code: "CRM_RESULT_UNAVAILABLE" } });
const refused = (): Answer => ({ status: 403, body: { ok: false, outcome: "refused", code: "CRM_RESULT_FORBIDDEN" } });
const notFound = (): Answer => ({ status: 404, body: { ok: false, outcome: "not_found", code: "CRM_RESULT_NOT_FOUND" } });

export async function inspectOpportunityResult(input: {
  raw: unknown; actorId: string; caller: Client; admin: Client;
}): Promise<Answer> {
  const raw = object(input.raw), requested = object(raw?.inspect_opportunity_result);
  const tenantId = uuid(raw?.expected_tenant_id), actorId = uuid(input.actorId);
  const dealId = uuid(requested?.deal_id), correlationId = uuid(requested?.correlation_id);
  if (!raw || !requested || !tenantId || !actorId || !dealId || !correlationId
    || !exactKeys(raw, ["expected_tenant_id", "inspect_opportunity_result"])
    || !exactKeys(requested, ["deal_id", "correlation_id"])) {
    return { status: 400, body: { ok: false, outcome: "refused", code: "CRM_RESULT_REQUEST_INVALID" } };
  }
  const { caller, admin } = input;
  const permitted = async () => {
    // The shared resolver supplies current active workspace and original door
    // seat semantics. A global role or agency management alone is not a seat.
    const authority = await resolveWorkspaceAuthority(caller, admin, actorId, tenantId);
    if (!authority.seat) return false;
    const { data, error } = await admin.from("tenants")
      .select("id,status,account_type,parent_tenant_id,account_number").eq("id", tenantId).maybeSingle();
    const tenant = object(data);
    return !error && tenant?.id === tenantId && typeof tenant.account_type === "string"
      && tenant.parent_tenant_id === null && isSoloStandalone({ account_type: tenant.account_type, parent_tenant_id: null })
      && Number.isInteger(tenant.account_number) && Number(tenant.account_number) > 0
      && typeof tenant.status === "string" && ["trial", "active", "past_due"].includes(tenant.status);
  };
  const currentDeal = async () => {
    // Keep the actual caller's RLS in the path; a saved locator grants no read.
    const { data: rawDeal, error } = await caller.from("deals").select("id,version")
      .eq("tenant_id", tenantId).eq("id", dealId).maybeSingle();
    const data = object(rawDeal);
    return !error && data?.id === dealId && Number.isInteger(data.version) && Number(data.version) >= 1
      ? { id: data.id, version: Number(data.version) } : null;
  };
  try {
    if (!(await permitted())) return refused();
    if (!(await currentDeal())) return notFound();
    const { data, error } = await admin.from("crm_command_results")
      .select("action,result,created_at").eq("tenant_id", tenantId).eq("actor_user_id", actorId)
      .eq("action", "deal.update").eq("result->>correlation_id", correlationId).maybeSingle();
    if (error) return unavailable();
    const stored = object(data);
    const result = object(stored?.result), readback = object(result?.readback);
    const current = await currentDeal();
    if (!(await permitted())) return refused();
    if (!current) return notFound();
    if (!stored) return notFound();
    if (stored.action !== "deal.update" || result?.action !== "deal.update" || result.ok !== true
      || result.outcome !== "succeeded" || result.receipt_recorded !== true
      || uuid(result.correlation_id) !== correlationId || uuid(readback?.id) !== dealId
      || !Number.isInteger(readback?.version) || Number(readback?.version) < 1
      || current.version < Number(readback?.version) || readback?.absent === true
      || typeof stored.created_at !== "string" || !Number.isFinite(Date.parse(stored.created_at))) return unavailable();
    // Only the original immutable receipt identity/version/time cross this
    // boundary. No private words, command, request key or approval is returned.
    return { status: 200, body: { ok: true, outcome: "recorded", receipt: {
      action: "deal.update", correlation_id: correlationId, record_id: dealId,
      recorded_at: stored.created_at, result_version: readback!.version,
    }, current_version: current.version } };
  } catch { return unavailable(); }
}
