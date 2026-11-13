/** Pure contract for the existing tenant Zapier Workflow API connection.
 * No transport, secrets, approval, persistence or execution authority lives here.
 * Grounded in api.zapier.com/schema, inspected 2026-11-11 (2026.10.0).
 * Callers must use the original Work/Trust claim and verify actual granted scopes.
 */
type ObjectValue = Record<string, unknown>;
export type ZapierWorkflowOperation = "list" | "create" | "update" | "pause" | "resume" | "history" | "apps" | "actions" | "connections";
export type ZapierWorkflowRequest = Readonly<{
  method: "GET" | "POST" | "PATCH";
  path: string;
  requiredScope: string;
  effect: "read" | "write" | "may_enable";
  body?: string;
}>;

const invalid = (): never => { throw new Error("zapier_workflow_invalid_arguments"); };
const READ_ONLY_SCOPES = Object.freeze(["profile", "zap:account:all"]);
const WORKFLOW_SCOPES = Object.freeze([...READ_ONLY_SCOPES, "zap", "zap:write", "zap:update", "zap:pause", "zap:runs", "connection:read"]);

/** Selecting a profile does not authorize it. The original OAuth attempt must
 * store this server-selected list before redirect; completion/refresh must use
 * that stored request or previous grant, never fresh callback/model arguments.
 */
export function zapierAuthorizationScopes(profile: string = "read_only"): readonly string[] {
  if (profile === "read_only") return READ_ONLY_SCOPES;
  if (profile === "workflow_management") return WORKFLOW_SCOPES;
  return invalid();
}

export function validateZapierGrantScopes(returnedScope: unknown, originalRequested: readonly string[]): string[] {
  if (!Array.isArray(originalRequested) || originalRequested.some(scope => typeof scope !== "string")) return invalid();
  const requested = [...originalRequested].sort();
  const same = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((scope, i) => scope === right[i]);
  if (![READ_ONLY_SCOPES, WORKFLOW_SCOPES].some(profile => same([...profile].sort(), requested))) return invalid();
  // RFC 6749: omitted scope means the scope of the original request. This is safe
  // only because the caller supplies that exact stored, validated request here.
  if (returnedScope === undefined) return requested;
  if (typeof returnedScope !== "string" || returnedScope.length > 2000) return invalid();
  const granted = [...new Set(returnedScope.trim().split(/\s+/).filter(Boolean))].sort();
  if (!same(granted, requested)) return invalid();
  return granted;
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  return value as ObjectValue;
}
function keys(value: ObjectValue, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value)) return invalid();
  return value;
}
function title(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200
    || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return invalid();
  return value;
}
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 20) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1); return; }
  for (const item of Object.values(object(value))) jsonValue(item, depth + 1);
}
function steps(value: unknown): ObjectValue[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) return invalid();
  const aliases = new Set<string>();
  return value.map(raw => {
    const step = object(raw);
    keys(step, ["action", "authentication", "inputs", "alias"]);
    const action = identifier(step.action);
    const authentication = step.authentication === null ? null : identifier(step.authentication);
    const inputs = object(step.inputs);
    jsonValue(inputs);
    const result: ObjectValue = { action, authentication, inputs };
    if (step.alias !== undefined) {
      if (step.alias !== null && (typeof step.alias !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(step.alias) || aliases.has(step.alias))) invalid();
      if (typeof step.alias === "string") aliases.add(step.alias);
      result.alias = step.alias;
    }
    return result;
  });
}
function page(input: ObjectValue): URLSearchParams {
  const limit = input.limit ?? 25, offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100
    || !Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 10000) invalid();
  return new URLSearchParams({ limit: String(limit), offset: String(offset) });
}
function request(method: ZapierWorkflowRequest["method"], path: string, requiredScope: string,
  effect: ZapierWorkflowRequest["effect"], data?: ObjectValue): ZapierWorkflowRequest {
  const body = data === undefined ? undefined : JSON.stringify({ data });
  if (body !== undefined && new TextEncoder().encode(body).byteLength > 64 * 1024) invalid();
  return Object.freeze({ method, path, requiredScope, effect, ...(body === undefined ? {} : { body }) });
}

/** Returns bounded, captured request bytes, not permission to send them. There is
 * deliberately no draft-save operation: Classic Zap creation can enable triggers.
 * A step PATCH publishes/enables even a paused Zap. Only original exact Trust
 * approval may authorize those effects; a confirm flag in model input grants none.
 */
export function prepareZapierWorkflowRequest(operation: string, raw: unknown): ZapierWorkflowRequest {
  const input = object(raw);
  if (operation === "list") {
    keys(input, ["limit", "offset"]);
    const query = page(input); query.set("include_shared", "false"); query.set("expand", "steps");
    return request("GET", `/v2/zaps?${query}`, "zap:account:all", "read");
  }
  if (operation === "apps") {
    keys(input, ["query", "limit", "offset"]);
    const query = page(input);
    if (input.query !== undefined) query.set("query", title(input.query));
    return request("GET", `/v2/apps?${query}`, "zap", "read");
  }
  if (operation === "actions" || operation === "connections") {
    keys(input, operation === "actions" ? ["app"] : ["app", "limit", "offset"]);
    const query = operation === "connections" ? page(input) : new URLSearchParams();
    query.set("app", identifier(input.app));
    return request("GET", `/v2/${operation === "actions" ? "actions" : "authentications"}?${query}`,
      operation === "actions" ? "zap" : "connection:read", "read");
  }
  if (operation === "create") {
    keys(input, ["title", "steps"]);
    return request("POST", "/v2/zaps", "zap:write", "may_enable", { title: title(input.title), steps: steps(input.steps) });
  }
  if (operation === "update") {
    keys(input, ["workflow_id", "title", "steps"]);
    const id = identifier(input.workflow_id), data: ObjectValue = {};
    if (input.title !== undefined) data.title = title(input.title);
    if (input.steps !== undefined) data.steps = steps(input.steps);
    if (!Object.keys(data).length) return invalid();
    return request("PATCH", `/v2/zaps/${id}`, "zap:update", input.steps === undefined ? "write" : "may_enable", data);
  }
  if (operation === "pause" || operation === "resume") {
    keys(input, ["workflow_id"]);
    return request("POST", `/v2/zaps/${identifier(input.workflow_id)}/${operation === "pause" ? "disable" : "enable"}`,
      "zap:pause", operation === "pause" ? "write" : "may_enable");
  }
  if (operation === "history") {
    keys(input, ["workflow_id", "limit", "offset"]);
    const id = identifier(input.workflow_id);
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) return invalid();
    const query = page(input); query.set("zap_id", id);
    return request("GET", `/v2/zap-runs?${query}`, "zap:runs", "read");
  }
  return invalid();
}

const responseInvalid = (): never => { throw new Error("zapier_workflow_response_invalid"); };
function observedTime(value: unknown, optional = false): string | null {
  if (value === null || (optional && value === undefined)) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)
    || !Number.isFinite(Date.parse(value))) return responseInvalid();
  return new Date(value).toISOString();
}
function observedWorkflow(raw: unknown): ObjectValue {
  const row = object(raw);
  const id = identifier(row.id);
  if (row.type !== "zap" || typeof row.is_enabled !== "boolean") return responseInvalid();
  return { id, title: title(row.title), is_enabled: row.is_enabled, updated_at: observedTime(row.updated_at) };
}
const RUN_STATES = new Set(["delayed", "scheduled", "pending", "error", "error_handled", "halted", "throttled", "held", "filtered", "skipped", "success"]);

/** Closed metadata only. This cannot establish that the GHL contact/tags exist:
 * original domain readback and Rail settlement must do that separately. Provider
 * input/output, URLs, errors and nested prose are never forwarded as model context.
 */
export function projectZapierWorkflowResponse(operation: string, raw: unknown, expectedWorkflowId?: string, expectedAppId?: string): ObjectValue {
  if (operation === "pause" || operation === "resume") {
    return { status: "acknowledged", workflow_id: identifier(expectedWorkflowId), verified: false, onboarding_completed: null };
  }
  if (operation === "create" || operation === "update") {
    const workflow = observedWorkflow(raw);
    if ((operation === "update" && expectedWorkflowId === undefined)
      || (expectedWorkflowId !== undefined && workflow.id !== expectedWorkflowId)) return responseInvalid();
    return { status: "observed", workflow, onboarding_completed: null, source_is_untrusted: true };
  }
  if (["apps", "actions", "connections", "list", "history"].includes(operation)) {
    // Zap and run-history OpenAPI responses wrap their page in an array. Some
    // versions return the page directly; accept exactly those bounded shapes.
    if (Array.isArray(raw)) {
      if (raw.length !== 1) return responseInvalid();
      raw = raw[0];
    }
    const envelope = object(raw);
    if (!Array.isArray(envelope.data) || envelope.data.length > 100) return responseInvalid();
    const meta = envelope.meta === undefined ? {} : object(envelope.meta);
    const total = Number.isSafeInteger(meta.count) && Number(meta.count) >= envelope.data.length ? Number(meta.count) : null;
    if (["apps", "actions", "connections"].includes(operation)) {
      const appId = (value: unknown) => typeof value === "string" ? identifier(value) : identifier(object(value).id);
      const items = envelope.data.map(value => {
        const row = object(value), id = identifier(row.id);
        if (operation === "apps") {
          if (row.type !== "app") return responseInvalid();
          return { id, title: title(row.title) };
        }
        const app = appId(row.app);
        if (!expectedAppId || app !== expectedAppId) return responseInvalid();
        if (operation === "connections") {
          if (row.type !== "authentication" || typeof row.is_expired !== "boolean") return responseInvalid();
          return { id, app_id: app, title: title(row.title), is_expired: row.is_expired };
        }
        if (row.type !== "action" || typeof row.is_instant !== "boolean" || typeof row.action_type !== "string"
          || !["READ", "READ_BULK", "WRITE", "SEARCH", "SEARCH_OR_WRITE", "SEARCH_AND_WRITE", "FILTER"].includes(row.action_type)) return responseInvalid();
        return { id, app_id: app, title: title(row.title), action_type: row.action_type, is_instant: row.is_instant };
      });
      return { status: "observed", items, total_count: total, source_is_untrusted: true, onboarding_completed: null };
    }
    if (operation === "list") {
      const links = envelope.links === undefined ? {} : object(envelope.links);
      return { status: "observed", workflows: envelope.data.map(observedWorkflow), total_count: total,
        inventory_complete: meta.offset === 0 && total === envelope.data.length
          && links.next === null && links.prev === null, source_is_untrusted: true };
    }
    const expected = identifier(expectedWorkflowId);
    const runs = envelope.data.map(value => {
      const row = object(value);
      if (!Number.isSafeInteger(row.zap_id) || String(row.zap_id) !== expected
        || typeof row.status !== "string" || !RUN_STATES.has(row.status)) return responseInvalid();
      return { id: identifier(row.id), workflow_id: expected, status: row.status,
        started_at: observedTime(row.start_time, true), ended_at: observedTime(row.end_time, true) };
    });
    return { status: "observed", runs, total_count: total, onboarding_completed: null, source_is_untrusted: true };
  }
  return responseInvalid();
}
