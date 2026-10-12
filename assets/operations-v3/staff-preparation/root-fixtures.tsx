// Explicit synthetic ports. Never imported by production.
import {allowAccountSwitch} from '@/lib/auth/accountSwitchGuard';
const id=(n:number)=>`ed600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const mode=new URLSearchParams(location.search).get('mode')??'populated';
const calls:Array<{name:string;args:unknown}>=[];let rows:unknown[]=[];
export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:id(1)}}},error:null})},rpc:async(name:string,args:Record<string,unknown>)=>{
 calls.push({name,args});if(name==='current_user_tenant_id')return{data:id(2),error:null};
 if(mode==='loading')return new Promise(()=>{});
 if(mode==='unavailable')return{data:null,error:{code:'42501'}};
 if(name==='operations_delivery_list_scoped')return{data:{work_item_id:id(3),submissions:rows},error:null};
 if(name==='operations_delivery_client_status_scoped')return{data:{work_item_id:id(3),client_releases:[]},error:null};
 if(name==='list_studio_sessions')return mode==='source-refused'?{data:null,error:{code:'42501'}}:{data:mode==='empty'?[]:[{id:id(20),tenant_id:id(2),title:'Workshop delivery',artifact_refs:[{id:id(21),kind:'content',title:'Facilitation and follow-through'}]}],error:null};
 if(name==='list_artifact_versions')return mode==='version-refused'?{data:null,error:{code:'42501'}}:{data:[{id:id(7),tenant_id:id(2),session_id:id(20),kind:'content',lineage_id:id(21),version_no:2,created_at:'2026-10-12T12:00:00Z',snapshot:{kind:'text',title:'Workshop delivery outline',body:'The agreed workshop, prepared for independent review.\n\n'+Array.from({length:15},(_,i)=>`Section ${i+1}: Facilitation, participant preparation and documented follow-through.\n\n`).join(''),internal_brief:'Private metadata not projected'}},{id:id(22),tenant_id:id(2),session_id:id(20),kind:'content',lineage_id:id(21),version_no:1,created_at:'2026-10-11T12:00:00Z',snapshot:{kind:'image'}}],error:null};
 if(name==='operations_delivery_submit_scoped'){
  if(mode==='refused')return{data:null,error:{code:'42501'}};
  if(mode!=='unknown')rows=[{id:id(6),tenant_id:id(2),work_item_id:id(3),plan_id:id(4),client_id:id(5),artifact_version_id:id(7),artifact_digest:'a'.repeat(64),revision_no:1,submitted_by:id(1),submitted_at:'2026-10-12T13:00:00Z',reviewer_user_id:id(8),state:'in_review',review_note:null,reviewed_by:null,reviewed_at:null,updated_at:'2026-10-12T13:00:00Z'}];
  if(mode==='unknown'||mode==='lost-ack')return{data:null,error:{code:'08006'}};
  return{data:{ok:true,submission_id:id(6),state:'in_review',revision_no:1},error:null};
 }
 return{data:null,error:{code:'42501'}};
}};
Object.assign(window,{__preparationFixture:{calls:()=>calls,switch:()=>allowAccountSwitch({fromTenantId:id(2),toTenantId:'test-other',toTenantName:'Test other workspace'})}});
