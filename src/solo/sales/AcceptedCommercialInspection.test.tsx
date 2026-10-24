import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {AcceptedCommercialInspection} from './AcceptedCommercialInspection';
import {prepareCommercialPresentation,commercialPresentationText} from '../../../supabase/functions/_shared/agreements/commercial-presentation';
import {assembleFixedRepaymentSchedule} from '../../../supabase/functions/_shared/sales-collections/model';
import type {AcceptedCommercialRead} from '../../../supabase/functions/_shared/agreements/accepted-commercial-read';
import type {CollectionCommand} from '../../../supabase/functions/_shared/sales-collections/contract';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({read:vi.fn(),review:null as null|{tenantId:string;command:CollectionCommand;onComplete(result:Record<string,unknown>,executed:CollectionCommand):void;onClose():void}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));
vi.mock('../../../supabase/functions/_shared/agreements/accepted-commercial-read',()=>({readAcceptedCommercialAgreement:h.read}));
vi.mock('./collections/CollectionCommandReview',()=>({CollectionCommandReview:(p:NonNullable<typeof h.review>)=>{h.review=p;return <div data-testid="effective-review"><button onClick={p.onClose}>Cancel effective review</button></div>}}));
const id=(n:number)=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
const props={tenantId:id(1),invoiceId:id(6),agreementId:id(4),version:2,currentTermsId:id(5),currentTermsVersion:3,currentPrincipal:350000,currentCurrency:'usd',currentDraftVersion:1};
let host:HTMLDivElement,root:Root,recorded:Extract<AcceptedCommercialRead,{state:'recorded'}>;
beforeEach(async()=>{
 h.read.mockReset();h.review=null;host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
 if(schedule.state!=='ready')throw Error('Fixture schedule unavailable');
 const none={state:'not_applicable',charges:[],source:'Synthetic decision',policy:'No additional charge'};
 const body='Synthetic retained words. <script>private-marker</script>';
 const presentation=await prepareCommercialPresentation({schema_version:2,engagement:{starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated'},
  source:{tenant_id:id(1),client_id:id(2),offer_id:id(3),agreement_id:id(4),agreement_version:4,agreement_updated_at:'2026-10-14T18:00:00Z',body_source:'tenant_template',status:'draft',content_sha256:null,
   terms_id:id(5),terms_version:3,terms_updated_at:'2026-10-14T18:00:00.123456Z',invoice_id:id(6),invoice_version:1,invoice_draft_version:1,invoice_updated_at:'2026-10-14T18:00:00Z'},
  title:'Synthetic service agreement',body_markdown:body,principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions:{schema_version:1,tax:none,fees:none},lines:[{unit_minor:350000,quantity:1}]});
 recorded={state:'recorded',presentation,presented_body_markdown:commercialPresentationText(body,presentation),completed_at:'2026-10-15T00:00:00Z',receipt_id:id(7),sealed_sha256:'b'.repeat(64)};
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=(overrides:Partial<typeof props>={})=>act(()=>root.render(<AcceptedCommercialInspection {...props} {...overrides}/>));
const button=(name:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===name)!;
const inspect=()=>act(async()=>button('Inspect accepted terms').click());
it('reads only after an explicit request and shows the original exact principal, versions and all dated obligations',async()=>{
 h.read.mockResolvedValue(recorded);render();expect(h.read).not.toHaveBeenCalled();await inspect();
 expect(h.read.mock.calls[0].slice(0,2)).toEqual([props.tenantId,{invoice_id:props.invoiceId,agreement_id:props.agreementId}]);
 expect(host.textContent).toContain('$3,500.00');expect(host.textContent).toContain('Accepted payment terms version');
 expect(host.querySelectorAll('li')).toHaveLength(11);expect(host.textContent).toContain('$500.00');expect(host.querySelectorAll('li')[10].textContent).toContain('$300.00');
 expect(host.textContent).toContain('do not activate terms, confirm payment or establish completed services');
 expect(host.textContent).toContain('Current file availability has not been checked');
 expect(document.activeElement).toBe(host.querySelector('h4'));expect(host.querySelector('script')).toBeNull();expect(host.querySelector('pre')?.textContent).toBe(recorded.presented_body_markdown);
});
it('keeps current terms and invoice changes distinct from accepted history',async()=>{
 h.read.mockResolvedValue(recorded);render({currentTermsVersion:99,currentPrincipal:999,currentDraftVersion:99});await inspect();
 expect(host.textContent).toContain('Current payment terms differ');expect(host.textContent).toContain('current invoice draft changed');
 expect(host.textContent).toContain('$3,500.00');expect(host.querySelector('pre')?.textContent).toBe(recorded.presented_body_markdown);
});
it.each(['unverified','refused'] as const)('provides a fresh explicit retry for %s without exposing private text',async state=>{
 h.read.mockResolvedValueOnce({state}).mockResolvedValueOnce(recorded);render();await inspect();
 expect(host.textContent).not.toContain('private-marker');expect(host.querySelector(`[role="${state==='refused'?'alert':'status'}"]`)).not.toBeNull();
 await act(async()=>button('Read again').click());expect(h.read).toHaveBeenCalledTimes(2);expect(host.querySelectorAll('li')).toHaveLength(11);
});
it('cancels an in-flight read, restores focus after the trigger is enabled and ignores its late response',async()=>{
 let resolve!:(value:AcceptedCommercialRead)=>void;h.read.mockReturnValue(new Promise(r=>resolve=r));render();await inspect();
 expect(button('Reading accepted terms…').disabled).toBe(true);await act(async()=>button('Cancel reading').click());
 expect(document.activeElement).toBe(button('Inspect accepted terms'));await act(async()=>resolve(recorded));expect(host.textContent).not.toContain('private-marker');
});
it('closes a recorded inspection and returns keyboard focus to the existing read control',async()=>{
 h.read.mockResolvedValue(recorded);render();await inspect();await act(async()=>button('Close record').click());
 expect(document.activeElement).toBe(button('Inspect accepted terms'));expect(host.querySelector('pre')).toBeNull();
});
it.each(['tenantId','invoiceId','agreementId','version'] as const)('immediately hides and never automatically re-reads private history after %s changes',async key=>{
 h.read.mockResolvedValue(recorded);render();await inspect();expect(host.querySelector('pre')).not.toBeNull();
 render({[key]:key==='version'?3:id(99)});expect(host.querySelector('pre')).toBeNull();expect(h.read).toHaveBeenCalledTimes(1);expect(button('Inspect accepted terms')).toBeDefined();
});
it('ignores an old in-flight response after changing the workspace',async()=>{
 let resolve!:(value:AcceptedCommercialRead)=>void;h.read.mockReturnValue(new Promise(r=>resolve=r));render();await inspect();render({tenantId:id(99)});
 await act(async()=>resolve(recorded));expect(host.querySelector('pre')).toBeNull();expect(h.read).toHaveBeenCalledTimes(1);
});
it('turns a transport exception into a recoverable, private unavailable state',async()=>{
 h.read.mockRejectedValue(Error('Synthetic private transport detail'));render();await inspect();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain('Synthetic private transport detail');
});

const openEffective=()=>act(async()=>button('Review effective terms').click());
const receipt=()=>{const c=h.review!.command;if(c.action!=='collection.effectuate_terms')throw Error('Expected exact commercial command');return {ok:true,outcome:'commercial_terms_effectuated',historical_receipt:true,receipt_id:id(10),row:{id:c.agreement_id,tenant_id:props.tenantId,status_at_execution:'active',signing_id:c.signing_id,signing_version:c.signing_version,terms_version:c.expected_version,effective_at:'2026-10-16T12:00:00Z',source_digest:c.payload_digest,actor_user_id:id(8),effect:'activate_matching_terms'},operation:{id:id(9),action:c.action}};};
it('mounts the incumbent review with exact immutable signing, terms and raw microsecond source',async()=>{
 h.read.mockResolvedValue(recorded);render();expect(h.review).toBeNull();await inspect();await openEffective();
 expect(h.review!.tenantId).toBe(props.tenantId);expect(h.review!.command).toEqual({action:'collection.effectuate_terms',agreement_id:id(5),expected_version:3,expected_updated_at:'2026-10-14T18:00:00.123456Z',signing_id:id(4),signing_version:4,invoice_id:id(6),invoice_draft_version:1,payload_digest:recorded.presentation.payload_digest,sealed_sha256:recorded.sealed_sha256});
 await act(async()=>button('Cancel effective review').click());expect(host.querySelector('[data-testid="effective-review"]')).toBeNull();expect(document.activeElement).toBe(button('Review effective terms'));
});
it('allows native history recovery from the immutable accepted source even after current revisions change',async()=>{
 h.read.mockResolvedValue(recorded);render({currentTermsVersion:99,currentPrincipal:999,currentDraftVersion:99});await inspect();await openEffective();expect(h.review!.command).toMatchObject({expected_version:3,invoice_draft_version:1,expected_updated_at:'2026-10-14T18:00:00.123456Z'});
});
it('displays only a verified historical receipt and never presents it as current balance or current status',async()=>{
 h.read.mockResolvedValue(recorded);render();await inspect();await openEffective();await act(async()=>h.review!.onComplete(receipt(),h.review!.command));
 expect(host.textContent).toContain('Accepted-version operation recorded');expect(host.textContent).toContain(id(9));expect(host.textContent).toContain(id(10));expect(host.textContent).toContain('Current status must be read separately');expect(host.textContent).toContain('No payment or completed service is confirmed');expect(host.querySelector('[data-testid="effective-review"]')).toBeNull();
});
it('does not misattribute a different recovered pending action to this accepted agreement',async()=>{
 h.read.mockResolvedValue(recorded);render();await inspect();await openEffective();await act(async()=>h.review!.onComplete({ok:true},{action:'collection.stage_import',source_account:'Example',rows:[{entity:'invoice',entity_id:'EX',client_id:id(2),invoice_id:null,invoice_number:'EX',currency:'usd',amount_cents:100,due_date:null,memo:null}]}));
 expect(host.textContent).toContain('Original pending operation recovered');expect(host.textContent).toContain('This agreement action has not started');expect(host.textContent).not.toContain('Accepted-version operation recorded');
});
it('retires the review and ignores its stale completion when invoice identity changes',async()=>{
 h.read.mockResolvedValue(recorded);render();await inspect();await openEffective();const old=h.review!,completed=receipt();render({invoiceId:id(99)});expect(host.querySelector('[data-testid="effective-review"]')).toBeNull();await act(async()=>old.onComplete(completed,old.command));expect(host.textContent).not.toContain(id(10));expect(host.textContent).not.toContain('Accepted-version operation recorded');
});
it('does not convert an incomplete success callback into a recovered or completed operation',async()=>{
 h.read.mockResolvedValue(recorded);render();await inspect();await openEffective();await act(async()=>h.review!.onComplete({ok:true},h.review!.command));expect(host.querySelector('[data-testid="effective-review"]')).not.toBeNull();expect(host.textContent).not.toContain('Accepted-version operation recorded');expect(host.textContent).not.toContain('Original pending operation recovered');
});
