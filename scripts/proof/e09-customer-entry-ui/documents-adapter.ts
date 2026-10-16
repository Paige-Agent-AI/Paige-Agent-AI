// Explicit offline Auth/Data API/Storage protocol doubles. No provider or account.
const seed=(window as unknown as {documentSeed:{state:string;context:string}}).documentSeed;
let mode=seed.state,index=seed.context==="b"?1:0,reservations=0,transfers=0,finishes=0,stored=false;
const id=(p:string)=>`${p}-0000-0000-0000-${index===0?"000000000001":"000000000002"}`;
const user=()=>({id:id("e0914000"),email:"customer@tests.invalid"});
const profile=()=>({id:id("e0934000"),tenant_id:id("e0924000"),linked_user_id:user().id,first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,updated_at:"2026-01-01T00:00:00Z",email:user().email,phone:null,contact_methods:[]});
const shared=()=>({id:id("e0944000"),tenant_id:id("e0924000"),contact_id:id("e0934000"),uploaded_by_user_id:mode==="prior"?"e0914000-0000-0000-0000-000000000003":user().id,
 storage_path:`${id("e0924000")}/${id("e0934000")}/shared/preparation.pdf`,original_filename:mode==="long"?`${"PreparationReference".repeat(11)}.pdf`:index===0?"Preparation.pdf":"Other customer notes.pdf",mime_type:"application/pdf",size_bytes:4,visibility:mode==="prior"?"client_upload":"shared",upload_state:"ready",created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-01T00:00:00Z"});
let rows=mode==="empty"?[]:[shared()],reserved:ReturnType<typeof shared>|null=null;
type Session={user:ReturnType<typeof user>};const listeners=new Set<(event:string,session:Session)=>void>();
export const supabase={
 auth:{getUser:async()=>({data:{user:user()},error:null}),onAuthStateChange:(cb:(event:string,session:Session)=>void)=>{listeners.add(cb);return{data:{subscription:{unsubscribe:()=>listeners.delete(cb)}}};}},
 rpc:async(name:string,args?:Record<string,unknown>):Promise<{data:unknown;error:unknown}>=>{
  if(name==="get_client_portal_brand")return{data:[{tenant_id:id("e0924000"),tenant_name:"Test Service",tenant_slug:"test-service",logo_url:null,primary_color:index===0?"#26483e":"#694b38"}],error:null};
  if(name==="client_portal_self_profile"){
   if(mode==="loading")return new Promise(()=>{});
   return{data:mode==="revoked"?null:profile(),error:mode==="error"?{code:"503"}:null};
  }
  if(name==="client_portal_begin_file_upload"){
   if(args?.p_expected_client_id!==id("e0934000")||args.p_tenant_id!==id("e0924000"))throw Error("Missing native customer tuple");
   reservations++;if(mode==="pending")return new Promise(()=>{});
   reserved??={...shared(),id:String(args.p_file_id),original_filename:String(args.p_filename),visibility:"client_upload",upload_state:"pending",
    storage_path:`${id("e0924000")}/${id("e0934000")}/client_upload/${user().id}/${args.p_file_id}`};return{data:reserved,error:null};
  }
  if(name==="client_portal_file_upload_status")return{data:{file:reserved,object_verified:stored},error:null};
  if(name==="client_portal_finish_file_upload"){
   finishes++;if(!stored||!reserved)throw Error("No stored object");reserved={...reserved,upload_state:"ready"};
   if(mode==="unknown")throw Error("Synthetic lost final acknowledgement");return{data:reserved,error:null};
  }
  throw Error("Unexpected document RPC: "+name);
 },
 from:(table:string)=>{if(table!=="client_files")throw Error("Forbidden offline file source: "+table);const filters:Record<string,unknown>={};
  const result=(single:boolean)=>{if(filters.tenant_id!==id("e0924000")||filters.contact_id!==id("e0934000"))throw Error("Unscoped file read");return Promise.resolve({data:structuredClone(single?reserved:rows),error:null});};
  const q={select:(columns:string)=>{if(columns.includes("description"))throw Error("Private file payload selected");return q;},eq:(k:string,v:unknown)=>{filters[k]=v;return q;},in:()=>q,order:()=>q,range:()=>result(false),maybeSingle:()=>result(true)};return q;},
 storage:{from:(bucket:string)=>{if(bucket!=="client-files")throw Error("Wrong bucket");return{
  upload:async(_path:string,_file:File,options:{upsert:boolean})=>{if(options.upsert)throw Error("Unsafe overwrite");transfers++;if(mode==="retry"&&transfers===1)return{data:null,error:{message:"Synthetic interrupted transfer"}};stored=true;if(mode==="stored"&&transfers===1)throw Error("Synthetic lost object reply");return{data:{path:_path},error:null};},
  download:async()=>mode==="download-error"?{data:null,error:{message:"Synthetic unavailable object"}}:{data:new Blob(["test"],{type:"application/pdf"}),error:null},
 };}},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{},
};
(window as unknown as {documentProof:unknown}).documentProof={counts:()=>({reservations,transfers,finishes}),recover:()=>{mode="ready";},switchActor:()=>{index=index===0?1:0;mode="ready";rows=[shared()];reserved=null;stored=false;for(const cb of listeners)cb("SIGNED_IN",{user:user()});}};
