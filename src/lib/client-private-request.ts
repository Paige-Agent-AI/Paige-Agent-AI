import type { OwnerActionScope } from "@/hooks/useClientActionsOwner";

export type PrivateRequestScope = OwnerActionScope & { intent: string };
type Words = { title: string; body: string };
type ScopeArguments = { _expected_actor_id: string; _expected_tenant_id: string; _contact_id: string; _intent_id: string };
type PreparationArguments = ScopeArguments & { _title: string; _body: string };
type SavedRequest = {
  work_id: string; status: string; created_at: string; version: string;
  content_state: "prepared" | "changed" | "shared";
  title: string | null; body: string | null; customer_action_id: string | null;
};
export type PrivateRequestResult = {
  schema_version: 1; actor_id: string; tenant_id: string; contact_id: string; intent_id: string;
  found: boolean; request: SavedRequest | null; recipient_available: boolean;
  missing_is_rejection: false; read_at: string; replayed?: boolean;
};
const invalid = () => new Error("Saved private request could not be verified");
const uuid = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const timestamp = (x: unknown): x is string => typeof x === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const trim = (x: string) => x.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
const words = (x: unknown, max: number): x is string => typeof x === "string" && trim(x).length > 0 && [...x].length <= max;
function closed(row: Record<string, unknown>, fields: string[]) {
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(row, key))) throw invalid();
}
function checkOwnerScope(scope: OwnerActionScope) {
  if (![scope.actor, scope.tenant, scope.contact].every(uuid)) throw invalid();
}
function checkScope(scope: PrivateRequestScope) {
  checkOwnerScope(scope); if (!uuid(scope.intent)) throw invalid();
}
/** Closed DTO only, not authority or execution. Original native Auth/Work/CRM
 * checks still decide access. No network request, retry, store, or UI mount here.
 */
export function parsePrivateRequestResult(raw: unknown, scope: PrivateRequestScope, mode: "status" | "preparation"): PrivateRequestResult {
  checkScope(scope);
  if (!object(raw)) throw invalid();
  closed(raw, ["schema_version", "actor_id", "tenant_id", "contact_id", "intent_id", "found", "request",
    "recipient_available", "missing_is_rejection", "read_at", ...(mode === "preparation" ? ["replayed"] : [])]);
  if (raw.schema_version !== 1 || raw.actor_id !== scope.actor || raw.tenant_id !== scope.tenant
    || raw.contact_id !== scope.contact || raw.intent_id !== scope.intent || typeof raw.found !== "boolean"
    || typeof raw.recipient_available !== "boolean" || raw.missing_is_rejection !== false || !timestamp(raw.read_at)) throw invalid();
  if (mode === "preparation" && (!raw.found || typeof raw.replayed !== "boolean")) throw invalid();
  if (!raw.found) { if (raw.request !== null) throw invalid(); }
  else {
    const r = raw.request;
    if (!object(r)) throw invalid();
    closed(r, ["work_id", "status", "created_at", "version", "content_state", "title", "body", "customer_action_id"]);
    if (!uuid(r.work_id) || !timestamp(r.created_at) || !timestamp(r.version)
      || !["filed", "assigned", "drafting", "drafted", "pending_approval", "approved", "executing", "done", "blocked", "failed", "dismissed", "expired"].includes(String(r.status))) throw invalid();
    if (r.content_state === "prepared") {
      if (r.status !== "assigned" || r.customer_action_id !== null || !words(r.title, 160) || !words(r.body, 4000)) throw invalid();
    } else if (r.content_state === "changed" || r.content_state === "shared") {
      if (r.title !== null || r.body !== null || (r.content_state === "shared" ? !uuid(r.customer_action_id) : r.customer_action_id !== null)) throw invalid();
    } else throw invalid();
    if (mode === "preparation" && !raw.replayed && r.content_state !== "prepared") throw invalid();
  }
  // Preserve native version text, including microseconds. Never round it through
  // Date/toISOString before the future original compare-and-authorize handoff.
  return raw as unknown as PrivateRequestResult;
}
export function privateRequestArguments(scope: PrivateRequestScope): ScopeArguments;
export function privateRequestArguments(scope: PrivateRequestScope, value: Words): PreparationArguments;
export function privateRequestArguments(scope: PrivateRequestScope, value?: Words): ScopeArguments | PreparationArguments {
  checkScope(scope);
  const args = { _expected_actor_id: scope.actor, _expected_tenant_id: scope.tenant, _contact_id: scope.contact, _intent_id: scope.intent };
  if (value === undefined) return args;
  if (typeof value.title !== "string" || typeof value.body !== "string") throw invalid();
  const title = trim(value.title), body = trim(value.body);
  if (!words(title, 160) || !words(body, 4000)) throw invalid();
  return { ...args, _title: title, _body: body };
}
export type PrivateHistoryCursor = { created_at: string; work_id: string };
export type PrivateRequestHistory = {
  schema_version: 1; actor_id: string; tenant_id: string; contact_id: string;
  requests: { intent_id: string; request: SavedRequest }[];
  more: boolean; next_cursor: PrivateHistoryCursor | null; recipient_available: boolean;
  missing_is_rejection: false; read_at: string;
};
/** A native keyset projection over the same private Work, never a browser ledger.
 * Missing history is not proof a prior request was rejected or safe to repeat.
 */
export function parsePrivateRequestHistory(raw: unknown, scope: OwnerActionScope): PrivateRequestHistory {
  checkOwnerScope(scope);
  if (!object(raw)) throw invalid();
  closed(raw, ["schema_version", "actor_id", "tenant_id", "contact_id", "requests", "more", "next_cursor", "recipient_available", "missing_is_rejection", "read_at"]);
  if (raw.schema_version !== 1 || raw.actor_id !== scope.actor || raw.tenant_id !== scope.tenant || raw.contact_id !== scope.contact
    || !Array.isArray(raw.requests) || raw.requests.length > 20 || typeof raw.more !== "boolean"
    || typeof raw.recipient_available !== "boolean" || raw.missing_is_rejection !== false || !timestamp(raw.read_at)) throw invalid();
  const intents = new Set<string>(), work = new Set<string>();
  let last: SavedRequest | null = null;
  for (const item of raw.requests) {
    if (!object(item)) throw invalid();
    closed(item, ["intent_id", "request"]);
    if (!uuid(item.intent_id) || intents.has(item.intent_id)) throw invalid();
    const parsed = parsePrivateRequestResult({ schema_version: raw.schema_version, actor_id: raw.actor_id, tenant_id: raw.tenant_id,
      contact_id: raw.contact_id, intent_id: item.intent_id, found: true, request: item.request,
      recipient_available: raw.recipient_available, missing_is_rejection: raw.missing_is_rejection, read_at: raw.read_at },
    { ...scope, intent: item.intent_id }, "status");
    if (!parsed.request || work.has(parsed.request.work_id)) throw invalid();
    intents.add(item.intent_id); work.add(parsed.request.work_id); last = parsed.request;
  }
  if (raw.more) {
    if (raw.requests.length !== 20 || !last || !object(raw.next_cursor)) throw invalid();
    closed(raw.next_cursor, ["created_at", "work_id"]);
    if (raw.next_cursor.created_at !== last.created_at || raw.next_cursor.work_id !== last.work_id) throw invalid();
  } else if (raw.next_cursor !== null) throw invalid();
  return raw as unknown as PrivateRequestHistory;
}
export function privateHistoryArguments(scope: OwnerActionScope, cursor: PrivateHistoryCursor | null = null) {
  checkOwnerScope(scope);
  if (cursor !== null && (!timestamp(cursor.created_at) || !uuid(cursor.work_id))) throw invalid();
  return { _expected_actor_id: scope.actor, _expected_tenant_id: scope.tenant, _contact_id: scope.contact,
    _before_created_at: cursor?.created_at ?? null, _before_work_id: cursor?.work_id ?? null };
}
