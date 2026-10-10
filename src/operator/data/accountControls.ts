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
export type ResourceMode = 'archive'|'delete';
export type ResourcePreview = LifecyclePreview & {mode:ResourceMode;resources:{provider:'twilio'|'n8n'|'tts_cache'|'generated_media';tenant_id:string;action:'suspend'|'close'|'disconnect'|'remove_cache'|'remove_media';external_retention?:boolean;object_count?:number}[]};
export type ResourceReceipt = {tenant_id:string;operation_id:string;mode:ResourceMode;state:'resources_preparing'|'resources_ready'|'resources_unknown'|'resources_failed';account_count:number;results:{provider:'twilio'|'n8n'|'tts_cache'|'generated_media';state:'verified'|'blocked'|'unknown';provider_status:string|null;reason:string|null}[]};
export class AccountRpcError extends Error {
  constructor(message: string, public readonly code?: string,public readonly beforeExecution=false) { super(message); }
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

export function parseResourceReceipt(id:string, operation:string|null, row:unknown):ResourceReceipt {
  if(!row||typeof row!=='object')throw new Error('Provider outcome is unknown. Read the operation.');
  const r=row as ResourceReceipt;
  if(r.tenant_id!==id||(operation!==null&&r.operation_id!==operation)||!isString(r.operation_id)
    ||!['archive','delete'].includes(r.mode)||!['resources_preparing','resources_ready','resources_unknown','resources_failed'].includes(r.state)
    ||!Number.isSafeInteger(r.account_count)||r.account_count<1||!Array.isArray(r.results)
    ||!r.results.every(v=>v&&['twilio','n8n','tts_cache','generated_media'].includes(v.provider)&&['verified','blocked','unknown'].includes(v.state)
      &&(v.reason===null||isString(v.reason))&&(v.provider_status===null||isString(v.provider_status)))
    ||(r.state==='resources_ready'&&(!r.results.length||r.results.some(v=>v.state!=='verified'||(['tts_cache','generated_media'].includes(v.provider)?r.mode!=='delete'||v.provider_status!=='removed':v.provider==='n8n'?v.provider_status!=='disconnected':!(r.mode==='delete'?['closed']:['suspended','closed']).includes(v.provider_status??''))))))throw new Error('Provider outcome is unknown. Read the operation.');
  return r;
}
export async function previewRetirementResources(id:string,mode:ResourceMode):Promise<ResourcePreview> {
  const row=await rpc('operator_preview_retirement_resources',{_tenant_id:id,_mode:mode});
  const p=parseAccountDeletionPreview(id,row) as ResourcePreview;
  if(p.mode!==mode||!Array.isArray(p.resources)||!p.resources.every(r=>r&&['twilio','n8n','tts_cache','generated_media'].includes(r.provider)&&p.accounts.some(a=>a.id===r.tenant_id)
    &&r.action===(r.provider==='tts_cache'?'remove_cache':r.provider==='generated_media'?'remove_media':r.provider==='n8n'?'disconnect':mode==='archive'?'suspend':'close')
    &&(!['tts_cache','generated_media'].includes(r.provider)||mode==='delete'&&Number.isSafeInteger(r.object_count)&&(r.object_count??0)>0&&(r.object_count??0)<=100))
    ||new Set(p.resources.map(r=>r.provider+':'+r.tenant_id)).size!==p.resources.length)throw new Error('Provider scope could not be verified. Refresh the review.');
  return p;
}
export async function readRetirementResources(id:string,operation:string|null):Promise<ResourceReceipt|null> {
  try{return parseResourceReceipt(id,operation,await rpc('operator_read_retirement_resources',{_tenant_id:id,_operation_id:operation}));}
  catch(e){if(operation===null&&e instanceof AccountRpcError&&e.code==='P0002')return null;throw e;}
}
export async function runRetirementResources(id:string,operation:string,action:'prepare'|'continue'|'read',review?:ResourcePreview,confirmation?:string,retainExternalN8n?:boolean):Promise<ResourceReceipt> {
  const body:Record<string,unknown>={tenant_id:id,operation_id:operation,action};
  if(action==='prepare'){body.mode=review?.mode;body.version=review?.version;body.confirmation=confirmation;body.retain_external_n8n=retainExternalN8n;}
  const {data,error}=await supabase.functions.invoke('operator-account-retirement',{body});
  if(error){
    let code:string|undefined,beforeExecution=false;
    if('context' in error&&error.context instanceof Response){try{const r=await error.context.json();if(typeof r.code==='string')code=r.code;beforeExecution=r.error==='resource_review_refused';}catch{/* No untrusted provider payload is displayed. */}}
    throw new AccountRpcError('Provider preparation was not verified. Read the operation before retrying.',code,beforeExecution);
  }
  return parseResourceReceipt(id,operation,data);
}
