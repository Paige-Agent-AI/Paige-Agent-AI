import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {CrmWorkRecord} from "./operations-native-work";
const port=vi.hoisted(()=>({actor:"11111111-1111-4111-8111-111111111111",tenant:"22222222-2222-4222-8222-222222222222",readTask:vi.fn(),submit:vi.fn(),listError:null as string|null,guard:null as (()=>string|null)|null}));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>({activeUserId:port.actor,activeTenantId:port.tenant,loading:false,accountContextStatus:"ready"})}));
vi.mock("@/hooks/usePlanList",()=>({usePlanList:()=>({plans:[],allItems:[],loading:false,error:port.listError,forbidden:false,refresh:vi.fn()})}));
vi.mock("./useOperationsPeople",()=>({useOperationsPeople:()=>({members:[{user_id:port.actor,full_name:"Sample owner",status:"active",avatar_url:null}],loading:false,error:null,refresh:vi.fn()})}));
vi.mock("./useOperationsCrmWork",()=>({useOperationsCrmWork:()=>({tasks:[],loading:false,error:port.listError,forbidden:false,hasMore:true,refresh:vi.fn(),readTask:port.readTask})}));
vi.mock("./OperationsDelivery",()=>({default:()=>null}));
vi.mock("./OperationsPlaybooks",()=>({OperationsPlaybooks:()=>null}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:vi.fn(async()=>({data:true,error:null}))}}));
vi.mock("./operations-crm-work-command",async original=>({...await original<typeof import("./operations-crm-work-command")>(),submitCrmWorkStageOperation:port.submit}));
import {OperationsWorkspace} from "./OperationsWorkspace";
import {buildCrmWorkStageOperation} from "./operations-crm-work-command";
const id="33333333-3333-4333-8333-333333333333",other="44444444-4444-4444-8444-444444444444";
const task=():CrmWorkRecord=>({id,tenant_id:port.tenant,user_id:port.actor,title:"Exact Task beyond the loaded window",description:"Canonical current task description",status:"pending",due_date:"2026-11-02T10:00:00Z",updated_at:"2026-10-18T00:00:00.123456Z",created_at:"2026-10-17T00:00:00Z",deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null});
const available=(row=task())=>({status:"available",found:true,task:row});
let host:HTMLDivElement,root:Root;const dismiss=vi.fn();
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.clearAllMocks();port.readTask.mockReset();port.submit.mockReset();port.actor="11111111-1111-4111-8111-111111111111";port.tenant="22222222-2222-4222-8222-222222222222";port.listError=null;sessionStorage.clear();port.readTask.mockImplementation(async()=>available());host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const register=(guard:(()=>string|null)|null)=>{port.guard=guard;};
const render=async(search=`?task=${id}`,key="entry")=>{await act(async()=>root.render(<OperationsWorkspace view="work" weeklySourceSearch={search} weeklySourceKey={key} onTaskFocusDismiss={dismiss} onNavigationGuardChange={register}/>));};
const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]');
const checkbox=()=>dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
async function click(text:string){const button=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(node=>node.textContent?.trim()===text);expect(button).toBeTruthy();await act(async()=>button!.click());}
it("mounts the incumbent real editor for an exact current task even when both bounded lists failed",async()=>{
 port.listError="List unavailable";await render();expect(dialog()?.textContent).toContain(task().title);expect(dialog()?.querySelector('[aria-label="Edit task responsibility and due date"]')).toBeTruthy();
 expect(port.readTask).toHaveBeenCalledExactlyOnceWith(id,expect.any(AbortSignal));expect(port.submit).not.toHaveBeenCalled();
});
it.each(["empty","refused","unavailable"]) ("does not paint a task or editor for %s current authority",async status=>{
 port.readTask.mockResolvedValue(status==="empty"?{status:"available",found:false,task:null}:{status});await render();
 expect(dialog()?.textContent).not.toContain(task().title);expect(dialog()?.querySelector('[aria-label="Edit task responsibility and due date"]')).toBeNull();
 expect(dialog()?.textContent).toContain(status==="empty"?"does not establish global absence":"could not be verified");
});
it.each([`?task=${id}&task=${id}`,"?task=bad",`?task=${id}&weeklySource=planning_item&item=${other}`])("refuses invalid focus %s without an exact read",async query=>{
 await render(query);expect(port.readTask).not.toHaveBeenCalled();expect(dialog()).toBeNull();expect(host.textContent).toContain("task reference is unavailable");
});
it("cancels a held lookup, aborts the request and ignores late details",async()=>{
 let release!:(value:unknown)=>void;port.readTask.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));await render();
 expect(dialog()?.textContent).toContain("Reading current task");const signal=port.readTask.mock.calls[0][1] as AbortSignal;
 await click("Cancel task lookup");expect(signal.aborted).toBe(true);await act(async()=>release(available()));
 expect(dialog()?.textContent).toContain("lookup cancelled");expect(dialog()?.textContent).not.toContain(task().title);
});
it("retires a held Task when a newer clean query arrives",async()=>{
 let release!:(value:unknown)=>void;port.readTask.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await render();
 const oldSignal=port.readTask.mock.calls[0][1] as AbortSignal;
 port.readTask.mockResolvedValue(available({...task(),id:other,title:"New exact task"}));await render(`?task=${other}`,"next-query");
 expect(oldSignal.aborted).toBe(true);expect(dialog()?.textContent).toContain("New exact task");await act(async()=>release(available()));expect(dialog()?.textContent).not.toContain(task().title);
});
it("invalidates old detail replies across actual actor/tenant A→B→A remounts",async()=>{
 let release!:(value:unknown)=>void;port.readTask.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const old=task();await render();const signal=port.readTask.mock.calls[0][1] as AbortSignal;
 port.tenant="55555555-5555-4555-8555-555555555555";await render();port.tenant=old.tenant_id;port.actor="66666666-6666-4666-8666-666666666666";await render();port.actor=old.user_id;port.readTask.mockResolvedValue(available({...task(),title:"New generation"}));await render();
 await act(async()=>release(available(old)));expect(signal.aborted).toBe(true);expect(dialog()?.textContent).toContain("New generation");expect(dialog()?.textContent).not.toContain(old.title);
});
it("retains checked native input on Escape/new-target/Back guard and explicitly closes with Work fallback focus",async()=>{
 await render();await act(async()=>checkbox().click());expect(checkbox().checked).toBe(true);expect(port.guard?.()).toContain("explicitly close");
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
 expect(dialog()).toBeTruthy();expect(checkbox().checked).toBe(true);
 await render(`?task=${other}`,"new-target");expect(port.readTask).toHaveBeenCalledTimes(1);expect(checkbox().checked).toBe(true);
 await click("Close");expect(dialog()).toBeNull();expect(dismiss).toHaveBeenCalledOnce();expect(document.activeElement?.textContent).toBe("Work");
});
it("retains draft input without painting unconfirmed details after failed refresh, then recovers only by a fresh exact read",async()=>{
 await render();await act(async()=>checkbox().click());port.readTask.mockResolvedValueOnce({status:"unavailable"});await click("Refresh task details");
 expect(dialog()?.querySelector('h2')?.textContent).not.toContain(task().title);expect(checkbox().checked).toBe(true);expect(checkbox().closest<HTMLElement>('.ops-detail-content')?.hidden).toBe(true);
 port.readTask.mockResolvedValueOnce(available());await click("Refresh task details");expect(checkbox().checked).toBe(true);expect(checkbox().closest<HTMLElement>('.ops-detail-content')?.hidden).toBe(false);
});
it("preserves original precision and refuses a changed version instead of rebasing unsaved input",async()=>{
 await render();await act(async()=>checkbox().click());port.readTask.mockResolvedValueOnce(available({...task(),updated_at:"2026-10-18T00:00:00.123457Z"}));await click("Refresh task details");
 expect(dialog()?.textContent).toContain("changed while you were editing");expect(checkbox().checked).toBe(true);expect(checkbox().disabled).toBe(true);await click("Review due date");expect(port.submit).not.toHaveBeenCalled();
});
it("keeps the original unknown command/key through a new-target attempt and explicit Close",async()=>{
 port.submit.mockResolvedValue({kind:"uncertain",message:"Current result unknown"});await render();await act(async()=>checkbox().click());await click("Review due date");await click("Confirm task change");
 const command=port.submit.mock.calls[0][0];expect(command.command.expected_updated_at).toBe(task().updated_at);expect(sessionStorage.length).toBe(1);
 await render(`?task=${other}`,"new-target");expect(dialog()?.textContent).toContain("Recover original action");expect(port.submit).toHaveBeenCalledTimes(1);
 await click("Close");expect(sessionStorage.length).toBe(1);expect(JSON.parse(sessionStorage.getItem(`paige:operations-crm-stage:${port.actor}:${port.tenant}`)!).key).toBe(command.key);
});
it("holds a different retained-recovery entry until the current dirty inspector is explicitly closed",async()=>{
 const pending=buildCrmWorkStageOperation({...task(),id:other},"done",port.actor,port.tenant,"77777777-7777-4777-8777-777777777777")!;
 sessionStorage.setItem(`paige:operations-crm-stage:${port.actor}:${port.tenant}`,JSON.stringify(pending));await render();await act(async()=>checkbox().click());
 await click("Recover pending task change");expect(checkbox().checked).toBe(true);expect(dialog()?.querySelector('h2')?.textContent).toBe(task().title);expect(dialog()?.textContent).not.toContain("Recover the earlier task change");expect(port.submit).not.toHaveBeenCalled();
});
it("uses exact readback for a reviewed change beyond the list and preserves the native command",async()=>{
 port.submit.mockResolvedValue({kind:"acknowledged"});await render();await act(async()=>checkbox().click());await click("Review due date");
 port.readTask.mockResolvedValueOnce(available({...task(),due_date:null,updated_at:"2026-10-18T00:01:00.123456Z"}));await click("Confirm task change");
 expect(port.readTask).toHaveBeenCalledTimes(2);expect(port.submit.mock.calls[0][0].command).toEqual({action:"task.reschedule",task_id:id,expected_updated_at:task().updated_at,patch:{due_date:null}});
 expect(dialog()?.textContent).toContain("saved and confirmed");expect(sessionStorage.length).toBe(0);
});
it("reload/remount re-reads a reference instead of reusing a task snapshot",async()=>{
 await render();await act(async()=>root.unmount());root=createRoot(host);port.readTask.mockResolvedValueOnce({status:"available",found:false,task:null});await render();
 expect(port.readTask).toHaveBeenCalledTimes(2);expect(dialog()?.textContent).not.toContain(task().title);expect(dialog()?.textContent).toContain("not visible");
});
