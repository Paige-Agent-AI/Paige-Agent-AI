import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { OperationsClientArtifactReview, type VerifiedClientDecision } from '@/solo/operations/OperationsClientArtifactReview';
import { checkPortalReviewAccess, readPortalReleasedWork, type ClientDeliveryPortalPort, type PortalReleasedWork, type PortalReviewReference } from '@/lib/client-delivery-portal';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { ClientDeliveryPortalContext as Context, type ClientWorkView as WorkView } from './client-delivery-portal-context';
import './client-delivery-portal.css';

type Selection = PortalReviewReference & { instance: number };
const caller = supabase as unknown as ClientDeliveryPortalPort;
const sameSource = (selection: Selection, value: VerifiedClientDecision) => value.actorId === selection.scope.actorId
  && value.tenantId === selection.scope.tenantId && value.releaseId === selection.release.release_id
  && value.submissionId === selection.release.submission_id && value.revisionNo === selection.release.revision_no
  && value.artifactDigest === selection.release.artifact_digest;

/** One ephemeral client-review presentation lifetime; canonical records and authority stay in Operations. */
export function ClientDeliveryReviewProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { resolvedTheme, forcedTheme } = useTheme();
  const theme = (forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light';
  const { isImpersonating } = useImpersonation();
  const { isAdmin, mode } = useDashboardMode();
  const preview = isImpersonating || (isAdmin && mode === 'client');
  const previewRef = useRef(preview); previewRef.current = preview;
  const mounted = useRef(true), life = useRef(0), reads = useRef(0), opens = useRef(0), checks = useRef(0), instances = useRef(0);
  const authLease = useRef<symbol | null>(null);
  const actualActor = useRef<string | null | undefined>(undefined), expectedActor = useRef<string | null>(null);
  const activeList = useRef<{ actorId: string } | null>(null);
  const latestWork = useRef<WorkView>({ actorId: null, loading: false, result: null });
  const liveSelection = useRef<Selection | null>(null);
  const closeGuard = useRef<{ instance: number; guard: () => boolean } | null>(null);
  const opener = useRef<HTMLElement | null>(null), fallback = useRef<HTMLDivElement>(null), feedback = useRef<HTMLDivElement>(null);
  const [work, setWork] = useState(latestWork.current);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState(''), [accessNotice, setAccessNotice] = useState('');
  const focusFeedback = useRef<number | null>(null);
  const readCurrent = useCallback((actorId: string, generation: number) => mounted.current
    && life.current === generation && !previewRef.current && expectedActor.current === actorId
    && (actualActor.current === undefined || actualActor.current === actorId), []);
  const publishWork = useCallback((value: WorkView) => { latestWork.current = value; setWork(value); }, []);
  const retireRequests = useCallback(() => { life.current++; reads.current++; opens.current++; checks.current++; }, []);
  const invalidate = useCallback(() => {
    retireRequests(); expectedActor.current = null;
    liveSelection.current = null; closeGuard.current = null; opener.current = null;
    setSelection(null); setOpening(null); setAccessNotice(''); setNotice('');
    publishWork({ actorId: null, loading: false, result: null });
  }, [publishWork, retireRequests]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; retireRequests(); liveSelection.current = null; closeGuard.current = null; };
  }, [retireRequests]);
  const retireSelection = useCallback(() => {
    opener.current = null; liveSelection.current = null; closeGuard.current = null; opens.current++; checks.current++;
    setSelection(null); setAccessNotice(''); setNotice('This review is no longer available with your current access.');
  }, []);

  const load = useCallback(async (actorId: string, quiet = false): Promise<PortalReleasedWork | null> => {
    if (!mounted.current || !actorId || previewRef.current
      || (actualActor.current !== undefined && actualActor.current !== actorId)) return null;
    if (expectedActor.current !== actorId) { invalidate(); expectedActor.current = actorId; }
    const generation = life.current, sequence = ++reads.current;
    const current = () => readCurrent(actorId, generation) && reads.current === sequence;
    if (!quiet) publishWork({ actorId, loading: true, result: null });
    const result = await readPortalReleasedWork(caller, actorId, current);
    if (!current()) return null;
    if (result.kind === 'ready' && actualActor.current === undefined) actualActor.current = actorId;
    const selected = liveSelection.current;
    if (selected && (result.kind === 'unlinked' || result.kind === 'ambiguous'
      || (result.kind === 'ready' && (result.scope.clientId !== selected.scope.clientId || result.scope.tenantId !== selected.scope.tenantId)))) retireSelection();
    publishWork({ actorId, loading: false, result });
    return result;
  }, [invalidate, publishWork, readCurrent, retireSelection]);
  const refresh = useCallback((actorId: string) => { setNotice(''); void load(actorId); }, [load]);
  const attachList = useCallback((actorId: string) => {
    const entry = { actorId }; activeList.current = entry; void load(actorId);
    return () => { if (activeList.current === entry) activeList.current = null; };
  }, [load]);
  const mayClose = useCallback(() => {
    const selected = liveSelection.current, registered = closeGuard.current;
    if (!selected) return true;
    try { return registered?.instance === selected.instance && registered.guard() === true; }
    catch { return false; }
  }, []);
  const close = useCallback(() => {
    if (!mayClose()) {
      focusFeedback.current = liveSelection.current?.instance ?? null;
      setAccessNotice('Keep this review open. Resolve the note or recorded decision before closing.');
      feedback.current?.focus(); return;
    }
    opens.current++; checks.current++; liveSelection.current = null; closeGuard.current = null;
    setSelection(null); setAccessNotice('');
  }, [mayClose]);

  const open = useCallback(async (actorId: string, releaseId: string, button: HTMLElement) => {
    const view = latestWork.current;
    if (!view.result || view.result.kind !== 'ready' || view.actorId !== actorId
      || !readCurrent(actorId, life.current)) return;
    const release = view.result.releases.find(row => row.release_id === releaseId);
    if (!release) return;
    if (!mayClose()) { focusFeedback.current = liveSelection.current?.instance ?? null; setAccessNotice('Finish the current review before selecting another version.'); return; }
    const generation = life.current, sequence = ++opens.current;
    const current = () => readCurrent(actorId, generation) && opens.current === sequence;
    const reference = { scope: view.result.scope, release };
    setOpening(releaseId); setNotice('');
    const access = await checkPortalReviewAccess(caller, reference, current);
    if (!current()) return;
    setOpening(null);
    if (access.kind !== 'ready') { setNotice('This released version could not be opened. Check your access and try again.'); return; }
    // A previously clean instance may become dirty while the access read is pending.
    if (!mayClose()) { setAccessNotice('Finish the current review before selecting another version.'); return; }
    const next: Selection = { scope: reference.scope, release: Object.freeze({ ...release }), instance: ++instances.current };
    checks.current++; opener.current = button; liveSelection.current = next; closeGuard.current = null;
    setSelection(next); setAccessNotice('');
  }, [mayClose, readCurrent]);
  useLayoutEffect(() => {
    if (accessNotice && focusFeedback.current !== null && liveSelection.current?.instance === focusFeedback.current) {
      focusFeedback.current = null; feedback.current?.focus();
    }
  }, [accessNotice]);

  const revalidate = useCallback(async () => {
    const selected = liveSelection.current;
    if (!selected || previewRef.current) return;
    const generation = life.current, sequence = ++checks.current;
    const current = () => readCurrent(selected.scope.actorId, generation)
      && liveSelection.current?.instance === selected.instance && checks.current === sequence;
    const result = await checkPortalReviewAccess(caller, selected, current);
    if (!current()) return;
    if (result.kind === 'ready') { setAccessNotice(''); return; }
    if (result.kind === 'unlinked' || result.kind === 'ambiguous'
      || (result.kind === 'refused' && 'invalidated' in result && result.invalidated)) {
      // Proven scope loss is involuntary. It must not consult a dirty-work guard.
      retireSelection();
      const active = activeList.current; if (active) void load(active.actorId);
      return;
    }
    // A failed refresh does not revoke previously read content or erase an unknown attempt.
    // Every Operations decision still reauthorizes through its existing canonical writer.
    setAccessNotice('Access could not be checked. Your loaded review is retained. Check access again.');
  }, [load, readCurrent, retireSelection]);
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    if (!mounted.current || previewRef.current) return;
    if (liveSelection.current) void revalidate();
    else { const active = activeList.current; if (active && (actualActor.current === undefined || active.actorId === actualActor.current)
      && !(latestWork.current.actorId === active.actorId && latestWork.current.loading)) void load(active.actorId); }
  };
  useEffect(() => {
    const lease = Symbol('client-review-auth'); authLease.current = lease;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current || authLease.current !== lease) return;
      const next = session?.user.id ?? null, previous = actualActor.current;
      actualActor.current = next;
      if ((previous !== undefined && previous !== next)
        || (expectedActor.current !== null && expectedActor.current !== next)) invalidate();
      // Reuse actual SDK identity. No async SDK query runs inside the auth callback.
      window.setTimeout(() => refreshRef.current(), 0);
    });
    return () => { if (authLease.current === lease) authLease.current = null; subscription.unsubscribe(); };
  }, [invalidate]);
  useEffect(() => { if (preview) invalidate(); else refreshRef.current(); }, [preview, invalidate]);
  useEffect(() => { if (liveSelection.current) void revalidate(); }, [location.key, revalidate]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') refreshRef.current(); };
    window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, []);

  const instance = selection?.instance;
  const registerCloseGuard = useCallback((guard: () => boolean) => {
    const entry = { instance: instance ?? -1, guard };
    if (liveSelection.current?.instance === instance) closeGuard.current = entry;
    return () => { if (closeGuard.current === entry) closeGuard.current = null; };
  }, [instance]);
  const verified = useCallback(async (decision: VerifiedClientDecision) => {
    const selected = liveSelection.current;
    if (!selected || selected.instance !== instance || !sameSource(selected, decision)
      || !['accepted', 'client_revision_requested'].includes(decision.state)) return;
    const generation = life.current;
    const current = () => readCurrent(selected.scope.actorId, generation)
      && liveSelection.current?.instance === selected.instance;
    const result = await load(selected.scope.actorId, true);
    if (!current()) return;
    const latest = latestWork.current;
    const evidence = result ?? (latest.actorId === selected.scope.actorId && !latest.loading ? latest.result : null);
    const row = evidence?.kind === 'ready' ? evidence.releases.find(r => r.release_id === decision.releaseId) : null;
    if (!row || row.submission_id !== decision.submissionId || row.revision_no !== decision.revisionNo
      || row.artifact_digest !== decision.artifactDigest || row.updated_at !== decision.updatedAt || row.state !== decision.state)
      setNotice('The decision is recorded. Check released work again for the latest list.');
  }, [instance, load, readCurrent]);
  const value = useMemo(() => ({ work, opening, notice, preview, attachList, refresh, open }), [work, opening, notice, preview, attachList, refresh, open]);
  const visible = selection && liveSelection.current?.instance === selection.instance && !preview
    && actualActor.current === selection.scope.actorId;

  return <Context.Provider value={value}>
    {children}
    <div ref={fallback} className="sr-only" tabIndex={-1}>Review closed.</div>
    <Dialog open={Boolean(visible)} onOpenChange={next => { if (!next) close(); }}>
      {visible && <DialogContent className="client-delivery-review-dialog paige-solo" data-pg={theme}
        onCloseAutoFocus={event => { event.preventDefault(); if (liveSelection.current) return; const target = opener.current; if (target?.isConnected && actualActor.current === selection.scope.actorId) target.focus(); else fallback.current?.focus(); }}>
        <DialogTitle className="sr-only">Review released work</DialogTitle>
        <DialogDescription className="sr-only">Review this released version and record your explicit decision. Unfinished work stays open until resolved.</DialogDescription>
        <div className="client-delivery-review-header"><button type="button" onClick={close}>Close review</button></div>
        {accessNotice && <div ref={feedback} tabIndex={-1} role="status" className="client-delivery-access-status"><p>{accessNotice}</p><button type="button" onClick={() => void revalidate()}>Check review access</button></div>}
        {notice && <p role="status" className="client-delivery-access-status">{notice}</p>}
        <OperationsClientArtifactReview key={selection.instance} actorId={selection.scope.actorId} tenantId={selection.scope.tenantId}
          releaseId={selection.release.release_id} theme={theme}
          registerCloseGuard={registerCloseGuard} onVerifiedDecision={verified} />
      </DialogContent>}
    </Dialog>
  </Context.Provider>;
}
