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
