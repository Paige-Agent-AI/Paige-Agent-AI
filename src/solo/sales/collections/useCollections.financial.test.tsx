import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useCollections} from './useCollections';
const f=vi.hoisted(()=>({register:vi.fn(),agreements:vi.fn()}));
vi.mock('./api',()=>({readRegister:(...args:unknown[])=>f.register(...args),readAgreements:(...args:unknown[])=>f.agreements(...args),decodeInvoice:()=>null,decodeReceipt:()=>null}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tenant='e0447501-0000-4000-8000-000000000001',other='e0447501-0000-4000-8000-000000000002';
const row=(n:number,version:2|undefined)=>({id:'e0447502-0000-4000-8000-'+String(n).padStart(12,'0'),payment_evidence_version:version,remaining_cents:version===2?10000:5000});
function page(version:2|undefined,n=1,more=false,empty=false){return{rows:empty?[]:[row(n,version)],has_more:more,next_cursor:more?{snapshot_id:tenant,after_position:n,entity:'invoice'}:null,payment_evidence_version:version};}
function pending(){let resolve!:(v:ReturnType<typeof page>)=>void;return{promise:new Promise<ReturnType<typeof page>>(r=>{resolve=r}),resolve:(v:ReturnType<typeof page>)=>resolve(v)};}
let host:HTMLDivElement,root:Root,state:ReturnType<typeof useCollections>;
const snapshots:Array<Array<2|undefined>>=[];
function Probe({business}:{business:string}){state=useCollections(business);snapshots.push(state.invoices.map(r=>r.payment_evidence_version));return null;}
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const render=(business=tenant)=>act(async()=>{root.render(<Probe business={business}/>);await flush();});
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);f.register.mockReset();f.agreements.mockReset().mockResolvedValue({rows:[],has_more:false,next_cursor:null});snapshots.length=0;});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it.each([[undefined,2],[2,undefined]] as const)('refreshes the original register before appending %s→%s financial facts',async(before,after)=>{
 let continuation=false;f.register.mockImplementation(async(_t:string,entity:string,cursor:unknown)=>{if(cursor){continuation=true;return page(after,2);}return page(continuation?after:before,continuation?3:1, !continuation&&entity==='invoice');});
 await render();await act(async()=>{await state.more('invoice');await flush();});
 expect(state.invoices.map(r=>r.id)).toEqual([row(3,after).id]);expect(state.state).toBe('ready');expect(f.register).toHaveBeenCalledTimes(5);expect(snapshots.every(s=>new Set(s).size<=1)).toBe(true);
 expect(f.agreements).toHaveBeenCalledTimes(2);
});
it.each([undefined,2] as const)('retains original same-representation %s pagination and cursor',async version=>{
 f.register.mockImplementation(async(_t:string,entity:string,cursor:unknown)=>page(version,cursor?2:1,!cursor&&entity==='invoice'));
 await render();const cursor={snapshot_id:tenant,after_position:1,entity:'invoice'};await act(async()=>state.more('invoice'));
 expect(state.invoices.map(r=>r.id)).toEqual([row(1,version).id,row(2,version).id]);expect(f.register.mock.calls[2].slice(0,3)).toEqual([tenant,'invoice',cursor]);
});
it('keeps empty-page native evidence so a later legacy page still refreshes first',async()=>{
 let continuation=false;f.register.mockImplementation(async(_t:string,entity:string,cursor:unknown)=>{if(cursor){continuation=true;return page(undefined,2);}return page(continuation?undefined:2,continuation?3:1,!continuation&&entity==='invoice',!continuation&&entity==='invoice');});
 await render();expect(state.invoices).toEqual([]);await act(async()=>{await state.more('invoice');await flush();});expect(state.invoices.map(r=>r.id)).toEqual([row(3,undefined).id]);
});
it('a failed financial rollover shows the original recoverable read error with no mixed or stale rows',async()=>{
 let stage=0;f.register.mockImplementation(async(_t:string,entity:string,cursor:unknown)=>{if(cursor){stage=1;return page(2,2);}if(stage===1)throw Error('synthetic interrupted refresh');return page(stage===2?2:undefined,stage===2?3:1,stage===0&&entity==='invoice');});
 await render();await act(async()=>{await state.more('invoice');await flush();});expect(state.state).toBe('error');expect(state.invoices).toEqual([]);expect(state.receipts).toEqual([]);
 stage=2;await act(async()=>{state.retry();await flush();});expect(state.state).toBe('ready');expect(state.invoices.map(r=>r.id)).toEqual([row(3,2).id]);
});
it('initial invoice/receipt financial modes must agree before either becomes visible',async()=>{
 f.register.mockImplementation(async(_t:string,entity:string)=>page(entity==='invoice'?2:undefined));await render();expect(state.state).toBe('error');expect(state.invoices).toEqual([]);expect(state.receipts).toEqual([]);
});
it('late continuation from an old business cannot alter current financial rows or trigger its refresh',async()=>{
 const old=pending();f.register.mockImplementation(async(t:string,_entity:string,cursor:unknown)=>cursor?old.promise:page(t===tenant?undefined:2,t===tenant?1:3,true));
 await render();await act(async()=>{void state.more('invoice');await flush();});await render(other);old.resolve(page(2,2));await act(flush);
 expect(state.invoices.map(r=>r.id)).toEqual([row(3,2).id]);expect(state.state).toBe('ready');expect(f.register.mock.calls.filter(c=>c[0]===other)).toHaveLength(2);
});
