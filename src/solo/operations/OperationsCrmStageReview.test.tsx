import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const mocks=vi.hoisted(()=>({context:{accountContextStatus:"ready",activeUserId:"actor",activeTenantId:"workspace"},submit:vi.fn()}));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>mocks.context}));
vi.mock("./operations-crm-work-command",async importOriginal=>({...await importOriginal<typeof import("./operations-crm-work-command")>(),submitCrmWorkStageOperation:mocks.submit}));
import {OperationsCrmStageReview} from "./OperationsCrmStageReview";
import {buildCrmWorkStageOperation,type CrmWorkOperation} from "./operations-crm-work-command";
import {buildCrmWorkEditOperation} from "./operations-crm-work-edit";
import type {CrmWorkRecord} from "./operations-native-work";
const task={id:"original-task",tenant_id:"workspace",status:"pending",updated_at:"2026-10-10T12:00:00Z"} as CrmWorkRecord;
const original=buildCrmWorkStageOperation(task,"done","actor","workspace","original-key")!;
let node:HTMLDivElement,root:Root;
const refresh=vi.fn(),close=vi.fn(),verified=vi.fn();
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{vi.clearAllMocks();mocks.submit.mockReset();sessionStorage.clear();mocks.context={accountContextStatus:"ready",activeUserId:"actor",activeTenantId:"workspace"};
 node=document.createElement("div");document.body.append(node);root=createRoot(node);refresh.mockResolvedValue([{...task,status:"completed",updated_at:"2026-10-10T12:01:00Z"}]);});
afterEach(()=>{act(()=>root.unmount());node.remove();});
const render=async(operation:CrmWorkOperation=original)=>{await act(async()=>root.render(<OperationsCrmStageReview operation={operation} refresh={refresh} onClose={close} onVerified={verified}/>));};
const click=async(text:string)=>{const button=Array.from(node.querySelectorAll("button")).find(b=>b.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click());};
// Opt-in protected fixture capture. This renders the incumbent component/CSS;
// synthetic auth/execution ports cannot certify an authenticated production view.
const capture=(name:string)=>{
 const dir=process.env.TASK_PROGRESS_PROTOTYPE_DIR;if(!dir)return;
 mkdirSync(dir,{recursive:true});
 const css=readFileSync("src/solo/operations/operations-workspace.css","utf8");
 writeFileSync(join(dir,`${name}.html`),`<!doctype html><meta charset="utf-8"><title>Protected native Work fixture: ${name}</title><style>:root{--pg-line:#424349;--pg-line-strong:#64656b;--pg-surface:#24252b;--pg-raised:#303138;--pg-ink:#eeeef1;--pg-gold-fill:#dac298;--accent-foreground:240 12% 12%;--pg-violet:#b2a7ea}body{background:#1c1d22;color:#eeeef1;font:16px system-ui;margin:32px;max-width:540px}${css}</style><p>LOCAL SYNTHETIC FIXTURE · ${name}</p>${node.innerHTML}`);
};
it("drives the incumbent native review pattern through review, approval, unknown and refusal",async()=>{
 mocks.submit.mockResolvedValueOnce({kind:"approval",fingerprint:"prototype-fingerprint",summary:"Move this task to Completed."})
  .mockResolvedValueOnce({kind:"uncertain",message:"The result is unknown. Recover the original action before starting another."})
  .mockResolvedValueOnce({kind:"refused",message:"The task change was refused. Refresh its current details and review your permissions."});
 await render();capture("before-review");await click("Confirm stage change");capture("before-approval");
 await click("Approve exact change");capture("before-unknown");expect(sessionStorage.length).toBe(1);
 await click("Recover original action");capture("before-refused");expect(verified).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it("prototypes the existing progress review, exact approval and independently verified success",async()=>{
 // This initially failed using a protected progress input; after the contract extension
 // the same native fixture now exercises the real builder, with synthetic I/O ports.
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 mocks.submit.mockResolvedValueOnce({kind:"approval",fingerprint:"progress-fingerprint",summary:"Move this task to In progress."}).mockResolvedValueOnce({kind:"acknowledged"});
 refresh.mockResolvedValue([{...task,status:"in_progress",updated_at:"2026-10-10T12:01:00Z"}]);
 await render(progress);capture("progress-review");expect(node.textContent).toContain("Move this task to In progress.");expect(node.textContent).not.toContain("Completed");
 expect(mocks.submit).not.toHaveBeenCalled();await click("Confirm stage change");capture("progress-approval");expect(verified).not.toHaveBeenCalled();
 await click("Approve exact change");expect(mocks.submit.mock.calls[1]).toEqual([progress,"progress-fingerprint"]);expect(verified).toHaveBeenCalledExactlyOnceWith(task.id);
 capture("progress-readback-confirmed");
});
it("cancels a progress proposal without dispatch or retained recovery",async()=>{
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 await render(progress);await click("Back to details");expect(close).toHaveBeenCalledOnce();expect(mocks.submit).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
});
it("recovers the exact progress command and key after unknown result and remount",async()=>{
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 mocks.submit.mockResolvedValueOnce({kind:"uncertain",message:"Result unknown"}).mockResolvedValueOnce({kind:"acknowledged"});
 refresh.mockResolvedValue([{...task,status:"in_progress",updated_at:"2026-10-10T12:01:00Z"}]);
 await render(progress);await click("Confirm stage change");capture("progress-unknown");await click("Close · recovery retained");
 await act(async()=>root.unmount());root=createRoot(node);await render(original);await click("Recover original action");
 expect(mocks.submit.mock.calls[1]).toEqual([progress,undefined]);expect(verified).toHaveBeenCalledExactlyOnceWith(task.id);expect(sessionStorage.length).toBe(0);
});
it("preserves a progress proposal when the independent read is pending, foreign or fails",async()=>{
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 mocks.submit.mockResolvedValue({kind:"acknowledged"});refresh.mockResolvedValueOnce([task]).mockResolvedValueOnce([{...task,tenant_id:"foreign",status:"in_progress"}]).mockRejectedValueOnce(new Error("read unavailable"));
 await render(progress);await click("Confirm stage change");await click("Recover original action");await click("Recover original action");
 expect(verified).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);expect(mocks.submit.mock.calls.every(call=>call[0]===progress)).toBe(true);
});
it("refuses progress without retrying and fences a late progress read after scope change",async()=>{
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 mocks.submit.mockResolvedValueOnce({kind:"refused",message:"Current version required"});await render(progress);await click("Confirm stage change");capture("progress-refused");
 await click("Confirm stage change");expect(mocks.submit).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
 await act(async()=>root.unmount());root=createRoot(node);mocks.submit.mockResolvedValue({kind:"acknowledged"});
 refresh.mockImplementation(async()=>{mocks.context.activeTenantId="other-workspace";return [{...task,status:"in_progress",updated_at:"2026-10-10T12:01:00Z"}];});
 await render(progress);await click("Confirm stage change");expect(verified).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
});
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
 await act(async()=>root.unmount());root=createRoot(node);const next=buildCrmWorkStageOperation({...task,id:"new-task"},"done","actor","workspace","new-key")!;
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
it("confirms due-date changes independently without presenting completed work",async()=>{
 const operation=buildCrmWorkEditOperation({...task,due_date:null},{kind:"due",dueAt:"2026-10-16T13:00:00Z"},{actorId:"actor",tenantId:"workspace",key:"due-key"},[])!;
 mocks.submit.mockResolvedValue({kind:"acknowledged"});refresh.mockResolvedValue([{...task,due_date:"2026-10-16T09:00:00-04:00",updated_at:"2026-10-10T12:01:00Z"}]);
 await render(operation);expect(mocks.submit).not.toHaveBeenCalled();await click("Confirm task change");
 expect(verified).toHaveBeenCalledExactlyOnceWith(task.id);expect(sessionStorage.length).toBe(0);
});
it("retains a due change when the independent read does not confirm it",async()=>{
 const operation=buildCrmWorkEditOperation({...task,due_date:null},{kind:"due",dueAt:"2026-10-16T13:00:00Z"},{actorId:"actor",tenantId:"workspace",key:"due-key"},[])!;
 mocks.submit.mockResolvedValue({kind:"acknowledged"});refresh.mockResolvedValue([{...task,due_date:null}]);
 await render(operation);await click("Confirm task change");expect(verified).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
 await click("Recover original action");expect(mocks.submit.mock.calls[1][0]).toEqual(operation);
});
