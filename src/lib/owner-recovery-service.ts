/** Original R9/R12 native doors only. The host retains the stable intent BEFORE
 * submission and supplies its signed-in actor/selection incarnation. A not-found
 * receipt is not retry authority: an outstanding original transaction may commit.
 * No request generation, persistence, approval, automatic retry or alternate API.
 */
export interface OwnerRecoveryClient {
  getActor(): PromiseLike<string | null>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>;
}
export interface OwnerRecoveryScope {actorId: string; tenantId: string; isCurrent(): boolean}
export type OwnerRecoveryAction = 'grant_owner' | 'revoke_owner' | 'set_account_holder';
export interface OwnerRecoveryIntent {requestId: string; action: OwnerRecoveryAction; targetUserId: string; reason: string}
export interface OwnerRecoveryReceipt {
  auditId: string; tenantId: string; action: OwnerRecoveryAction; targetUserId: string;
  reason: string; recordedAt: string; noticeCount: number;
  noticeStatus: 'in_app_recorded' | 'no_recipients'; emailStatus: 'not_requested';
}
type Verified = {state: 'verified'; receipt: OwnerRecoveryReceipt};
export type OwnerRecoveryInspection = Verified | {state: 'not_found'; requestId: string};
export type OwnerRecoverySubmission = Verified | {state: 'unknown'; requestId: string};
type Code = 'INPUT_INVALID' | 'SCOPE_CHANGED' | 'REFUSED' | 'READ_FAILED' | 'READBACK_MISMATCH';
export class OwnerRecoveryError extends Error {
  constructor(public readonly code: Code) {super('This ownership recovery could not be verified.');}
}
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  && Number.isFinite(Date.parse(v));
const action = (v: unknown): v is OwnerRecoveryAction => v === 'grant_owner' || v === 'revoke_owner' || v === 'set_account_holder';

function capture(client: OwnerRecoveryClient, scope: OwnerRecoveryScope, supplied: OwnerRecoveryIntent) {
  if (!uuid(scope.actorId) || !uuid(scope.tenantId) || typeof scope.isCurrent !== 'function'
    || !uuid(supplied.requestId) || !uuid(supplied.targetUserId) || !action(supplied.action)
    || typeof supplied.reason !== 'string' || [...supplied.reason.trim()].length < 10 || [...supplied.reason.trim()].length > 500) {
    throw new OwnerRecoveryError('INPUT_INVALID');
  }
  const actor = scope.actorId.toLowerCase(), tenant = scope.tenantId.toLowerCase();
  const intent: OwnerRecoveryIntent = Object.freeze({requestId: supplied.requestId.toLowerCase(), action: supplied.action,
    targetUserId: supplied.targetUserId.toLowerCase(), reason: supplied.reason.trim()});
  const current = scope.isCurrent.bind(scope);
  const check = () => {if (current() !== true) throw new OwnerRecoveryError('SCOPE_CHANGED');};
  const resolve = async () => {
    check();
    const actual = await client.getActor();
    check();
    if (!uuid(actual) || actual.toLowerCase() !== actor) throw new OwnerRecoveryError('SCOPE_CHANGED');
  };
  return {tenant, intent, check, resolve};
}
type Captured = ReturnType<typeof capture>;

function projection(data: unknown, c: Captured): OwnerRecoveryInspection {
  const mismatch = () => new OwnerRecoveryError('READBACK_MISMATCH');
  if (!object(data)) throw mismatch();
  if (data.status === 'not_found') {
    if (data.request_id !== c.intent.requestId) throw mismatch();
    return {state: 'not_found', requestId: c.intent.requestId};
  }
  const r = data.receipt;
  if (data.status !== 'found' || data.audit_id !== c.intent.requestId || data.tenant_id !== c.tenant
    || data.action !== `tenant:owner_recovery.${c.intent.action}` || data.target_user_id !== c.intent.targetUserId
    || !instant(data.recorded_at) || !object(r) || r.request_id !== c.intent.requestId
    || r.target !== c.intent.targetUserId || r.reason !== c.intent.reason || r.outcome !== 'effect_verified'
    || (r.notice_status !== 'in_app_recorded' && r.notice_status !== 'no_recipients')
    || r.email_status !== 'not_requested' || !Array.isArray(r.notices) || !Array.isArray(r.notified)) throw mismatch();
  const users: string[] = [], notices: string[] = [];
  for (const n of r.notices) {
    if (!object(n) || !uuid(n.user_id) || !uuid(n.notification_id)) throw mismatch();
    users.push(n.user_id.toLowerCase()); notices.push(n.notification_id.toLowerCase());
  }
  if (new Set(users).size !== users.length || new Set(notices).size !== notices.length
    || r.notified.length !== users.length || !r.notified.every(uuid)
    || new Set(r.notified.map(v => v.toLowerCase())).size !== users.length
    || r.notified.some(v => !users.includes(v.toLowerCase()))
    || (r.notice_status === 'no_recipients') !== (users.length === 0)) throw mismatch();
  c.check();
  return {state: 'verified', receipt: {auditId: c.intent.requestId, tenantId: c.tenant, action: c.intent.action,
    targetUserId: c.intent.targetUserId, reason: c.intent.reason, recordedAt: data.recorded_at,
    noticeCount: users.length, noticeStatus: r.notice_status, emailStatus: 'not_requested'}};
}

async function inspect(client: OwnerRecoveryClient, c: Captured): Promise<OwnerRecoveryInspection> {
  await c.resolve(); c.check();
  const {data, error} = await client.rpc('platform_owner_recovery_receipt', {_tenant: c.tenant, _request: c.intent.requestId});
  c.check(); await c.resolve(); c.check();
  if (error) throw new OwnerRecoveryError('READ_FAILED');
  return projection(data, c);
}
function safeError(error: unknown): OwnerRecoveryError {
  return error instanceof OwnerRecoveryError ? error : new OwnerRecoveryError('READ_FAILED');
}
export async function inspectOwnerRecovery(client: OwnerRecoveryClient, scope: OwnerRecoveryScope,
  intent: OwnerRecoveryIntent): Promise<OwnerRecoveryInspection> {
  const c = capture(client, scope, intent);
  try {
    const result = await inspect(client, c);
    // The inner reader settled before this public continuation resumed.
    c.check();
    return result;
  } catch (error) {throw safeError(error);}
}
export async function submitOwnerRecovery(client: OwnerRecoveryClient, scope: OwnerRecoveryScope,
  intent: OwnerRecoveryIntent): Promise<OwnerRecoverySubmission> {
  const c = capture(client, scope, intent);
  try {await c.resolve(); c.check();} catch (error) {throw safeError(error);}
  try {
    // Preserve the SDK receiver. Only this call can execute the original writer.
    const {error} = await client.rpc('platform_owner_recovery', {_tenant: c.tenant, _act: c.intent.action,
      _user: c.intent.targetUserId, _reason: c.intent.reason, _request: c.intent.requestId});
    c.check();
    // Native PostgreSQL refusals roll back this transaction; no fallback or retry.
    if (object(error) && (error.code === '42501' || error.code === '22023')) throw new OwnerRecoveryError('REFUSED');
    // Other returned errors and interrupted transport reconcile below, never resend.
  } catch (error) {
    if (error instanceof OwnerRecoveryError) throw error;
  }
  try {
    const result = await inspect(client, c);
    c.check();
    return result.state === 'verified' ? result : {state: 'unknown', requestId: c.intent.requestId};
  } catch (error) {
    if (error instanceof OwnerRecoveryError && error.code === 'SCOPE_CHANGED') throw error;
    return {state: 'unknown', requestId: c.intent.requestId};
  }
}
