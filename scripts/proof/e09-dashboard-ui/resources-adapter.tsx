// Explicit offline transport for the actual owner resource UI. No network or accounts.
export * from './adapter';
import {useTenantRelationshipsData as incumbentData} from './adapter';
const options=(window as unknown as {portalProof:{tenant:string}}).portalProof;
const suffix=options.tenant.endsWith('-b')?'2':'1';
const tenant=`e0927000-0000-4000-8000-00000000000${suffix}`,actor='e0917000-0000-4000-8000-000000000001';
const documentId=`e0947000-0000-4000-8000-00000000000${suffix}`,shareId=`e0957000-0000-4000-8000-00000000000${suffix}`;
const title='Your program guide — planning the next stage together';
const content=('Begin with your weekly reflection. Bring the questions you want to discuss to your next session.\n\n').repeat(24);
let saved:null|Record<string,unknown>=null,loseNext=false;
const calls:Array<{name:string;args:Record<string,unknown>}>=[];
Object.assign(window,{resourceProof:{calls:()=>calls,loseNextAcknowledgement:()=>{loseNext=true;}}});
export const useTenantContext=()=>({activeTenantId:tenant,activeUserId:actor,activeTenant:{id:tenant,name:'Test Service Studio',account_type:'standalone',parent_tenant_id:null},accountContextStatus:'ready',accountContextLoading:false,refresh:async()=>{}});
export function useTenantRelationshipsData(){const value=incumbentData();return {...value,people:value.people.map((person,index)=>({...person,id:`e0937000-0000-4000-8000-00000000000${index+1}`}))};}
export const supabase={auth:{getUser:async()=>({data:{user:{id:actor}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 rpc:async(name:string,args:Record<string,unknown>={})=>{
  calls.push({name,args});
  if(name==='can_manage_tenant_brand')return {data:args._tenant_id===tenant,error:null};
  if(name==='read_tenant_knowledge')return {data:{tenant_id:tenant,documents:[{id:documentId,tenant_id:tenant,revision:3,title,summary:null,category:null,tags:[],source:'text',source_url:null,chunk_count:0,created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z',share_to_network:false,network_review_status:'none'}]},error:null};
  if(args.p_tenant_id!==tenant)throw Error('Offline proof refuses a foreign business');
  if(name==='list_client_portal_knowledge_shares')return {data:{tenant_id:tenant,contact_id:args.p_contact_id,shares:saved?[saved]:[],next_offset:saved?1:0,page_may_continue:false},error:null};
  if(name==='prepare_client_portal_knowledge_share')return {data:{tenant_id:tenant,contact_id:args.p_contact_id,document_id:documentId,available:args.p_available,expected_share_revision:saved?.share_revision??0,proposal_hash:'b'.repeat(64),source_fingerprint:'a'.repeat(64),document_revision:3,generation_id:null,title:args.p_available?title:null,preview:args.p_available?content.slice(0,1600):null,preview_truncated:args.p_available,already_shared:args.p_available&&saved?.currently_available===true},error:null};
  if(name==='set_client_portal_knowledge_share'){
   saved={share_id:shareId,share_revision:Number(args.p_expected_share_revision)+1,document_id:documentId,document_revision:3,generation_id:null,source_fingerprint:'a'.repeat(64),title,granted_at:'2026-10-17T00:00:00Z',revoked_at:args.p_available?null:'2026-10-17T01:00:00Z',receipt_id:args.p_operation_id,currently_available:args.p_available};
   if(loseNext){loseNext=false;throw Error('Offline simulated acknowledgement loss');}
   return {data:{tenant_id:tenant,contact_id:args.p_contact_id,document_id:documentId,share_id:shareId,receipt_id:args.p_operation_id,replayed:false,changed:true,original_revision:saved.share_revision,current_revision:saved.share_revision,currently_available:saved.currently_available},error:null};
  }
  throw Error('Offline source proof refuses unlisted operation: '+name);
 },from:()=>{throw Error('Offline source proof refuses raw table access');},functions:{invoke:()=>{throw Error('Offline source proof refuses function/provider transport');}}};
