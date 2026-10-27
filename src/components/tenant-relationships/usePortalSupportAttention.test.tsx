import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {usePortalSupportAttention} from './usePortalSupportAttention';
const actor='e0917000-0000-4000-8000-000000000001',other='e0917000-0000-4000-8000-000000000002',tenant='e0927000-0000-4000-8000-000000000001',foreign='e0927000-0000-4000-8000-000000000002',contact='e0937000-0000-4000-8000-000000000001';
const fixture=vi.hoisted(()=>({context:{activeUserId:'',activeTenantId:'',accountContextStatus:'ready',accountContextLoading:false},getUser:vi.fn(),getSession:vi.fn(),rpc:vi.fn(),header:vi.fn(),signal:null as AbortSignal|null,auth:null as null|((event:string,session:{user:{id:string}}|null)=>void),reply:null as unknown,error:null as unknown,deferred:null as Promise<unknown>|null}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>fixture.context}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 auth:{getUser:(...args:unknown[])=>fixture.getUser(...args),getSession:()=>fixture.getSession(),
  onAuthStateChange:(cb:typeof fixture.auth)=>{fixture.auth=cb;return {data:{subscription:{unsubscribe:vi.fn()}}};}},
 rpc:(...args:unknown[])=>{
  fixture.rpc(...args);
  return {setHeader:(...header:unknown[])=>{
   fixture.header(...header);
   return {abortSignal:(signal:AbortSignal)=>{
    fixture.signal=signal;return fixture.deferred??Promise.resolve({data:fixture.reply,error:fixture.error});
   }};
  }};
 },
}}));
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root,read:ReturnType<typeof usePortalSupportAttention>;
const reply=(a=actor,t=tenant)=>({schema_version:1,actor_id:a,tenant_id:t,source_window:50,source_count:0,cases:[],read_at:'2026-10-26T12:00:00Z'});
function Subject({business,ids}:{business:string;ids:string[]}){read=usePortalSupportAttention(business,ids);return <output>{read.phase}</output>;}
const show=async(business=tenant,ids=[contact])=>act(async()=>root.render(<Subject business={business} ids={ids}/>));
beforeEach(()=>{host=document.createElement('div');root=createRoot(host);fixture.context={activeUserId:actor,activeTenantId:tenant,accountContextStatus:'ready',accountContextLoading:false};fixture.getUser.mockReset().mockResolvedValue({data:{user:{id:actor}},error:null});fixture.getSession.mockReset().mockResolvedValue({data:{session:{user:{id:actor},access_token:'synthetic-token-a'}},error:null});fixture.rpc.mockReset();fixture.header.mockReset();fixture.reply=reply();fixture.error=null;fixture.deferred=null;fixture.auth=null;fixture.signal=null;});
afterEach(()=>{act(()=>root.unmount());vi.useRealTimers();});
it('binds actual captured Auth, actor, business and known CRM IDs to the original scoped read',async()=>{await show();await vi.waitFor(()=>expect(read.phase).toBe('ready'));expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('read_client_portal_support_attention',{p_expected_actor_id:actor,p_expected_tenant_id:tenant,p_contact_ids:[contact]});expect(fixture.header).toHaveBeenCalledWith('Authorization','Bearer synthetic-token-a');expect(fixture.getUser).toHaveBeenCalledWith('synthetic-token-a');expect(fixture.signal).toBeInstanceOf(AbortSignal);});
it.each(['foreign route','no clients','oversized list','invalid ID'])('does not dispatch for %s',async mode=>{await show(mode==='foreign route'?foreign:tenant,mode==='no clients'?[]:mode==='oversized list'?Array.from({length:251},(_,i)=>`e0937000-0000-4000-8000-${String(i).padStart(12,'0')}`):mode==='invalid ID'?['route-label']:[contact]);expect(fixture.rpc).not.toHaveBeenCalled();expect(read.value).toBeNull();});
it('refuses a different current SDK user before dispatch',async()=>{fixture.getUser.mockResolvedValue({data:{user:{id:other}},error:null});await show();await vi.waitFor(()=>expect(read.phase).toBe('error'));expect(fixture.rpc).not.toHaveBeenCalled();});
it('refuses a cached user whose captured bearer verifies as another actor',async()=>{fixture.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValue({data:{user:{id:other}},error:null});await show();await vi.waitFor(()=>expect(read.phase).toBe('error'));expect(fixture.rpc).not.toHaveBeenCalled();});
it.each(['scope','widened','refused','connection'])('keeps %s distinct from empty success',async mode=>{if(mode==='scope')fixture.reply=reply(actor,foreign);if(mode==='widened')fixture.reply={...reply(),private_history:[]};if(mode==='refused')fixture.error={code:'42501',message:'private backend detail'};if(mode==='connection')fixture.error={code:'network'};await show();await vi.waitFor(()=>expect(read.phase).toBe(mode==='refused'?'unavailable':'error'));expect(read.value).toBeNull();expect(host.textContent).not.toContain('private backend');});
it('retires cached data immediately on sign-out, then rereads a legitimate same-actor session',async()=>{await show();await vi.waitFor(()=>expect(read.phase).toBe('ready'));await act(async()=>fixture.auth!('SIGNED_OUT',null));expect(read.value).toBeNull();expect(read.phase).toBe('unavailable');await act(async()=>fixture.auth!('SIGNED_IN',{user:{id:actor}}));await vi.waitFor(()=>expect(read.phase).toBe('ready'));expect(fixture.rpc).toHaveBeenCalledTimes(2);});
it('ignores late A results across A to B to A without borrowing the earlier incarnation',async()=>{let finish!:(v:unknown)=>void;fixture.deferred=new Promise(resolve=>{finish=resolve;});await show();await vi.waitFor(()=>expect(fixture.rpc).toHaveBeenCalledTimes(1));fixture.context.activeTenantId=foreign;await show(foreign);fixture.context.activeTenantId=tenant;fixture.deferred=null;fixture.reply=reply();await show();await vi.waitFor(()=>expect(read.phase).toBe('ready'));const current=read.value;await act(async()=>finish({data:{...reply(),private_history:['old']},error:null}));expect(read.phase).toBe('ready');expect(read.value).toBe(current);});
it('clears old data while Refresh rereads and lets a failed read recover',async()=>{fixture.error={code:'network'};await show();await vi.waitFor(()=>expect(read.phase).toBe('error'));fixture.error=null;await act(async()=>read.refresh());expect(read.phase).toBe('ready');expect(fixture.rpc).toHaveBeenCalledTimes(2);});
it('retires visible history on pagehide and rereads on pageshow',async()=>{await show();await vi.waitFor(()=>expect(read.phase).toBe('ready'));await act(async()=>window.dispatchEvent(new Event('pagehide')));expect(read.value).toBeNull();await act(async()=>window.dispatchEvent(new Event('pageshow')));await vi.waitFor(()=>expect(read.phase).toBe('ready'));expect(fixture.rpc).toHaveBeenCalledTimes(2);});
it('times out a stuck original read without an effect retry, then allows deliberate recovery',async()=>{vi.useFakeTimers();fixture.deferred=new Promise(()=>{});await show();await act(async()=>vi.advanceTimersByTimeAsync(20_001));expect(read.phase).toBe('error');expect(read.value).toBeNull();expect(fixture.signal?.aborted).toBe(true);expect(fixture.rpc).toHaveBeenCalledTimes(1);fixture.deferred=null;await act(async()=>read.refresh());expect(read.phase).toBe('ready');expect(fixture.rpc).toHaveBeenCalledTimes(2);});
