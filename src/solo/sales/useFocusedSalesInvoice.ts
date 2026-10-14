import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { readInvoiceRecord, type InvoiceRecord } from './invoiceLifecycleApi';
import type { BillingRpc } from './billingDrafts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Options = { tenantId: string | null; resolving: boolean; invoiceIds: readonly string[]; accountEpoch?: string | null };
type Phase = 'idle' | 'loading' | 'ready' | 'refused' | 'unavailable';
type View = { identity: object; actorEpoch: object; phase: Phase; row: InvoiceRecord | null; message: string };
type Actor = { identity: object; epoch: object; id: string | null };
const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as unknown as BillingRpc)(name, args);
const refused = 'This invoice could not be opened in this workspace. Check your access or return to invoices.';
const unavailable = 'This invoice is unavailable. Retry the saved record or return to invoices.';

/** Exact saved-record read only. URL ids locate records; caller JWT and active workspace authorize them. */
export function useFocusedSalesInvoice({ tenantId, resolving, invoiceIds, accountEpoch = null }: Options) {
  const focusKey = JSON.stringify(invoiceIds);
  const [refresh, setRefresh] = useState(0);
  const identity = useRef({ tenantId, resolving, focusKey, refresh, accountEpoch });
  if (identity.current.tenantId !== tenantId || identity.current.resolving !== resolving
    || identity.current.focusKey !== focusKey || identity.current.refresh !== refresh || identity.current.accountEpoch !== accountEpoch) {
    identity.current = { tenantId, resolving, focusKey, refresh, accountEpoch };
  }
  const actorEpoch = useRef<object>({});
  const liveActor = useRef<Actor | null>(null);
  const [actor, setActor] = useState<Actor | null>(null);
  const [view, setView] = useState<View>(() => ({ identity: identity.current, actorEpoch: actorEpoch.current, phase: 'idle', row: null, message: '' }));
  const openedIdentity = identity.current;

  useEffect(() => {
    const opened = openedIdentity;
    let cancelled = false;
    let authEvents = 0;
    const ids = JSON.parse(opened.focusKey) as string[];
    if (ids.length !== 1 || !uuid.test(ids[0]) || opened.resolving || !opened.tenantId || !uuid.test(opened.tenantId)) return;
    const recordActor = (id: string | null) => {
      if (cancelled || identity.current !== opened) return;
      if (liveActor.current?.identity === opened && liveActor.current.id === id) return;
      const next = { identity: opened, epoch: {}, id };
      // Synchronously invalidate visible/read-in-flight facts before React applies the update.
      actorEpoch.current = next.epoch;
      liveActor.current = next;
      setActor(next);
    };
    // The callback is synchronous state only. Supabase calls run in the separate read effect.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authEvents += 1;
      recordActor(session?.user.id ?? null);
    });
    const bootstrapEpoch = authEvents;
    void supabase.auth.getSession().then(({ data: session }) => {
      if (bootstrapEpoch === authEvents) recordActor(session.session?.user.id ?? null);
    }).catch(() => { if (bootstrapEpoch === authEvents) recordActor(null); });
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, [openedIdentity]);

  useEffect(() => {
    const opened = openedIdentity;
    let cancelled = false;
    const set = (phase: Phase, message = '', row: InvoiceRecord | null = null, epoch = actorEpoch.current) => {
      if (!cancelled && identity.current === opened && actorEpoch.current === epoch) {
        setView({ identity: opened, actorEpoch: epoch, phase, row, message });
      }
    };
    const ids = JSON.parse(opened.focusKey) as string[];
    if (!ids.length) { set('idle'); return; }
    if (ids.length !== 1 || !uuid.test(ids[0])) { set('refused', 'This invoice link is invalid. Return to invoices to choose a saved record.'); return; }
    if (opened.resolving) { set('loading'); return; }
    if (!opened.tenantId || !uuid.test(opened.tenantId)) { set('unavailable', 'Your workspace could not be resolved. Return to invoices after checking your account.'); return; }
    const expectedTenant = opened.tenantId;
    const invoiceId = ids[0].toLowerCase();
    set('loading');
    if (!actor || actor.identity !== opened || liveActor.current !== actor) return;
    const { id: actorId, epoch } = actor;
    if (!actorId || !uuid.test(actorId)) { set('refused', 'Sign in to open this saved invoice.', null, epoch); return; }
    void (async () => {
      try {
        const response = await rpc('read_sales_invoice', { _expected_tenant_id: expectedTenant, _invoice_id: invoiceId });
        if (cancelled || identity.current !== opened || actorEpoch.current !== epoch) return;
        // A missed/late auth event must not publish a response read by a previous actor.
        const { data: current } = await supabase.auth.getSession();
        if (cancelled || identity.current !== opened || actorEpoch.current !== epoch) return;
        if (current.session?.user.id !== actorId) { set('refused', 'Your sign-in changed. Retry this invoice in your current workspace.', null, epoch); return; }
        if (response.error) {
          const code = typeof response.error === 'object' && response.error !== null && 'code' in response.error ? String(response.error.code) : '';
          set(['42501', '28000', 'PGRST301', '401', '403'].includes(code) ? 'refused' : 'unavailable', ['42501', '28000', 'PGRST301', '401', '403'].includes(code) ? refused : unavailable, null, epoch);
          return;
        }
        if (response.data === null) { set('unavailable', unavailable, null, epoch); return; }
        const row = readInvoiceRecord(response.data, expectedTenant);
        // Parser scope validation is necessary but not sufficient: never accept another invoice.
        if (!row || row.id !== invoiceId) { set('refused', refused, null, epoch); return; }
        set('ready', '', row, epoch);
      } catch { set('unavailable', unavailable, null, epoch); }
    })();
    return () => { cancelled = true; };
  }, [openedIdentity, actor]);

  const retry = useCallback(() => setRefresh(value => value + 1), []);
  const current = view.identity === identity.current && view.actorEpoch === actorEpoch.current;
  return {
    phase: current ? view.phase : invoiceIds.length ? 'loading' as const : 'idle' as const,
    row: current ? view.row : null,
    message: current ? view.message : '',
    retry,
  };
}
