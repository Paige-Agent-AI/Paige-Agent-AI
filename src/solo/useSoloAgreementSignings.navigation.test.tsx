import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const h=vi.hoisted(()=>({tenant:{activeTenantId:'',accountContextLoading:false},actor:'',anonymous:false,admin:true,current:'',
 row:null as Record<string,unknown>|null,pending:null as Promise<unknown>|null,invoke:vi.fn(),calls:[] as Array<{table:string;columns:string;filters:Array<[string,unknown]>}>,
 listeners:new Set<(event:string,session:{user:{id:string}}|null)=>void>()}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>h.tenant}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 auth:{getUser:async()=>({data:{user:{id:h.actor,is_anonymous:h.anonymous}},error:null}),onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{
  h.listeners.add(callback);callback('INITIAL_SESSION',{user:{id:h.actor}});return {data:{subscription:{unsubscribe:()=>h.listeners.delete(callback)}}};
 }},
 rpc:async(name:string)=>({data:name==='current_user_tenant_id'?h.current:h.admin,error:null}),functions:{invoke:h.invoke},
 from:(table:string)=>{const call={table,columns:'',filters:[] as Array<[string,unknown]>};const q:Record<string,unknown>={};
  q.select=(columns:string)=>{call.columns=columns;h.calls.push(call);return q;};q.eq=(key:string,value:unknown)=>{call.filters.push([key,value]);return q;};q.order=()=>q;
  q.limit=async()=>({data:[],error:null});q.maybeSingle=()=>table==='tenant_members'?Promise.resolve({data:{role:'owner'},error:null}):h.pending??Promise.resolve({data:h.row,error:null});return q;
 },
}}));
import {useSoloAgreementSignings} from './useSoloAgreementSignings';
let root:Root,host:HTMLDivElement,latest:ReturnType<typeof useSoloAgreementSignings>;
function Probe(){latest=useSoloAgreementSignings();return null;}
async function paint(){await act(async()=>{root.render(<Probe/>);});}
beforeEach(async()=>{h.tenant={activeTenantId:id(1),accountContextLoading:false};h.current=id(1);h.actor=id(9);h.admin=true;h.anonymous=false;h.pending=null;h.calls=[];h.listeners.clear();h.invoke.mockReset();
 h.row={id:id(2),tenant_id:id(1),version:4,contact_id:id(3),commercial_terms_id:id(4),title:'Retained agreement',body_source:'paige_draft',status:'draft',paige_agreement_signers:[]};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await paint();});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const begin=async()=>{let resolve!:(value:unknown)=>void;h.pending=new Promise(r=>resolve=r);let result!:ReturnType<typeof latest.readSigning>;await act(async()=>{result=latest.readSigning(id(2),id(1));await Promise.resolve();await Promise.resolve();});return {result,resolve};};
it('opens the exact agreement absent from the bounded register using scoped metadata only',async()=>{
 expect(latest.signings).toEqual([]);const result=await latest.readSigning(id(2),id(1));expect(result).toMatchObject({ok:true,version:4,signing:{id:id(2),contactId:id(3),signatureState:'draft'}});
 const call=h.calls.find(c=>c.filters.some(([key])=>key==='id'))!;expect(call.filters).toEqual([['tenant_id',id(1)],['id',id(2)]]);expect(call.columns).toContain('version');expect(call.columns).not.toMatch(/body_markdown|document_path|storage_key|token_hash/);expect(h.listeners.size).toBe(0);
});
it.each(['wrong_id','wrong_tenant','missing','unsafe_version','zero_version'])('never substitutes an unverified target: %s',async kind=>{
 if(kind==='wrong_id')h.row!.id=id(8);if(kind==='wrong_tenant')h.row!.tenant_id=id(8);if(kind==='missing')h.row=null;if(kind==='unsafe_version')h.row!.version=Number.MAX_SAFE_INTEGER+1;if(kind==='zero_version')h.row!.version=0;
 expect(await latest.readSigning(id(2),id(1))).toMatchObject({ok:false});
});
it.each(['role','workspace','anonymous','stale_form','resolving'])('refuses %s before querying target metadata',async kind=>{
 if(kind==='role')h.admin=false;if(kind==='workspace')h.current=id(8);if(kind==='anonymous')h.anonymous=true;if(kind==='resolving'){h.tenant.accountContextLoading=true;await paint();}
 expect(await latest.readSigning(id(2),kind==='stale_form'?id(8):id(1))).toMatchObject({ok:false});expect(h.calls.some(c=>c.filters.some(([key])=>key==='id'))).toBe(false);
});
it.each(['role','workspace','actor_round_trip','tenant_round_trip'])('retires an in-flight exact read after %s',async kind=>{
 const {result,resolve}=await begin();
 if(kind==='role')h.admin=false;if(kind==='workspace')h.current=id(8);
 if(kind==='actor_round_trip'){for(const actor of [id(8),id(9)]){h.actor=actor;for(const callback of h.listeners)callback('SIGNED_IN',{user:{id:actor}});}}
 if(kind==='tenant_round_trip'){h.tenant.activeTenantId=id(8);await paint();h.tenant.activeTenantId=id(1);await paint();}
 resolve({data:h.row,error:null});expect(await result).toMatchObject({ok:false});expect(h.listeners.size).toBe(0);
});
it('keeps an in-flight exact read through a token refresh by the same ordinary actor',async()=>{
 const {result,resolve}=await begin();for(const callback of h.listeners)callback('TOKEN_REFRESHED',{user:{id:h.actor}});resolve({data:h.row,error:null});expect(await result).toMatchObject({ok:true,version:4});
});
it('sends the original workspace brake and refuses a stale form before invocation',async()=>{
 h.invoke.mockResolvedValue({data:{ok:true,sent:[{email:'synthetic@example.test'}],notDelivered:[]},error:null});
 await act(async()=>{expect(await latest.sendForSignature(id(2),id(1))).toMatchObject({ok:true,sent:['synthetic@example.test']});});
 expect(h.invoke).toHaveBeenCalledWith('agreement-send',{body:{agreementId:id(2),expectedTenantId:id(1),resend:false}});
 expect(await latest.sendForSignature(id(2),id(8))).toMatchObject({ok:false});expect(h.invoke).toHaveBeenCalledOnce();
});
it('does not claim non-delivery when the transport loses the result',async()=>{
 h.invoke.mockRejectedValue(Error('Disconnected'));const result=await latest.sendForSignature(id(2),id(1));expect(result).toMatchObject({ok:false});if(result.ok===false){expect(result.message).toContain('could not be confirmed');expect(result.message).not.toMatch(/nothing.*sent|nothing.*delivered/i);}
});
it('masks a returned sending result after a workspace round trip without claiming no effect',async()=>{
 let resolve!:(value:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>resolve=r));const pending=latest.sendForSignature(id(2),id(1));h.tenant.activeTenantId=id(8);await paint();h.tenant.activeTenantId=id(1);await paint();
 resolve({data:{ok:true,sent:[{email:'private@example.test'}],notDelivered:[]},error:null});const result=await pending;expect(result).toMatchObject({ok:false});expect(JSON.stringify(result)).not.toContain('private@example.test');if(result.ok===false)expect(result.message).not.toMatch(/nothing.*sent/i);
});
