import { supabase } from '@/integrations/supabase/client';

export type AccountDetails = { id: string; name: string; status: string; account_type: string; parent_tenant_id: string | null; version: string };
export type DeletionPreview = { tenant_id: string; accounts: { id: string; name: string; account_type: string }[]; blockers: string[]; execution_available: false };

export function accountEditReadback(id: string, name: string, status: string, row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const value = row as Record<string, unknown>;
  return value.id === id && value.name === name && value.status === status;
}

export function parseAccountDeletionPreview(id: string, row: unknown): DeletionPreview {
  if (!row || typeof row !== 'object') throw new Error('Deletion scope could not be verified. Refresh the preview.');
  const value = row as Record<string, unknown>;
  if (value.tenant_id !== id || !Array.isArray(value.accounts) || value.accounts.length === 0 || !Array.isArray(value.blockers)
    || !value.blockers.every(b => typeof b === 'string') || value.execution_available !== false
    || !value.accounts.every(a => a && typeof a.id === 'string' && typeof a.name === 'string' && typeof a.account_type === 'string')
    || !value.accounts.some(a => a.id === id)) throw new Error('Deletion scope could not be verified. Refresh the preview.');
  return value as DeletionPreview;
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  // Newly added operator lifecycle RPCs are not yet in generated Supabase types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc(name as any, args);
  if (error) throw new Error(error.code === 'PGRST202' ? 'Account controls are not deployed yet.' : error.message);
  return data;
}

export async function readAccountDetails(id: string): Promise<AccountDetails> {
  const result = await rpc('operator_read_account_details', { _tenant_id: id });
  if (!result || typeof result !== 'object') throw new Error('Account details could not be verified.');
  const row = result as AccountDetails;
  if (row.id !== id || typeof row.version !== 'string' || typeof row.name !== 'string' || typeof row.status !== 'string' || typeof row.account_type !== 'string') throw new Error('Account details could not be verified.');
  return row;
}

export async function saveAccountDetails(details: AccountDetails, name: string, status: string): Promise<AccountDetails> {
  const result = await rpc('operator_edit_account_details', { _tenant_id: details.id, _name: name.trim(), _status: status, _expected_version: details.version });
  if (!accountEditReadback(details.id, name.trim(), status, result)) throw new Error('Save outcome is unverified. Reload account details before retrying.');
  // Read separately through the owning contract rather than trusting the write response alone.
  const saved = await readAccountDetails(details.id);
  if (!accountEditReadback(details.id, name.trim(), status, saved)) throw new Error('Saved account readback changed. Reload before editing again.');
  return saved;
}

export async function previewAccountDeletion(id: string): Promise<DeletionPreview> {
  return parseAccountDeletionPreview(id, await rpc('operator_preview_account_deletion', { _tenant_id: id }));
}
