import {beforeEach,expect,it,vi} from 'vitest';
import type {BusinessMissionDetail} from '@/types/businessMission';
import {buildMissionTaskOperation,inspectMissionTaskEffect,parseMissionTaskLocalDate,submitMissionTaskOperation} from './mission-task-command';
const h=vi.hoisted(()=>({auth:vi.fn(),invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:h.auth},functions:{invoke:h.invoke}}}));
const actor='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',mission='33333333-3333-4333-8333-333333333333',step='44444444-4444-4444-8444-444444444444',doc='55555555-5555-4555-8555-555555555555';
const detail=()=>({mission:{id:mission,state:'active',revision:2},brief:{version:1,document_work_intent_status:'available',document_work_intent_hash:'a'.repeat(64),document_work_intent:{contractVersion:1,
 sources:[{reference:{contractVersion:1,tenantId:tenant,documentId:doc,revision:1,contentSha256:'b'.repeat(64)},title:'Synthetic agreement',excerpts:[{start:0,end:4,text:'work'}]}],
 steps:[{id:step,title:'Prepare work',description:'Review the deliverable',responsible:{kind:'specialist',alias:'MENTOR'},dueOn:'2027-02-10',dependencies:[],sourceIds:[doc],basis:'source_obligation',proposedTask:{action:'task.create',assigneeUserId:null}}]}}} as BusinessMissionDetail);
const none={dueAt:null,timeZone:null,reason:null};
const operation=()=>buildMissionTaskOperation(detail(),step,actor,tenant,none)!;
beforeEach(()=>{h.auth.mockReset().mockResolvedValue({data:{user:{id:actor}},error:null});h.invoke.mockReset();});
it('uses one original key and source/version binding, without inventing a source appointment or specialist assignee',()=>{
 const op=operation();expect(op.command.patch).toMatchObject({assignee_user_id:actor,due_date:null,metadata:{mission_source_v1:{missionId:mission,missionRevision:2,briefVersion:1,intentSha256:'a'.repeat(64),stepId:step,schedule:none}}});
 expect(buildMissionTaskOperation(detail(),step,actor,tenant,none)).toEqual(op);
 const changed=detail();changed.mission.revision=3;
 expect(buildMissionTaskOperation(changed,step,actor,tenant,none)?.key).toBe(op.key);
});
it.each(['paused','blocked','completed','stopped','proposed'])('refuses new work from %s plan',state=>{const d=detail();d.mission.state=state as BusinessMissionDetail['mission']['state'];expect(buildMissionTaskOperation(d,step,actor,tenant,none)).toBeNull();});
it('refuses stale/inaccessible/malformed or foreign plan data',()=>{
 for(const patch of [{document_work_intent_status:'source_changed'},{document_work_intent_status:'source_unavailable'},{document_work_intent_hash:null},{document_work_intent:null}]){
  const d=detail();Object.assign(d.brief,patch);expect(buildMissionTaskOperation(d,step,actor,tenant,none)).toBeNull();
 }
 expect(buildMissionTaskOperation(detail(),step,actor,doc,none)).toBeNull();
 expect(buildMissionTaskOperation(detail(),doc,actor,tenant,none)).toBeNull();
});
it('requires an explicit valid local appointment plus scheduling explanation',()=>{
 expect(parseMissionTaskLocalDate('','')).toEqual(none);
 expect(parseMissionTaskLocalDate('2027-02-30T10:00','Chosen appointment')).toBeNull();
 expect(parseMissionTaskLocalDate('2027-02-10T10:00','')).toBeNull();
 const schedule=parseMissionTaskLocalDate('2027-02-10T10:00','Reviewed work time')!;
 expect(buildMissionTaskOperation(detail(),step,actor,tenant,schedule)?.command.patch.due_date).toBe(schedule.dueAt);
 expect(buildMissionTaskOperation(detail(),step,actor,tenant,{...none,timeZone:'UTC'})).toBeNull();
});
it('passes the exact reviewed command/fingerprint to the same governed door and leaves approval there',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'fresh-original',summary:'Approve reviewed work'},error:null});
 expect(await submitMissionTaskOperation(operation(),'prior-original')).toEqual({kind:'approval',fingerprint:'fresh-original',summary:'Approve reviewed work'});
 expect(h.invoke).toHaveBeenCalledExactlyOnceWith('crm-command',{body:{expected_tenant_id:tenant,command:operation().command,idempotency_key:operation().key,approved_fingerprint:'prior-original'}});
});
it('never retries a lost or contradictory create acknowledgement',async()=>{
 h.invoke.mockRejectedValue(Error('connection lost'));
 expect(await submitMissionTaskOperation(operation())).toMatchObject({kind:'uncertain'});expect(h.invoke).toHaveBeenCalledOnce();
 h.invoke.mockResolvedValue({data:{ok:true,readback:{id:doc},receipt_recorded:true},error:null});
 expect(await submitMissionTaskOperation(operation())).toMatchObject({kind:'uncertain'});expect(h.invoke).toHaveBeenCalledTimes(2);
});
it('inspects an unknown effect without issuing create or storing an invented result',async()=>{
 h.invoke.mockResolvedValue({data:{inspection:true,status:'not_created'},error:null});
 expect(await inspectMissionTaskEffect(actor,tenant,mission,step)).toEqual({kind:'not_created'});
 expect(h.invoke).toHaveBeenCalledExactlyOnceWith('crm-command',{body:{expected_tenant_id:tenant,inspect_mission_task:{mission_id:mission,step_id:step}}});
});
it('withholds late actor changes and malformed scope before result display',async()=>{
 h.invoke.mockResolvedValue({data:{inspection:true,status:'not_created'},error:null});
 h.auth.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:doc}},error:null});
 expect(await inspectMissionTaskEffect(actor,tenant,mission,step)).toMatchObject({kind:'unavailable'});
 expect(await inspectMissionTaskEffect(actor,tenant,'malformed',step)).toMatchObject({kind:'unavailable'});expect(h.invoke).toHaveBeenCalledOnce();
});
