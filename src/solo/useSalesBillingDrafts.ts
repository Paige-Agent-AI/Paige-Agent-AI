import { useCallback, useEffect, useRef, useState } from 'react';
import { useTenantContext } from '@/hooks/useTenantContext';
import { supabase } from '@/integrations/supabase/client';
import { listBillingDrafts, saveBillingDraft, type BillingDraft, type BillingRpc, type DraftSaveRequest } from './sales/billingDrafts';

// New migration RPCs are not yet in generated database types. This explicit narrow adapter
// forwards the caller's ordinary session, never a service key or browser-resolved authority.
const rpc: BillingRpc = (name, args) => (supabase.rpc as unknown as BillingRpc)(name, args);
type Identity = { tenant: string | null; resolving: boolean };
type View = { identity: Identity; phase: 'loading' | 'ready' | 'error' | 'unavailable'; rows: BillingDraft[]; hasMore: boolean; nextCursor: string | null; message: string };

export function useSalesBillingDrafts() {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const identity = useRef<Identity>({ tenant: activeTenantId ?? null, resolving: accountContextLoading });
  if (identity.current.tenant !== (activeTenantId ?? null) || identity.current.resolving !== accountContextLoading) {
    identity.current = { tenant: activeTenantId ?? null, resolving: accountContextLoading };
  }
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<View>({ identity: identity.current, phase: 'loading', rows: [], hasMore: false, nextCursor: null, message: '' });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const opened = identity.current;
    let cancelled = false;
    setView({ identity: opened, phase: 'loading', rows: [], hasMore: false, nextCursor: null, message: '' });
    if (!opened.tenant || opened.resolving) return;
    void listBillingDrafts(rpc, opened.tenant).then(result => {
      if (cancelled || !alive.current || identity.current !== opened) return;
      setView(result.ok === true
        ? { identity: opened, phase: 'ready', ...result.value, message: '' }
        : { identity: opened, phase: result.outcome === 'unavailable' ? 'unavailable' : 'error', rows: [], hasMore: false, nextCursor: null, message: 'Billing drafts could not be read. Retry after checking workspace and access.' });
    });
    return () => { cancelled = true; };
  }, [activeTenantId, accountContextLoading, refresh]);
  const retry = useCallback(() => setRefresh(n => n + 1), []);
  const save = useCallback(async (request: DraftSaveRequest) => {
    const opened = identity.current;
    if (!alive.current || opened.resolving || request.openedTenantId !== opened.tenant) {
      return { ok: false as const, outcome: 'refused' as const, message: 'Your workspace changed. Reopen the draft in its original workspace.' };
    }
    const result = await saveBillingDraft(rpc, request);
    if (!alive.current || identity.current !== opened) return { ok: false as const, outcome: 'unknown' as const, message: 'Your workspace changed while saving. Check the original workspace before retrying.' };
    if (result.ok) retry();
    return result;
  }, [retry]);
  const current = identity.current;
  // A->B->A is a new identity epoch too: never reveal the previous A response on return.
  const visible = view.identity === current ? view : { phase: 'loading' as const, rows: [], hasMore: false, nextCursor: null, message: '' };
  return { ...visible, tenantId: current.tenant, phase: current.resolving ? 'resolving' as const : !current.tenant ? 'unavailable' as const : visible.phase, retry, save };
}
