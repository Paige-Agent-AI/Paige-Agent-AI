// Deterministic offline Auth/DataAPI protocol doubles; no production client or network.
const seed=(window as unknown as {actionSeed:{state:string;context:string}}).actionSeed;
let mode=seed.state,index=seed.context==="b"?1:0;
const id=(prefix:string)=>`${prefix}-0000-0000-0000-${index===0?"000000000001":"000000000002"}`;
const user=()=>({id:id("e0913000"),email:"customer@tests.invalid",email_confirmed_at:"2026-01-01"});
const profile=()=>({id:id("e0933000"),tenant_id:id("e0923000"),linked_user_id:user().id,
 first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,
 onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,
 updated_at:"2026-01-01T00:00:00Z",email:user().email,phone:null,contact_methods:[]});
const assigned=()=>({id:id("e0943000"),tenant_id:id("e0923000"),contact_id:id("e0933000"),updated_at:"2026-01-01T00:00:00Z",
 action_type:"task",title:index===0?"Prepare for your session":"Other customer request",body:mode==="long"?`Preparation: ${"DocumentReference".repeat(20)}`:"Review the questions shared by your team.",
 status:mode==="confirmed"?"customer_acted":mode==="expired"?"expired":"proposed",expires_at:mode==="expired"?"2020-01-01T00:00:00Z":"2099-01-01T00:00:00Z",
 created_at:"2026-01-01T00:00:00Z",paige_customer_responses:mode==="confirmed"?[{id:id("e0953000"),responded_by_user_id:user().id,response_type:"completed",response_text:null,created_at:"2026-01-02T00:00:00Z"}]:[]});
let rows=mode==="empty"?[]:[assigned()],writes=0;
type Session={user:ReturnType<typeof user>};
const listeners=new Set<(event:string,session:Session)=>void>();
const never=()=>new Promise<never>(()=>{});
export const supabase={
 auth:{getUser:async()=>({data:{user:user()},error:null}),onAuthStateChange:(cb:(event:string,session:Session)=>void)=>{listeners.add(cb);return{data:{subscription:{unsubscribe:()=>listeners.delete(cb)}}};}},
 rpc:async(name:string,args?:Record<string,unknown>)=>{
  if(name==="get_client_portal_brand")return{data:[{tenant_id:id("e0923000"),tenant_name:"Test Service",tenant_slug:"test-service",logo_url:null,primary_color:index===0?"#26483e":"#694b38"}],error:null};
  if(name==="client_portal_self_profile"){
   if(mode==="loading")return never();
   if(mode==="error")return{data:null,error:{code:"HTTP503"}};
   return{data:mode==="revoked"?null:profile(),error:null};
  }
  if(name!=="customer_respond_to_action")throw Error("Unexpected offline RPC: "+name);
  writes++;
  if(mode==="pending")return never();
  if(args?.p_expected_updated_at!==rows[0]?.updated_at)throw Error("Missing loaded native version");
  const type=String(args.p_response_type),status=type==="question"?"proposed":type==="declined"?"customer_declined":"customer_acted";
  rows=[{...rows[0],status,paige_customer_responses:[{id:id("e0953000"),responded_by_user_id:user().id,response_type:type,response_text:args.p_response_text as string|null,created_at:"2026-01-02T00:00:00Z"}]}];
  if(mode==="unknown")throw Error("synthetic lost response after save");
  return{data:{ok:true,status},error:null};
 },
 from:(table:string)=>{
  if(table!=="paige_customer_actions")throw Error("Forbidden offline source: "+table);
  const filters:Record<string,unknown>={};
  const q={select:(columns:string)=>{if(columns.includes("payload_json"))throw Error("Private payload selected");return q;},eq:(key:string,value:unknown)=>{filters[key]=value;return q;},order:()=>q,
   limit:async()=>{if(filters.contact_id!==id("e0933000")||filters.tenant_id!==id("e0923000"))throw Error("Missing actual relationship tuple");return{data:structuredClone(rows),error:null};}};
  return q;
 },
 channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:async()=>{},
};
(window as unknown as {actionProof:unknown}).actionProof={writes:()=>writes,recover:()=>{mode="ready";},switchActor:()=>{index=index===0?1:0;mode="ready";rows=[assigned()];for(const cb of listeners)cb("SIGNED_IN",{user:user()});}};
