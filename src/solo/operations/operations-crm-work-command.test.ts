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
 expect(buildCrmWorkStageOperation(task,"in_progress","actor","workspace","key")).toBeNull();
 expect(buildCrmWorkStageOperation(task,"done","actor","other-workspace","key")).toBeNull();
 expect(Object.isFrozen(operation().command)).toBe(true);
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
 expect(restoreCrmWorkStageOperation({...original,targetStatus:"in_progress",command:{...original.command,action:"task.update",patch:{status:"in_progress"}}},"actor","workspace")).toBeNull();
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
