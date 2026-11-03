import {beforeEach,expect,it,vi} from 'vitest';
import {executorFailureSpeech} from '../../supabase/functions/_shared/crm-command/executor-error';
import type {BusinessMissionDetail} from '@/types/businessMission';
import {buildMissionTaskOperation,inspectMissionTaskEffect,listMissionTaskEffects,parseMissionTaskLocalDate,submitMissionTaskOperation} from './mission-task-command';
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

it.each(['CRM_MISSION_PLAN_CHANGED','CRM_MISSION_STEP_CHANGED','CRM_MISSION_SOURCE_CHANGED','CRM_MISSION_NOT_ACTIVE','CRM_MISSION_TASK_EXISTS'])('preserves the original confirmed native refusal envelope %s',async code=>{
 const body={ok:false,outcome:'failed',code,...executorFailureSpeech(code,[],'refused')};
 h.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify(body),{status:422})}});
 const result=await submitMissionTaskOperation(operation());expect(result).toMatchObject({kind:'refused'});expect(result).not.toMatchObject({kind:'uncertain'});
 expect(h.invoke).toHaveBeenCalledOnce();
});
it('keeps original lost-execution envelope uncertain even with an owned refusal-shaped code',async()=>{
 const code='CRM_MISSION_SOURCE_CHANGED';h.invoke.mockResolvedValue({data:{ok:false,outcome:'failed',code,...executorFailureSpeech(code,[],'lost')},error:null});
 expect(await submitMissionTaskOperation(operation())).toMatchObject({kind:'uncertain'});expect(h.invoke).toHaveBeenCalledOnce();
});

const recovered=(stepId=step)=>({stepId,inspection:true,status:'available',task:{id:doc,tenant_id:tenant,title:'Existing permitted work',status:'pending',assignee_user_id:actor,due_date:null,updated_at:'2026-11-03T12:00:00Z'},origin:{missionId:mission,stepId,missionRevision:2,briefVersion:1,intentSha256:'a'.repeat(64)},receipt:{receipt_recorded:true,correlation_id:doc}});
const page=(records:unknown[]=[],offset=0)=>({listing:true,missionId:mission,offset,records,has_more:false,next_offset:null});
it('recovers original result summaries after source redaction without raw text or execution',async()=>{
 h.invoke.mockResolvedValue({data:page([recovered()]),error:null});
 const result=await listMissionTaskEffects(actor,tenant,mission);expect(result).toMatchObject({kind:'page',nextOffset:null,records:[{stepId:step,inspection:{kind:'available',task:{title:'Existing permitted work'}}}]});
 expect(JSON.stringify(result)).not.toContain('description');expect(h.invoke).toHaveBeenCalledExactlyOnceWith('crm-command',{body:{expected_tenant_id:tenant,inspect_mission_task:{mission_id:mission,offset:0}}});
});
it('uses only the original exact paging continuation and withholds corrupt or foreign summaries',async()=>{
 const records=Array.from({length:20},(_,i)=>recovered(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`));
 h.invoke.mockResolvedValue({data:{...page(records),has_more:true,next_offset:20},error:null});
 expect(await listMissionTaskEffects(actor,tenant,mission)).toMatchObject({kind:'page',nextOffset:20,records:expect.any(Array)});
 const invalid=[{...page(records),has_more:true,next_offset:21},page([recovered(),recovered()]),{...page(),missionId:doc},page([{...recovered(),task:{...recovered().task,tenant_id:doc}}]),page([{...recovered(),origin:{...recovered().origin,missionId:doc}}]),page([{...recovered(),status:'not_created'}])];
 for(const data of invalid){h.invoke.mockResolvedValue({data,error:null});expect(await listMissionTaskEffects(actor,tenant,mission)).toMatchObject({kind:'unavailable'});}
 h.invoke.mockResolvedValue({data:page([],20),error:null});expect(await listMissionTaskEffects(actor,tenant,mission,20)).toMatchObject({kind:'page',records:[]});
 expect(h.invoke.mock.lastCall?.[1].body.inspect_mission_task).toEqual({mission_id:mission,offset:20});
});
it('withholds revoked, late actor, malformed and failed recovery without a Task write',async()=>{
 h.invoke.mockResolvedValue({data:{inspection:true,ok:false,code:'CRM_FORBIDDEN'},error:null});expect(await listMissionTaskEffects(actor,tenant,mission)).toMatchObject({kind:'unavailable'});
 h.invoke.mockResolvedValue({data:page([recovered()]),error:null});h.auth.mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:doc}},error:null});
 expect(await listMissionTaskEffects(actor,tenant,mission)).toMatchObject({kind:'unavailable'});
 h.invoke.mockRejectedValue(Error('interrupted'));expect(await listMissionTaskEffects(actor,tenant,mission)).toMatchObject({kind:'unavailable'});
 const calls=h.invoke.mock.calls.length;expect(await listMissionTaskEffects(actor,tenant,mission,-1)).toMatchObject({kind:'unavailable'});expect(h.invoke).toHaveBeenCalledTimes(calls);
 expect(h.invoke.mock.calls.every(call=>!call[1].body.command)).toBe(true);
});
it('keeps an explicit unknown outcome uncertain even with a contradictory approval',async()=>{
 h.invoke.mockResolvedValue({data:{outcome:'approval_required',fingerprint:'must-not-approve',outcome_unknown:true},error:null});expect(await submitMissionTaskOperation(operation())).toMatchObject({kind:'uncertain'});
});
