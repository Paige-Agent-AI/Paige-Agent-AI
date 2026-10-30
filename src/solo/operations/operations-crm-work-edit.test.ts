import { expect, it } from "vitest";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import type { CrmWorkRecord } from "./operations-native-work";
import { buildCrmWorkEditOperation, restoreCrmWorkEditOperation, crmWorkEditMatchesReadback } from "./operations-crm-work-edit";

const person="00000000-0000-4000-8000-000000000002";
const task={id:"task",tenant_id:"workspace",user_id:"owner",due_date:null,updated_at:"2026-10-10T12:00:00.123456Z"} as CrmWorkRecord;
const members=[{user_id:person,status:"active"}] as TeamMemberRecord[];
const scope={actorId:"actor",tenantId:"workspace",key:"original-key"};
const assign=()=>buildCrmWorkEditOperation(task,{kind:"assignment",assigneeId:person},scope,members)!;
const due=()=>buildCrmWorkEditOperation(task,{kind:"due",dueAt:"2026-10-16T09:00:00-04:00"},scope,members)!;
it("prepares the exact canonical command and original CAS without copying work",()=>{
 expect(assign().command).toEqual({action:"task.assign",task_id:task.id,expected_updated_at:task.updated_at,patch:{assignee_user_id:person}});
 expect(due().command).toEqual({action:"task.reschedule",task_id:task.id,expected_updated_at:task.updated_at,patch:{due_date:"2026-10-16T09:00:00-04:00"}});
 expect(Object.isFrozen(assign().command.patch)).toBe(true);
});
it("offers only current active Team identities and refuses malformed or foreign preparation",()=>{
 expect(buildCrmWorkEditOperation(task,{kind:"assignment",assigneeId:person},scope,[])).toBeNull();
 expect(buildCrmWorkEditOperation(task,{kind:"assignment",assigneeId:person},scope,[{...members[0],status:"inactive"}])).toBeNull();
 expect(buildCrmWorkEditOperation(task,{kind:"assignment",assigneeId:"not-uuid"},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation({...task,tenant_id:"foreign"},{kind:"due",dueAt:null},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation({...task,updated_at:null,created_at:null},{kind:"due",dueAt:null},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation(task,{kind:"due",dueAt:null},{...scope,actorId:""},members)).toBeNull();
});
it("distinguishes an explicit clear, invalid date and unchanged instant",()=>{
 expect(buildCrmWorkEditOperation(task,{kind:"due",dueAt:"tomorrow"},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation(task,{kind:"due",dueAt:"2026-02-30T09:00:00Z"},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation(task,{kind:"due",dueAt:"2026-10-16"},scope,members)).toBeNull();
 const cleared=buildCrmWorkEditOperation({...task,due_date:"2026-10-16T13:00:00Z"},{kind:"due",dueAt:null},scope,members)!;
 expect(cleared.command.patch).toEqual({due_date:null});
 expect(buildCrmWorkEditOperation({...task,due_date:"2026-10-16T13:00:00Z"},{kind:"due",dueAt:"2026-10-16T09:00:00-04:00"},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation(task,{kind:"due",dueAt:null},scope,members)).toBeNull();
});
it("restores only exact same-scope, same-key, single-field supported proposals",()=>{
 for(const original of [assign(),due()])expect(restoreCrmWorkEditOperation(JSON.parse(JSON.stringify(original)),"actor","workspace")).toEqual(original);
 expect(restoreCrmWorkEditOperation(assign(),"actor","other")).toBeNull();
 expect(restoreCrmWorkEditOperation({...assign(),command:{...assign().command,patch:{assignee_user_id:person,status:"completed"}}},"actor","workspace")).toBeNull();
 expect(restoreCrmWorkEditOperation({...due(),target:{kind:"due",dueAt:null}},"actor","workspace")).toBeNull();
 expect(restoreCrmWorkEditOperation({...assign(),command:{...assign().command,action:"task.delete"}},"actor","workspace")).toBeNull();
});
it("checks changed-field readback without equating assignment or a date with completion",()=>{
 expect(crmWorkEditMatchesReadback(assign(),{...task,user_id:person})).toBe(true);
 expect(crmWorkEditMatchesReadback(assign(),task)).toBe(false);
 expect(crmWorkEditMatchesReadback(due(),{...task,due_date:"2026-10-16T13:00:00Z"})).toBe(true);
 expect(crmWorkEditMatchesReadback(due(),{...task,tenant_id:"foreign",due_date:"2026-10-16T13:00:00Z"})).toBe(false);
 expect(crmWorkEditMatchesReadback(due(),{...task,id:"other",due_date:"2026-10-16T13:00:00Z"})).toBe(false);
});
it("prepares and restores one scalar effort patch without copying metadata",()=>{
 const effort=buildCrmWorkEditOperation({...task,estimated_minutes:15},{kind:"effort",minutes:30},scope,members)!;
 expect(effort.command).toEqual({action:"task.update",task_id:task.id,expected_updated_at:task.updated_at,patch:{estimated_minutes:30}});
 expect(Object.isFrozen(effort.command.patch)).toBe(true);
 expect(restoreCrmWorkEditOperation(JSON.parse(JSON.stringify(effort)),scope.actorId,scope.tenantId)).toEqual(effort);
 expect(crmWorkEditMatchesReadback(effort,{...task,estimated_minutes:30})).toBe(true);
 expect(crmWorkEditMatchesReadback(effort,{...task,estimated_minutes:15})).toBe(false);
 expect(crmWorkEditMatchesReadback(effort,{...task,tenant_id:"foreign",estimated_minutes:30})).toBe(false);
});
it("keeps effort zero, clear, unchanged and invalid values distinct",()=>{
 expect(buildCrmWorkEditOperation({...task,estimated_minutes:null},{kind:"effort",minutes:0},scope,members)?.command.patch).toEqual({estimated_minutes:0});
 const clear=buildCrmWorkEditOperation({...task,estimated_minutes:0},{kind:"effort",minutes:null},scope,members)!;
 expect(clear.command.patch).toEqual({estimated_minutes:null});
 expect(crmWorkEditMatchesReadback(clear,{...task,estimated_minutes:null})).toBe(true);
 expect(crmWorkEditMatchesReadback(clear,{...task,estimated_minutes:0})).toBe(false);
 expect(buildCrmWorkEditOperation({...task,estimated_minutes:null},{kind:"effort",minutes:null},scope,members)).toBeNull();
 expect(buildCrmWorkEditOperation({...task,estimated_minutes:30},{kind:"effort",minutes:30},scope,members)).toBeNull();
 for(const minutes of [-1,0.5,2147483648,NaN,Infinity])expect(buildCrmWorkEditOperation(task,{kind:"effort",minutes},scope,members)).toBeNull();
});
it("rejects widened or mismatched recovered effort proposals",()=>{
 const effort=buildCrmWorkEditOperation(task,{kind:"effort",minutes:30},scope,members)!;
 for(const altered of [
  {...effort,target:{kind:"effort",minutes:31}},
  {...effort,targetStatus:"in_progress"},
  {...effort,command:{...effort.command,patch:{estimated_minutes:30,metadata:{}}}},
  {...effort,command:{...effort.command,patch:{estimated_minutes:"30"}}},
  {...effort,command:{...effort.command,action:"task.assign"}},
  {...effort,command:{...effort.command,expected_updated_at:"yesterday"}},
 ])expect(restoreCrmWorkEditOperation(altered,scope.actorId,scope.tenantId)).toBeNull();
 expect(restoreCrmWorkEditOperation(effort,"different-actor",scope.tenantId)).toBeNull();
});
