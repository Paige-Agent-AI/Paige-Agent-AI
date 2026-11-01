/** The original personal native notice reader only. No workspace choice, listing,
 * read-state write, business grant, Memory save, sender or alternative API fallback.
 * The host resolves the actual signed-in actor and supplies its original negative-
 * only lifetime guard (stays false after departure, including A -> B -> A).
 */
export interface PersonalRecoveryNoticeClient {
  getActor(): PromiseLike<string | null>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface PersonalRecoveryNoticeScope {
  actorId: string;
  isCurrent(): boolean;
}
export type OwnerRecoveryNoticeAction = 'grant_owner' | 'revoke_owner' | 'set_account_holder';
export interface PersonalOwnerRecoveryNotice {
  auditId: string;
  noticeId: string;
  tenantId: string;
  businessName: string;
  action: OwnerRecoveryNoticeAction;
  targetUserId: string | null;
  reason: string;
  recordedAt: string;
  isRead: boolean;
}
type NoticeErrorCode = 'INPUT_INVALID' | 'SCOPE_CHANGED' | 'UNAVAILABLE' | 'READ_FAILED' | 'READBACK_MISMATCH';
export class OwnerRecoveryNoticeError extends Error {
  constructor(public readonly code: NoticeErrorCode) {
    super('This ownership notice could not be verified.');
  }
}
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
function noticeAction(value: unknown): OwnerRecoveryNoticeAction | null {
  switch (value) {
    case 'tenant:owner_recovery.grant_owner': return 'grant_owner';
    case 'tenant:owner_recovery.revoke_owner': return 'revoke_owner';
    case 'tenant:owner_recovery.set_account_holder': return 'set_account_holder';
    default: return null;
  }
}

export async function readPersonalOwnerRecoveryNotice(
  client: PersonalRecoveryNoticeClient, scope: PersonalRecoveryNoticeScope, noticeId: string,
): Promise<PersonalOwnerRecoveryNotice> {
  if (!uuid(scope.actorId) || !uuid(noticeId) || typeof scope.isCurrent !== 'function') {
    throw new OwnerRecoveryNoticeError('INPUT_INVALID');
  }
  const actor = scope.actorId.toLowerCase(), notice = noticeId.toLowerCase();
  const isCurrent = scope.isCurrent.bind(scope);
  const check = () => {
    if (isCurrent() !== true) throw new OwnerRecoveryNoticeError('SCOPE_CHANGED');
  };
  const resolve = async () => {
    check();
    const actual = await client.getActor();
    check();
    if (!uuid(actual) || actual.toLowerCase() !== actor) throw new OwnerRecoveryNoticeError('SCOPE_CHANGED');
  };
  try {
    await resolve();
    check();
    // Preserve the supplied SDK receiver; never destructure its rpc method.
    const { data, error } = await client.rpc('get_my_owner_recovery_notice', { _notice: notice });
    check();
    await resolve();
    if (error) {
      const code = object(error) ? error.code : null;
      throw new OwnerRecoveryNoticeError(['42501', '42883', 'PGRST202'].includes(String(code)) ? 'UNAVAILABLE' : 'READ_FAILED');
    }
    const action = object(data) ? noticeAction(data.action) : null;
    if (!object(data) || !uuid(data.notification_id) || data.notification_id.toLowerCase() !== notice
      || !uuid(data.audit_id) || !uuid(data.tenant_id) || typeof data.business_name !== 'string'
      || !(data.target_user_id === null || uuid(data.target_user_id))
      || typeof data.reason !== 'string' || [...data.reason.trim()].length < 10 || [...data.reason].length > 500
      || !timestamp(data.recorded_at) || typeof data.is_read !== 'boolean' || action === null) {
      throw new OwnerRecoveryNoticeError('READBACK_MISMATCH');
    }
    check();
    return {
      auditId: data.audit_id.toLowerCase(), noticeId: notice, tenantId: data.tenant_id.toLowerCase(),
      businessName: data.business_name,
      action,
      targetUserId: data.target_user_id === null ? null : String(data.target_user_id).toLowerCase(),
      reason: data.reason, recordedAt: data.recorded_at, isRead: data.is_read,
    };
  } catch (error) {
    if (error instanceof OwnerRecoveryNoticeError) throw error;
    // The view never renders native SQL, response bodies or transport details.
    throw new OwnerRecoveryNoticeError('READ_FAILED');
  }
}
