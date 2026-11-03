import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {useParams} from 'react-router-dom';
import {useOptionalTenantContext} from '@/hooks/useTenantContext';
import type {BusinessMissionDetail,DocumentWorkStep} from '@/types/businessMission';
import {routeLinkTarget} from '@/lib/links/workspaceLinks';
import {useOperationsPeople} from './operations/useOperationsPeople';
import {memberVisibleIdentity} from './team-workspace-contract';
import {buildMissionTaskOperation,inspectMissionTaskEffect,listMissionTaskEffects,missionTaskAssignee,parseMissionTaskLocalDate,submitMissionTaskOperation,
 type MissionTaskInspection,type MissionTaskOperation} from './mission-task-command';

type RenderTask=(step:DocumentWorkStep)=>ReactNode;
type Props={tenantId:string|null|undefined;detail:BusinessMissionDetail;disabled:boolean;children:(renderTask:RenderTask)=>ReactNode};
type Review={stepId:string;phase:'checking'|'review'|'submitting'|'approval'|'result'|'unknown'|'refused';inspection?:MissionTaskInspection;operation?:MissionTaskOperation;fingerprint?:string;summary?:string;message?:string};

/** Original plan step list owns this inline consumer. Native Tasks/Trust own effects. */
export function MissionDocumentTasks(props:Props){
 const identity=useOptionalTenantContext();
 if(!identity?.activeUserId||identity.loading||identity.accountContextStatus!=='ready'||identity.activeTenantId!==props.tenantId)return props.children(()=>null);
 return <ScopedMissionTasks key={JSON.stringify([identity.activeUserId,props.tenantId,props.detail.mission.id,props.detail.mission.revision,props.detail.brief.document_work_intent_hash])}
  {...props} actorId={identity.activeUserId} tenantId={identity.activeTenantId!}/>;
}
function ScopedMissionTasks({tenantId,actorId,detail,disabled,children}:Props&{actorId:string;tenantId:string}){
 const {account}=useParams<{account:string}>();
 const people=useOperationsPeople();
 const [review,setReview]=useState<Review|null>(null),[localDate,setLocalDate]=useState(''),[reason,setReason]=useState('');
 const [recovered,setRecovered]=useState<{phase:'idle'|'loading'|'ready'|'failed';rows:Array<{stepId:string;inspection:MissionTaskInspection}>;next:number|null;message?:string}>({phase:'idle',rows:[],next:null});
 const lifecycle=useRef({live:true,sequence:0}),pending=useRef(false);
 const reviewFocus=useRef<HTMLDivElement>(null),triggers=useRef(new Map<string,HTMLButtonElement>()),lastReviewStep=useRef<string|null>(null);
 const selectedStep=review?.stepId,selectedPhase=review?.phase;
 useLayoutEffect(()=>{
  if(selectedStep){lastReviewStep.current=selectedStep;reviewFocus.current?.focus();}
  else if(lastReviewStep.current){triggers.current.get(lastReviewStep.current)?.focus();lastReviewStep.current=null;}
 },[selectedStep,selectedPhase]);
 useLayoutEffect(()=>{const marker=lifecycle.current;marker.live=true;return()=>{marker.live=false;marker.sequence++;};},[]);
 const busy=review?.phase==='checking'||review?.phase==='submitting'||recovered.phase==='loading';
 const loadRecovered=async(offset=0)=>{
  if(disabled||pending.current)return;
  pending.current=true;const token=++lifecycle.current.sequence;
  setRecovered(previous=>({phase:'loading',rows:offset?previous.rows:[],next:null}));
  const result=await listMissionTaskEffects(actorId,tenantId,detail.mission.id,offset);
  if(!lifecycle.current.live||token!==lifecycle.current.sequence)return;
  pending.current=false;
  if(result.kind==='unavailable'){setRecovered({phase:'failed',rows:[],next:null,message:result.message});return;}
  setRecovered(previous=>({phase:'ready',rows:[...new Map([...(offset?previous.rows:[]),...result.records].map(row=>[row.stepId,row])).values()],next:result.nextOffset}));
 };
 const inspect=async(step:DocumentWorkStep)=>{
  if(disabled||pending.current)return;
  pending.current=true;const token=++lifecycle.current.sequence;
  setReview({stepId:step.id,phase:'checking'});
  const result=await inspectMissionTaskEffect(actorId,tenantId,detail.mission.id,step.id);
  if(!lifecycle.current.live||token!==lifecycle.current.sequence)return;
  pending.current=false;
  setReview({stepId:step.id,phase:result.kind==='not_created'?'review':'result',inspection:result});
 };
 const create=async(step:DocumentWorkStep)=>{
  if(disabled||pending.current||!review||review.stepId!==step.id||!['review','approval'].includes(review.phase))return;
  const schedule=parseMissionTaskLocalDate(localDate,reason);
  const operation=review.phase==='approval'?review.operation:schedule&&buildMissionTaskOperation(detail,step.id,actorId,tenantId,schedule);
  if(!operation){setReview({...review,message:'Choose a valid date and time with a scheduling note, or leave the task undated. The saved plan must be active and its sources available.'});return;}
  const assignee=people.members.find(person=>person.user_id===operation.command.patch.assignee_user_id&&person.status==='active');
  if(!assignee){setReview({...review,message:'The proposed person could not be verified. Refresh the team or revise and save the plan.'});return;}
  pending.current=true;const token=++lifecycle.current.sequence;
  setReview({...review,phase:'submitting',operation,message:undefined});
  const result=await submitMissionTaskOperation(operation,review.phase==='approval'?review.fingerprint:undefined);
  if(!lifecycle.current.live||token!==lifecycle.current.sequence)return;
  if(result.kind==='approval'){pending.current=false;setReview({stepId:step.id,phase:'approval',operation,fingerprint:result.fingerprint,summary:result.summary});return;}
  if(result.kind==='acknowledged'){
   const original=await inspectMissionTaskEffect(actorId,tenantId,detail.mission.id,step.id);
   if(!lifecycle.current.live||token!==lifecycle.current.sequence)return;
   pending.current=false;
   setReview({stepId:step.id,phase:original.kind==='available'?'result':'unknown',inspection:original,message:original.kind==='available'?undefined:'The command returned a receipt, but its current task could not be verified. Check the original task.'});return;
  }
  pending.current=false;setReview({stepId:step.id,phase:result.kind==='uncertain'?'unknown':'refused',operation,message:result.message});
 };
 const renderTask:RenderTask=step=>{
  const selected=review?.stepId===step.id?review:null;
  if(!selected)return <button ref={node=>{if(node)triggers.current.set(step.id,node);else triggers.current.delete(step.id);}} type="button" className="sd-btn sd-btn-sm" disabled={disabled||busy} onClick={()=>{setLocalDate('');setReason('');void inspect(step);}}>Review task</button>;
  const assigneeId=missionTaskAssignee(step,actorId),person=people.members.find(row=>row.user_id===assigneeId&&row.status==='active');
  const name=person?memberVisibleIdentity(person).primary:people.loading?'Checking responsible person…':'Proposed person unavailable';
  const inspection=selected.inspection;
  const taskLink=inspection?.kind==='available'?routeLinkTarget({destination:'operations_work',record_id:inspection.task.id},'solo',account):null;
  const schedule=parseMissionTaskLocalDate(localDate,reason);
  const canCreate=detail.mission.state==='active'&&detail.brief.document_work_intent_status==='available'&&!!person&&!people.loading;
  return <div ref={reviewFocus} tabIndex={-1} role="group" className="space-y-3" aria-label={`Task for ${step.title}`}>
   {selected.phase==='checking'&&<p role="status">Checking the original task…</p>}
   {(selected.phase==='review'||selected.phase==='approval')&&<>
    <p>Task: <strong>{step.title}</strong></p><p className="whitespace-pre-wrap break-words">{step.description}</p>
    <p>Assigned to: {name}{assigneeId===actorId?' (you)':''}</p>
    <p className="text-sm">Saved plan revision {detail.mission.revision} · brief {detail.brief.version}. {step.dueOn?`Source date: ${step.dueOn}.`:'No source date recorded.'}</p>
    <p className="text-sm break-words">Source versions: {detail.brief.document_work_intent?.sources.filter(source=>step.sourceIds.includes(source.reference.documentId)).map(source=>`${source.title}, revision ${source.reference.revision}`).join('; ')||'Recommendation in the saved plan'}</p>
    {step.dependencies.length>0&&<p className="text-sm">Dependencies remain in this saved plan. Creating a task does not schedule or complete them.</p>}
    {selected.phase==='review'&&<>
     <label className="ov-field"><span>Task date and time, optional</span><input className="fin" type="datetime-local" value={localDate} disabled={disabled||!canCreate} onChange={e=>setLocalDate(e.target.value)}/></label>
     {localDate&&<label className="ov-field"><span>Scheduling note</span><textarea className="fin" maxLength={1000} value={reason} disabled={disabled||!canCreate} onChange={e=>setReason(e.target.value)} placeholder="Explain this chosen time; a source date does not set an appointment."/></label>}
     <p className="text-sm">{!localDate?'The task will have no due date.':schedule?`Chosen task time: ${schedule.dueAt} · device timezone ${schedule.timeZone}.`:'Enter a valid time in your device timezone and a scheduling note.'}</p>
    </>}
    {selected.phase==='approval'&&<><p role="status">{selected.summary}</p>{selected.operation?.command.patch.metadata.mission_source_v1.schedule.reason&&<p className="text-sm break-words">Scheduling note: {selected.operation.command.patch.metadata.mission_source_v1.schedule.reason}</p>}<p className="text-sm">{selected.operation?.command.patch.due_date?`Task time: ${selected.operation.command.patch.due_date} · ${selected.operation.command.patch.metadata.mission_source_v1.schedule.timeZone}`:'No task due date.'}</p></>}
    {!canCreate&&<p role="status">{detail.mission.state!=='active'?'Activate the reviewed plan before creating new work.':people.error??'Refresh the responsible person and current source before creating work.'}</p>}
    {people.error&&<button className="sd-btn sd-btn-sm" type="button" onClick={()=>void people.refresh()}>Refresh team</button>}
    <button className="sd-btn sd-btn-sm" type="button" disabled={disabled||!canCreate||!!localDate&&!schedule} onClick={()=>void create(step)}>{selected.phase==='approval'?'Approve task':'Create task'}</button>
   </>}
   {selected.phase==='submitting'&&<p role="status">Creating your task… Closing may leave this request running; reopen this step to check its result.</p>}
   {inspection?.kind==='available'&&<>
    <p role="status">Saved task · {inspection.task.status.replace('_',' ')}</p><p className="break-words">{inspection.task.title}</p>
    <p className="text-sm">Created from plan revision {inspection.origin.missionRevision}, brief {inspection.origin.briefVersion}. Current plan revision: {detail.mission.revision}.</p>
    {inspection.origin.intentSha256!==detail.brief.document_work_intent_hash&&<p className="text-sm">This task belongs to an earlier approved plan version. Review later changes before updating the task.</p>}
    <p className="text-sm">Original receipt: {inspection.receipt.correlation_id.slice(-8)}</p>
    {taskLink?.status==='exact'&&<a className="sd-btn sd-btn-sm" href={taskLink.to}>{taskLink.label}</a>}
   </>}
   {inspection?.kind==='historical_unavailable'&&<p role="status">This step has a committed task result, but the task is deleted or unavailable. Another task will not be created.</p>}
   {inspection?.kind==='ambiguous'&&<p role="alert">More than one historical result needs inspection. New task creation is withheld.</p>}
   {inspection?.kind==='unavailable'&&<p role="status">{inspection.message}</p>}
   {selected.message&&<p role="alert">{selected.message}</p>}
   {!busy&&<div className="flex flex-wrap gap-2">
    {!['review','approval'].includes(selected.phase)&&<button className="sd-btn sd-btn-sm" type="button" disabled={disabled} onClick={()=>void inspect(step)}>Check original task</button>}
    <button className="sd-btn sd-btn-sm" type="button" onClick={()=>{lifecycle.current.sequence++;setReview(null);}}>Close task review</button>
   </div>}
  </div>;
 };
 const needsRecovery=detail.brief.version>1||!detail.brief.document_work_intent&&(detail.brief.document_work_intent_status==='source_changed'||detail.brief.document_work_intent_status==='source_unavailable');
 return <>{children(renderTask)}{needsRecovery&&<section className="mission-document-steps space-y-3" aria-label="Saved tasks for this plan">
  <h4>Saved tasks</h4>
  <p className="text-sm">Existing work keeps its own record and receipt across plan revisions.</p>
  <button className="sd-btn sd-btn-sm" type="button" disabled={disabled||busy} onClick={()=>void loadRecovered()}>Find saved tasks</button>
  {recovered.phase==='loading'&&<p role="status">Checking this plan's original task results…</p>}
  {recovered.message&&<p role="alert">{recovered.message}</p>}
  {recovered.phase==='ready'&&recovered.rows.length===0&&<p role="status">No task results are recorded for this plan.</p>}
  <ul className="space-y-4">{recovered.rows.map(({stepId,inspection})=>{
   const link=inspection.kind==='available'?routeLinkTarget({destination:'operations_work',record_id:inspection.task.id},'solo',account):null;
   return <li key={stepId} className="space-y-2">
    {inspection.kind==='available'?<>
     <h5 className="break-words">{inspection.task.title}</h5><p className="text-sm">{inspection.task.status.replace('_',' ')} · created from plan revision {inspection.origin.missionRevision}, brief {inspection.origin.briefVersion}</p>
     <p className="text-sm">Original receipt: {inspection.receipt.correlation_id.slice(-8)}</p>
     {link?.status==='exact'&&<a className="sd-btn sd-btn-sm" href={link.to}>{link.label}</a>}
    </>:<p role="status">{inspection.kind==='ambiguous'?'This step has more than one historical result to inspect.':'An earlier task result exists, but the task is deleted or unavailable.'} Another task will not be created.</p>}
   </li>;
  })}</ul>
  {recovered.next!==null&&<button className="sd-btn sd-btn-sm" type="button" disabled={disabled||busy} onClick={()=>void loadRecovered(recovered.next!)}>Load more saved tasks</button>}
 </section>}</>;
}
