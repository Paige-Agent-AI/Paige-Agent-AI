/** Domain adapter only. Upstream must use the existing governedExecution result,
 * real stored-proposal redemption and original operation identity. This module
 * produces none of those facts, no approval, deduplication store or Rail receipt.
 * Caller ports must use the actual caller JWT and canonical RLS, never service role.
 * Three creates are non-idempotent. Source verification is not client acceptance.
 */
export type PlanningScope = { actorId: string; tenantId: string };
export type PlanningCaller = {
  getScope(): Promise<PlanningScope | null>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  readRecord(table: 'plans' | 'plan_items', id: string, scope: PlanningScope): PromiseLike<{ data: unknown; error: unknown }>;
};
/** Structural view of the existing shared result, not another policy decision. */
export type PlanningDecision = { kind: string; args?: unknown; audit?: {
  capability: string; decision: string; effect: string; principal: string;
  userId: string | null; tenantId: string | null;
} };
export type PlanningWriteResult =
  | { outcome: 'source_verified'; operationIdentity: string; record: { table: 'plans' | 'plan_items'; id: string };
      readback: Record<string, unknown>; proofBoundary: 'planning_record_only'; retryAllowed: false }
  | { outcome: 'refused' | 'unavailable' | 'conflict' | 'unverified' | 'scope_changed';
      writeAttempted: boolean; retryAllowed: false; message: string };

const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object'
  && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) ? v as Record<string, unknown> : null;
const owns = (v: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const priorities = ['low', 'normal', 'high', 'urgent'];
const statuses = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];
function day(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const n = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v;
}
function instant(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 80) return false;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  return !!m && day(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60 && Number.isFinite(Date.parse(v));
}
/** Compare instants, retaining PostgreSQL's fractional precision, not business-zone policy. */
function sameInstant(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (!instant(a) || !instant(b)) return false;
  const fraction = (s: string) => (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(s)?.[1] ?? '').padEnd(6, '0');
  return Date.parse(a) === Date.parse(b) && fraction(a) === fraction(b);
}
class InvalidInput extends Error {}
function requireInput(ok: unknown): asserts ok { if (!ok) throw new InvalidInput(); }
function id(v: unknown): string { requireInput(uuid(v)); return v.toLowerCase(); }
function optionalId(v: unknown): string | null { return v == null ? null : id(v); }
function summary(v: unknown): string | null {
  requireInput(v == null || typeof v === 'string' && v.length <= 10000);
  return typeof v === 'string' ? v.trim() || null : null;
}
function due(v: unknown): string | null { requireInput(v == null || instant(v)); return v == null ? null : v as string; }
function priority(v: unknown): string { const p = v === undefined ? 'normal' : v; requireInput(typeof p === 'string' && priorities.includes(p)); return p; }
type Spec = { rpc: string; table: 'plans' | 'plan_items'; args: Record<string, unknown>;
  expected: Record<string, unknown>; itemId?: string; sourceVersion?: string };
function spec(tool: string, a: Record<string, unknown>, scope: PlanningScope): Spec {
  const allowed: Record<string, string[]> = {
    plan_create: ['title', 'summary', 'owner_user_id', 'scope', 'horizon', 'starts_on', 'ends_on'],
    plan_add_milestone: ['title', 'summary', 'plan_id', 'assigned_to_user_id', 'priority', 'due_at'],
    plan_assign_task: ['title', 'summary', 'assigned_to_user_id', 'priority', 'plan_id', 'milestone_id', 'due_at', 'contact_id'],
    plan_update_item: ['item_id', 'expected_updated_at', 'status', 'due_at', 'assigned_to_user_id', 'priority'],
    plan_item_set_client_share: ['item_id', 'shared', 'expected_updated_at'],
  };
  requireInput(allowed[tool] && Object.keys(a).every(k => allowed[tool].includes(k)));
  const common = { p_expected_actor_id: scope.actorId, p_expected_tenant_id: scope.tenantId };
  if (tool === 'plan_item_set_client_share') {
    const share = clientShareArgs(a);
    requireInput(share);
    return { rpc: 'plan_item_set_client_share', table: 'plan_items',
      args: { ...common, p_item_id: share.itemId, p_shared: share.shared, p_expected_updated_at: share.expectedUpdatedAt },
      expected: { shared: share.shared }, itemId: share.itemId, sourceVersion: share.expectedUpdatedAt };
  }
  if (tool === 'plan_update_item') {
    requireInput(instant(a.expected_updated_at));
    const expected: Record<string, unknown> = {};
    if (owns(a, 'status')) { requireInput(typeof a.status === 'string' && statuses.includes(a.status)); expected.status = a.status; }
    if (owns(a, 'due_at')) { requireInput(instant(a.due_at)); expected.due_at = a.due_at; }
    if (owns(a, 'assigned_to_user_id')) expected.assigned_to_user_id = id(a.assigned_to_user_id);
    if (owns(a, 'priority')) { requireInput(a.priority !== undefined); expected.priority = priority(a.priority); }
    requireInput(Object.keys(expected).length);
    const itemId = id(a.item_id);
    const args: Record<string, unknown> = { ...common, p_item_id: itemId, p_expected_updated_at: a.expected_updated_at,
      p_status: expected.status ?? null, p_due_at: expected.due_at ?? null, p_assigned_to_user_id: expected.assigned_to_user_id ?? null };
    if (owns(expected, 'priority')) args.p_priority = expected.priority;
    return { rpc: owns(expected, 'priority') ? 'plan_update_item_priority_versioned' : 'plan_update_item_versioned',
      table: 'plan_items', args, expected, itemId, sourceVersion: a.expected_updated_at as string };
  }
  requireInput(typeof a.title === 'string' && a.title.length <= 500 && a.title.trim().length);
  const title = a.title.trim(), detail = summary(a.summary);
  const base = { ...common, p_title: title, p_summary: detail };
  if (tool === 'plan_create') {
    requireInput(day(a.starts_on) && day(a.ends_on) && a.ends_on >= a.starts_on);
    requireInput(typeof a.horizon === 'string' && ['week', 'month', 'quarter', 'semiannual', 'year', 'custom'].includes(a.horizon));
    const scopeKind = a.scope === undefined ? 'individual' : a.scope;
    requireInput(scopeKind === 'individual' || scopeKind === 'team');
    const owner = id(a.owner_user_id);
    return { rpc: 'plan_create_scoped', table: 'plans',
      args: { ...base, p_horizon: a.horizon, p_starts_on: a.starts_on, p_ends_on: a.ends_on, p_scope: scopeKind, p_owner_user_id: owner },
      expected: { title, summary: detail, horizon: a.horizon, starts_on: a.starts_on, ends_on: a.ends_on,
        scope: scopeKind, owner_user_id: owner, created_by: scope.actorId, tenant_id: scope.tenantId, status: 'active' } };
  }
  const person = id(a.assigned_to_user_id), importance = priority(a.priority), dueAt = due(a.due_at);
  const plan = tool === 'plan_add_milestone' ? id(a.plan_id) : optionalId(a.plan_id);
  const milestone = tool === 'plan_assign_task' ? optionalId(a.milestone_id) : null;
  requireInput(!milestone || plan);
  const expected: Record<string, unknown> = { title, summary: detail, assigned_to_user_id: person,
    priority: importance, due_at: dueAt, plan_id: plan, tenant_id: scope.tenantId, created_by: scope.actorId,
    item_type: tool === 'plan_add_milestone' ? 'milestone' : 'task', status: 'open' };
  const args: Record<string, unknown> = { ...base, p_assigned_to_user_id: person, p_priority: importance, p_due_at: dueAt, p_plan_id: plan };
  if (tool === 'plan_assign_task') {
    args.p_milestone_id = milestone; args.p_contact_id = optionalId(a.contact_id);
    expected.parent_item_id = milestone; expected.contact_id = args.p_contact_id;
  }
  return { rpc: tool === 'plan_add_milestone' ? 'plan_add_milestone_scoped' : 'plan_assign_task_scoped', table: 'plan_items', args, expected };
}

export async function writeScopedPlanning(input: {
  caller: PlanningCaller; decision: PlanningDecision; scope: PlanningScope;
  operationIdentity: string; current(): boolean;
}): Promise<PlanningWriteResult> {
  let attempted = false;
  const fail = (outcome: Exclude<PlanningWriteResult['outcome'], 'source_verified'>, message: string): PlanningWriteResult =>
    ({ outcome, writeAttempted: attempted, retryAllowed: false, message });
  const uncertain = () => fail('unverified', 'The change could not be confirmed. Inspect the original work before trying again.');
  const matchesScope = (s: PlanningScope | null) => !!s && s.actorId === input.scope.actorId && s.tenantId === input.scope.tenantId;
  const isCurrent = () => { try { return input.current() === true; } catch { return false; } };
  try {
    if (!isCurrent()) return fail('scope_changed', 'The active request changed. Reopen the work in its original workspace.');
    const a = input.decision.audit;
    if (input.decision.kind !== 'execute' || !a || a.decision !== 'execute' || a.effect !== 'mutate' || a.principal !== 'person'
      || !uuid(input.scope.actorId) || !uuid(input.scope.tenantId) || a.userId !== input.scope.actorId || a.tenantId !== input.scope.tenantId)
      return fail('refused', 'This change has not been admitted for the current person and workspace.');
    if (typeof input.operationIdentity !== 'string' || !/^[a-zA-Z0-9:._-]{1,200}$/.test(input.operationIdentity))
      return fail('unavailable', 'The original change could not be identified safely. Review it again.');
    if (!['plan_create', 'plan_add_milestone', 'plan_assign_task', 'plan_update_item', 'plan_item_set_client_share'].includes(a.capability))
      return fail('unavailable', 'This kind of planning change is not supported through this path yet.');
    const args = object(input.decision.args);
    if (!args) return fail('refused', 'The requested work details are incomplete or unsupported.');
    const request = spec(a.capability, args, input.scope);
    if (a.capability === 'plan_item_set_client_share') {
      // The allowlist above has already refused any extra key (a tenant_id included). The share
      // path then owns its own write and readback; this adapter only re-proves scope around it.
      const initial = await input.caller.getScope();
      if (!isCurrent() || !matchesScope(initial)) return fail('scope_changed', 'The current person or workspace changed.');
      const shared = await setPlanItemClientShare({
        caller: { rpc: (n, x) => input.caller.rpc(n, x), readItem: (itemId) => input.caller.readRecord('plan_items', itemId, input.scope) },
        expectedActorId: input.scope.actorId, expectedTenantId: input.scope.tenantId, args, current: isCurrent,
      });
      attempted = shared.success === true || shared.writeAttempted;
      const after = await input.caller.getScope();
      if (!isCurrent() || !matchesScope(after)) return fail('scope_changed', 'The result belongs to the original request, not the current workspace.');
      if (shared.success === true) return { outcome: 'source_verified', operationIdentity: input.operationIdentity,
        record: { table: 'plan_items', id: shared.itemId },
        readback: { id: shared.itemId, shared: shared.shared, shared_at: shared.sharedAt, updated_at: shared.updatedAt },
        proofBoundary: 'planning_record_only', retryAllowed: false };
      const outcome = shared.reason === 'outcome_unknown' ? 'unverified' : shared.reason === 'scope_changed' ? 'scope_changed'
        : shared.reason === 'changed' ? 'conflict' : 'refused';
      return fail(outcome, shared.message);
    }
    const initialScope = await input.caller.getScope();
    if (!isCurrent() || !matchesScope(initialScope)) return fail('scope_changed', 'The current person or workspace changed.');
    if (request.itemId) {
      const before = await input.caller.readRecord('plan_items', request.itemId, input.scope);
      if (!isCurrent()) return fail('scope_changed', 'The active request changed.');
      const row = object(before.data);
      if (before.error || !row || row.id !== request.itemId || row.tenant_id !== input.scope.tenantId)
        return fail('refused', 'The original work is not available to inspect.');
      if (!['task', 'milestone'].includes(String(row.item_type))) return fail('unavailable', 'This item needs its own supported planning path.');
      if (row.updated_at !== request.sourceVersion) return fail('conflict', 'The work changed since this request was prepared. Review its current version.');
      for (const key of ['title', 'summary', 'created_by', 'item_type', 'plan_id', 'parent_item_id', 'contact_id', 'status', 'priority', 'due_at', 'assigned_to_user_id']) {
        if (!owns(row, key)) return fail('unavailable', 'The original work could not be fully inspected.');
        if (!owns(request.expected, key)) request.expected[key] = row[key];
      }
    }
    const beforeWriteScope = await input.caller.getScope();
    if (!isCurrent() || !matchesScope(beforeWriteScope)) return fail('scope_changed', 'The current request or workspace changed.');
    attempted = true;
    const reply = await input.caller.rpc(request.rpc, request.args);
    if (!isCurrent()) return fail('scope_changed', 'The active request changed before the result was verified.');
    const error = object(reply.error);
    if (reply.error) {
      if (error?.code === '40001') return fail('conflict', 'The saved work changed. Review its current version before proposing another change.');
      if (['42501', '22023', '23514', '23503'].includes(String(error?.code))) return fail('refused', 'This change was not allowed. Review the work, person and dates.');
      return uncertain();
    }
    const ack = object(reply.data), recordId = request.table === 'plans' ? ack?.plan_id : ack?.item_id;
    if (!ack || ack.ok !== true || ack.actor_id !== input.scope.actorId || ack.tenant_id !== input.scope.tenantId
      || !uuid(recordId) || request.itemId && recordId !== request.itemId) return uncertain();
    const read = await input.caller.readRecord(request.table, recordId, input.scope);
    const afterReadScope = await input.caller.getScope();
    if (!isCurrent() || !matchesScope(afterReadScope)) return fail('scope_changed', 'The result belongs to the original request, not the current workspace.');
    const row = object(read.data);
    if (read.error || !row || row.id !== recordId || row.tenant_id !== input.scope.tenantId || !instant(row.updated_at)) return uncertain();
    for (const [key, wanted] of Object.entries(request.expected)) {
      if (key === 'due_at' ? !sameInstant(row[key], wanted) : row[key] !== wanted) return uncertain();
    }
    // Named inspected fields only; never copy unknown/private row metadata.
    const fields = Object.fromEntries(Object.keys(request.expected).map(k => [k, row[k]]));
    fields.updated_at = row.updated_at;
    return { outcome: 'source_verified', operationIdentity: input.operationIdentity,
      record: { table: request.table, id: recordId }, readback: fields,
      proofBoundary: 'planning_record_only', retryAllowed: false };
  } catch (error) {
    if (error instanceof InvalidInput && !attempted) return fail('refused', 'The requested work details are incomplete or unsupported.');
    if (!isCurrent()) return fail('scope_changed', 'The active request changed.');
    return attempted ? uncertain() : fail('unavailable', 'The original work context could not be inspected.');
  }
}

// ─── E09 Slice 3: share one client-linked work item with that client's portal ───────────────────
//
// ONE implementation, two callers: paige-ai-chat calls it directly once its confirm gate has cleared
// the approval card (the tool is `high` in action-risk.ts), and writeScopedPlanning delegates to it
// after its own admission checks. It runs on the CALLER's JWT: public.plan_item_set_client_share is
// SECURITY DEFINER and re-proves, from auth.uid(), that the caller is the expected actor, that the
// expected tenant is their active workspace, and that they are its owner or admin.
//
// THE TENANT AND ACTOR NEVER COME FROM THE MODEL. Only `item_id`, `shared` and `expected_updated_at`
// are read from the arguments; anything else (a `tenant_id`, an actor id) is ignored here and never
// reaches the RPC. The expected tenant and actor are the server-resolved caller.
//
// SUCCESS IS A READBACK, NOT AN ACKNOWLEDGEMENT. `ok:true` alone proves nothing reached the row; the
// item is re-read on the caller's own session and its `client_shared_at` must be in the asked state.
// A refusal the database answered (`ok:false`, or an error carrying a SQLSTATE) proves nothing was
// written. Anything else after the call was sent is `outcome_unknown`, and is never retried here.

export type ClientShareCaller = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  /** Caller-JWT (RLS) read of one plan_items row in the given tenant: id, tenant_id, client_shared_at, updated_at. */
  readItem(itemId: string, tenantId: string): PromiseLike<{ data: unknown; error: unknown }>;
};
export type ClientShareFailure =
  | 'bad_request' | 'no_workspace' | 'scope_changed' | 'not_for_account' | 'not_found' | 'not_client_linked'
  | 'not_shareable' | 'client_not_found' | 'changed' | 'refused' | 'outcome_unknown';
export type ClientShareResult =
  | { success: true; itemId: string; shared: boolean; replayed: boolean; sharedAt: string | null;
      updatedAt: string; portalConnected: boolean | null }
  | { success: false; reason: ClientShareFailure; message: string; writeAttempted: boolean; currentUpdatedAt?: string };

const CLIENT_SHARE_MESSAGES: Record<ClientShareFailure, string> = {
  bad_request: 'That needs the work item id, whether to share it, and the exact updated_at you read it at. Nothing was changed.',
  no_workspace: 'The current workspace could not be confirmed. Nothing was changed.',
  scope_changed: 'Only the owner or an admin of this workspace can change what a client sees, and only in the workspace they are working in now. Nothing was changed.',
  not_for_account: 'Sharing work with a client is not available for this kind of account. Nothing was changed.',
  not_found: 'That work item was not found in this workspace. Nothing was changed.',
  not_client_linked: 'That work item is not linked to a client, so there is nobody to share it with. Nothing was changed.',
  not_shareable: 'That item cannot be shared: reminders and cancelled work stay private. Nothing was changed.',
  client_not_found: 'The client this item belongs to is no longer an active client here. Nothing was changed.',
  changed: 'The item changed since it was read. Read it again (plan_list) and confirm the current version before sharing. Nothing was changed.',
  refused: 'That change was not allowed. Nothing was changed.',
  outcome_unknown: 'The change could not be confirmed. Check the item (plan_list) before doing anything else, and do not retry automatically.',
};
const SHARE_REFUSALS: Record<string, ClientShareFailure> = {
  INVALID_REQUEST: 'bad_request', CLIENT_SHARE_UNAVAILABLE: 'not_for_account', ITEM_NOT_FOUND: 'not_found', ITEM_NOT_CLIENT_LINKED: 'not_client_linked',
  ITEM_NOT_SHAREABLE: 'not_shareable', CONTACT_NOT_FOUND: 'client_not_found', ITEM_CHANGED: 'changed',
};

/** The only three arguments the share reads. Every other key — a tenant_id included — is ignored. */
export function clientShareArgs(v: unknown): { itemId: string; shared: boolean; expectedUpdatedAt: string } | null {
  const a = object(v);
  if (!a || !uuid(a.item_id) || typeof a.shared !== 'boolean' || !instant(a.expected_updated_at)) return null;
  return { itemId: a.item_id.toLowerCase(), shared: a.shared, expectedUpdatedAt: a.expected_updated_at };
}

export async function setPlanItemClientShare(input: {
  caller: ClientShareCaller; expectedActorId: string | null | undefined; expectedTenantId: string | null | undefined;
  args: unknown; current?: () => boolean;
}): Promise<ClientShareResult> {
  let attempted = false;
  const fail = (reason: ClientShareFailure, extra: { currentUpdatedAt?: string } = {}): ClientShareResult =>
    ({ success: false, reason, message: CLIENT_SHARE_MESSAGES[reason], writeAttempted: attempted, ...extra });
  const isCurrent = () => { try { return input.current ? input.current() === true : true; } catch { return false; } };
  const actor = input.expectedActorId, tenant = input.expectedTenantId;
  if (!uuid(actor) || !uuid(tenant)) return fail('no_workspace');
  const request = clientShareArgs(input.args);
  if (!request) return fail('bad_request');
  if (!isCurrent()) return fail('scope_changed');
  let reply: { data: unknown; error: unknown };
  try {
    attempted = true;
    reply = await input.caller.rpc('plan_item_set_client_share', {
      p_expected_actor_id: actor, p_expected_tenant_id: tenant, p_item_id: request.itemId,
      p_shared: request.shared, p_expected_updated_at: request.expectedUpdatedAt,
    });
  } catch {
    return fail('outcome_unknown');
  }
  if (reply.error) {
    const code = String(object(reply.error)?.code ?? '');
    // Only an answered SQL refusal proves its transaction rolled back. A gateway or network error
    // can arrive after the database committed, so it is reported as unknown, never as "not applied".
    if (!/^[0-9A-Z]{5}$/.test(code)) return fail('outcome_unknown');
    attempted = false;
    if (code === '42501') return fail('scope_changed');
    if (code === '40001') return fail('changed');
    if (['22023', '22P02', '23514', '23503'].includes(code)) return fail('bad_request');
    return fail('refused');
  }
  const ack = object(reply.data);
  if (ack?.ok === false) {
    // The function answered with a named refusal and wrote nothing
    // (public.plan_item_set_client_share, migration 20271110030000, steps 2-8).
    attempted = false;
    const reason = SHARE_REFUSALS[String(ack.error)] ?? 'refused';
    return fail(reason, reason === 'changed' && instant(ack.updated_at) ? { currentUpdatedAt: ack.updated_at } : {});
  }
  if (!ack || ack.ok !== true || typeof ack.item_id !== 'string' || ack.item_id.toLowerCase() !== request.itemId
    || ack.shared !== request.shared || typeof ack.replayed !== 'boolean') return fail('outcome_unknown');
  if (!isCurrent()) return fail('outcome_unknown');
  let read: { data: unknown; error: unknown };
  try { read = await input.caller.readItem(request.itemId, tenant); } catch { return fail('outcome_unknown'); }
  const row = object(read.data);
  const sharedAt = row?.client_shared_at;
  if (read.error || !row || typeof row.id !== 'string' || row.id.toLowerCase() !== request.itemId || row.tenant_id !== tenant
    || !instant(row.updated_at) || !(sharedAt === null || instant(sharedAt)) || (sharedAt !== null) !== request.shared)
    return fail('outcome_unknown');
  return { success: true, itemId: request.itemId, shared: request.shared, replayed: ack.replayed,
    sharedAt: sharedAt as string | null, updatedAt: row.updated_at as string,
    portalConnected: typeof ack.portal_connected === 'boolean' ? ack.portal_connected : null };
}
