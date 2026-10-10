import { supabase } from '@/integrations/supabase/client';

export type AccountDetails = {
  id: string; name: string; status: string; account_type: string; parent_tenant_id: string | null; version: string;
  archived_at?: string | null; archive_operation_id?: string | null; archive_root_tenant_id?: string | null; execution_paused?: boolean;
};
export type ScopeAccount = { id: string; name: string; account_type: string; status?: string; parent_tenant_id?: string | null };
export type LifecyclePreview = {
  tenant_id: string; accounts: ScopeAccount[]; blockers: string[]; execution_available: boolean; version?: string;
  archive_operation_id?: string; dependencies?: { relation: string; count: number; disposition: 'delete'|'preserve'|'blocked' }[];
  preserved?: string[]; storage_count?: number;
  memberships?: number; shared_identities?: number;
};
export type DeletionPreview = LifecyclePreview;
export type LifecycleAction = 'archive' | 'restore' | 'delete';
export type LifecycleReceipt = { tenant_id: string; operation_id: string; state: 'archived'|'restored'|'deleted'; account_count: number };
export class AccountRpcError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}
const isString = (v: unknown): v is string => typeof v === 'string';
export function accountEditReadback(id: string, name: string, status: string, row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const value = row as Record<string, unknown>;
  return value.id === id && value.name === name && value.status === status;
}
export function parseAccountDeletionPreview(id: string, row: unknown): LifecyclePreview {
  if (!row || typeof row !== 'object') throw new Error('Account scope could not be verified. Refresh the review.');
  const v = row as LifecyclePreview;
  if (v.tenant_id !== id || !Array.isArray(v.accounts) || !v.accounts.length || !Array.isArray(v.blockers)
    || !v.blockers.every(isString) || typeof v.execution_available !== 'boolean'
    || !v.accounts.every(a => a && isString(a.id) && isString(a.name) && isString(a.account_type))
    || new Set(v.accounts.map(a => a.id)).size !== v.accounts.length || !v.accounts.some(a => a.id === id)
    || (v.execution_available && (!isString(v.version) || !v.version || v.blockers.length))
    || [v.memberships,v.shared_identities,v.storage_count].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0))
    || (v.dependencies !== undefined && (!Array.isArray(v.dependencies) || !v.dependencies.every(d => d && isString(d.relation) && Number.isSafeInteger(d.count) && d.count >= 0 && ['delete','preserve','blocked'].includes(d.disposition)))))
    throw new Error('Account scope could not be verified. Refresh the review.');
  return v;
}
export function parseLifecycleReceipt(id: string, operation: string, row: unknown): LifecycleReceipt {
  if (!row || typeof row !== 'object') throw new Error('Operation outcome is unknown. Read the operation before another change.');
  const v = row as LifecycleReceipt;
  if (v.tenant_id !== id || v.operation_id !== operation || !['archived','restored','deleted'].includes(v.state)
    || !Number.isSafeInteger(v.account_count) || v.account_count < 1)
    throw new Error('Operation outcome is unknown. Read the operation before another change.');
  return v;
}
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  // Explicit server-authorized lifecycle contracts; generated types follow the migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc(name as any, args);
  if (error) throw new AccountRpcError(error.code === 'PGRST202' ? 'Account lifecycle controls are not deployed yet.' : error.message, error.code);
  return data;
}
export async function readRetirementAuthority(): Promise<boolean> {
  return await rpc('operator_can_retire_accounts', {}) === true;
}
export async function readAccountDetails(id: string): Promise<AccountDetails> {
  const result = await rpc('operator_read_account_details', { _tenant_id: id });
  if (!result || typeof result !== 'object') throw new Error('Account details could not be verified.');
  const r = result as AccountDetails;
  if (r.id !== id || !isString(r.version) || !isString(r.name) || !isString(r.status) || !isString(r.account_type)) throw new Error('Account details could not be verified.');
  return r;
}
export async function saveAccountDetails(details: AccountDetails, name: string, status: string): Promise<AccountDetails> {
  const result = await rpc('operator_edit_account_details', { _tenant_id: details.id, _name: name.trim(), _status: status, _expected_version: details.version });
  if (!accountEditReadback(details.id, name.trim(), status, result)) throw new Error('Save outcome is unverified. Reload account details before retrying.');
  const saved = await readAccountDetails(details.id);
  if (!accountEditReadback(details.id, name.trim(), status, saved)) throw new Error('Saved account readback changed. Reload before editing again.');
  return saved;
}
export async function previewAccountDeletion(id: string): Promise<LifecyclePreview> {
  return parseAccountDeletionPreview(id, await rpc('operator_preview_account_deletion', { _tenant_id: id }));
}
export async function previewAccountArchive(id: string): Promise<LifecyclePreview> {
  return parseAccountDeletionPreview(id, await rpc('operator_preview_account_archive', { _tenant_id: id }));
}
export async function readLifecycleOutcome(id: string, operation: string, action: LifecycleAction): Promise<LifecycleReceipt> {
  const receipt = parseLifecycleReceipt(id, operation, await rpc('operator_read_archive_receipt', { _tenant_id: id, _operation_id: operation }));
  const expected = { archive: 'archived', restore: 'restored', delete: 'deleted' }[action];
  if (receipt.state !== expected) throw new Error('The operation has not reached its expected outcome. Read again before retrying.');
  if (action === 'delete') {
    try { await readAccountDetails(id); } catch(e) {
      if (e instanceof AccountRpcError && e.code === 'P0002') return receipt;
      throw e;
    }
    throw new Error('Deletion absence could not be verified. Read the operation again.');
  }
  const row = await readAccountDetails(id);
  if (action === 'archive' ? !row.archived_at || row.archive_operation_id !== operation : Boolean(row.archived_at))
    throw new Error('Account lifecycle readback differs from its receipt. Read again.');
  return receipt;
}
export async function executeLifecycle(id: string, action: LifecycleAction, operation: string, confirmation: string, version?: string): Promise<LifecycleReceipt> {
  const name = { archive: 'operator_archive_account', restore: 'operator_restore_archived_account', delete: 'operator_delete_archived_account' }[action];
  const args: Record<string, unknown> = { _tenant_id: id, _operation_id: operation };
  if (action !== 'restore') { args._expected_version = version; args._confirmation_name = confirmation; }
  const result = await rpc(name, args);
  parseLifecycleReceipt(id, operation, result);
  return readLifecycleOutcome(id, operation, action);
}
