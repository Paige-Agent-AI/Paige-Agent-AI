import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button as BaseButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readAccountDetails, saveAccountDetails, previewAccountDeletion, type AccountDetails, type DeletionPreview } from '@/operator/data/accountControls';
import { previewAccountArchive, executeLifecycle, readLifecycleOutcome, AccountRpcError, type LifecycleAction, type LifecycleReceipt } from '@/operator/data/accountControls';
import { cn } from '@/lib/utils';
import { readRetirementResources, runRetirementResources, type ResourcePreview } from '@/operator/data/accountControls';
import { AccountFileCleanupError, deleteWithEligibleFiles, reviewDeletionFiles } from '@/operator/data/accountDeletion';

function Button({ variant = 'default', className, ...props }: ComponentProps<typeof BaseButton>) {
  return <BaseButton {...props} variant={variant} className={cn(
    'min-h-11 focus-visible:ring-[var(--pg-gold-core)]',
    variant === 'outline' ? 'border-[var(--pg-line)] bg-[var(--pg-raised)] text-[var(--pg-ink)] hover:bg-[var(--pg-surface)] hover:text-[var(--pg-ink)]'
      : 'bg-[var(--pg-gold-core)] text-[var(--pg-raised)] hover:bg-[var(--pg-gold-deep)]', className,
  )} />;
}
export default function AccountDetailsDialog({ tenantId, onClose, onChanged }: { tenantId: string; onClose: () => void; onChanged: () => void }) {
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'view' | 'edit' | 'discard' | 'confirm' | 'archive' | 'delete' | 'restore' | 'completed'>('view');
  const [files, setFiles] = useState<ResourcePreview | null>(null);
  const fileOperation = useRef<string | null>(null);
  const [resumeFiles, setResumeFiles] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [irreversible, setIrreversible] = useState(false);
  const [receipt, setReceipt] = useState<LifecycleReceipt | null>(null);
  const operation = useRef<{ id: string; action: LifecycleAction } | null>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [busy, setBusy] = useState(true);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const request = useRef(0);
  const pending = useRef(false);
  const dirty = Boolean(details && (name !== details.name || status !== details.status));
  const archived = Boolean(details?.archived_at);
  const scopeRoot = !details?.archive_root_tenant_id || details.archive_root_tenant_id === tenantId;

  async function load() {
    const generation = ++request.current;
    setBusy(true); setError('');
    try {
      const row = await readAccountDetails(tenantId);
      if (!alive.current || request.current !== generation) return;
      setDetails(row); setName(row.name); setStatus(row.status); setUnknown(false); setMode('view');
    } catch (e) {
      if (alive.current && request.current === generation) setError(e instanceof Error ? e.message : 'Account details could not be read. Retry.');
    } finally { if (alive.current && request.current === generation) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
    // Dialog is keyed to the account and authenticated actor by the Fleet host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function close() {
    if (pending.current) return;
    if (unknown) { setError('The save outcome is unknown. Read the current account before another change.'); return; }
    if (dirty) { setMode('discard'); return; }
    onClose();
  }
  async function save() {
    if (!details || pending.current || unknown) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveAccountDetails(details, name, status);
      if (!alive.current) return;
      setDetails(saved); setName(saved.name); setStatus(saved.status); setMode('view');
      setNotice('Account changes saved and read back.'); onChanged();
    } catch (e) {
      if (alive.current) { setUnknown(true); setError(e instanceof Error ? e.message : 'Save outcome unknown. Read the current account before retrying.'); }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function deletionPreview(action: 'archive' | 'delete' = 'delete') {
    if (pending.current || unknown) return;
    pending.current = true; setBusy(true); setError(''); setPreview(null); setFiles(null); setMode(action); setConfirmation(''); setIrreversible(false);
    try {
      const result = await (action === 'archive' ? previewAccountArchive(tenantId) : previewAccountDeletion(tenantId));
      const fileReview = action === 'delete' ? await reviewDeletionFiles(result) : null;
      const existing = action === 'delete' && result.storage_count ? await readRetirementResources(tenantId, null) : null;
      if (alive.current) {
        setPreview(result); setFiles(fileReview);
        if (existing?.file_only && existing.mode === 'delete' && ['resources_preparing','resources_unknown','resources_failed'].includes(existing.state)) {
          fileOperation.current = existing.operation_id;
          operation.current = {id: result.archive_operation_id ?? existing.operation_id, action:'delete'};
          setUnknown(true); setError('File cleanup is pending. Read its outcome before confirming deletion.');
        }
      }
    } catch(e) { if (alive.current) setError(e instanceof Error ? e.message : 'Deletion preview unavailable. Retry.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  function completed(result: LifecycleReceipt) {
    if (!alive.current) return;
    setReceipt(result); setUnknown(false); setError(''); setMode('completed'); onChanged();
  }
  async function execute(action: LifecycleAction) {
    if (!details || pending.current || unknown) return;
    if (action !== 'restore' && (!(preview?.execution_available || files) || !preview?.version || confirmation !== details.name || (action === 'delete' && !irreversible))) return;
    const id = action === 'archive' ? crypto.randomUUID() : details.archive_operation_id;
    if (!id) { setError('Archive identity unavailable. Reload account details.'); return; }
    operation.current = { id, action }; pending.current = true; setBusy(true); setError('');
    try { completed(await (action === 'delete' && files && preview
      ? deleteWithEligibleFiles(tenantId, id, confirmation, preview, files)
      : executeLifecycle(tenantId, action, id, confirmation, preview?.version))); }
    catch(e) {
      if (!alive.current) return;
      if (e instanceof AccountFileCleanupError) fileOperation.current = e.operationId;
      const refused = e instanceof AccountRpcError && ['42501','22023','40001','55000','54000','23503'].includes(e.code ?? '');
      setUnknown(!refused); setError(e instanceof Error ? e.message : 'Operation outcome unknown. Read the operation.');
      if (refused) { setPreview(null); setConfirmation(''); setIrreversible(false); }
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function recoverOperation(resume = false) {
    if (pending.current) return;
    if (!operation.current) { await load(); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      if (fileOperation.current) {
        let fileResult = await runRetirementResources(tenantId, fileOperation.current, resume ? 'continue' : 'read');
        for (let step = 1; resume && fileResult.state === 'resources_preparing' && step < 50; step++)
          fileResult = await runRetirementResources(tenantId, fileOperation.current, 'continue');
        if (!fileResult.file_only) throw new Error('File-only cleanup scope could not be verified. No account deletion has run.');
        if (fileResult.state !== 'resources_ready') { setResumeFiles(true); throw new Error('File cleanup remains unverified. No account deletion has run. Resume only the previously confirmed file scope.'); }
        setResumeFiles(false);
        fileOperation.current = null; operation.current = null; setUnknown(false); setPreview(null); setFiles(null); setConfirmation(''); setIrreversible(false);
        setNotice('File cleanup read back. Refresh the deletion review and confirm again.');
      } else completed(await readLifecycleOutcome(tenantId, operation.current.id, operation.current.action));
    }
    catch(e) { if (alive.current) setError(e instanceof Error ? e.message : 'Outcome remains unknown. Read again.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent overlayClassName="motion-reduce:!animate-none" data-pg={typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'} className="max-w-xl rounded-xl border-[var(--pg-line)] bg-[var(--pg-raised)] text-[var(--pg-ink)] motion-reduce:!animate-none [&>button.absolute]:min-h-11 [&>button.absolute]:min-w-11 [&>button.absolute]:right-2 [&>button.absolute]:top-2" onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); close(); }}>
      <DialogTitle className="break-words pr-8">{details?.name ?? 'Account details'}</DialogTitle>
      <DialogDescription>{details ? `${details.account_type.replace(/_/g, ' ')} · ${archived ? 'Archived' : details.status}` : 'Read the account through the Platform Operator lifecycle.'}</DialogDescription>
      {busy && <p role="status">{pending.current ? 'PROCESSING · Verifying the operation…' : 'Reading account details…'}</p>}
      {error && <p role="alert" className="break-words text-[var(--pg-negative)]">{unknown ? 'OUTCOME UNKNOWN · ' : 'FAILED · '}{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {unknown && <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void recoverOperation()}>{operation.current ? 'Read operation' : 'Read current account'}</Button>{resumeFiles && <Button variant="outline" disabled={busy} onClick={() => void recoverOperation(true)}>Resume confirmed file removal</Button>}<Button variant="outline" disabled={busy} onClick={() => { onChanged(); onClose(); }}>Close without confirmation</Button></div>}
      {!details && !busy && <Button onClick={() => void load()}>Retry details</Button>}
      {details && mode === 'view' && <>
        {details.parent_tenant_id && <p>This account belongs to an Agency. Editing preserves that relationship.</p>}
        {archived && !scopeRoot && <p>Archived with its parent scope. Open the parent account to restore or delete the complete archive.</p>}
        {details.execution_paused && <p>Provider and scheduled execution remains paused. Restoring access does not resume paid services.</p>}
        <div className="flex flex-wrap gap-3">
          {!archived && <><Button disabled={busy || unknown} onClick={() => { setMode('edit'); setNotice(''); }}>Edit account</Button><Button variant="outline" disabled={busy || unknown || details.status === 'canceled'} onClick={() => { setName(details.name); setStatus('canceled'); setMode('confirm'); }}>Cancel account</Button><Button variant="outline" disabled={busy || unknown} onClick={() => void deletionPreview('archive')}>Archive account</Button></>}
          {archived && <Button variant="outline" disabled={busy || unknown || !scopeRoot} onClick={() => setMode('restore')}>Restore archived account</Button>}
          <Button variant="outline" className="text-[var(--pg-negative)]" disabled={busy || unknown || !scopeRoot} onClick={() => void deletionPreview()}>Permanently delete account</Button><Button variant="outline" disabled={busy || unknown} onClick={close}>Done</Button>
        </div>
      </>}
      {details && mode === 'edit' && <form onSubmit={e => { e.preventDefault(); if (!name.trim() || busy || unknown) return; setMode('confirm'); }}>
        <p className="mb-4">Name and lifecycle status only. Ownership, permissions and account type stay unchanged.</p>
        <label htmlFor="fleet-account-name">Account name</label><Input id="fleet-account-name" maxLength={200} required value={name} disabled={busy || unknown} onChange={e => setName(e.target.value)} className="mb-4" />
        <label htmlFor="fleet-account-status">Status</label><select id="fleet-account-status" value={status} disabled={busy || unknown} onChange={e => setStatus(e.target.value)} className="mb-5 block w-full rounded-md border border-[var(--pg-line)] bg-[var(--pg-canvas)] px-3 py-2">
          {['trial','active','past_due','suspended','canceled'].map(value => <option key={value} value={value}>{value.replace(/_/g,' ')}</option>)}
        </select><div className="flex gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => dirty ? setMode('discard') : setMode('view')}>Cancel</Button><Button type="submit" disabled={busy || unknown || !name.trim() || !dirty}>Review changes</Button></div>
      </form>}
      {mode === 'confirm' && <><p>Save the name “{name.trim()}” and status “{status}”?</p><p>Status changes can suspend or cancel workspace access. Billing and provider services are not canceled by this edit.</p><div className="flex gap-3"><Button variant="outline" disabled={busy} onClick={() => setMode('edit')}>Back</Button><Button disabled={busy || unknown} onClick={() => void save()}>Save changes</Button></div></>}
      {mode === 'discard' && <><p>Discard unsaved changes?</p><div className="flex gap-3"><Button onClick={() => setMode('edit')}>Keep editing</Button><Button variant="outline" onClick={() => { setName(details?.name ?? ''); setStatus(details?.status ?? ''); setMode('view'); }}>Discard changes</Button></div></>}
      {details && (mode === 'delete' || mode === 'archive') && <>
        <h3 className="text-lg font-medium">{mode === 'archive' ? 'Archive account' : 'Permanently delete account'}</h3>
        <p>{mode === 'archive' ? 'Archive the listed scope, remove active access and pause execution. Business records stay in place for restoration.' : 'Permanently remove the listed workspaces and eligible data. Shared logins and their other accounts are preserved. A completed deletion cannot be undone here.'}</p>
        {preview && <>
          <p role="status" className={preview.execution_available || files ? 'text-[var(--pg-positive)]' : 'text-[var(--pg-warning)]'}>{preview.execution_available || files ? 'READY · Server preflight permits this scope.' : 'BLOCKED · Resolve the requirements below.'}</p>
          <h4 className="mt-2 font-medium">Accounts in scope</h4><ul className="list-disc space-y-1 pl-5 break-words">{preview.accounts.map(a => <li key={a.id}>{a.name} · {a.account_type.replace(/_/g,' ')}{a.status ? ' · ' + a.status : ''}</li>)}</ul>
          {preview.memberships !== undefined && <p>{preview.memberships} workspace memberships · {preview.shared_identities ?? 'Unverified'} identities also belong to other workspaces. Shared logins are preserved.</p>}
          {preview.dependencies && preview.dependencies.length > 0 && <div><h4 className="mb-2 mt-4 font-medium">Data disposition</h4><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--pg-line)]"><th className="py-2 font-medium">Records</th><th className="px-3 py-2 font-medium">Count</th><th className="py-2 font-medium">Disposition</th></tr></thead><tbody>{preview.dependencies.map(d => <tr key={d.relation} className="border-b border-[var(--pg-line-soft)]"><td className="break-words py-2">{d.relation.replace(/_/g,' ')}</td><td className="px-3 py-2 tabular-nums">{d.count}</td><td className="py-2">{d.disposition === 'delete' ? 'Delete' : d.disposition === 'preserve' ? 'Preserve' : 'Blocked'}</td></tr>)}</tbody></table></div>}
          {!files && preview.blockers.length > 0 && <><h4 className="mt-4 font-medium">Required before execution</h4><ul className="list-disc space-y-2 pl-5 break-words">{preview.blockers.map((b,i) => <li key={i}>{b === 'Archive this account and its children before permanent deletion.' ? 'Archive this account before permanent deletion.' : b}</li>)}</ul></>}
          {preview.warnings?.map(warning => <p key={warning}>{warning}</p>)}
          {files && <p>{preview.storage_count} eligible files will be removed as part of this deletion. File absence and the unchanged account scope are verified before account removal.</p>}
          {preview.preserved && <><h4 className="mt-2 font-medium">Preserved</h4><ul className="list-disc pl-5 break-words">{preview.preserved.map(p => <li key={p}>{p}</li>)}</ul></>}
          {mode === 'delete' && <p>Deleting PAIGE data does not cancel external services or charges. Required audit history and scheduled backups follow existing retention policies.</p>}
          {(preview.execution_available || files) && <div className="mt-3 space-y-3"><label htmlFor="fleet-lifecycle-confirm">Type “{details.name}” to confirm the entire listed scope</label><Input id="fleet-lifecycle-confirm" autoComplete="off" value={confirmation} disabled={busy || unknown} onChange={e => setConfirmation(e.target.value)} />{mode === 'delete' && <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--pg-negative)]" checked={irreversible} disabled={busy || unknown} onChange={e => setIrreversible(e.target.checked)} /><span>I understand that this permanently deletes the listed eligible data.</span></label>}</div>}
        </>}
        <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy || unknown} onClick={() => setMode('view')}>Cancel</Button><Button variant="outline" disabled={busy || unknown} onClick={() => void deletionPreview(mode === 'archive' ? 'archive' : 'delete')}>Refresh review</Button><Button disabled={busy || unknown || !(preview?.execution_available || files) || confirmation !== details.name || (mode === 'delete' && !irreversible)} className={mode === 'delete' ? 'bg-[var(--pg-negative)] hover:bg-[var(--pg-negative)]' : undefined} onClick={() => void execute(mode === 'archive' ? 'archive' : 'delete')}>{mode === 'archive' ? 'Archive listed accounts' : 'Permanently delete listed accounts'}</Button></div>
      </>}
      {mode === 'restore' && <><h3 className="text-lg font-medium">Restore archived account?</h3><p>Restore the original account scope and unchanged memberships. Paid services and scheduled/provider execution stay paused. No subscription is reactivated.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy || unknown} onClick={() => setMode('view')}>Cancel</Button><Button disabled={busy || unknown} onClick={() => void execute('restore')}>Restore account access</Button></div></>}
      {mode === 'completed' && receipt && <><p role="status" className="text-[var(--pg-positive)]">COMPLETED · {receipt.account_count} {receipt.account_count === 1 ? 'account' : 'accounts'} {receipt.state === 'deleted' ? 'permanently deleted' : receipt.state} and independently read back.</p>{receipt.external_cleanup_pending && <p>PAIGE retirement is complete. External cleanup remains pending; services or charges may continue.</p>}{receipt.state === 'restored' && <p>Access is restored. Provider and scheduled execution remains paused.</p>}<Button onClick={onClose}>Done</Button></>}
    </DialogContent>
  </Dialog>;
}
