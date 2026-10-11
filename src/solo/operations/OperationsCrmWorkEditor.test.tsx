import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {CrmWorkRecord} from "./operations-native-work";
import type {TeamMemberRecord} from "@/solo/team-workspace-contract";
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mock.rpc}}));
import {OperationsCrmWorkEditor} from "./OperationsCrmWorkEditor";
const first="00000000-0000-4000-8000-000000000001",second="00000000-0000-4000-8000-000000000002";
const task={id:"task",tenant_id:"workspace",user_id:first,due_date:"2026-10-16T13:00:00Z",updated_at:"2026-10-10T12:00:00.123456Z"} as CrmWorkRecord;
const members=[{user_id:first,full_name:"Sample owner",status:"active"},{user_id:second,full_name:"Sample teammate",status:"active"}] as TeamMemberRecord[];
let node:HTMLDivElement,root:Root;const propose=vi.fn();
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.clearAllMocks();mock.rpc.mockResolvedValue({data:true,error:null});node=document.createElement("div");document.body.append(node);root=createRoot(node);});
afterEach(()=>{act(()=>root.unmount());node.remove();});
const render=async(record=task,unavailable=false)=>{await act(async()=>root.render(<OperationsCrmWorkEditor task={record} actorId="actor" tenantId="workspace" members={members} unavailable={unavailable} onPropose={propose}/>));};
const click=async(text:string)=>{const button=Array.from(node.querySelectorAll("button")).find(b=>b.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click());};
const changePerson=async()=>{const select=node.querySelector("select")!;await act(async()=>{select.value=second;select.dispatchEvent(new Event("change",{bubbles:true}));});};
it("shows real Team labels and proposes one reassignment without dispatching it",async()=>{
 await render();expect(propose).not.toHaveBeenCalled();expect(mock.rpc).toHaveBeenCalledWith("is_tenant_admin",{_tenant:"workspace"});
 await changePerson();await click("Review reassignment");expect(propose).toHaveBeenCalledOnce();
 expect(propose.mock.calls[0][0].command).toEqual({action:"task.assign",task_id:"task",expected_updated_at:task.updated_at,patch:{assignee_user_id:second}});
});
it("refuses stale draft reuse and unavailable source preparation",async()=>{
 await render();await changePerson();await render({...task,updated_at:"2026-10-10T12:01:00Z"});await click("Review reassignment");expect(propose).not.toHaveBeenCalled();expect(node.textContent).toContain("changed while you were editing");
});
it("keeps assignment control unavailable when target administration is denied",async()=>{
 mock.rpc.mockResolvedValue({data:false,error:null});await render();expect(node.querySelector("select")).toBeNull();expect(node.querySelector('input[type="datetime-local"]')).not.toBeNull();
});
it("prepares an explicit reviewed deadline removal with the original version",async()=>{
 await render();await act(async()=>node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await click("Review due date");
 expect(propose.mock.calls[0][0].command).toEqual({action:"task.reschedule",task_id:"task",expected_updated_at:task.updated_at,patch:{due_date:null}});
});
it("does not prepare changes while the authoritative read is unavailable",async()=>{
 await render(task,true);await changePerson();await click("Review reassignment");expect(propose).not.toHaveBeenCalled();
});
