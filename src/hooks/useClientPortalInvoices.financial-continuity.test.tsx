import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CustomerIdentityProvider,type CustomerIdentityState} from '@/lib/portal/customerIdentity';
import {useClientPortalInvoices,type ClientPortalInvoicesState} from './useClientPortalInvoices';
const f=vi.hoisted(()=>({reply:vi.fn(),calls:[] as Array<{name:string;args:Record<string,unknown>}>,listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>{
 const query={setHeader:()=>query,then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{f.calls.push({name,args});return f.reply({name,args});}).then(resolve,reject)};return query;
},auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),getSession:async()=>({data:{session:{user:{id:actor},access_token:'synthetic-financial-continuity'}},error:null}),
 onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{f.listeners.add(callback);return{data:{subscription:{unsubscribe:()=>f.listeners.delete(callback)}}};}}}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor='e0447300-0000-4000-8000-000000000001',tenant='e0447300-0000-4000-8000-000000000002',other='e0447300-0000-4000-8000-000000000003';
const client=(business:string)=>business===tenant?'e0447300-0000-4000-8000-000000000004':'e0447300-0000-4000-8000-000000000005';
const id=(n:number)=>'e0447301-0000-4000-8000-'+String(n).padStart(12,'0');
function page(mode:2|3|4,n=1,more=false,business=tenant,empty=false){return{
 schema_version:mode,...(mode>=3?{payment_evidence_version:2}:{}),...(mode===4?{financial_evidence_version:3,financial_revision:'a'.repeat(64)}:{}),tenant_id:business,business_name:'Test consultancy',
 invoices:empty?[]:[{...(mode===4?{financial_revision:'a'.repeat(64),financial_standing:'recorded',refund_payable_minor:'0',credit_minor:'0',provider_net_minor:'0'}:{}),id:id(n),invoice_number:'TEST-'+n,status:'issued',currency:'usd',issued_at:'2026-10-29T00:15:00Z',due_date:null,issued_snapshot_version:1,
  amount_minor:'2000',remaining_minor:mode>=3?'2000':'1000',provider_verified_minor:mode>=3?'0':'1000',manual_recorded_minor:'0',test_provider_minor:'1000',payable:false,past_due:false}],
 balances:[{...(mode===4?{financial_standing:'recorded',refund_payable_minor:'0',credit_minor:'0',provider_net_minor:'0'}:{}),currency:'usd',remaining_minor:mode>=3?'4000':'2000',provider_verified_minor:mode>=3?'0':'2000',manual_recorded_minor:'0',test_provider_minor:'2000'}],
 invoice_count:2,open_count:2,has_more:more,next_cursor:more?{issued_at:'2026-10-29T00:15:00Z',id:id(n)}:null,
 read_at:'2026-10-29T00:15:00Z',calendar:{state:'configured',zone:'America/Los_Angeles',local_date:'2026-10-28'},
};}
const result=(data:unknown)=>({data,error:null});
const pending=()=>{let resolve!:(v:ReturnType<typeof result>)=>void;return{promise:new Promise<ReturnType<typeof result>>(r=>{resolve=r;}),resolve:(v:ReturnType<typeof result>)=>resolve(v)};};
let root:Root,host:HTMLDivElement,state:ClientPortalInvoicesState;
const snapshots:Array<{business:string;versions:Array<2|undefined>;ids:string[]}>=[];
function Probe({business}:{business:string}){state=useClientPortalInvoices();snapshots.push({business,versions:state.invoices.map(i=>i.payment_evidence_version),ids:state.invoices.map(i=>i.id)});return null;}
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const render=async(business=tenant,phase:CustomerIdentityState['phase']='ready')=>act(async()=>{root.render(<CustomerIdentityProvider state={{phase,frame:{actorId:actor,profile:{id:client(business),tenant_id:business,linked_user_id:actor,first_name:'Test',last_name:'Customer'},brand:{tenant_name:'Test consultancy'},config:{}} as CustomerIdentityState['frame']}}><Probe business={business}/></CustomerIdentityProvider>);await flush();});
beforeEach(()=>{f.reply.mockReset();f.calls=[];f.listeners.clear();snapshots.length=0;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

it.each([2,3] as const)('explicit current owner/client facts refuse old initial representation%s and recover on a fresh current read',async mode=>{
 f.reply.mockResolvedValueOnce(result(page(mode,1,true))).mockResolvedValueOnce(result(page(4,3)));
 await render();expect(state.invoices).toEqual([]);expect(state.loaded).toBe(false);expect(state.error).toBeTruthy();
 await act(async()=>state.refresh());expect(state.invoices.map(i=>i.id)).toEqual([id(3)]);expect(state.invoices[0].financial_evidence_version).toBe(3);expect(state.error).toBeNull();
});
it.each([2,3] as const)('current pagination refuses older representation%s without blending and recovers through original refresh',async mode=>{
 f.reply.mockResolvedValueOnce(result(page(4,1,true))).mockResolvedValueOnce(result(page(mode,2))).mockResolvedValueOnce(result(page(4,3)));
 await render();await act(async()=>state.loadMore());
 expect(f.calls).toHaveLength(2);expect(f.calls[1]).toMatchObject({name:'client_portal_invoices_calendar_scoped',args:{p_tenant_id:tenant,p_expected_client_id:client(tenant),p_after:{issued_at:'2026-10-29T00:15:00Z',id:id(1)}}});
 expect(state.invoices.map(i=>i.id)).toEqual([id(1)]);expect(state.error).toBeTruthy();
 await act(async()=>state.refresh());expect(f.calls[2].args.p_after).toBeNull();expect(state.invoices.map(i=>i.id)).toEqual([id(3)]);expect(state.error).toBeNull();
});
it('preserves original pagination when current financial representation is unchanged',async()=>{
 f.reply.mockResolvedValueOnce(result(page(4,1,true))).mockResolvedValueOnce(result(page(4,2)));await render();await act(async()=>state.loadMore());
 expect(state.invoices.map(i=>i.id)).toEqual([id(1),id(2)]);expect(f.calls).toHaveLength(2);expect(state.error).toBeNull();expect(state.invoices.every(i=>i.financial_evidence_version===3)).toBe(true);
});
it('does not silently accept an old continuation after an empty current first page',async()=>{
 f.reply.mockResolvedValueOnce(result(page(4,1,true,tenant,true))).mockResolvedValueOnce(result(page(3,2))).mockResolvedValueOnce(result(page(4,3)));
 await render();await act(async()=>state.loadMore());expect(f.calls).toHaveLength(2);expect(state.invoices).toEqual([]);expect(state.error).toBeTruthy();
 await act(async()=>state.refresh());expect(state.invoices.map(i=>i.id)).toEqual([id(3)]);
});
it('a failed fresh financial read cannot blend or mark stale rows fresh and the same refresh recovers',async()=>{
 f.reply.mockResolvedValueOnce(result(page(4,1,true))).mockResolvedValueOnce(result(page(3,2))).mockResolvedValueOnce({data:null,error:{code:'synthetic_connection'}}).mockResolvedValueOnce(result(page(4,3)));
 await render();await act(async()=>state.loadMore());await act(async()=>state.refresh());
 expect(state.invoices.map(i=>i.id)).toEqual([id(1)]);expect(state.error).toBeTruthy();expect(state.loading).toBe(false);
 await act(async()=>state.refresh());expect(state.invoices.map(i=>i.id)).toEqual([id(3)]);expect(state.error).toBeNull();
});
it('a late older financial continuation cannot replace a fresh scope or current next page',async()=>{
 const old=pending();f.reply.mockResolvedValueOnce(result(page(4,1,true))).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(page(4,3,true,other))).mockResolvedValueOnce(result(page(4,4,false,other)));
 await render();await act(async()=>{void state.loadMore();await flush();});await render(other);old.resolve(result(page(3,2)));await act(flush);
 await act(async()=>state.loadMore());expect(state.invoices.map(i=>i.id)).toEqual([id(3),id(4)]);expect(snapshots.filter(s=>s.business===other).every(s=>!s.ids.includes(id(1))&&!s.ids.includes(id(2)))).toBe(true);
});
it('an intervening refresh owns current financial truth and retires older load-more response',async()=>{
 const old=pending();f.reply.mockResolvedValueOnce(result(page(4,1,true))).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(page(4,3)));
 await render();await act(async()=>{void state.loadMore();await flush();});await act(async()=>state.refresh());old.resolve(result(page(3,2)));await act(flush);
 expect(state.invoices.map(i=>i.id)).toEqual([id(3)]);expect(state.invoices[0].financial_evidence_version).toBe(3);expect(f.calls).toHaveLength(3);
});
it('original signout retires financial facts and a fresh same-actor login cannot accept legacy debt',async()=>{
 f.reply.mockResolvedValueOnce(result(page(4,1,true))).mockResolvedValueOnce(result(page(3,2))).mockResolvedValueOnce(result(page(4,3,true))).mockResolvedValueOnce(result(page(4,4)));
 await render();await act(async()=>{for(const callback of f.listeners)callback('SIGNED_OUT',null);await flush();});expect(state.invoices).toEqual([]);
 await act(async()=>{for(const callback of f.listeners)callback('SIGNED_IN',{user:{id:actor}});await flush();});expect(state.invoices).toEqual([]);expect(state.error).toBeTruthy();
 await act(async()=>state.refresh());await act(async()=>state.loadMore());expect(state.invoices.map(i=>i.id)).toEqual([id(3),id(4)]);expect(state.invoices.every(i=>i.financial_evidence_version===3)).toBe(true);
});

it('a changed canonical financial source refreshes before appending current pages, even in the same day and representation',async()=>{
 const old=page(4,1,true),next=page(4,2),fresh=page(4,3);next.financial_revision='b'.repeat(64);fresh.financial_revision='b'.repeat(64);next.invoices[0].remaining_minor='1000';next.balances[0].remaining_minor='3000';fresh.invoices[0].remaining_minor='1000';fresh.balances[0].remaining_minor='3000';
 f.reply.mockResolvedValueOnce(result(old)).mockResolvedValueOnce(result(next)).mockResolvedValueOnce(result(fresh));await render();await act(async()=>state.loadMore());
 expect(f.calls).toHaveLength(3);expect(f.calls[2].args.p_after).toBeNull();expect(state.invoices.map(i=>i.id)).toEqual([id(3)]);
});
