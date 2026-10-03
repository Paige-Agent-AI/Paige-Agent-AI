import React from 'react';
import { useSalesBillingDrafts } from '../useSalesBillingDrafts';
import { useCatalogOffers } from '../useCatalogOffers';
import { useSoloCommercialTerms } from '../useSoloCommercialTerms';
import { useSalesDraftExit } from '../sales-dialog';
import { billingDraftEditInput, type BillingDraft, type BillingDraftInput, type DraftSaveRequest } from './billingDrafts';
import { calculateBillingAmounts, parseMinorAmount } from './billingAmounts';
import './sales-billing.css';

const cash = (minor: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(minor / 100);
const label = (kind: BillingDraftInput['kind']) => kind === 'recurring' ? 'Monthly recurring' : kind === 'deposit' ? 'Deposit and balance' : 'One-time';
type Sources = ReturnType<typeof useSoloCommercialTerms>;
type Catalog = ReturnType<typeof useCatalogOffers>;
type Store = ReturnType<typeof useSalesBillingDrafts>;
type Form = { client: string; price: string; item: string; amount: string; quantity: string; kind: BillingDraftInput['kind']; deposit: string; provider: BillingDraftInput['provider']; date: string; email: string; memo: string };

function DraftEditor({ row, recurring, store, clients, catalog, catalogSearch, setCatalogSearch, onClose }: { row: BillingDraft | null; recurring: boolean; store: Store; clients: Sources; catalog: Catalog; catalogSearch: string; setCatalogSearch: (value: string) => void; onClose: () => void }) {
  const initial = row ? billingDraftEditInput(row.facts) : null;
  const [form, setForm] = React.useState<Form>(() => ({ client: initial?.client_id ?? '', price: initial?.price_id ?? '', item: initial?.item ?? '', amount: row ? (row.facts.unit_minor / 100).toFixed(2) : '', quantity: String(initial?.quantity ?? 1), kind: initial?.kind ?? (recurring ? 'recurring' : 'one_time'), deposit: initial?.deposit_basis_points ? (initial.deposit_basis_points / 100).toFixed(2) : '50', provider: initial?.provider ?? 'stripe', date: initial?.due_date ?? '', email: initial?.recipient_email ?? '', memo: initial?.memo ?? '' }));
  const [busy, setBusy] = React.useState(false);
  const [unknown, setUnknown] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [review, setReview] = React.useState(false);
  const request = React.useRef<DraftSaveRequest | null>(null);
  const submittedUnitMinor = React.useRef<number | null>(null);
  const invoiceId = React.useRef(row?.id ?? crypto.randomUUID());
  const { close, request: requestExit, confirmation, alive } = useSalesDraftExit(form, busy || unknown, onClose);
  const allowNavigation = React.useRef(false);
  React.useEffect(() => {
    const intercept = (event: MouseEvent) => {
      if (allowNavigation.current || !(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLButtonElement>('.so-subnav button, .so > .sb-actions button, .solo-campaigns .campaigns-tabs button');
      if (!target || target.disabled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      requestExit(() => { allowNavigation.current = true; try { target.click(); } finally { allowNavigation.current = false; } });
    };
    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, [requestExit]);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => { heading.current?.focus(); }, [review]);
  const prices = [...catalog.offers, ...catalog.referencedOffers].flatMap(offer => offer.availability === 'active' ? offer.prices.filter(price => price.active && price.currency?.toLowerCase() === 'usd' && price.unitAmount !== null && (form.kind === 'recurring' ? price.kind === 'recurring' && price.billingInterval === 'month' : price.kind === 'one_time')).map(price => ({ offer, price })) : []);
  const selected = prices.find(p => p.price.id === form.price);
  const unitMinor = (() => {
    if ((busy || unknown) && submittedUnitMinor.current !== null) return submittedUnitMinor.current;
    if (form.price) return selected?.price.unitAmount ?? null;
    try { return parseMinorAmount(form.amount, 2); } catch { return null; }
  })();
  const repriced = !!form.price && row?.facts.price_id === form.price && unitMinor !== null && unitMinor !== row.facts.unit_minor;
  const amounts = (() => { try { return unitMinor === null ? null : calculateBillingAmounts(unitMinor, Number(form.quantity), form.kind === 'deposit' ? parseMinorAmount(form.deposit, 2) : undefined); } catch { return null; } })();
  const update = (key: keyof Form, value: string) => { setForm(previous => ({ ...previous, [key]: value })); setNotice(''); request.current = null; };
  const input = (): BillingDraftInput | null => {
    try {
      if (!form.client || !clients.clients.some(c => c.id === form.client) || !form.item.trim()) throw new Error('Choose a client and enter an item description.');
      if (form.price && !selected) throw new Error('The current Catalog price is unavailable. Find its active offer or choose a custom item before reviewing or saving.');
      if (!amounts || amounts.totalMinor > 2147483647) throw new Error('Enter a valid amount, quantity and deposit percentage.');
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) throw new Error('Enter a valid billing email.');
      return { client_id: form.client, price_id: form.price || null, item: form.item.trim(), unit_minor: form.price ? null : parseMinorAmount(form.amount, 2), quantity: Number(form.quantity), kind: form.kind, deposit_basis_points: form.kind === 'deposit' ? parseMinorAmount(form.deposit, 2) : null, provider: form.provider, currency: 'usd', due_date: form.date || null, recipient_email: form.email.trim() || null, memo: form.memo.trim() || null, cadence: form.kind === 'recurring' ? 'monthly' : null };
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Check your billing details.'); return null; }
  };
  const save = async () => {
    const draft = request.current?.draft ?? input();
    if (!draft || !store.tenantId || busy) return;
    request.current ??= { openedTenantId: store.tenantId, invoiceId: invoiceId.current, expectedVersion: row?.version ?? 0, operationId: crypto.randomUUID(), draft };
    submittedUnitMinor.current ??= unitMinor;
    setBusy(true); setNotice('');
    const result = await store.save(request.current);
    if (!alive.current) return;
    setBusy(false);
    if (result.ok === true) { onClose(); return; }
    setUnknown(result.outcome === 'unknown');
    if (result.outcome !== 'unknown') { request.current = null; submittedUnitMinor.current = null; }
    setNotice(result.message);
  };
  return <div className="sb-editor">
    <header className="sb-toolbar"><h2 ref={heading} tabIndex={-1}>{review ? 'Review draft' : row ? 'Edit billing draft' : recurring ? 'Set up recurring billing' : 'Create invoice'}</h2><button className="btn" onClick={close} disabled={busy || unknown}>Back to records</button></header>
    {notice && <p role="alert" className="sb-notice">{notice}</p>}
    {unknown && <div className="sb-notice"><p>The original save may have succeeded. Keep these details fixed and retry the same operation to recover its confirmed record.</p><button className="btn btn-p" onClick={save} disabled={busy}>Recover original save</button></div>}
    <div className="sb-editor-grid"><section className="sb-panel">
      {review ? <div className="sb-paper"><h3>{form.item}</h3><p>Bill to {clients.clients.find(c => c.id === form.client)?.name}</p><p>{form.email || 'No billing email recorded'}</p><dl><dt>Structure</dt><dd>{label(form.kind)}</dd><dt>Unit price</dt><dd>{unitMinor === null ? 'Unavailable' : cash(unitMinor)}</dd><dt>Quantity</dt><dd>{form.quantity}</dd><dt>Draft total</dt><dd>{amounts ? cash(amounts.totalMinor) : 'Unavailable'}</dd><dt>Due date</dt><dd>{form.date || 'Not recorded'}</dd><dt>Preferred processor</dt><dd>{form.provider === 'stripe' ? 'Stripe' : 'PayPal'} · connection unavailable</dd></dl><p>{form.memo}</p><button className="btn" onClick={() => setReview(false)} disabled={busy || unknown}>Back to details</button></div>
        : <form onSubmit={event => { event.preventDefault(); if (input()) setReview(true); }}>
          <fieldset disabled={busy || unknown} className="sb-fields"><legend>Client and billing details</legend>
            <label>Client<select value={form.client} onChange={e => update('client', e.target.value)} required><option value="">Choose a client</option>{clients.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Billing email<input type="email" value={form.email} maxLength={254} onChange={e => update('email', e.target.value)} /></label>
            <label>Billing structure<select value={form.kind} onChange={e => { update('kind', e.target.value); update('price', ''); }}><option value="one_time">One-time invoice</option><option value="deposit">Deposit and balance</option><option value="recurring">Monthly recurring</option></select></label>
            <label>Find Catalog offer<input type="search" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} /></label>
            <label>Catalog offer<select value={form.price} onChange={e => { const option = prices.find(p => p.price.id === e.target.value); update('price', e.target.value); if (option) { update('item', option.offer.name); update('amount', ((option.price.unitAmount ?? 0) / 100).toFixed(2)); } }}><option value="">Custom item</option>{form.price && !selected && <option value={form.price}>Saved price · choose an active Catalog price</option>}{prices.map(({ offer, price }) => <option key={price.id} value={price.id}>{offer.name} · {cash(price.unitAmount ?? 0)}</option>)}</select></label>
            <label className="sb-full">Description<input required value={form.item} maxLength={200} onChange={e => update('item', e.target.value)} /></label>
            <label>Unit price · USD<input required inputMode="decimal" value={form.price ? unitMinor === null ? '' : (unitMinor / 100).toFixed(2) : form.amount} placeholder={form.price && unitMinor === null ? 'Current price unavailable' : undefined} disabled={!!form.price} onChange={e => update('amount', e.target.value)} /></label>
            <label>Quantity<input required type="number" min={1} max={1000} step={1} value={form.quantity} onChange={e => update('quantity', e.target.value)} /></label>
            {form.kind === 'deposit' && <label>Deposit percentage<input required inputMode="decimal" value={form.deposit} onChange={e => update('deposit', e.target.value)} /></label>}
            <label>{form.kind === 'recurring' ? 'Requested first billing date' : 'Due date'}<input type="date" value={form.date} onChange={e => update('date', e.target.value)} /></label>
            <label>Preferred processor<select value={form.provider} onChange={e => update('provider', e.target.value)}><option value="stripe">Stripe</option><option value="paypal">PayPal</option></select></label>
            <label className="sb-full">Memo<textarea value={form.memo} maxLength={2000} rows={2} onChange={e => update('memo', e.target.value)} /></label>
          </fieldset>
        </form>}
    </section><aside className="sb-panel sb-summary"><h3>Billing summary</h3><dl><dt>Unit price</dt><dd>{unitMinor === null ? 'Unavailable' : cash(unitMinor)}</dd><dt>Draft total</dt><dd>{amounts ? cash(amounts.totalMinor) : 'Enter an amount'}</dd><dt>{form.kind === 'recurring' ? 'Per monthly cycle' : 'Due now'}</dt><dd>{amounts ? cash(amounts.dueNowMinor) : '—'}</dd>{form.kind === 'deposit' && <><dt>Remaining balance</dt><dd>{amounts ? cash(amounts.remainderMinor) : '—'}</dd></>}</dl>{repriced && <p className="sb-notice" role="status">Catalog price changed from {cash(row.facts.unit_minor)} to {cash(unitMinor)} per unit. Saving reprices this draft at the current Catalog price.</p>}<p>Saving creates a billing record. Issuing, sending and collection require a connected processor.</p>{form.price && <p>The server confirms the current Catalog price when saving; the saved record is authoritative.</p>}<button className="btn" disabled>Issue and send · unavailable</button></aside></div>
    <footer className="sb-fixed-footer"><span>{amounts ? cash(amounts.totalMinor) + (form.kind === 'recurring' ? ' / month' : ' draft total') : 'Enter billing details'}</span><div className="sb-actions"><button className="btn" disabled={busy || unknown} onClick={save}>{busy ? 'Saving…' : 'Save draft'}</button>{!review && <button className="btn btn-p" disabled={busy || unknown} onClick={() => { if (input()) setReview(true); }}>Review draft</button>}</div></footer>
    {confirmation}
  </div>;
}

export function SalesBillingWorkspace({ view, integrationsPath }: { view: string; integrationsPath?: string }) {
  const store = useSalesBillingDrafts();
  const clients = useSoloCommercialTerms();
  const [search, setSearch] = React.useState('');
  const [catalogSearch, setCatalogSearch] = React.useState('');
  const catalog = useCatalogOffers({ search: catalogSearch, page: 0, pageSize: 25 });
  const [editing, setEditing] = React.useState<{ tenant: string; row: BillingDraft | null; recurring: boolean } | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const registerRef = React.useRef<HTMLDivElement>(null);
  const editorWasOpen = React.useRef(false);
  const currentEditor = editing?.tenant === store.tenantId && store.phase !== 'resolving' ? editing : null;
  React.useLayoutEffect(() => {
    if (editorWasOpen.current && !currentEditor) registerRef.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus();
    editorWasOpen.current = !!currentEditor;
  }, [currentEditor]);
  React.useEffect(() => { setEditing(null); setSelectedId(null); setSearch(''); setCatalogSearch(''); }, [store.tenantId]);
  const canEdit = store.phase === 'ready' && clients.phase === 'ready' && clients.tenantId === store.tenantId && clients.canManage && clients.clientsReadable && catalog.phase === 'ready' && catalog.tenantId === store.tenantId;
  if (currentEditor) return <DraftEditor key={`${currentEditor.tenant}:${currentEditor.row?.id ?? 'new'}`} row={currentEditor.row} recurring={currentEditor.recurring} store={store} clients={clients} catalog={catalog} catalogSearch={catalogSearch} setCatalogSearch={setCatalogSearch} onClose={() => setEditing(null)} />;
  const rows = store.rows.filter(row => (view === 'recurring' ? row.facts.kind === 'recurring' : view === 'invoices' ? row.facts.kind !== 'recurring' : true) && `${row.facts.item} ${row.number} ${clients.clients.find(c => c.id === row.facts.client_id)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const selected = rows.find(r => r.id === selectedId) ?? rows[0];
  const create = (recurring: boolean) => store.tenantId && setEditing({ tenant: store.tenantId, row: null, recurring });
  return <div className="sb-workspace" ref={registerRef}>
    <header className="sb-toolbar"><div className="sb-actions"><button className="btn btn-p" disabled={!canEdit} onClick={() => create(false)}>Create invoice</button><button className="btn" disabled={!canEdit} onClick={() => create(true)}>Set up recurring</button></div><span className="sb-muted">USD · draft records · processor status unavailable</span></header>
    {view === 'payments' ? <section className="sb-panel"><header><h2>Payments</h2></header><div className="sb-empty"><h3>Connect the evidence behind each payment</h3><p>Payment imports, allocations and payout matching are unavailable. Billing drafts do not establish collected revenue.</p>{integrationsPath && <a className="btn" href={integrationsPath}>Open Integrations</a>}<button className="btn" onClick={() => create(false)} disabled={!canEdit}>Create an invoice draft</button></div></section> : <>
      <section className="sb-panel"><header><h2>{view === 'recurring' ? 'Recurring drafts' : view === 'overview' ? 'Next billing actions' : 'Invoices'}</h2><label className="sb-search">Search drafts<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, item or reference" /></label></header>
        {(store.phase === 'loading' || store.phase === 'resolving') ? <p className="sb-empty" role="status">Reading billing drafts…</p> : store.phase !== 'ready' ? <div className="sb-empty"><h3>{store.phase === 'unavailable' ? 'Billing draft storage unavailable' : 'Billing drafts could not be read'}</h3><p>{store.message || 'Check your workspace and access before retrying.'}</p><button className="btn" onClick={store.retry}>Retry</button></div> : !rows.length ? <div className="sb-empty"><h3>{search ? 'No matching drafts' : 'Start with a client and an offer'}</h3><p>{search ? 'Try a different client, item or reference.' : 'Save an invoice, deposit or monthly recurring draft and return to it here.'}</p>{!canEdit && <p>Draft editing requires owner or admin access and readable client records.</p>}</div> : <div className="sb-register"><table><thead><tr><th>Client / item</th><th>Structure</th><th>Amount</th><th>State</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} aria-selected={selected?.id === row.id}><td><button className="sb-row-link" onClick={() => setSelectedId(row.id)}>{clients.clients.find(c => c.id === row.facts.client_id)?.name || 'Client record unavailable'}</button><small>{row.facts.item}</small></td><td>{label(row.facts.kind)}</td><td className="sb-money">{cash(row.totalMinor)}</td><td><span className="pill pill-v">Draft</span></td><td><button className="btn" disabled={!canEdit} onClick={() => store.tenantId && setEditing({ tenant: store.tenantId, row, recurring: row.facts.kind === 'recurring' })}>Edit</button></td></tr>)}</tbody></table></div>}
        {store.pageMessage && <p className="sb-notice" role="status">{store.pageMessage}</p>}
        {store.hasMore && <button className="btn" onClick={store.loadMore} disabled={store.loadingMore}>{store.loadingMore ? 'Reading more…' : 'Load more drafts'}</button>}
      </section>
      <div className="sb-detail-grid"><section className="sb-panel"><header><h3>{selected ? 'Billing record' : 'Record details'}</h3></header><div className="sb-paper">{selected ? <><h3>{selected.facts.item}</h3><dl><dt>Reference</dt><dd className="sb-reference">{selected.number}</dd><dt>Total obligation</dt><dd>{cash(selected.totalMinor)}</dd><dt>Due now</dt><dd>{cash(selected.dueNowMinor)}</dd><dt>Remaining balance</dt><dd>{cash(selected.remainderMinor)}</dd><dt>Version</dt><dd>{selected.version}</dd></dl><p>Not issued · no payment requested</p></> : <p>Select a billing record to inspect its saved facts.</p>}</div></section><section className="sb-panel"><header><h3>Collection and reconciliation</h3></header><div className="sb-paper"><p>Processor status unavailable.</p><p>Invoice delivery, customer approval, payments and payouts need verified provider records.</p>{integrationsPath && <a className="btn" href={integrationsPath}>Open Integrations</a>}<button className="btn" disabled>Send reminder · unavailable</button></div></section></div>
    </>}
    {catalog.hasMore && <label className="sb-catalog-search">Find a Catalog offer<input type="search" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} /></label>}
  </div>;
}
