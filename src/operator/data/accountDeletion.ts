import { AccountRpcError, executeLifecycle, previewAccountDeletion, previewRetirementResources, runRetirementResources,
  type LifecyclePreview, type LifecycleReceipt, type ResourcePreview, type ResourceReceipt } from './accountControls';

// Coordinate the existing journal and Storage API inside the confirmed Delete flow.
// No provider execution, new registry, or automatic retry of an uncertain write.
export class AccountFileCleanupError extends Error {
  constructor(public readonly operationId: string) { super('File cleanup is unverified. Read the operation before another change.'); }
}
const sameScope = (a: LifecyclePreview, b: LifecyclePreview) => JSON.stringify(a.accounts) === JSON.stringify(b.accounts);
export function isEligibleFileReview(preview: LifecyclePreview, files: ResourcePreview): boolean {
  return Boolean(preview.storage_count && preview.data_version && preview.version && files.execution_available && files.version
    && files.mode === 'delete' && files.tenant_id === preview.tenant_id && sameScope(preview, files)
    && files.resources.length > 0 && files.resources.length <= 50
    && files.resources.every(r => ['tts_cache','generated_media'].includes(r.provider)));
}
export async function reviewDeletionFiles(preview: LifecyclePreview): Promise<ResourcePreview | null> {
  if (preview.execution_available || !preview.storage_count) return null;
  const files = await previewRetirementResources(preview.tenant_id, 'delete');
  return isEligibleFileReview(preview, files) ? files : null;
}
type Ports = {
  preview: typeof previewAccountDeletion; run: typeof runRetirementResources; execute: typeof executeLifecycle;
};
const ports: Ports = { preview: previewAccountDeletion, run: runRetirementResources, execute: executeLifecycle };
export async function deleteWithEligibleFiles(id: string, archive: string, confirmation: string, reviewed: LifecyclePreview,
  files: ResourcePreview, io: Ports = ports): Promise<LifecycleReceipt> {
  if (!isEligibleFileReview(reviewed, files) || reviewed.tenant_id !== id || reviewed.archive_operation_id !== archive
    || reviewed.accounts.find(a => a.id === id)?.name !== confirmation) throw new AccountRpcError('Refresh the deletion review.', '40001');
  const before = await io.preview(id);
  if (before.version !== reviewed.version || before.data_version !== reviewed.data_version || !sameScope(before, reviewed))
    throw new AccountRpcError('Account data changed. Refresh the deletion review.', '40001');
  const operation = crypto.randomUUID();
  let result: ResourceReceipt;
  try {
    result = await io.run(id, operation, 'prepare', files, confirmation, false);
    for (let step = 1; result.state === 'resources_preparing' && step < files.resources.length; step++)
      result = await io.run(id, operation, 'continue');
  } catch (error) {
    if (error instanceof AccountRpcError && error.beforeExecution) throw error;
    throw new AccountFileCleanupError(operation);
  }
  if (result.state !== 'resources_ready' || result.mode !== 'delete' || result.operation_id !== operation || result.tenant_id !== id
    || result.account_count !== reviewed.accounts.length || !result.results.length
    || result.results.some(r => !['tts_cache','generated_media'].includes(r.provider) || r.state !== 'verified' || r.provider_status !== 'removed')) throw new AccountFileCleanupError(operation);
  let after: LifecyclePreview;
  try { after = await io.preview(id); } catch { throw new AccountFileCleanupError(operation); }
  if (!after.execution_available || after.data_version !== reviewed.data_version || after.archive_operation_id !== archive
    || !sameScope(after, reviewed)) throw new AccountRpcError('Account data changed during file removal. Refresh the deletion review.', '40001');
  return io.execute(id, 'delete', archive, confirmation, after.version);
}
