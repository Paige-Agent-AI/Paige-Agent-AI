// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readManualSystemsRun} from '../../supabase/functions/_shared/systems-check-manual-result';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const ref={threadId:id(1),intentId:id(2),workId:id(3)};
 const work={work_id:id(3),capability_key:'systems.check',work_kind:'systems_check',work_status:'succeeded',attempt_count:1,max_attempts:1,blocked_reason:null,error_code:null,safe_summary:'Original check',created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:03Z',settled_at:'2026-10-01T12:00:03Z'};
 const run={id:id(3),work_id:id(3),tenant_id:id(5),scan_flavor:'manual',selected_runner_keys:null,triggered_by:{scope:'tenant',action_filing:'none'},started_at:'2026-10-01T12:00:01Z',completed_at:'2026-10-01T12:00:02Z',check_count:5,pass_count:2,fail_count:1};
 const observation:Record<string,unknown>={...ref,workIntentId:id(6),actorId:id(4),tenantId:id(5),state:'succeeded',version:2,artifactVerified:false,artifactRef:null,recoveryState:'observed',observationKind:'systems_check',receiptVerified:true,receiptRef:id(7)};
 const observe=vi.fn(async():Promise<{data:unknown;error:unknown}>=>({data:{...observation},error:null}));
 const getUser=vi.fn(async()=>({data:{user:{id:id(4)}},error:null}));
 const tenant=vi.fn(async()=>({data:id(5),error:null}));
 const workRead=vi.fn(async():Promise<{data:unknown;error:unknown}>=>({data:[{...work}],error:null}));
 const workAbort=vi.fn(()=>workRead());
 const runRead=vi.fn(async()=>({data:JSON.parse(JSON.stringify(run)),error:null}));
 const query={select:vi.fn(),eq:vi.fn(),abortSignal:vi.fn(),maybeSingle:runRead};
 query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.abortSignal.mockReturnValue(query);
 const bounded=(start:()=>PromiseLike<{data:unknown;error:unknown}>)=>{const pending=Promise.resolve().then(start);return Object.assign(pending,{abortSignal:vi.fn(()=>pending)});};
 const caller={auth:{getUser},rpc:vi.fn((name:string,_args?:Record<string,unknown>)=>{
  if(name==='current_user_tenant_id')return bounded(tenant);
  if(name==='get_paige_durable_work')return {abortSignal:workAbort};
  if(name==='read_paige_durable_observation')return bounded(observe);
  throw Error('Unexpected RPC '+name);
 }),from:vi.fn(()=>query)};
 const controller=new AbortController(),current=vi.fn(()=>true);
 const ports={actorId:id(4),tenantId:id(5),workId:id(3),caller,signal:controller.signal,current,observation:ref};
 return {ref,work,run,observation,observe,getUser,tenant,workRead,runRead,query,caller,controller,current,ports};
}
const read=(ports:ReturnType<typeof fixture>['ports'])=>readManualSystemsRun(ports as unknown as Parameters<typeof readManualSystemsRun>[0]);
it('joins only the original accepted-intent receipt and retains the original run',async()=>{
 const f=fixture(),r=await read(f.ports);
 expect(r).toMatchObject({readback:'available',run:{id:id(3),checkCount:5},receipt:'verified',receiptRef:id(7)});
 expect(f.observe).toHaveBeenCalledTimes(2);
 expect(f.caller.rpc.mock.calls.filter(x=>x[0]==='read_paige_durable_observation')).toEqual([
  ['read_paige_durable_observation',{_thread:id(1),_intent:id(2),_work:id(3)}],
  ['read_paige_durable_observation',{_thread:id(1),_intent:id(2),_work:id(3)}],
 ]);
 expect(f.caller.from.mock.calls.every(x=>x[0]==='paige_systems_check_run')).toBe(true);
 expect(JSON.stringify(r)).not.toMatch(/request_payload|tenantId|actorId|threadId|eligibleForExecution|artifactVerified|detail/);
});
it('keeps genuine recorded completion distinct from an unverified original receipt',async()=>{
 const f=fixture();Object.assign(f.observation,{receiptVerified:false,receiptRef:null,recoveryState:'terminal_unverified'});
 expect(await read(f.ports)).toMatchObject({readback:'available',receipt:'unverified'});
 expect(await read(f.ports)).not.toHaveProperty('receiptRef');
});
it.each([{workId:id(8)},{threadId:'invalid'},{intentId:'invalid'},{extra:'not accepted'}])('refuses a foreign or malformed original observation reference %j',async change=>{
 const f=fixture();Object.assign(f.ref,change);expect(await read(f.ports)).toEqual({readback:'unconfirmed'});expect(f.getUser).not.toHaveBeenCalled();
});
it.each([{state:'claimed',receiptVerified:false,receiptRef:null},{observationKind:undefined},{receiptRef:'invalid'},{artifactVerified:true,artifactRef:id(8)},{tenantId:id(8)},{actorId:id(8)},{workIntentId:'invalid'}])('does not borrow inconsistent or unrelated evidence %j',async change=>{
 const f=fixture();Object.assign(f.observation,change);expect(await read(f.ports)).toEqual({readback:'unconfirmed'});
});
it('withdraws proof when the original observation is no longer available',async()=>{
 const f=fixture();f.observe.mockImplementation(async()=>({data:null,error:null}));expect(await read(f.ports)).toEqual({readback:'unconfirmed'});
});
it('pins the original reference before asynchronous reads',async()=>{
 const f=fixture();f.getUser.mockImplementationOnce(async()=>{f.ref.intentId=id(8);return {data:{user:{id:id(4)}},error:null};});
 expect(await read(f.ports)).toMatchObject({receipt:'verified',receiptRef:id(7)});
 expect(f.caller.rpc.mock.calls.filter(x=>x[0]==='read_paige_durable_observation').every(x=>(x[1] as Record<string,string>)._intent===id(2))).toBe(true);
});
it('refuses a changed original receipt between canonical observation reads',async()=>{
 const f=fixture();f.observe.mockImplementationOnce(async()=>({data:{...f.observation},error:null})).mockImplementationOnce(async()=>({data:{...f.observation,receiptRef:id(8)},error:null}));
 expect(await read(f.ports)).toEqual({readback:'unconfirmed'});
});
it('withdraws the result if the associated run changes during receipt verification',async()=>{
 const f=fixture();f.observe.mockImplementationOnce(async()=>{f.run.check_count=6;return {data:{...f.observation},error:null};});
 expect(await read(f.ports)).toEqual({readback:'unconfirmed'});
});
it.each(['authority','host'])('withdraws receipt results after a final %s change',async change=>{
 const f=fixture();f.observe.mockImplementationOnce(async()=>{
  if(change==='authority')f.workRead.mockImplementation(async()=>({data:null,error:{message:'private denial'}}));else f.current.mockReturnValue(false);
  return {data:{...f.observation},error:null};
 });
 expect(await read(f.ports)).toEqual({readback:'unconfirmed'});
});
it.each(['actor','tenant'])('refuses a final %s change before another native Work read',async change=>{
 const f=fixture();f.runRead.mockImplementationOnce(async()=>({data:JSON.parse(JSON.stringify(f.run)),error:null})).mockImplementationOnce(async()=>{
  if(change==='actor')f.getUser.mockImplementation(async()=>({data:{user:{id:id(8)}},error:null}));else f.tenant.mockImplementation(async()=>({data:id(8),error:null}));
  return {data:JSON.parse(JSON.stringify(f.run)),error:null};
 });
 expect(await read(f.ports)).toEqual({readback:'unconfirmed'});expect(f.workRead).toHaveBeenCalledTimes(2);
 if(change==='actor')expect(f.tenant).toHaveBeenCalledTimes(4);
});
it('returns bounded uncertainty without waiting for a late receipt or retrying',async()=>{
 const f=fixture();let finish!:()=>void;
 f.observe.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>resolve({data:{...f.observation},error:null});}));
 const pending=read(f.ports);await tick();f.controller.abort();expect(await pending).toEqual({readback:'unconfirmed'});
 finish();await tick();expect(f.observe).toHaveBeenCalledTimes(1);
});
