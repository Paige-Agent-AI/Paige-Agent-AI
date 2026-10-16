import { beforeEach, expect, it, vi } from "vitest";
import type { CrmWorkRecord } from "./operations-native-work";
const mocks=vi.hoisted(()=>({getUser:vi.fn(),invoke:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:mocks.getUser},functions:{invoke:mocks.invoke}}}));
import { buildCrmWorkStageOperation, restoreCrmWorkStageOperation, submitCrmWorkStageOperation } from "./operations-crm-work-command";
import { buildCrmWorkEditOperation } from "./operations-crm-work-edit";
const task={id:"native-task",tenant_id:"workspace",status:"pending",updated_at:"2026-10-10T12:00:00.123456Z"} as CrmWorkRecord;
const operation=()=>buildCrmWorkStageOperation(task,"done","actor","workspace","original-key")!;
const ack=()=>({data:{ok:true,readback:{id:task.id,status:"completed",updated_at:"2026-10-10T12:01:00Z",external_effect:false,notification_sent:false}},error:null});
beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:"actor"}},error:null});});
it("preserves the raw native version and refuses unsupported stages or foreign scope",()=>{
 expect(operation().command).toEqual({action:"task.complete",task_id:task.id,expected_updated_at:task.updated_at});
 expect(buildCrmWorkStageOperation(task,"blocked","actor","workspace","key")).toBeNull();
 expect(buildCrmWorkStageOperation(task,"in_progress","actor","workspace","key")?.command).toEqual({action:"task.update",task_id:task.id,expected_updated_at:task.updated_at,patch:{status:"in_progress"}});
 expect(buildCrmWorkStageOperation({...task,status:"completed"},"in_progress","actor","workspace","key")).toBeNull();
 expect(buildCrmWorkStageOperation({...task,status:"cancelled"},"in_progress","actor","workspace","key")).toBeNull();
 expect(buildCrmWorkStageOperation(task,"done","actor","other-workspace","key")).toBeNull();
 expect(Object.isFrozen(operation().command)).toBe(true);
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 expect(Object.isFrozen(progress.command)).toBe(true);expect("patch" in progress.command&&Object.isFrozen(progress.command.patch)).toBe(true);
});
it("submits progress through the same scoped exact-key Trust door and requires progress readback",async()=>{
 const progress=buildCrmWorkStageOperation(task,"in_progress","actor","workspace","progress-key")!;
 mocks.invoke.mockResolvedValueOnce({data:{outcome:"approval_required",fingerprint:"progress-fingerprint",summary:"Start work"},error:null});
 expect((await submitCrmWorkStageOperation(progress)).kind).toBe("approval");
 const response=ack();response.data.readback.status="in_progress";mocks.invoke.mockResolvedValue(response);
 expect(await submitCrmWorkStageOperation(progress,"progress-fingerprint")).toEqual({kind:"acknowledged"});
 expect(mocks.invoke.mock.calls[1]).toEqual(["crm-command",{body:{expected_tenant_id:"workspace",command:progress.command,idempotency_key:"progress-key",approved_fingerprint:"progress-fingerprint"}}]);
 for(const status of ["pending","completed","cancelled"]){response.data.readback.status=status;expect((await submitCrmWorkStageOperation(progress)).kind).toBe("uncertain");}
});
it("uses the existing Trust fingerprint for the exact command and idempotency key",async()=>{
 const original=operation();
 mocks.invoke.mockResolvedValueOnce({data:{outcome:"approval_required",fingerprint:"source-fingerprint",summary:"Complete native task"},error:null}).mockResolvedValueOnce(ack());
 expect(await submitCrmWorkStageOperation(original)).toEqual({kind:"approval",fingerprint:"source-fingerprint",summary:"Complete native task"});
 expect(await submitCrmWorkStageOperation(original,"source-fingerprint")).toEqual({kind:"acknowledged"});
 expect(mocks.invoke.mock.calls[1]).toEqual(["crm-command",{body:{expected_tenant_id:"workspace",command:original.command,idempotency_key:"original-key",approved_fingerprint:"source-fingerprint"}}]);
});
it("recovers an unknown dispatch using the original command without an automatic replay",async()=>{
 const original=operation();mocks.invoke.mockRejectedValueOnce(new Error("Network")).mockResolvedValueOnce(ack());
 expect((await submitCrmWorkStageOperation(original)).kind).toBe("uncertain");
 expect(mocks.invoke).toHaveBeenCalledOnce();
 expect((await submitCrmWorkStageOperation(original)).kind).toBe("acknowledged");
 expect(mocks.invoke.mock.calls[1][1].body).toEqual(mocks.invoke.mock.calls[0][1].body);
});
it("does not dispatch for a different authenticated actor",async()=>{
 mocks.getUser.mockResolvedValue({data:{user:{id:"other"}},error:null});
 expect((await submitCrmWorkStageOperation(operation())).kind).toBe("refused");expect(mocks.invoke).not.toHaveBeenCalled();
});
it("does not acknowledge a response after an actor change",async()=>{
 mocks.getUser.mockResolvedValueOnce({data:{user:{id:"actor"}},error:null}).mockResolvedValueOnce({data:{user:{id:"other"}},error:null});mocks.invoke.mockResolvedValue(ack());
 expect((await submitCrmWorkStageOperation(operation())).kind).toBe("uncertain");
});
it.each([{id:"other-task"},{status:"pending"},{notification_sent:true},{external_effect:true},{updated_at:null}])("requires matching bounded readback: %j",async patch=>{
 const result=ack();Object.assign(result.data.readback,patch);mocks.invoke.mockResolvedValue(result);
 expect((await submitCrmWorkStageOperation(operation())).kind).toBe("uncertain");
});
it("keeps a refusal separate from an attempted or verified completion",async()=>{
 mocks.invoke.mockResolvedValue({data:{ok:false,outcome:"refused"},error:null});
 expect((await submitCrmWorkStageOperation(operation())).kind).toBe("refused");
});
it("restores only an exact same-scope supported task stage command",()=>{
 const original=operation();expect(restoreCrmWorkStageOperation(JSON.parse(JSON.stringify(original)),"actor","workspace")).toEqual(original);
 expect(restoreCrmWorkStageOperation(original,"actor","other-workspace")).toBeNull();
 expect(restoreCrmWorkStageOperation({...original,command:{...original.command,action:"task.delete"}},"actor","workspace")).toBeNull();
 expect(restoreCrmWorkStageOperation({...original,targetStatus:"pending"},"actor","workspace")).toBeNull();
 expect(restoreCrmWorkStageOperation({...original,command:{...original.command,patch:{user_id:"other"}}},"actor","workspace")).toBeNull();
 const progress={...original,targetStatus:"in_progress",command:{...original.command,action:"task.update",patch:{status:"in_progress"}}};
 expect(restoreCrmWorkStageOperation(progress,"actor","workspace")).toEqual(progress);
 for(const patch of [{status:"completed"},{status:"cancelled"},{status:"pending"},{status:"blocked"},{status:null},[],null,{status:"in_progress",user_id:"other"}])
  expect(restoreCrmWorkStageOperation({...progress,command:{...progress.command,patch}},"actor","workspace")).toBeNull();
 expect(restoreCrmWorkStageOperation({...progress,command:{...progress.command,receipt_action:"task.complete"}},"actor","workspace")).toBeNull();
});
it("acknowledges only the changed assignment or date field through the same executor",async()=>{
 const scope={actorId:"actor",tenantId:"workspace",key:"original-edit-key"};
 const due=buildCrmWorkEditOperation({...task,due_date:null},{kind:"due",dueAt:"2026-10-16T13:00:00Z"},scope,[])!;
 const result=ack();Object.assign(result.data.readback,{status:"pending",due_date:"2026-10-16T09:00:00-04:00"});mocks.invoke.mockResolvedValue(result);
 expect(await submitCrmWorkStageOperation(due)).toEqual({kind:"acknowledged"});
 expect(mocks.invoke.mock.calls[0][1].body.command).toEqual(due.command);
 Object.assign(result.data.readback,{due_date:null});
 expect((await submitCrmWorkStageOperation(due)).kind).toBe("uncertain");
});
