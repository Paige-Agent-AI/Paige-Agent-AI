/** Caller-JWT reader/control for the existing native task process. No execution or retry authority. */
export type OwnerTaskScope = { actorId: string; tenantId: string; epoch: number };
type JsonObject = Record<string, unknown>;
type Response = { data: unknown; error: unknown; count?: number | null };
type Query = PromiseLike<Response> & {
  select(columns: string, options?: { count: "exact" }): Query; eq(key: string, value: unknown): Query;
  in(key: string, values: readonly string[]): Query; range(from: number, to: number): Query;
  order(key: string, options?: { ascending: boolean }): Query; limit(count: number): Query; maybeSingle(): Query;
};
export type OwnerTaskCaller = {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  from(table: string): Query;
  rpc(name: string, args?: JsonObject): PromiseLike<Response>;
};
export type OwnerTaskReview = { id: string; updatedAt: string; process: JsonObject; acts: JsonObject[] };
export type OwnerTaskRead = { status: "ready"; items: OwnerTaskReview[]; hasMore: boolean }
  | { status: "loading" | "refused" | "unavailable" };
export type OwnerTaskControl = { status: "saved"; state: "live" | "paused" }
  | { status: "refused" | "stale" | "busy" | "unsupported" | "unavailable" | "unknown" };
const PROCESS_KEYS = ["id", "tenant_id", "name", "category", "trigger_key", "trigger_config", "conditions", "created_by", "state", "granted_lane", "owner_task_armed_at"] as const;
const object = (v: unknown): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
const instant = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => object(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
function matches(scope: OwnerTaskScope, current: () => OwnerTaskScope | null) {
  const now = current(); return now?.actorId === scope.actorId && now.tenantId === scope.tenantId && now.epoch === scope.epoch;
}
class DeadlineExpired extends Error {}
class ScopeChanged extends Error {}
function operationDeadline(scope: OwnerTaskScope, current: () => OwnerTaskScope | null) {
  const expires = performance.now() + 8_000;
  const check = () => {
    if (!matches(scope, current)) throw new ScopeChanged();
    if (performance.now() >= expires) throw new DeadlineExpired();
  };
  return {
    check,
    wait<T>(start: () => PromiseLike<T>): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (result: { value: T } | { error: unknown }) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if ("error" in result) reject(result.error); else resolve(result.value);
        };
        const timer = setTimeout(() => finish({ error: matches(scope, current) ? new DeadlineExpired() : new ScopeChanged() }), Math.max(0, expires - performance.now()));
        // Bound EACH awaited stage. A late preflight resolution can never resume
        // an outer workflow and start a mutation after its deadline has expired.
        Promise.resolve().then(() => { check(); return start(); }).then(value => {
          if (settled) return;
          try { check(); finish({ value }); } catch (error) { finish({ error }); }
        }, error => finish({ error }));
      });
    },
  };
}
type Deadline = ReturnType<typeof operationDeadline>;
async function authority(scope: OwnerTaskScope, caller: OwnerTaskCaller, current: () => OwnerTaskScope | null, deadline: Deadline): Promise<"ready" | "refused" | "unavailable"> {
  if (!matches(scope, current)) return "refused";
  const user = await deadline.wait(() => caller.auth.getUser());
  if (!matches(scope, current) || user.error || user.data.user?.id !== scope.actorId) return "refused";
  const tenant = await deadline.wait(() => caller.rpc("current_user_tenant_id"));
  if (!matches(scope, current)) return "refused";
  if (tenant.error) return "unavailable";
  if (tenant.data !== scope.tenantId) return "refused";
  const seat = await deadline.wait(() => caller.from("tenant_members").select("role,status").eq("tenant_id", scope.tenantId).eq("user_id", scope.actorId).maybeSingle());
  if (!matches(scope, current)) return "refused";
  if (seat.error) return "unavailable";
  return object(seat.data) && seat.data.status === "active" && ["owner", "admin"].includes(String(seat.data.role)) ? "ready" : "refused";
}
export async function readOwnerTaskAutomations(scope: OwnerTaskScope, caller: OwnerTaskCaller, current: () => OwnerTaskScope | null): Promise<OwnerTaskRead> {
  const deadline = operationDeadline(scope, current);
  try {
    const admitted = await authority(scope, caller, current, deadline);
    if (admitted !== "ready") return { status: admitted };
    const rows = await deadline.wait(() => caller.from("paige_automations").select([...PROCESS_KEYS, "updated_at"].join(","))
      .eq("tenant_id", scope.tenantId).eq("trigger_key", "contact.created").order("created_at", { ascending: false }).limit(51));
    if (!matches(scope, current)) return { status: "refused" };
    if (rows.error || !Array.isArray(rows.data)) return { status: "unavailable" };
    const inspected: JsonObject[] = [];
    const processIds = new Set<string>();
    for (const row of rows.data.slice(0, 50)) {
      if (!object(row) || row.tenant_id !== scope.tenantId || row.trigger_key !== "contact.created" ||
        typeof row.id !== "string" || processIds.has(row.id) || typeof row.name !== "string" || !instant(row.updated_at) || PROCESS_KEYS.some(k => !(k in row))) return { status: "unavailable" };
      processIds.add(row.id); inspected.push(row);
    }
    const acts = new Map<string, JsonObject[]>([...processIds].map(id => [id, []]));
    const actIds = new Set<string>();
    let received = 0, expected: number | null = null;
    // One batch for ordinary lists. Exact count + ordered pages prevent an API
    // row cap from silently turning a partial process into a complete review.
    while (processIds.size && (expected === null || received < expected)) {
      const result = await deadline.wait(() => caller.from("paige_automation_acts")
        .select("id,automation_id,position,action_kind,tool_key,config", { count: "exact" })
        .in("automation_id", [...processIds]).order("automation_id", { ascending: true })
        .order("position", { ascending: true }).order("id", { ascending: true }).range(received, received + 199));
      if (!matches(scope, current)) return { status: "refused" };
      if (result.error || !Array.isArray(result.data) || typeof result.count !== "number" || !Number.isSafeInteger(result.count)
        || result.count < 0 || expected !== null && expected !== result.count || result.data.length > 200
        || received + result.data.length > result.count || !result.data.length && received < result.count) return { status: "unavailable" };
      expected = result.count;
      for (const a of result.data) {
        if (!object(a) || typeof a.automation_id !== "string" || !processIds.has(a.automation_id) || typeof a.id !== "string"
          || actIds.has(a.id) || !Number.isInteger(a.position) || !("config" in a)) return { status: "unavailable" };
        actIds.add(a.id); acts.get(a.automation_id)!.push(a);
      }
      received += result.data.length;
    }
    const items: OwnerTaskReview[] = inspected.flatMap(row => {
      const steps = acts.get(row.id as string)!;
      return steps.some(a => a.action_kind === "owner.task") ? [{ id: row.id as string, updatedAt: row.updated_at as string,
        process: Object.fromEntries(PROCESS_KEYS.map(k => [k, row[k]])),
        acts: steps.map(a => ({ id: a.id, position: a.position, action_kind: a.action_kind, tool_key: a.tool_key, config: a.config })) }] : [];
    });
    const after = await authority(scope, caller, current, deadline);
    deadline.check();
    return after === "ready" ? { status: "ready", items, hasMore: rows.data.length > 50 } : { status: after };
  } catch { return { status: matches(scope, current) ? "unavailable" : "refused" }; }
}
/** One deliberate human request. Ambiguous responses require inspection, never automatic replay. */
export async function controlOwnerTaskAutomation(scope: OwnerTaskScope, review: OwnerTaskReview, action: "arm" | "pause", caller: OwnerTaskCaller, current: () => OwnerTaskScope | null): Promise<OwnerTaskControl> {
  const deadline = operationDeadline(scope, current);
  let dispatched = false;
  try {
    if (review.process.tenant_id !== scope.tenantId || review.process.id !== review.id || !instant(review.updatedAt) ||
      !["arm", "pause"].includes(action)) return { status: "refused" };
    const admitted = await authority(scope, caller, current, deadline);
    if (admitted !== "ready") return { status: admitted };
    const result = await deadline.wait(() => {
      // The deadline rechecks this captured scope immediately before the sole
      // effect RPC. Once started, interruption means unknown, never a replay.
      dispatched = true;
      return caller.rpc("control_owner_task_automation", { _automation_id: review.id, _action: action,
        _expected_updated_at: review.updatedAt, _expected_process: review.process, _expected_acts: review.acts });
    });
    if (!matches(scope, current)) return { status: "refused" };
    if (result.error) {
      const code = object(result.error) ? result.error.code : null;
      return { status: code === "40001" ? "stale" : code === "55P03" ? "busy" : code === "42501" ? "refused" : code === "22023" ? "unsupported" : "unknown" };
    }
    const data = result.data, expected = action === "arm" ? "live" : "paused";
    const expectedGrant = action === "arm" ? "confirm" : review.process.granted_lane;
    if (!object(data) || data.automation_id !== review.id || data.state !== expected || data.granted_lane !== expectedGrant ||
      data.execution_started !== false || data.future_events_only !== true || typeof data.changed !== "boolean" ||
      !instant(data.updated_at) || !object(data.process) || !Array.isArray(data.acts) || canonical(data.acts) !== canonical(review.acts) ||
      data.process.state !== expected || data.process.granted_lane !== expectedGrant ||
      (action === "arm" ? !instant(data.armed_at) || data.process.owner_task_armed_at !== data.armed_at : data.armed_at !== null || data.process.owner_task_armed_at !== null) ||
      PROCESS_KEYS.filter(k => !["state", "granted_lane", "owner_task_armed_at"].includes(k)).some(k => canonical(data.process[k]) !== canonical(review.process[k]))) return { status: "unknown" };
    const after = await authority(scope, caller, current, deadline);
    deadline.check();
    return after === "ready" ? { status: "saved", state: expected } : { status: after === "refused" ? "refused" : "unknown" };
  } catch { return { status: matches(scope, current) ? dispatched ? "unknown" : "unavailable" : "refused" }; }
}
