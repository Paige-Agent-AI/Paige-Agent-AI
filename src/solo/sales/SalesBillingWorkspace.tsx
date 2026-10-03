import React from 'react';
import { useSalesInvoiceDrafts } from '../useSalesInvoiceDrafts';
import { InvoiceDraftEditor, type InvoiceBrowseControls, type InvoiceCatalogChoice } from './InvoiceDraftEditor';
import { useInvoiceBillingSources } from './useInvoiceBillingSources';
import { snapshotEditInput, type InvoiceSnapshotInput } from './invoiceDraftSnapshot';
import type { InvoiceDraft, InvoiceDraftSaveRequest } from './invoiceDraftApi';
import { useCatalogOffers } from '../useCatalogOffers';
import { useSoloCommercialTerms } from '../useSoloCommercialTerms';
import { useSalesDraftExit } from '../sales-dialog';
import type { BillingDraftInput } from './billingDrafts';
import './sales-billing.css';
const cash = (minor: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(minor / 100);
const label = (kind: BillingDraftInput['kind']) => kind === 'recurring' ? 'Monthly recurring' : kind === 'deposit' ? 'Deposit and balance' : 'One-time';
type Catalog = ReturnType<typeof useCatalogOffers>;
type Store = ReturnType<typeof useSalesInvoiceDrafts>;
function DraftEditor({row, recurring, store, sources, catalog, browse, onSelection, onReferences, canManage, onClose}: {row:InvoiceDraft|null;recurring:boolean;store:Store;sources:ReturnType<typeof useInvoiceBillingSources>;catalog:Catalog;browse:InvoiceBrowseControls;onSelection(clientId:string,agreementId:string|null):void;onReferences(ids:string[]):void;canManage:boolean;onClose:()=>void}) {
 const [value,setValue]=React.useState<InvoiceSnapshotInput>(()=>row?snapshotEditInput(row.snapshot):{schema_version:2,client_id:'',items:[{price_id:null,item:'',unit_minor:null,quantity:1}],kind:recurring?'recurring':'one_time',deposit_basis_points:null,currency:'usd',cadence:recurring?'monthly':null,recipient_email:null,recipient_phone:null,email_source_method_id:null,phone_source_method_id:null,billing_address:null,agreement_id:null,processor_intent:null,payment_method_intents:[],delivery_channel_intents:[],due_date:null,memo:null});
 const [busy,setBusy]=React.useState(false),[unknown,setUnknown]=React.useState(false),[notice,setNotice]=React.useState(''),[review,setReview]=React.useState(false);
 const request=React.useRef<InvoiceDraftSaveRequest|null>(null),invoiceId=React.useRef(row?.id??crypto.randomUUID());
 const {close,request:requestExit,confirmation,alive}=useSalesDraftExit(value,busy||unknown,onClose);
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
 const wrapper=React.useRef<HTMLDivElement>(null);
 React.useEffect(()=>{const heading=wrapper.current?.querySelector<HTMLElement>('h2');if(heading){heading.tabIndex=-1;heading.focus();}},[review]);
 const choices:InvoiceCatalogChoice[]=[...catalog.offers,...catalog.referencedOffers].flatMap(offer=>offer.prices.map(price=>({priceId:price.id,productId:offer.id,name:offer.name,unitMinor:price.unitAmount,currency:price.currency,billingInterval:price.billingInterval,intervalCount:price.intervalCount??null,active:offer.availability==='active'&&price.active})));
 const repriced=row?.snapshot.items.flatMap(item=>{const current=choices.find(c=>c.priceId===item.price_id);return current?.unitMinor!==null&&current?.unitMinor!==undefined&&current.unitMinor!==item.unit_minor?[`Catalog price changed from ${cash(item.unit_minor)} to ${cash(current.unitMinor)} per unit for ${item.item}. Saving uses the current price.`]:[]})??[];
 const frozenChoices=React.useRef<InvoiceCatalogChoice[]|null>(null);
 const save=async()=>{if(busy||!store.tenantId)return;request.current??={openedTenantId:store.tenantId,invoiceId:invoiceId.current,expectedVersion:row?.version??0,operationId:crypto.randomUUID(),draft:structuredClone(value)};frozenChoices.current??=structuredClone(choices);setBusy(true);setNotice('');const result=await store.save(request.current);if(!alive.current)return;setBusy(false);if(result.ok===true){onClose();return;}setUnknown(result.outcome==='unknown');if(result.outcome!=='unknown'){request.current=null;frozenChoices.current=null;}setNotice(result.message);};
 return <div className="sb-editor" ref={wrapper}><InvoiceDraftEditor value={value} onChange={next=>{if(busy||unknown)return;setValue(next);onSelection(next.client_id,next.agreement_id);onReferences(next.items.flatMap(item=>{const found=choices.find(c=>c.priceId===item.price_id);return found?[found.productId]:[]}));request.current=null;setNotice('');}} customers={sources.customers} catalog={frozenChoices.current??choices} agreements={sources.agreements} processors={[]} busy={busy} frozen={unknown} canManage={canManage} notice={notice} sourceNotice={!unknown?repriced.join(" "):undefined} browse={browse} review={review} onReview={()=>setReview(true)} onEdit={()=>setReview(false)} onSave={save} onClose={close}/>{unknown&&<div className="sb-notice"><p>The original save may have succeeded. Keep these details fixed and recover the same operation.</p><button className="btn btn-p" onClick={save} disabled={busy}>Recover original save</button></div>}{confirmation}</div>;
}
export function SalesBillingWorkspace({ view, integrationsPath }: { view: string; integrationsPath?: string }) {
  const store = useSalesInvoiceDrafts();
  const clients = useSoloCommercialTerms();
  const [search, setSearch] = React.useState('');
  const [catalogSearch, setCatalogSearch] = React.useState('');
  const [catalogPage,setCatalogPage]=React.useState(0),[customerSearch,setCustomerSearch]=React.useState(''),[customerPage,setCustomerPage]=React.useState(0),[agreementPage,setAgreementPage]=React.useState(0);
  const [sourceSelection,setSourceSelection]=React.useState<{clientId:string|null;agreementId:string|null}>({clientId:null,agreementId:null});
  const [catalogReferences,setCatalogReferences]=React.useState<string[]>([]);
  const sources=useInvoiceBillingSources({customerSearch,customerPage,agreementPage,...sourceSelection});
  const catalog = useCatalogOffers({ search: catalogSearch, page: catalogPage, pageSize: 25, referenceIds:catalogReferences });
  const browse:InvoiceBrowseControls={customerSearch,customerPage,customersHasMore:sources.customersHasMore,onCustomerSearch:value=>{setCustomerSearch(value);setCustomerPage(0)},onCustomerPage:setCustomerPage,catalogSearch,catalogPage,catalogHasMore:catalog.hasMore,onCatalogSearch:value=>{setCatalogSearch(value);setCatalogPage(0)},onCatalogPage:setCatalogPage,agreementPage,agreementsHasMore:sources.agreementsHasMore,onAgreementPage:setAgreementPage,sourceStatus:sources.phase==='error'?'Billing contacts or agreements could not be read.':sources.phase==='loading'?'Reading billing contacts and agreements...':catalog.phase==='error'?'Catalog could not be read.':'',onRetrySources:()=>{sources.retry();catalog.retry()}};
  const [editing, setEditing] = React.useState<{ tenant: string; row: InvoiceDraft | null; recurring: boolean } | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const registerRef = React.useRef<HTMLDivElement>(null);
  const editorWasOpen = React.useRef(false);
  const currentEditor = editing?.tenant === store.tenantId && store.phase !== 'resolving' ? editing : null;
  React.useLayoutEffect(() => {
    if (editorWasOpen.current && !currentEditor) registerRef.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus();
    editorWasOpen.current = !!currentEditor;
  }, [currentEditor]);
  React.useEffect(() => { setEditing(null); setSelectedId(null); setSearch(''); setCatalogSearch('');setCatalogPage(0);setCustomerSearch('');setCustomerPage(0);setAgreementPage(0);setSourceSelection({clientId:null,agreementId:null});setCatalogReferences([]); }, [store.tenantId]);
  const canEdit = sources.phase === 'ready' && sources.tenantId === store.tenantId && store.phase === 'ready' && clients.phase === 'ready' && clients.tenantId === store.tenantId && clients.canManage && clients.clientsReadable && catalog.phase === 'ready' && catalog.tenantId === store.tenantId;
  if (currentEditor) return <DraftEditor key={`${currentEditor.tenant}:${currentEditor.row?.id ?? 'new'}`} row={currentEditor.row} recurring={currentEditor.recurring} store={store} sources={sources} catalog={catalog} browse={browse} onSelection={(clientId,agreementId)=>{setSourceSelection({clientId:clientId||null,agreementId});setAgreementPage(0)}} onReferences={ids=>setCatalogReferences(old=>[...new Set([...old,...ids])])} canManage={canEdit} onClose={() => setEditing(null)} />;
  const rows = store.rows.filter(row => (view === 'recurring' ? row.snapshot.kind === 'recurring' : view === 'invoices' ? row.snapshot.kind !== 'recurring' : true) && `${row.snapshot.items.map(item => item.item).join(', ')} ${row.number} ${clients.clients.find(c => c.id === row.snapshot.client_id)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const selected = rows.find(r => r.id === selectedId) ?? rows[0];
  const create = (recurring: boolean) => {if(!store.tenantId)return;setSourceSelection({clientId:null,agreementId:null});setCatalogReferences([]);setEditing({tenant:store.tenantId,row:null,recurring});};
  const edit=(row:InvoiceDraft)=>{if(!store.tenantId)return;setSourceSelection({clientId:row.snapshot.client_id,agreementId:row.snapshot.agreement_id});setCatalogReferences(row.snapshot.items.flatMap(item=>typeof item.price_snapshot?.product_id==='string'?[item.price_snapshot.product_id]:[]));setEditing({tenant:store.tenantId,row,recurring:row.snapshot.kind==='recurring'});};
  return <div className="sb-workspace" ref={registerRef}>
    <header className="sb-toolbar"><div className="sb-actions"><button className="btn btn-p" disabled={!canEdit} onClick={() => create(false)}>Create invoice</button><button className="btn" disabled={!canEdit} onClick={() => create(true)}>Set up recurring</button></div><span className="sb-muted">USD · draft records · processor status unavailable</span></header>
    <div className="sb-records">
    {sources.phase === 'error' && <p className="sb-notice" role="alert">Billing contacts or agreements could not be read. <button className="btn" onClick={sources.retry}>Retry billing sources</button></p>}
    {view === 'payments' ? <section className="sb-panel"><header><h2>Payments</h2></header><div className="sb-empty"><h3>Connect the evidence behind each payment</h3><p>Payment imports, allocations and payout matching are unavailable. Billing drafts do not establish collected revenue.</p>{integrationsPath && <a className="btn" href={integrationsPath}>Open Integrations</a>}<button className="btn" onClick={() => create(false)} disabled={!canEdit}>Create an invoice draft</button></div></section> : <>
      <section className="sb-panel"><header><h2>{view === 'recurring' ? 'Recurring drafts' : view === 'overview' ? 'Next billing actions' : 'Invoices'}</h2><label className="sb-search">Search drafts<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, item or reference" /></label></header>
        {(store.phase === 'loading' || store.phase === 'resolving') ? <p className="sb-empty" role="status">Reading billing drafts…</p> : store.phase !== 'ready' ? <div className="sb-empty"><h3>{store.phase === 'unavailable' ? 'Billing draft storage unavailable' : 'Billing drafts could not be read'}</h3><p>{store.message || 'Check your workspace and access before retrying.'}</p><button className="btn" onClick={store.retry}>Retry</button></div> : !rows.length ? <div className="sb-empty"><h3>{search ? 'No matching drafts' : 'Start with a client and an offer'}</h3><p>{search ? 'Try a different client, item or reference.' : 'Save an invoice, deposit or monthly recurring draft and return to it here.'}</p>{!canEdit && <p>Draft editing requires owner or admin access and readable client records.</p>}</div> : <div className="sb-register"><table><thead><tr><th>Client / item</th><th>Structure</th><th>Amount</th><th>State</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} aria-selected={selected?.id === row.id}><td><button className="sb-row-link" onClick={() => setSelectedId(row.id)}>{clients.clients.find(c => c.id === row.snapshot.client_id)?.name || 'Client record unavailable'}</button><small>{row.snapshot.items.map(item => item.item).join(', ')}</small></td><td>{label(row.snapshot.kind)}</td><td className="sb-money">{cash(row.totalMinor)}</td><td><span className="pill pill-v">Draft</span></td><td><button className="btn" disabled={!canEdit} onClick={() => edit(row)}>Edit</button></td></tr>)}</tbody></table></div>}
        {store.pageMessage && <p className="sb-notice" role="status">{store.pageMessage}</p>}
        {store.hasMore && <button className="btn" onClick={store.loadMore} disabled={store.loadingMore}>{store.loadingMore ? 'Reading more…' : 'Load more drafts'}</button>}
      </section>
      <div className="sb-detail-grid"><section className="sb-panel"><header><h3>{selected ? 'Billing record' : 'Record details'}</h3></header><div className="sb-paper">{selected ? <><h3>{selected.snapshot.items.map(item => item.item).join(', ')}</h3><dl><dt>Reference</dt><dd className="sb-reference">{selected.number}</dd><dt>Total obligation</dt><dd>{cash(selected.totalMinor)}</dd><dt>Due now</dt><dd>{cash(selected.snapshot.due_now_minor)}</dd><dt>Remaining balance</dt><dd>{cash(selected.snapshot.remainder_minor)}</dd><dt>Version</dt><dd>{selected.version}</dd></dl><p>Not issued · no payment requested</p></> : <p>Select a billing record to inspect its saved facts.</p>}</div></section><section className="sb-panel"><header><h3>Collection and reconciliation</h3></header><div className="sb-paper"><p>Processor status unavailable.</p><p>Invoice delivery, customer approval, payments and payouts need verified provider records.</p>{integrationsPath && <a className="btn" href={integrationsPath}>Open Integrations</a>}<button className="btn" disabled>Send reminder · unavailable</button></div></section></div>
    </>}
    {catalog.hasMore && <label className="sb-catalog-search">Find a Catalog offer<input type="search" value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} /></label>}
    </div>
  </div>;
}
