import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({context:{accountContextStatus:"ready",activeUserId:"actor",activeTenantId:"workspace"},submit:vi.fn()}));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>mocks.context}));
vi.mock("./operations-crm-work-command",async importOriginal=>({...await importOriginal<typeof import("./operations-crm-work-command")>(),submitCrmWorkStageOperation:mocks.submit}));
import {OperationsCrmStageReview} from "./OperationsCrmStageReview";
import {buildCrmWorkStageOperation} from "./operations-crm-work-command";
import type {CrmWorkRecord} from "./operations-native-work";
const task={id:"original-task",tenant_id:"workspace",status:"pending",updated_at:"2026-10-10T12:00:00Z"} as CrmWorkRecord;
const original=buildCrmWorkStageOperation(task,"done","actor","workspace","original-key")!;
let node:HTMLDivElement,root:Root;
const refresh=vi.fn(),close=vi.fn(),verified=vi.fn();
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mocks.context={accountContextStatus:"ready",activeUserId:"actor",activeTenantId:"workspace"};
 node=document.createElement("div");document.body.append(node);root=createRoot(node);refresh.mockResolvedValue([{...task,status:"completed",updated_at:"2026-10-10T12:01:00Z"}]);});
afterEach(()=>{act(()=>root.unmount());node.remove();});
const render=async(operation=original)=>{await act(async()=>root.render(<OperationsCrmStageReview operation={operation} refresh={refresh} onClose={close} onVerified={verified}/>));};
const click=async(text:string)=>{const button=Array.from(node.querySelectorAll("button")).find(b=>b.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click());};
it("requires explicit confirmation and independent native readback after acknowledgement",async()=>{
 mocks.submit.mockResolvedValue({kind:"acknowledged"});await render();expect(mocks.submit).not.toHaveBeenCalled();
 await click("Confirm stage change");expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(original,undefined);
 expect(refresh).toHaveBeenCalledOnce();expect(verified).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
});
it("binds Trust approval to the proposed exact operation before readback",async()=>{
 mocks.submit.mockResolvedValueOnce({kind:"approval",fingerprint:"fingerprint",summary:"Complete the task"}).mockResolvedValueOnce({kind:"acknowledged"});await render();
 await click("Confirm stage change");expect(verified).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
 await click("Approve exact change");expect(mocks.submit.mock.calls[1]).toEqual([original,"fingerprint"]);expect(verified).toHaveBeenCalledOnce();
});
it("does not claim saved work when independent readback differs",async()=>{
 mocks.submit.mockResolvedValue({kind:"acknowledged"});refresh.mockResolvedValue([task]);await render();await click("Confirm stage change");
 expect(verified).not.toHaveBeenCalled();expect(node.textContent).toContain("has not confirmed");expect(sessionStorage.length).toBe(1);
});
it("retains unknown recovery across remount and never substitutes a newly requested task",async()=>{
 mocks.submit.mockResolvedValueOnce({kind:"uncertain",message:"Result unknown"}).mockResolvedValueOnce({kind:"acknowledged"});await render();await click("Confirm stage change");await click("Close · recovery retained");
 await act(async()=>root.unmount());root=createRoot(node);const next=buildCrmWorkStageOperation({...task,id:"new-task"},"in_progress","actor","workspace","new-key")!;
 await render(next);expect(node.textContent).toContain("newly selected task has not been changed");await click("Recover original action");
 expect(mocks.submit.mock.calls[1]).toEqual([original,undefined]);expect(verified).toHaveBeenCalledExactlyOnceWith("original-task");
});
it("rejects a new dispatch after workspace switch",async()=>{
 await render();mocks.context.activeTenantId="other-workspace";await render();await click("Confirm stage change");expect(mocks.submit).not.toHaveBeenCalled();
});
it("preserves recovery and suppresses success when scope changes during dispatch",async()=>{
 mocks.submit.mockImplementation(async()=>{mocks.context.activeTenantId="other-workspace";return {kind:"acknowledged"};});await render();await click("Confirm stage change");
 expect(refresh).not.toHaveBeenCalled();expect(verified).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
});
it("does not retry a refused command with stale inputs",async()=>{
 mocks.submit.mockResolvedValue({kind:"refused",message:"Refused"});await render();await click("Confirm stage change");
 await click("Confirm stage change");expect(mocks.submit).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);expect(verified).not.toHaveBeenCalled();
});
