import { useSyncExternalStore } from 'react';
import { allowAccountSwitch } from '@/lib/auth/accountSwitchGuard';
import { members, items, plans } from './records';
const fixtureMode = new URLSearchParams(location.search).get('delivery') ?? 'prepare';
const fixtureId = (n:number) => `ee910000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixtureActor = fixtureMode === 'prepare' ? fixtureId(3) : fixtureId(4);
let state={mode:'populated',tenant:'ee910000-0000-4000-8000-000000000002',revision:0};
const listeners=new Set<()=>void>();
const read=()=>state;
const calls:Array<{name:string;args:Record<string,unknown>}>=[];
export function getFixtureCalls(){return calls}
export function clearFixtureCalls(){calls.length=0}
function useStateFixture(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback)},read)}
export function setFixture(mode:string,tenant=state.tenant){state={mode,tenant,revision:state.revision+1};listeners.forEach(callback=>callback())}
export async function requestFixtureWorkspaceSwitch(){const next='ee910000-0000-4000-8000-000000000001';const allowed=await allowAccountSwitch({fromTenantId:state.tenant,toTenantId:next,toTenantName:'Synthetic second workspace'});if(allowed)setFixture(state.mode,next);return allowed}
export function useTenantContext(){const s=useStateFixture();return{activeTenantId:s.tenant,activeUserId:fixtureActor,loading:false,accountContextStatus:'ready',accountContextLoading:false}}
export function usePlanList(){const s=useStateFixture();const empty=s.mode==='empty';const rebound=s.tenant==='ee910000-0000-4000-8000-000000000001'&&s.mode!=='foreign';const scopedItems=rebound?items.map(item=>({...item,tenant_id:s.tenant,id:`b-${item.id}`,plan_id:item.plan_id?`b-${item.plan_id}`:null,title:`Second workspace · ${item.title}`})):items;const scopedPlans=rebound?plans.map(plan=>({...plan,tenant_id:s.tenant,id:`b-${plan.id}`,title:`Second workspace · ${plan.title}`,items:scopedItems.filter(item=>item.plan_id===`b-${plan.id}`)})):plans;const visible=localStorage.getItem('closed-project-fixture')==='yes'?scopedPlans.map((plan,index)=>index===0?{...plan,status:'completed',owner_user_id:'missing-synthetic-person'}:plan):scopedPlans;return{plans:empty?[]:visible,allItems:empty?[]:scopedItems,loading:s.mode==='loading',error:s.mode==='error'?'Test source unavailable':null,forbidden:s.mode==='refused',refresh:async()=>setFixture(s.mode)}}
export function useOperationsPeople(){const s=useStateFixture();const roster=localStorage.getItem('native-edit-fixture')==='populated'?[...members,{...members[0],membership_id:'synthetic-edit-member',user_id:'00000000-0000-4000-8000-000000000002',full_name:'Synthetic delivery teammate'}]:members;return{members:s.mode==='partial'?[]:roster,loading:false,error:s.mode==='partial'?'Test profiles unavailable':null,partial:false,refresh:async()=>setFixture(s.mode)}}
export function useSoloCommercialTerms(){const s=useStateFixture();return{tenantId:s.tenant,phase:s.mode==='loading'?'loading':s.mode==='error'?'error':'ready',agreements:s.mode==='empty'?[]:[{id:'ee910000-0000-4000-8000-000000000008',contactId:'ee910000-0000-4000-8000-000000000009',offerId:'ee910000-0000-4000-8000-000000000010',title:'Synthetic client launch',status:'active',notes:'Illustrative signed engagement. No live company records.',startsOn:'2026-10-09',endsOn:'2026-10-30',renewsOn:null,agreedAmountMinor:null,agreedCurrency:null,termKind:'fixed',updatedAt:'2026-10-09T12:00:00Z'}],clients:[{id:'ee910000-0000-4000-8000-000000000009',name:'Synthetic service client'}],clientsReadable:true,agreementsReadable:s.mode!=='refused',authorityUnknown:false,retry:()=>setFixture(s.mode)}}
export function useSoloAgreementSignings(){const s=useStateFixture();return{tenantId:s.tenant,phase:'ready',signings:[{id:'ee910000-0000-4000-8000-000000000011',agreementId:'ee910000-0000-4000-8000-000000000008',contactId:'ee910000-0000-4000-8000-000000000009',documentTitle:'Synthetic signed launch agreement',signatureState:'completed',hasSealedCopy:true,completedAt:'2026-10-09T12:00:00Z',displayState:'completed',signerName:null}],readable:true,authorityUnknown:false,retry:()=>setFixture(s.mode)}}
export function useKnowledgeDocuments(){return{docs:[],loading:false,error:null,hasMore:false,reload:async()=>{},loadMore:async()=>{}}}
export const supabase={rpc:async(name:string,args:Record<string,unknown>={})=>{
  calls.push({name,args}); if(name==='operations_engagement_evidence_read'&&state.mode==='evidence-refused')return{data:null,error:{code:'42501',message:'Explicit synthetic source refusal'}};if(name==='operations_engagement_handoff')return{data:null,error:{code:state.mode==='handoff-uncertain'?'08006':'42501',message:'Explicit synthetic handoff outcome'}};if(name==='operations_engagement_evidence_read')return{data:{ok:true,actor_id:'ee910000-0000-4000-8000-000000000003',tenant_id:state.tenant,evidence:{agreement_id:'ee910000-0000-4000-8000-000000000011',tenant_id:state.tenant,contact_id:'ee910000-0000-4000-8000-000000000009',commercial_terms_id:'ee910000-0000-4000-8000-000000000008',offer_id:'ee910000-0000-4000-8000-000000000010',version:3,status:'completed',completed_at:'2026-10-09T12:00:00Z',content_sha256:'a'.repeat(64),sealed_sha256:'b'.repeat(64),sealed_copy_recorded:true,handoff_authorized:false,client_accepted:false}},error:null};
  // Synthetic target-tenant administration port; grants no production permission.
  if(name==='is_tenant_admin')return{data:args._tenant===state.tenant&&state.mode!=='admin-refused',error:null};
  if(name==='operations_crm_work_read')return{data:{ok:true,actor_id:'ee910000-0000-4000-8000-000000000003',tenant_id:state.tenant,has_more:false,tasks:localStorage.getItem('native-crm-fixture')==='populated'?[{id:'test-work-1',tenant_id:state.tenant,user_id:'ee910000-0000-4000-8000-000000000003',title:'Synthetic CRM engagement preparation',description:'Illustrative native CRM task. No live record or execution.',status:'pending',due_date:'2026-10-15T12:00:00Z',updated_at:'2026-10-10T12:00:00.123456Z',created_at:null,deal_id:'synthetic-deal',biz_id:null,recorded_priority:'high',estimated_minutes:90}]:[]},error:null};
  if(name==='has_any_role')return{data:true,error:null};
  if(name==='plan_item_activity_scoped'&&localStorage.getItem('activity-fixture')==='populated')return{data:{ok:true,actor_id:'ee910000-0000-4000-8000-000000000003',tenant_id:'ee910000-0000-4000-8000-000000000002',item_id:args.p_item_id,events:[{action:'plan_update_item',recorded_at:'2026-10-10T12:00:00Z',actor_id:'ee910000-0000-4000-8000-000000000003',status:'in_progress'},{action:'plan_assign_task',recorded_at:'2026-10-09T12:00:00Z',actor_id:'ee910000-0000-4000-8000-000000000003',status:null}]},error:null};
  if(name==='plan_item_activity_scoped'&&localStorage.getItem('activity-fixture')==='empty')return{data:{ok:true,actor_id:'ee910000-0000-4000-8000-000000000003',tenant_id:'ee910000-0000-4000-8000-000000000002',item_id:args.p_item_id,events:[]},error:null};
  if(name==='plan_assign_task_scoped'&&localStorage.getItem('creation-fixture')==='uncertain-known')return{data:{ok:true,actor_id:'ee910000-0000-4000-8000-000000000003',tenant_id:'ee910000-0000-4000-8000-000000000002',item_id:'test-work-1'},error:null};
  if(name==='plan_assign_task_scoped'&&localStorage.getItem('creation-fixture')==='uncertain-unknown')return{data:null,error:{code:'08006',message:'Explicit synthetic connection loss'}};
  return{data:null,error:{code:'42501',message:'Explicit synthetic refusal'}};
},functions:{invoke:async()=>({data:{ok:false,outcome:'refused',message:'Explicit synthetic refusal'},error:null})},auth:{getUser:async()=>({data:{user:{id:'ee910000-0000-4000-8000-000000000003'}},error:null}),getSession:async()=>({data:{session:{user:{id:'ee910000-0000-4000-8000-000000000003'}}},error:null})}};


// Explicit synthetic query port for original-request recovery: no readable canonical fixture project.
const emptyQuery={select(){return this},eq(){return this},contains(){return this},in(){return this},order(){return this},limit(){return this},maybeSingle:async()=>({data:null,error:null}),then(resolve:(value:unknown)=>unknown){return Promise.resolve({data:[],error:null}).then(resolve)}};
Object.assign(supabase,{from:()=>({...emptyQuery})});

// Explicit local RPC doubles for the mounted staff journey. They exercise the
// real domain clients/readback; they are never a persistence or authority proof.
const originalRpc = supabase.rpc;
const submission = () => ({id:fixtureId(16),tenant_id:state.tenant,work_item_id:fixtureId(13),plan_id:fixtureId(14),client_id:fixtureId(9),artifact_version_id:fixtureId(17),artifact_digest:'a'.repeat(64),revision_no:1,submitted_by:fixtureId(3),reviewer_user_id:fixtureId(4),state:'in_review',review_note:null,reviewed_by:null,reviewed_at:null,submitted_at:'2026-10-14T16:00:00Z',updated_at:'2026-10-14T16:00:00Z'});
let deliveryRows:any[] = fixtureMode === 'prepare' ? [] : [submission()];
let clientReleases:any[] = [];
if(fixtureMode === 'accepted') {
  deliveryRows = [{...submission(),state:'approved',reviewed_by:fixtureId(4),reviewed_at:'2026-10-14T16:10:00Z'}];
  clientReleases = [{release_id:fixtureId(18),submission_id:fixtureId(16),state:'accepted',released_by:fixtureId(4),released_at:'2026-10-14T16:20:00Z',decision_by:fixtureId(19),decision_at:'2026-10-14T16:30:00Z',client_note:'This version meets our agreed outcome.',updated_at:'2026-10-14T16:30:00Z'}];
}
Object.assign(supabase.auth, {getUser:async()=>({data:{user:{id:fixtureActor}},error:null}),getSession:async()=>({data:{session:{user:{id:fixtureActor}}},error:null})});
Object.assign(supabase, {rpc:async(name:string,args:Record<string,unknown>={})=>{
  if(name==='current_user_tenant_id')return{data:state.tenant,error:null};
  if(!name.startsWith('operations_delivery_') && !['list_studio_sessions','list_artifact_versions'].includes(name))return originalRpc(name,args);
  calls.push({name,args});
  if(fixtureMode==='loading')return new Promise(()=>{});
  if(fixtureMode==='unavailable')return{data:null,error:{code:'42501'}};
  if(name==='operations_delivery_reviews_scoped')return{data:{actor_id:fixtureActor,tenant_id:state.tenant,has_more:false,unavailable_count:0,reviews:deliveryRows.filter(r=>r.state==='in_review'&&r.reviewer_user_id===fixtureActor).map(r=>({submission_id:r.id,work_item_id:r.work_item_id,plan_id:r.plan_id,client_id:r.client_id,artifact_version_id:r.artifact_version_id,artifact_digest:r.artifact_digest,revision_no:r.revision_no,submitted_by:r.submitted_by,reviewer_user_id:r.reviewer_user_id,submission_updated_at:r.updated_at,work_updated_at:items[0].updated_at,title:'Workshop delivery outline'}))},error:null};
  if(name==='operations_delivery_list_scoped')return{data:{work_item_id:args.p_work_item_id,submissions:args.p_work_item_id===fixtureId(13)?deliveryRows:[]},error:null};
  if(name==='operations_delivery_client_status_scoped')return{data:{work_item_id:args.p_work_item_id,client_releases:clientReleases},error:null};
  if(name==='operations_delivery_artifact_scoped')return{data:{...deliveryRows[0],actor_id:fixtureActor,submission_id:fixtureId(16),title:'Workshop delivery outline',body:'The agreed workshop and documented follow-through.\n\n'+Array.from({length:12},(_,i)=>`Section ${i+1}: Confirmed responsibilities, participant preparation and review evidence.\n\n`).join('')},error:null};
  if(name==='list_studio_sessions')return{data:[{id:fixtureId(20),tenant_id:state.tenant,title:'Workshop delivery',artifact_refs:[{id:fixtureId(21),kind:'content',title:'Facilitation and follow-through'}]}],error:null};
  if(name==='list_artifact_versions')return{data:[{id:fixtureId(17),tenant_id:state.tenant,session_id:fixtureId(20),kind:'content',lineage_id:fixtureId(21),version_no:2,created_at:'2026-10-14T12:00:00Z',snapshot:{kind:'text',title:'Workshop delivery outline',body:'The agreed workshop and follow-through.\n\n'+Array.from({length:12},(_,i)=>`Section ${i+1}: Prepared material and accountable responsibilities.\n\n`).join('')}}],error:null};
  if(fixtureMode==='unknown')return{data:null,error:{code:'08006'}};
  if(fixtureMode==='refused')return{data:null,error:{code:'42501'}};
  if(name==='operations_delivery_submit_scoped'){deliveryRows=[submission()];return{data:{ok:true,submission_id:fixtureId(16),state:'in_review',revision_no:1},error:null};}
  if(name==='operations_delivery_review_scoped'){deliveryRows=[{...deliveryRows[0],state:args.p_decision,review_note:args.p_note,reviewed_by:fixtureActor,reviewed_at:'2026-10-14T16:40:00Z',updated_at:'2026-10-14T16:40:00Z'}];return{data:{ok:true,submission_id:fixtureId(16),state:args.p_decision},error:null};}
  if(name==='operations_delivery_release_scoped'){clientReleases=[{release_id:fixtureId(18),submission_id:fixtureId(16),state:'awaiting_client',released_by:fixtureActor,released_at:'2026-10-14T16:50:00Z',decision_by:null,decision_at:null,client_note:null,updated_at:'2026-10-14T16:50:00Z'}];return{data:{ok:true,release_id:fixtureId(18),state:'awaiting_client'},error:null};}
  return{data:null,error:{code:'42501'}};
}});
Object.assign(window,{__opsMountedFixture:{calls:()=>calls,clearCalls:()=>{calls.length=0},switchWorkspace:()=>requestFixtureWorkspaceSwitch()}});

Object.assign(window,{__operationsFixture:{setFixture,getFixtureCalls,clearFixtureCalls,requestFixtureWorkspaceSwitch}});
