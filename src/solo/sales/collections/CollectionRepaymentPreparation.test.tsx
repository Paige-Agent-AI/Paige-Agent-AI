import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CollectionPlanBuilder} from './CollectionPlanBuilder';
import type {Agreement} from './api';
import {parseCollectionTerms,type CollectionCommand} from '../../../../supabase/functions/_shared/sales-collections/contract';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(()=>{act(()=>root.unmount());host.remove()});
const agreement:Agreement={id:'11111111-1111-4111-8111-111111111111',tenant_id:'22222222-2222-4222-8222-222222222222',client_id:'33333333-3333-4333-8333-333333333333',client_name:'Controlled client',title:'Consulting agreement',status:'draft',term_kind:'one_time',agreed_amount_basis:'total',agreed_amount_minor:350000,agreed_currency:'usd',collection_terms:null,collection_terms_version:3,terms_current:true};
const other:Agreement={...agreement,id:'44444444-4444-4444-8444-444444444444',title:'Other agreement'};
function field(name:string,scope:ParentNode=host):HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement{
 const direct=Array.from(scope.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')).find(e=>e.getAttribute('aria-label')===name);
 const wrapped=Array.from(scope.querySelectorAll('label')).find(l=>l.firstChild?.textContent?.trim()===name)?.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');
 if(!direct&&!wrapped)throw Error('Missing field '+name);return direct??wrapped!;
}
function button(name:string){const found=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()===name);if(!found)throw Error('Missing button '+name);return found}
const click=(name:string)=>act(()=>button(name).click());
function change(name:string,value:string,scope:ParentNode=host){const el=field(name,scope),proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;act(()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})}
const proposal=()=>host.querySelector<HTMLDivElement>('#sc-fixed-preparation')!;
function mount(rows:Agreement[]=[agreement,other],canManage=true){
 const review=vi.fn<(command:CollectionCommand)=>void>(),back=vi.fn(),dirty=vi.fn();
 const show=(next=rows,allowed=canManage)=>act(()=>root.render(<CollectionPlanBuilder agreements={next} initialAgreementId={agreement.id} initialKind="installment" canManage={allowed} onReview={review} onBack={back} onDirty={dirty}/>));
 show();return{review,back,dirty,show};
}
function open(){click('Prepare deposit and installments');expect(proposal().style.display).toBe('block')}
function complete(installment='300'){
 change('Deposit amount','500',proposal());change('Installment amount',installment,proposal());
 change('Deposit date','2026-11-15',proposal());change('First installment date','2026-12-15',proposal());change('Payment frequency','monthly',proposal());
}
function savedCommand(review:ReturnType<typeof mount>['review']){const command=review.mock.calls[0]?.[0];if(command?.action!=='collection.save_terms')throw Error('Original save command missing');return command}

describe('Original collection-plan repayment preparation',()=>{
 it.each([
  {term_kind:undefined,agreed_amount_basis:undefined},
  {term_kind:'recurring' as const,agreed_amount_basis:'per_cycle' as const},
  {term_kind:'installment' as const,agreed_amount_basis:'per_installment' as const},
  {term_kind:'installment' as const,agreed_amount_basis:'unverified' as const},
  {status:'cancelled'}, {status:'completed'},
 ])('requires original fixed-total and eligible-source evidence %j',semantics=>{
  const {review}=mount([{...agreement,...semantics}]);
  expect(button('Prepare deposit and installments').disabled).toBe(true);
  click('Prepare deposit and installments');expect(proposal().style.display).toBe('none');
  expect(host.querySelector('[role="status"]')?.textContent).toMatch(/total|agreement/i);
  if(semantics.agreed_amount_basis==='per_cycle')expect(host.textContent).toContain('Saved agreement amount per cycle');
  if(semantics.agreed_amount_basis==='per_installment')expect(host.textContent).toContain('Saved amount per installment');
  expect(review).not.toHaveBeenCalled();
 });
 it('uses a negotiated installment total only when the original read verifies that meaning',()=>{
  const {review}=mount([{...agreement,term_kind:'installment',agreed_amount_basis:'total'}]);open();complete();click('Use proposed schedule');click('Review and save terms');
  expect(savedCommand(review)).toMatchObject({agreement_id:agreement.id,expected_version:3,terms:{total_cents:350000,count:11}});
 });
 it('does not replace an already recorded recurring collection plan with a finite proposal',()=>{
  const recurring=parseCollectionTerms({schema_version:1,kind:'recurring',currency:'usd',total_cents:350000,anchor_date:'2026-11-01',cadence:'monthly',count:null});
  mount([{...agreement,collection_terms:recurring}]);
  expect(button('Prepare deposit and installments').disabled).toBe(true);expect(host.textContent).toContain('recurring collection plan');
 });
 it('retires an open proposal when original total semantics disappear and requires fresh input on return',()=>{
  const {show,review}=mount();open();complete();expect(button('Use proposed schedule').disabled).toBe(false);
  show([{...agreement,term_kind:'recurring',agreed_amount_basis:'per_cycle'}]);
  expect(button('Use proposed schedule').disabled).toBe(true);expect(proposal().textContent).toContain('per billing cycle');
  act(()=>proposal().querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(review).not.toHaveBeenCalled();
  show([agreement]);expect(field('Deposit amount',proposal()).value).toBe('');expect(button('Use proposed schedule').disabled).toBe(true);
 });
 it.each([{collection_terms_version:4},{term_kind:'recurring' as const,agreed_amount_basis:'per_cycle' as const}])('blocks review after source change, programmatic submit and restoration %j',patch=>{
  const {show,review}=mount();open();complete();click('Use proposed schedule');
  expect(button('Review and save terms').disabled).toBe(false);
  show([{...agreement,...patch}]);
  expect(button('Review and save terms').disabled).toBe(true);
  act(()=>host.querySelector('.sc-builder > .sc-builder-grid > form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(review).not.toHaveBeenCalled();expect(host.textContent).toContain('original agreement changed');
  expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
  show([agreement]);expect(button('Review and save terms').disabled).toBe(true);
  click('Discard proposal and use current terms');
  expect(document.activeElement).toBe(field('Saved agreement'));
  expect(field('Custom schedule: date, amount, label').value).toBe('');
  open();complete();click('Use proposed schedule');click('Review and save terms');
  expect(savedCommand(review)).toMatchObject({agreement_id:agreement.id,expected_version:3});
 });
 it('asks for actual dates and never reviews or saves merely by preparing or applying a proposal',()=>{
  const {review,dirty}=mount();open();expect(proposal().textContent).toContain(agreement.client_name);expect(proposal().textContent).toContain(agreement.title);
  for(const name of ['Deposit amount','Installment amount','Deposit date','First installment date','Payment frequency'])expect(field(name,proposal()).value).toBe('');
  expect(button('Use proposed schedule').disabled).toBe(true);
  change('Deposit amount','500',proposal());change('Installment amount','300',proposal());change('Payment frequency','monthly',proposal());
  expect(button('Use proposed schedule').disabled).toBe(true);
  expect(proposal().textContent).toContain('agreed deposit date, first installment date');
  complete();click('Use proposed schedule');
  expect(review).not.toHaveBeenCalled();expect(dirty).toHaveBeenCalledWith(true);
  expect(proposal().style.display).toBe('none');
  expect(document.activeElement).toBe(button('Prepare deposit and installments'));
  click('Review and save terms');
  const command=savedCommand(review);
  expect(command.agreement_id).toBe(agreement.id);expect(command.expected_version).toBe(3);expect(command.terms.kind).toBe('custom');
  expect(command.terms.total_cents).toBe(350000);expect(command.terms.dates).toHaveLength(11);
  expect(command.terms.dates[0]).toEqual({due_date:'2026-11-15',amount_cents:50000,label:'Deposit'});
  expect(command.terms.dates.slice(1).map(r=>r.amount_cents)).toEqual(Array(10).fill(30000));
  expect(command.terms.dates.at(-1)?.due_date).toBe('2027-09-15');
 });
 it('keeps a smaller final installment explicit instead of silently changing principal or rounding payment amounts',()=>{
  const {review}=mount();open();complete('350');
  expect(proposal().textContent).toContain('Installment 9');expect(proposal().textContent).toContain('$200.00');
  click('Use proposed schedule');click('Review and save terms');const command=savedCommand(review);
  expect(command.terms.total_cents).toBe(350000);expect(command.terms.dates).toHaveLength(10);
  expect(command.terms.dates.at(-1)?.amount_cents).toBe(20000);
 });
 it('preserves existing agreed fee and interest metadata when changing only the proposed schedule',()=>{
  const terms=parseCollectionTerms({schema_version:1,kind:'full',currency:'usd',total_cents:350000,anchor_date:'2026-10-01',cadence:'monthly',count:1,dates:[],deposit_cents:null,late_fee:{fixed_cents:500,rate_bps:200,grace_days:5,agreement_basis:'Existing agreed fee basis'},interest:{annual_bps:1000,agreement_basis:'Existing agreed interest basis'}});
  const {review}=mount([{...agreement,collection_terms:terms}]);open();complete();click('Use proposed schedule');click('Review and save terms');
  const command=savedCommand(review);expect(command.terms.late_fee).toEqual(terms.late_fee);expect(command.terms.interest).toEqual(terms.interest);
  expect(command.terms.total_cents).toBe(350000);expect(command.expected_version).toBe(3);
 });
 it('keeps same-source inputs across Back and Escape, without applying an unchosen revision',()=>{
  const {review}=mount();open();complete();click('Use proposed schedule');
  const original=(field('Custom schedule: date, amount, label') as HTMLTextAreaElement).value;
  open();change('Installment amount','350',proposal());click('Back to collection plan');
  expect((field('Custom schedule: date, amount, label') as HTMLTextAreaElement).value).toBe(original);
  expect(document.activeElement).toBe(button('Prepare deposit and installments'));
  open();expect(field('Installment amount',proposal()).value).toBe('350');
  act(()=>field('Installment amount',proposal()).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(proposal().style.display).toBe('none');expect(document.activeElement).toBe(button('Prepare deposit and installments'));expect(review).not.toHaveBeenCalled();
 });
 it.each([{label:'amount precision',field:'Deposit amount',value:'500.001'},{label:'deposit equals principal',field:'Deposit amount',value:'3500'},{label:'original schedule limit',field:'Installment amount',value:'0.01'},{label:'deposit chronology',field:'First installment date',value:'2026-11-15'}])('refuses $label and preserves the exact entered value',item=>{
  const {review}=mount();open();complete();change(item.field,item.value,proposal());
  expect(button('Use proposed schedule').disabled).toBe(true);expect(field(item.field,proposal()).value).toBe(item.value);
  act(()=>proposal().querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(proposal().style.display).toBe('block');expect(review).not.toHaveBeenCalled();
 });
 it('refuses programmatic application after permission loss without discarding the proposal',()=>{
  const {review,show}=mount();open();complete();act(()=>field('Deposit amount',proposal()).focus());show([agreement,other],false);
  expect(button('Use proposed schedule').disabled).toBe(true);expect(field('Deposit amount',proposal()).matches(':disabled')).toBe(true);
  act(()=>proposal().querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(proposal().style.display).toBe('block');expect(field('Deposit amount',proposal()).value).toBe('500');expect(review).not.toHaveBeenCalled();expect(document.activeElement).toBe(proposal().querySelector('h3'));
 });
 it('retires inputs when switching agreements and does not revive them when returning',()=>{
  mount();open();complete();click('Back to collection plan');change('Saved agreement',other.id);open();
  for(const name of ['Deposit amount','Installment amount','Deposit date','First installment date','Payment frequency'])expect(field(name,proposal()).value).toBe('');
  click('Back to collection plan');change('Saved agreement',agreement.id);open();expect(field('Deposit amount',proposal()).value).toBe('');
 });
 it.each([{collection_terms_version:4},{client_id:'55555555-5555-4555-8555-555555555555'}])('retires the proposal when its original revision or client relationship changes (%j)',changeRecord=>{
  const {show}=mount();open();complete();show([{...agreement,...changeRecord},other]);
  expect(field('Deposit amount',proposal()).value).toBe('');expect(field('Deposit date',proposal()).value).toBe('');expect(button('Use proposed schedule').disabled).toBe(true);expect(proposal().textContent).toContain('The agreement or client changed');
 });
 it('keeps preparation unavailable without an original agreement source',()=>{mount([]);expect(button('Prepare deposit and installments').disabled).toBe(true)});
});
