import React,{act} from 'react';
import {readFileSync} from 'node:fs';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CollectionsWorkspace} from './CollectionsWorkspace';
import type {CollectionInvoice} from './api';
// Experience 04 E4-S3 PR beta (Track C1): Collections judges "Overdue" on the BUSINESS calendar
// (the owner's saved zone), with the same strict "<" PAIGE's composer uses, and holds the judgement
// — never a 0 — when there is no usable zone. Frozen words: cross-track contract §2.4.
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const fx=vi.hoisted(()=>({tenant:'11111111-1111-4111-8111-111111111111',invoices:[] as unknown[],zone:{data:null as unknown,error:null as unknown}}));
vi.mock('next-themes',()=>({useTheme:()=>({resolvedTheme:'light'})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn(async(name:string)=>name==='read_business_time_zone'?fx.zone:{data:null,error:null})}}));
vi.mock('../../useSoloCommercialTerms',()=>({useSoloCommercialTerms:()=>({phase:'ready',tenantId:fx.tenant,canManage:true})}));
vi.mock('./useCollections',()=>({useCollections:()=>({state:'ready',invoices:fx.invoices,receipts:[],agreements:[],error:'',retry:vi.fn(),more:vi.fn(),loadingMore:false,invoiceHasMore:false,receiptHasMore:false,agreementHasMore:false})}));
vi.mock('./CollectionPlanBuilder',()=>({CollectionPlanBuilder:({onDirty}:{onDirty(d:boolean):void})=><button onClick={()=>onDirty(true)}>Edit plan fixture</button>}));
const zone=(z:string|null,state='configured',can_set=true)=>({data:{state:z?state:(state==='configured'?'missing':state),zone:z,set_at:null,local_date:null,can_set},error:null});
let n=0;
const invoice=(patch:Partial<CollectionInvoice>&{collection_required?:boolean}):CollectionInvoice=>({id:`22222222-2222-4222-8222-${String(++n).padStart(12,'0')}`,tenant_id:fx.tenant,client_id:'33333333-3333-4333-8333-333333333333',client_name:'Example client',invoice_number:`INV-${n}`,source_invoice_number:null,status:'issued',version:1,amount_cents:5000,currency:'usd',due_date:'2026-10-31',created_at:'2026-10-01T12:00:00Z',manual_recorded_cents:0,provider_verified_cents:0,allocated_cents:0,remaining_cents:5000,receipt_count:0,record_kind:'managed',provenance:'canonical_record',collection_required:true,...patch} as CollectionInvoice);
let host:HTMLDivElement,root:Root;
beforeEach(()=>{fx.invoices=[];fx.zone=zone('America/New_York');host=document.createElement('div');document.body.append(host);root=createRoot(host)});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers()});
const at=(iso:string)=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse(iso))};
const render=async(props:Partial<React.ComponentProps<typeof CollectionsWorkspace>>={})=>{await act(async()=>root.render(<CollectionsWorkspace tenantId={fx.tenant} {...props}/>));await act(async()=>{await Promise.resolve()})};
const tile=(label:string)=>[...host.querySelectorAll('.sc-facts article')].find(x=>x.querySelector('small')?.textContent===label);
const value=(label:string)=>tile(label)?.querySelector('strong')?.textContent;
const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
describe('Collections · Overdue on the business calendar',()=>{
 it('judges Overdue on the business calendar, not UTC (west of UTC)',async()=>{
  at('2026-11-01T02:30:00Z'); // UTC is Nov 1; New York is still Oct 31
  fx.invoices=[invoice({due_date:'2026-10-31'})];await render();
  expect(value('Overdue')).toBe('0');expect(value('Upcoming')).toBe('1');
  expect(host.querySelector('.sc-register-row')?.textContent).not.toContain('Overdue ·');
  expect(host.textContent).not.toContain('Past due');
 });
 it('judges Overdue on the business calendar, not UTC (east of UTC), and marks the late row',async()=>{
  at('2026-10-31T12:00:00Z');fx.zone=zone('Pacific/Kiritimati'); // already Nov 1 there
  fx.invoices=[invoice({due_date:'2026-10-31'})];await render();
  expect(value('Overdue')).toBe('1');
  expect(host.querySelector('.sc-register-row .sc-overdue')?.textContent).toBe('Overdue · 2026-10-31');
  expect(host.querySelector('.sc-coverage')?.textContent).toContain('Due dates follow your business calendar · Line Islands Time (Kiritimati) · today Nov 1, 2026.');
 });
 it('holds Overdue and Upcoming when no business zone is set, never as 0, and the owner can set it',async()=>{
  fx.zone=zone(null);fx.invoices=[invoice({due_date:'2020-01-01'})];const open=vi.fn();await render({onOpenBusinessTimeZone:open});
  for(const label of ['Overdue','Upcoming'])expect(value(label)).toBe('On hold');
  // The frozen note appears ONCE (on Overdue); the notice and its one button are the one action.
  expect(tile('Overdue')?.querySelector('.sc-fact-note')?.textContent).toBe('Set your business time zone');
  expect(tile('Upcoming')?.querySelector('.sc-fact-note')).toBeNull();
  expect(host.querySelector('.sc-facts')?.textContent?.split('Set your business time zone').length).toBe(2);
  expect(host.querySelector('.sc-facts')?.textContent).not.toMatch(/Overdue0|Upcoming0/);
  const notice=host.querySelector('[data-business-calendar-notice]');expect(notice?.getAttribute('role')).toBe('status');
  await act(async()=>button('Set your business time zone')!.click());expect(open).toHaveBeenCalledOnce();
 });
 it('tells an admin the owner must set it and offers to open the setting',async()=>{
  fx.zone=zone(null,'configured',false);await render({onOpenBusinessTimeZone:vi.fn()});
  expect(tile('Overdue')?.textContent).toContain('Until the business owner sets the business time zone');
  expect(button('Set your business time zone')).toBeUndefined();expect(button('Open business time zone setting')).toBeDefined();
 });
 it('an invalid or unreadable zone never falls back to UTC; unreadable can be retried',async()=>{
  fx.zone=zone(null,'invalid');fx.invoices=[invoice({due_date:'2020-01-01'})];await render();
  expect(value('Overdue')).toBe('On hold');expect(host.textContent).toContain('isn’t recognised');
  act(()=>root.unmount());root=createRoot(host);
  fx.zone={data:null,error:{code:'57014'}};await render();
  expect(value('Overdue')).toBe('On hold');expect(host.textContent).toContain('couldn’t be read');
  fx.zone=zone('America/New_York');await act(async()=>button('Retry')!.click());await act(async()=>{await Promise.resolve()});
  expect(value('Overdue')).toBe('1');
 });
 it('while the zone is loading the tiles say so and claim nothing',async()=>{
  fx.zone=new Promise(()=>{}) as never;fx.invoices=[invoice({due_date:'2020-01-01'})];await render();
  expect(value('Overdue')).toBe('Checking…');expect(tile('Overdue')?.getAttribute('aria-busy')).toBe('true');
 });
 it('a draft or void invoice is never overdue, upcoming or outstanding',async()=>{
  at('2026-10-31T12:00:00Z');
  fx.invoices=[invoice({status:'draft',due_date:'2020-01-01',remaining_cents:9000,collection_required:false}),invoice({status:'void',due_date:'2030-01-01',remaining_cents:9000,collection_required:false})];await render();
  expect(value('Overdue')).toBe('0');expect(value('Upcoming')).toBe('0');expect(value('Outstanding')).toBe('$0.00');
 });
 it('names older legacy-status invoices it does not count, instead of silently dropping them',async()=>{
  fx.invoices=[invoice({status:'sent',due_date:'2020-01-01',collection_required:false}),invoice({due_date:'2030-01-01'})];await render();
  expect(value('Overdue')).toBe('0');
  expect(host.querySelector('.sc-coverage')?.textContent).toContain('1 older invoice with a legacy status (sent or paid) is not counted here');
 });
 it('does not classify the obligations aside without a zone',async()=>{
  fx.zone=zone(null);fx.invoices=[invoice({due_date:'2020-01-01'}),invoice({due_date:'2030-01-01'})];await render();
  expect(host.textContent).toContain('Open obligations by due date');expect(host.textContent).not.toContain('Upcoming obligations');
  expect(host.querySelectorAll('.sc-upcoming').length).toBe(2);
 });
 it('names the business calendar in words, not machine values',async()=>{
  at('2026-10-13T17:00:00Z');fx.zone=zone('America/Chicago');fx.invoices=[invoice({due_date:'2026-10-31'})];await render();
  const line=host.querySelector('.sc-coverage')?.textContent??'';
  expect(line).toContain('Due dates follow your business calendar · Central Time (Chicago) · today Oct 13, 2026.');
  expect(line).not.toContain('America/Chicago');expect(line).not.toContain('2026-10-13');expect(line).not.toContain('judged');
 });
 it('an admin also sees the owner-only note once, not on every held tile',async()=>{
  fx.zone=zone(null,'configured',false);await render({onOpenBusinessTimeZone:vi.fn()});
  expect(host.querySelector('.sc-facts')?.textContent?.split('Until the business owner sets the business time zone').length).toBe(2);
 });
 it('if any loaded invoice does not say whether it is owed, Outstanding, Overdue and Upcoming are unjudged — never $0.00 or 0',async()=>{
  at('2026-10-31T12:00:00Z');
  const older=invoice({due_date:'2020-01-01',remaining_cents:7000});delete (older as {collection_required?:boolean}).collection_required;
  fx.invoices=[older,invoice({due_date:'2030-01-01'})];await render();
  for(const label of ['Outstanding','Overdue','Upcoming'])expect(value(label),label).toBe('On hold');
  for(const label of ['Outstanding','Overdue','Upcoming'])expect(tile(label)?.textContent,label).not.toMatch(/\$0\.00|^\D*0$/);
  expect(tile('Outstanding')?.querySelector('.sc-fact-note')?.textContent).toBe('Some invoices don’t say whether they’re still owed');
  // The obligations list makes no confident "none" (and lists nothing) about invoices it cannot judge.
  expect(document.body.textContent).toContain('Obligations can’t be listed: some invoices don’t say whether they’re still owed.');
  expect(document.body.textContent).not.toMatch(/No (upcoming|open) obligations/);
  expect(document.querySelectorAll('.sc-upcoming').length).toBe(0);
 });
 it('fact tiles stack from the top so held values line up across the row',()=>{
  expect(readFileSync('src/solo/sales/collections/collections.css','utf8')).toMatch(/\.sc-facts article\{[^}]*align-content:start/);
 });
 it('source guard: no browser-UTC "today" remains',()=>{
  expect(readFileSync('src/solo/sales/collections/CollectionsWorkspace.tsx','utf8')).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
 });
});
