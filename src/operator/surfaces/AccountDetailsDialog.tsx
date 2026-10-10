import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button as BaseButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readAccountDetails, saveAccountDetails, previewAccountDeletion, type AccountDetails, type DeletionPreview } from '@/operator/data/accountControls';
import { cn } from '@/lib/utils';

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
  const [mode, setMode] = useState<'view' | 'edit' | 'discard' | 'confirm' | 'delete'>('view');
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [busy, setBusy] = useState(true);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const request = useRef(0);
  const pending = useRef(false);
  const dirty = Boolean(details && (name !== details.name || status !== details.status));

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
  async function deletionPreview() {
    if (pending.current || unknown) return;
    pending.current = true; setBusy(true); setError(''); setPreview(null); setMode('delete');
    try {
      const result = await previewAccountDeletion(tenantId);
      if (alive.current) setPreview(result);
    } catch(e) { if (alive.current) setError(e instanceof Error ? e.message : 'Deletion preview unavailable. Retry.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent data-pg={typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'} className="max-w-xl rounded-xl border-[var(--pg-line)] bg-[var(--pg-raised)] text-[var(--pg-ink)] motion-reduce:animate-none" onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); close(); }}>
      <DialogTitle>{details?.name ?? 'Account details'}</DialogTitle>
      <DialogDescription>{details ? `${details.account_type.replace(/_/g, ' ')} · ${details.status}` : 'Read the account through the Platform Operator lifecycle.'}</DialogDescription>
      {busy && <p role="status">{pending.current ? 'Verifying the operation…' : 'Reading account details…'}</p>}
      {error && <p role="alert" className="text-[var(--pg-negative)]">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {unknown && <Button disabled={busy} onClick={() => void load()}>Read current account</Button>}
      {!details && !busy && <Button onClick={() => void load()}>Retry details</Button>}
      {details && mode === 'view' && <>
        {details.parent_tenant_id && <p>This account belongs to an Agency. Editing preserves that relationship.</p>}
        <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => { setMode('edit'); setNotice(''); }}>Edit account</Button><Button variant="outline" disabled={busy} onClick={() => void deletionPreview()}>Review deletion</Button><Button variant="outline" disabled={busy || unknown} onClick={close}>Done</Button></div>
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
      {mode === 'delete' && <>
        <p>Solo accounts and Platform Operator workspaces are protected from Agency cleanup. Shared user identities are preserved.</p>
        {preview && <><h3 className="font-medium">Accounts in scope</h3><ul className="list-disc pl-5">{preview.accounts.map(a => <li key={a.id}>{a.name} · {a.account_type.replace(/_/g,' ')}</li>)}</ul><h3 className="font-medium">Deletion blocked</h3><ul className="list-disc pl-5">{preview.blockers.map((b,i) => <li key={i}>{b}</li>)}</ul><p>No deletion has run. This preview never deletes accounts.</p></>}
        <div className="flex gap-3"><Button disabled={busy} onClick={() => void deletionPreview()}>Refresh preview</Button><Button variant="outline" disabled={busy} onClick={() => setMode('view')}>Cancel</Button></div>
      </>}
    </DialogContent>
  </Dialog>;
}
