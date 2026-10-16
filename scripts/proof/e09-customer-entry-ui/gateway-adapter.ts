// Explicit offline Auth/DataAPI doubles. Actual Gateway and landing resolver run.
const seed=(window as unknown as {entrySeed:{context:string}}).entrySeed;
const subject="e0911000-0000-0000-0000-000000000001",tenant="e0921000-0000-0000-0000-000000000001";
let user:null|{id:string;email:string;email_confirmed_at:string}=null;
const brand={tenant_name:seed.context==="a"?"Test Service Studio":"Second Test Business with a Longer Name",tenant_slug:"test-service",logo_url:null,primary_color:seed.context==="a"?"#26483e":"#694b38"};
const profile={id:"e0931000-0000-0000-0000-000000000001",tenant_id:tenant,linked_user_id:subject,
 first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,
 onboarding_stage:"completed",is_signup_contact:false,paige_shared_context_consent:false,paige_shared_context_consent_updated_at:null,
 updated_at:null,email:"recipient@tests.invalid",phone:null,contact_methods:[]};
export const supabase={
 auth:{getUser:async()=>({data:{user},error:null}),signInWithPassword:async()=>{user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};return{data:{user},error:null};}},
 rpc:async(name:string)=>{
  if(["peek_tenant_portal_brand","get_client_portal_brand"].includes(name))return{data:[brand],error:null};
  if(name==="client_portal_self_profile")return{data:profile,error:null};
  throw Error("Unapproved offline native contract: "+name);
 },
 from:(table:string)=>{
  if(!["user_roles","tenants","tenant_members","agency_team_members"].includes(table))throw Error("Unapproved offline table: "+table);
  const result={data:table==="user_roles"?[{role:"client"}]:null,error:null};
  const query={select:()=>query,eq:()=>query,limit:()=>query,maybeSingle:async()=>result,then:(resolve:(v:typeof result)=>unknown)=>Promise.resolve(result).then(resolve)};
  return query;
 },
};
