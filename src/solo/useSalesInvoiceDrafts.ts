import { useCallback, useEffect, useRef, useState } from 'react';
import { useTenantContext } from '@/hooks/useTenantContext';
import { supabase } from '@/integrations/supabase/client';
import { listInvoiceDrafts, saveInvoiceDraft, type InvoiceDraft, type InvoiceDraftSaveRequest } from './sales/invoiceDraftApi';
import type { BillingRpc } from './sales/billingDrafts';

// New migration RPCs are not yet in generated database types. This explicit narrow adapter
// forwards the caller's ordinary session, never a service key or browser-resolved authority.
const rpc: BillingRpc = (name, args) => (supabase.rpc as unknown as BillingRpc)(name, args);
type Identity = { tenant: string | null; resolving: boolean };
type View = { identity: Identity; phase: 'loading' | 'ready' | 'error' | 'unavailable'; rows: InvoiceDraft[]; hasMore: boolean; nextCursor: string | null; message: string };

export function useSalesInvoiceDrafts() {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const identity = useRef<Identity>({ tenant: activeTenantId ?? null, resolving: accountContextLoading });
  if (identity.current.tenant !== (activeTenantId ?? null) || identity.current.resolving !== accountContextLoading) {
    identity.current = { tenant: activeTenantId ?? null, resolving: accountContextLoading };
  }
  const [refresh, setRefresh] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageMessage, setPageMessage] = useState('');
  const pageRequest = useRef<object | null>(null);
  const [view, setView] = useState<View>({ identity: identity.current, phase: 'loading', rows: [], hasMore: false, nextCursor: null, message: '' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const opened = identity.current;
    let cancelled = false;
    pageRequest.current = null; setLoadingMore(false); setPageMessage('');
    setView({ identity: opened, phase: 'loading', rows: [], hasMore: false, nextCursor: null, message: '' });
    if (!opened.tenant || opened.resolving) return;
    void listInvoiceDrafts(rpc, opened.tenant).then(result => {
      if (cancelled || !alive.current || identity.current !== opened) return;
      setView(result.ok === true
        ? { identity: opened, phase: 'ready', ...result.value, message: '' }
        : { identity: opened, phase: result.outcome === 'unavailable' ? 'unavailable' : 'error', rows: [], hasMore: false, nextCursor: null, message: 'Billing drafts could not be read. Retry after checking workspace and access.' });
    });
    return () => { cancelled = true; };
  }, [activeTenantId, accountContextLoading, refresh]);
  const retry = useCallback(() => setRefresh(n => n + 1), []);
  const loadMore = useCallback(async () => {
    const opened = identity.current;
    if (!alive.current || opened.resolving || !opened.tenant || view.identity !== opened || view.phase !== 'ready' || !view.hasMore || !view.nextCursor || pageRequest.current) return;
    const token = {};
    pageRequest.current = token; setLoadingMore(true); setPageMessage('');
    const result = await listInvoiceDrafts(rpc, opened.tenant, view.nextCursor);
    if (!alive.current || identity.current !== opened || pageRequest.current !== token) return;
    pageRequest.current = null; setLoadingMore(false);
    if (result.ok === false) { setPageMessage('Further records could not be read. Retry loading more.'); return; }
    setView(previous => previous.identity !== opened ? previous : {
      ...previous, rows: [...previous.rows, ...result.value.rows.filter(row => !previous.rows.some(existing => existing.id === row.id))],
      hasMore: result.value.hasMore, nextCursor: result.value.nextCursor,
    });
  }, [view]);
  const save = useCallback(async (request: InvoiceDraftSaveRequest) => {
    const opened = identity.current;
    if (!alive.current || opened.resolving || request.openedTenantId !== opened.tenant) {
      return { ok: false as const, outcome: 'refused' as const, message: 'Your workspace changed. Reopen the draft in its original workspace.' };
    }
    const result = await saveInvoiceDraft(rpc, request);
    if (!alive.current || identity.current !== opened) return { ok: false as const, outcome: 'unknown' as const, message: 'Your workspace changed while saving. Check the original workspace before retrying.' };
    if (result.ok) retry();
    return result;
  }, [retry]);
  const current = identity.current;
  // A->B->A is a new identity epoch too: never reveal the previous A response on return.
  const visible = view.identity === current ? view : { phase: 'loading' as const, rows: [], hasMore: false, nextCursor: null, message: '' };
  return { ...visible, tenantId: current.tenant, phase: current.resolving ? 'resolving' as const : !current.tenant ? 'unavailable' as const : visible.phase, retry, save, loadMore, loadingMore: view.identity === current && loadingMore, pageMessage: view.identity === current ? pageMessage : '' };
}
