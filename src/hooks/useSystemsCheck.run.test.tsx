import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({context:{} as Record<string,unknown>,getUser:vi.fn(),rpc:vi.fn(),from:vi.fn(),row:null as unknown,error:null as unknown,held:null as Promise<{data:unknown;error:unknown}>|null,reads:[] as Array<{table:string;selection:string;filters:unknown[][];signal?:AbortSignal}>}));
vi.mock('@/hooks/useTenantContext',()=>({useTenantContext:()=>h.context}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:h.getUser},rpc:h.rpc,from:h.from}}));
import {useSystemsCheck,type SystemsCheckScope} from './useSystemsCheck';
const ACTOR='00000000-0000-4000-8000-000000000001',TENANT='00000000-0000-4000-8000-000000000002',RUN='a1000000-0000-4000-8000-000000000003',OTHER='00000000-0000-4000-8000-000000000004';
const original=()=>({id:RUN,tenant_id:TENANT,started_at:'2026-10-01T12:00:00Z',completed_at:'2026-10-01T12:00:03Z',check_count:7,pass_count:2,fail_count:1});
const current={run:{...original(),id:OTHER},findings:[]};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|null,host:HTMLDivElement,client:QueryClient,result:ReturnType<typeof useSystemsCheck>,reference:string|null|undefined,scope:SystemsCheckScope;
function Probe(){result=useSystemsCheck(scope,{runId:reference} as Parameters<typeof useSystemsCheck>[1]);return null;}
const render=()=>act(()=>root!.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
async function waitFor(check:()=>void){const began=Date.now();for(;;){try{check();return;}catch(e){if(Date.now()-began>3000)throw e;await act(async()=>{await new Promise(r=>setTimeout(r,10));});}}}
const runState=()=>result as ReturnType<typeof useSystemsCheck>&{recordedRun?:{state:string;run?:Record<string,unknown>}};
beforeEach(()=>{
 h.context={activeTenantId:TENANT,activeUserId:ACTOR,accountContextStatus:'ready',loading:false,isPlatformStaff:false,activeTenant:{id:TENANT,account_type:'standalone',parent_tenant_id:null}};
 h.reads.length=0;h.row=original();h.error=null;h.held=null;reference=RUN;scope='tenant';
 h.getUser.mockReset().mockResolvedValue({data:{user:{id:ACTOR}},error:null});
 h.rpc.mockReset().mockImplementation((name:string)=>{const p=Promise.resolve({data:name==='current_user_tenant_id'?TENANT:current,error:null});return Object.assign(p,{abortSignal:()=>p});});
 h.from.mockReset().mockImplementation(table=>{const read={table,selection:'',filters:[] as unknown[][],signal:undefined as AbortSignal|undefined};h.reads.push(read);const q={select(value:string){read.selection=value;return q;},eq(key:string,value:unknown){read.filters.push([key,value]);return q;},abortSignal(value:AbortSignal){read.signal=value;return q;},maybeSingle(){return h.held??Promise.resolve({data:h.row,error:h.error});}};return q;});
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root?.unmount());client.clear();host.remove();root=null;vi.restoreAllMocks();});
it('reopens the exact original run under current caller/RLS without replacing current health',async()=>{
 render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('ready'));
 expect(runState().recordedRun).toEqual({state:'ready',run:{id:RUN,started_at:original().started_at,completed_at:original().completed_at,check_count:7,pass_count:2,fail_count:1}});
 expect(result.run?.id).toBe(OTHER);expect(h.reads).toHaveLength(2);
 for(const read of h.reads){expect(read.table).toBe('paige_systems_check_run');expect(read.filters).toEqual([['id',RUN],['tenant_id',TENANT]]);expect(read.selection).not.toMatch(/\*|triggered_by|request_payload|receipt|evidence/);expect(read.signal).toBeInstanceOf(AbortSignal);}
 expect(runState().recordedRun).not.toHaveProperty('run.tenant_id');expect(runState().recordedRun).not.toHaveProperty('receiptVerified');
});
it.each([null,undefined])('keeps absent run %s unrequested without an extra read',async value=>{
 reference=value;render();await waitFor(()=>expect(result.loading).toBe(false));expect(runState().recordedRun?.state??'not_requested').toBe('not_requested');expect(h.from).not.toHaveBeenCalled();expect(h.getUser).not.toHaveBeenCalled();
});
it.each(['bad-id','',` ${RUN}`,'https://elsewhere.invalid/run'])('refuses malformed original reference %s before a record read',async value=>{
 reference=value;render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('unavailable'));expect(h.from).not.toHaveBeenCalled();expect(h.getUser).not.toHaveBeenCalled();
});
it('normalizes the canonical UUID before selecting the original record',async()=>{
 reference=RUN.toUpperCase();render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('ready'));expect(h.reads[0].filters[0]).toEqual(['id',RUN]);
});
it('supports the canonical opaque UUID shape without inventing a version restriction',async()=>{
 reference='a1000000-0000-0000-0000-00000000a001';h.row={...original(),id:reference};render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('ready'));expect(runState().recordedRun?.run?.id).toBe(reference);
});
it.each([{accountContextStatus:'resolving'},{activeUserId:null},{activeTenantId:null},{activeTenant:{id:TENANT,account_type:'agency'}},{activeTenant:{id:TENANT,account_type:'standalone',parent_tenant_id:OTHER}}])('requires the existing current SOLO context %#',async change=>{
 h.context={...h.context,...change};render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('unavailable'));expect(h.from).not.toHaveBeenCalled();
});
it('does not widen the Operator snapshot into a tenant record reader',async()=>{
 scope='operator';render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('unavailable'));expect(h.from).not.toHaveBeenCalled();
});
it.each([{id:OTHER},{tenant_id:OTHER},{started_at:'invalid'},{completed_at:'invalid'},{completed_at:'2026-09-01T00:00:00Z'}])('withdraws a foreign or malformed source response %j',async change=>{
 h.row={...original(),...change};render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('unavailable'));
});
it.each([{check_count:0,pass_count:0,fail_count:0},{check_count:null,pass_count:null,fail_count:null},{completed_at:null}])('retains zero, unknown and unfinished data without inference %j',async change=>{
 h.row={...original(),...change};render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('ready'));expect(runState().recordedRun?.run).toMatchObject(change);
});
it('does not return a result after the authenticated actor changes',async()=>{
 h.getUser.mockResolvedValueOnce({data:{user:{id:ACTOR}},error:null}).mockResolvedValueOnce({data:{user:{id:OTHER}},error:null});render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('unavailable'));
});
it('rechecks original RLS after identity awaits rather than reusing the earlier record',async()=>{
 h.getUser.mockImplementationOnce(async()=>({data:{user:{id:ACTOR}},error:null})).mockImplementationOnce(async()=>{h.row=null;return {data:{user:{id:ACTOR}},error:null};});render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('unavailable'));expect(h.reads).toHaveLength(2);
});
it('returns a bounded read error without private details or completion',async()=>{
 h.error={message:'private backend detail'};render();await waitFor(()=>expect(runState().recordedRun?.state).toBe('error'));expect(runState().recordedRun).toEqual({state:'error'});
});
it('withdraws the old record and aborts its read on a workspace change',async()=>{
 let finish!:(value:{data:unknown;error:unknown})=>void;h.held=new Promise(r=>{finish=r;});render();await waitFor(()=>expect(h.reads.length).toBe(1));const signal=h.reads[0].signal;
 h.context={...h.context,activeTenantId:OTHER,activeTenant:{id:OTHER,account_type:'standalone'}};render();await waitFor(()=>expect(signal?.aborted).toBe(true));
 await act(async()=>{finish({data:original(),error:null});});expect(runState().recordedRun?.state).not.toBe('ready');
});
