/** Synthetic provider only. Real components/hooks/shared owner parser remain under measurement. */
import { useMemo } from 'react';
export const TENANT='10000000-0000-4000-8000-000000000005',ACTOR='20000000-0000-4000-8000-000000000005';
export const PROCESS='30000000-0000-4000-8000-000000000005',ITEM='80000000-0000-4000-8000-000000000005';
export const scenarios=['empty','requested','held','paused','scheduled','running','completed','unknown','failed','cancelled','unavailable','refused','loading','zone-missing','truncated'] as const;
export type Scenario=typeof scenarios[number];
let selected=(new URLSearchParams(location.search).get('state')||'empty') as Scenario;
export const calls:Array<{name:string,args?:unknown}>=[],effects:Array<string>=[];
export function scenario(){return selected;}
export function currentPlanningItem(){return{id:ITEM,tenant_id:TENANT,plan_id:null,item_type:'task',assigned_to_user_id:ACTOR,contact_id:null,title:'Synthetic commitment — review delivery outline',summary:'Synthetic current source work. The weekly observation remains historical.',status:'in_progress',priority:'high',due_at:'2026-10-26T13:00:00Z',remind_at:null,remind_target:null,reminded_at:null,created_by:ACTOR,linked_action_id:null,updated_at:'2026-10-20T12:57:00.123456Z'};}
export function setScenario(s:Scenario){selected=s;}
function verified(){return{event_id:'50000000-0000-4000-8000-000000000005',act_id:'60000000-0000-4000-8000-000000000005',status:'completed',scheduled_for:'2026-10-19T13:00:00Z',correlation_ref:'synthetic-correlated-receipt',observation:{tenant_id:TENANT,authorized_by:ACTOR,automation_id:PROCESS,event_id:'50000000-0000-4000-8000-000000000005',act_id:'60000000-0000-4000-8000-000000000005',receipt_id:'70000000-0000-4000-8000-000000000005',correlation_ref:'synthetic-correlated-receipt',source:'public.plan_items',observed_at:'2026-10-19T13:01:00Z',schedule_revision:1,truncated:selected==='truncated',open_count:selected==='truncated'?51:1,blocked_count:1,overdue_count:1,due_next_week_count:0,undated_count:selected==='truncated'?50:0,items:[{id:ITEM,kind:'task',title:'Synthetic commitment — review delivery outline',status:'blocked',priority:'high',due_at:'2026-10-16T13:00:00Z'},...(selected==='truncated'?Array.from({length:49},(_,i)=>({id:'80000000-0000-4000-8000-'+String(i+6).padStart(12,'0'),kind:'task',title:'Synthetic additional commitment '+(i+2),status:'open',priority:'normal',due_at:null})):[])]}};}
export function rawDto(){const savedDraft=draftRequest?.phase==='saved'&&selected==='requested'?draftRequest.draft as {name:string;weekday:number;local_time:string;timezone:string}:null;const status=selected==='requested'?'requested':selected==='paused'?'paused':selected==='cancelled'?'cancelled':'scheduled',ready=['scheduled','running','completed','unknown','failed','truncated'].includes(selected),last=verified();return{ok:true,scope:'personal_planning_commitments',tenant_id:TENANT,actor_id:ACTOR,read_at:['running','unknown','failed'].includes(selected)?'2026-10-26T13:02:00Z':'2026-10-20T12:58:00Z',limit:50,has_more:false,business_time_zone:selected==='zone-missing'?{state:'missing',zone:null}:{state:'configured',zone:'America/New_York'},checks:selected==='empty'?[]:[{automation_id:PROCESS,name:savedDraft?.name??'Weekly commitment check',revision:1,schedule_status:status,schedule:savedDraft?{weekday:savedDraft.weekday,local_time:savedDraft.local_time,timezone:savedDraft.timezone}:{weekday:1,local_time:'09:00',timezone:'America/New_York'},execution_availability:ready?'ready':'held',execution_hold_reason:selected==='held'?'trigger_dark':ready?null:status,next_run_at:ready?(['running','unknown','failed'].includes(selected)?'2026-11-02T14:00:00Z':'2026-10-26T13:00:00Z'):null,intended_next_run_at:status==='scheduled'?(['running','unknown','failed'].includes(selected)?'2026-11-02T14:00:00Z':'2026-10-26T13:00:00Z'):null,last_run:['running','unknown','failed'].includes(selected)?{event_id:'50000000-0000-4000-8000-000000000006',act_id:'60000000-0000-4000-8000-000000000006',status:selected,scheduled_for:'2026-10-26T13:00:00Z'}:['completed','truncated'].includes(selected)?last:null,last_verified_run:['completed','unknown','truncated'].includes(selected)?last:null}]};}
const ok=(data:unknown)=>Promise.resolve({data,error:null});
const denied=(name:string)=>{effects.push(name);return Promise.resolve({data:null,error:{message:'Synthetic harness: effectful or unrecognized operation denied'}});};
// DEV-ONLY canonical-shaped draft transport. No network, database or authority.
let draftRequest:Record<string,unknown>|null=null;
function draftInvoke(name:string,options?:{body?:Record<string,unknown>;headers?:Record<string,string>}){
  if(name!=='weekly-commitment-command')return denied('functions.invoke');
  calls.push({name:'synthetic.weekly-draft',args:options?.body?.action});
  if(options?.headers?.['x-paige-expected-tenant']!==TENANT)return ok({ok:false,code:'SCOPE_CHANGED'});
  const body=options.body??{};
  if(body.action==='pending')return ok({ok:true,requests:draftRequest?[draftRequest]:[],limit:10,has_more:false});
  if(body.action==='prepare'){
    const d=body.draft as {name:string;weekday:number;local_time:string;timezone:string};
    draftRequest={ok:true,tenant_id:TENANT,actor_id:ACTOR,phase:'awaiting_approval',
      confirmation_id:'40000000-0000-4000-8000-000000000005',request_id:'40000000-0000-4000-8000-000000000006',read_at:new Date().toISOString(),
      expires_at:new Date(Date.now()+600000).toISOString(),draft:d,
      summary:`Save “${d.name}” as an unapproved draft: ISO weekday ${d.weekday} at ${d.local_time} in ${d.timezone}. Read personal Planning commitments. No recurrence, task changes or provider sends are authorized.`,
      confirmation_token:'0123456789abcdef:40000000-0000-4000-8000-000000000007',automation_id:null,revision:null,process_state:null,receipt_id:null,recurrence_authorized:false};
  }else if(body.action==='commit'&&draftRequest){
    draftRequest={...draftRequest,phase:'saved',confirmation_token:null,automation_id:PROCESS,revision:1,process_state:'draft',receipt_id:'70000000-0000-4000-8000-000000000006'};
    selected='requested';
  }else if(body.action==='decline'&&draftRequest){draftRequest={...draftRequest,phase:'declined',confirmation_token:null};}
  return ok(draftRequest?{...draftRequest,read_at:new Date().toISOString()}:null);
}
export const supabase={
 auth:{getSession:()=>ok({session:{access_token:'synthetic-local-only',user:{id:ACTOR}}}),getUser:()=>ok({user:{id:ACTOR}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc(name:string,args?:unknown){calls.push({name,args});if(name==='weekly_commitment_owner')return ok(selected!=='refused');if(name==='current_user_tenant_id')return ok(TENANT);if(name==='get_weekly_commitment_checks'){if(selected==='loading')return new Promise(()=>{});if(selected==='unavailable')return Promise.resolve({data:null,error:{message:'Synthetic read unavailable'}});return ok(rawDto());}if(name==='is_tenant_member')return ok(true);if(['is_tenant_admin','is_current_user_tenant_admin','is_platform_owner'].includes(name))return ok(false);if(name==='list_tool_autonomy')return ok([]);if(name==='resolve_tool_autonomy')return ok('confirm');if(['plan_list_operations_scoped','plan_list'].includes(name))return ok({plans:[],loose_items:[currentPlanningItem()]});if(name==='operations_crm_work_read')return ok({ok:true,actor_id:ACTOR,tenant_id:TENANT,tasks:[],has_more:false});if(name==='get_solo_team_workspace')return ok({tenant_id:TENANT,viewer_user_id:ACTOR,viewer_permission:'owner',can_change_permissions:false,members:[],invitations:[],total_members:0});if(name==='plan_item_activity_scoped')return ok({ok:true,actor_id:ACTOR,tenant_id:TENANT,item_id:ITEM,events:[]});if(['list_team_bookings','list_calendar_classes','list_calendar_availability'].includes(name))return ok([]);return denied(name);},
 from(table:string){const result=ok([]),filters:Record<string,unknown>={};const chain:Record<string,unknown>={};for(const method of ['select','eq','neq','in','is','order','limit','gte','lte','match','or'])chain[method]=()=>chain;chain.then=(resolve:(v:unknown)=>unknown)=>result.then(resolve);chain.eq=(key:string,value:unknown)=>{filters[key]=value;return chain;};chain.maybeSingle=()=>{calls.push({name:'from.'+table,args:filters});return ok(table==='plan_items'&&filters.tenant_id===TENANT&&filters.id===ITEM?currentPlanningItem():null);};chain.single=()=>ok(null);for(const method of ['insert','update','delete','upsert'])chain[method]=()=>denied(table+'.'+method);return chain;},
 functions:{invoke:draftInvoke},channel:()=>({on(){return this;},subscribe(){return this;},unsubscribe(){return this;}}),removeChannel:()=>undefined,storage:{from:()=>({createSignedUrl:()=>denied('storage.url')})},
};
export function useTenantContext(){return useMemo(()=>({activeTenantId:TENANT,activeUserId:ACTOR,activeTenant:{id:TENANT,name:'Synthetic review workspace',account_number:'05',account_type:'solo'},tenants:[],loading:false,isLoading:false,accountContextStatus:'ready',isPlatformStaff:false,soloShellEnabled:true,scopeEpoch:1}),[]);}
export const TenantProvider=({children}:{children:unknown})=>children;
export function useScopedUserId(){return ACTOR;}
export function usePlaybook(){return{persona:{name:'PAIGE',greeting:'',role:''},quickActions:[]};}
export function usePaigeThreads(){return{threads:[],isLoading:false,isFetched:true,loadTurns:async()=>[],ensureThread:async()=>{effects.push('ensureThread');throw Error('No thread writer in synthetic review');},onTurnPersisted:()=>undefined,renameThread:()=>denied('renameThread'),archiveThread:()=>denied('archiveThread'),deleteThread:()=>denied('deleteThread')};}
export function useChatDocumentUpload(){return{attachedDoc:null,isProcessingFile:false,isDragOver:false,fileInputRef:{current:null},acceptString:'',handleFileSelect:()=>denied('document'),handleDragOver:()=>undefined,handleDragLeave:()=>undefined,handleDrop:()=>denied('document'),removeAttachment:()=>undefined,openFilePicker:()=>undefined,setAttachedDoc:()=>undefined};}
export type PaigeThread={id:string,title:string};

export function useTierFeatures(){return{has:()=>false,loading:false,classification:"solo"};}
export const useOptionalTenantContext=useTenantContext;
