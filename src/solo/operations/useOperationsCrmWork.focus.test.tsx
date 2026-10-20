import {act,useLayoutEffect} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {setScopedUserId} from "@/lib/scopedUser";
import {useOperationsCrmWork} from "./useOperationsCrmWork";
import * as taskAdapter from "../../../supabase/functions/_shared/operations-task-read";
const port=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:port.rpc,auth:{getUser:port.getUser}}}));
const actor="11111111-1111-4111-8111-111111111111",tenant="22222222-2222-4222-8222-222222222222",id="33333333-3333-4333-8333-333333333333";
const row={id,tenant_id:tenant,user_id:actor,title:"Exact current Task",description:null,status:"pending",due_date:null,updated_at:"2026-10-18T00:00:00.123456Z",created_at:"2026-10-17T00:00:00Z",deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null};
const envelope=(tasks:unknown[]=[row])=>({ok:true,actor_id:actor,tenant_id:tenant,has_more:false,tasks});
const signals:AbortSignal[]=[];
function builder(value:unknown){const promise=Promise.resolve(value);const result={then:promise.then.bind(promise),abortSignal(signal:AbortSignal){signals.push(signal);return result;}};return result;}
let host:HTMLDivElement,root:Root,current:ReturnType<typeof useOperationsCrmWork>,mounted=false;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
function Probe({a=actor,t=tenant}:{a?:string;t?:string}){current=useOperationsCrmWork(a,t);return <p>{current.tasks.length}</p>;}
const render=async(a=actor,t=tenant)=>{await act(async()=>root.render(<Probe a={a} t={t}/>));};
beforeEach(()=>{vi.clearAllMocks();setScopedUserId(null);signals.length=0;host=document.createElement("div");document.body.append(host);root=createRoot(host);mounted=true;
 port.getUser.mockResolvedValue({data:{user:{id:actor}},error:null});
 port.rpc.mockImplementation((name:string,args?:Record<string,unknown>)=>builder({data:name==="current_user_tenant_id"?tenant:name==="is_tenant_member"?true:args?.p_task_id?envelope():{...envelope([]),has_more:true},error:null}));
});
afterEach(async()=>{if(mounted)await act(async()=>root.unmount());host.remove();setScopedUserId(null);vi.useRealTimers();});
it("uses the actual shared adapter twice with original caller and preserves raw CAS precision despite list failure",async()=>{
 const base=port.rpc.getMockImplementation()!;
 port.rpc.mockImplementation((name,args)=>name==="operations_crm_work_read"&&!args?.p_task_id?builder({data:null,error:{code:"XX000"}}):base(name,args));
 await render();expect(current.error).toBeTruthy();
 const result=await current.readTask(id);
 expect(result).toMatchObject({status:"available",found:true,task:{updated_at:row.updated_at}});
 const exact=port.rpc.mock.calls.filter(([name,args])=>name==="operations_crm_work_read"&&args?.p_task_id);
 expect(exact).toEqual(Array.from({length:2},()=>["operations_crm_work_read",{p_expected_actor_id:actor,p_expected_tenant_id:tenant,p_task_id:id}]));
 expect(port.rpc.mock.calls.filter(([name])=>name==="current_user_tenant_id")).toHaveLength(2);
 expect(port.rpc.mock.calls.filter(([name])=>name==="is_tenant_member")).toHaveLength(2);
 expect(signals.length).toBe(6);expect(current.tasks).toEqual([]);
});
it.each([null,{ok:true,actor_id:actor,tenant_id:tenant,has_more:true,tasks:[row]},envelope([{...row,id:actor}]),envelope([{...row,tenant_id:actor}]),envelope([{...row,status:"invented"}])])("rejects unconfirmed/malformed exact native data",async data=>{
 const base=port.rpc.getMockImplementation()!;port.rpc.mockImplementation((name,args)=>args?.p_task_id?builder({data,error:null}):base(name,args));
 await render();expect(await current.readTask(id)).toMatchObject({status:"unavailable"});
});
it("uses only the final native read when access is withdrawn",async()=>{
 const base=port.rpc.getMockImplementation()!;let n=0;port.rpc.mockImplementation((name,args)=>args?.p_task_id?builder({data:envelope(++n===1?[row]:[]),error:null}):base(name,args));
 await render();expect(await current.readTask(id)).toMatchObject({status:"available",found:false,task:null});
});
it.each(["actor","tenant","seat","persona","error"]) ("refuses changed %s without issuing an exact record read",async boundary=>{
 await render();const base=port.rpc.getMockImplementation()!;
 if(boundary==="actor")port.getUser.mockResolvedValue({data:{user:{id:tenant}},error:null});
 if(boundary==="persona")setScopedUserId("client");
 port.rpc.mockImplementation((name,args)=>name==="current_user_tenant_id"&&boundary==="tenant"?builder({data:actor,error:null}):name==="is_tenant_member"&&boundary==="seat"?builder({data:false,error:null}):name==="current_user_tenant_id"&&boundary==="error"?builder({data:tenant,error:{message:"unconfirmed"}}):base(name,args));
 expect(await current.readTask(id)).toMatchObject({status:"refused"});
 expect(port.rpc.mock.calls.some(([,args])=>args?.p_task_id)).toBe(false);
});
it("aborts in-flight reads across A→B→A and ignores their late response",async()=>{
 await render();const base=port.rpc.getMockImplementation()!;let release!:(value:unknown)=>void;
 port.rpc.mockImplementation((name,args)=>args?.p_task_id?builder(new Promise(resolve=>{release=resolve;})):base(name,args));
 const pending=current.readTask(id);await act(async()=>{await Promise.resolve();});
 expect(signals.at(-1)?.aborted).toBe(false);
 await render(actor,"44444444-4444-4444-8444-444444444444");await render();
 expect(signals.some(signal=>signal.aborted)).toBe(true);
 release({data:envelope(),error:null});expect(await pending).toMatchObject({status:"refused"});
});
it("cannot borrow returned A scope through a callback captured before A→B→A",async()=>{
 await render();const originalCallback=current.readTask;await render(actor,"44444444-4444-4444-8444-444444444444");await render();
 port.rpc.mockClear();expect(await originalCallback(id)).toMatchObject({status:"refused"});expect(port.rpc).not.toHaveBeenCalled();
});
it("retires current identity during unmount layout, before the parent layout observer or passive cleanup",async()=>{
 const actual=taskAdapter.readOperationsTask;let currentIdentity:()=>unknown=()=>"not-captured";
 const spy=vi.spyOn(taskAdapter,"readOperationsTask").mockImplementation((identity,deps,args)=>{currentIdentity=deps.currentIdentity;return actual(identity,deps,args);});
 let observed:unknown="not-observed";
 function LayoutObserver({show}:{show:boolean}){useLayoutEffect(()=>{if(!show)observed=currentIdentity();},[show]);return show?<Probe/>:null;}
 try{
  await act(async()=>root.render(<LayoutObserver show/>));const base=port.rpc.getMockImplementation()!;
  port.rpc.mockImplementation((name,args)=>args?.p_task_id?builder(new Promise(()=>{})):base(name,args));const pending=current.readTask(id);await act(async()=>{await Promise.resolve();});
  expect(currentIdentity()).not.toBeNull();await act(async()=>root.render(<LayoutObserver show={false}/>));expect(observed).toBeNull();expect((await pending).status).toBe("refused");
 }finally{spy.mockRestore();}
});
it.each(["cancel","unmount","deadline"]) ("retires a held exact read on %s without starting the final native read",async mode=>{
 await render();const base=port.rpc.getMockImplementation()!;port.rpc.mockImplementation((name,args)=>args?.p_task_id?builder(new Promise(()=>{})):base(name,args));
 if(mode==="deadline")vi.useFakeTimers();
 const abort=new AbortController();const pending=current.readTask(id,abort.signal);await act(async()=>{await Promise.resolve();});
 if(mode==="cancel")abort.abort();
 if(mode==="unmount"){await act(async()=>root.unmount());mounted=false;}
 if(mode==="deadline")await vi.advanceTimersByTimeAsync(8001);
 expect((await pending).status).not.toBe("available");expect(signals.some(signal=>signal.aborted)).toBe(true);
 expect(port.rpc.mock.calls.filter(([,args])=>args?.p_task_id)).toHaveLength(1);
});
