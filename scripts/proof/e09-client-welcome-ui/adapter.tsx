// Explicit isolated SDK/record doubles only. Actual parent, form and controllers run.
type Seed={context:"a"|"b";state:string};
const seed=(window as unknown as {welcomeSeed:Seed}).welcomeSeed;
const subject="e0919000-0000-0000-0000-000000000001";
const tenant=seed.context==="a"?"e0929000-0000-0000-0000-000000000001":"e0929000-0000-0000-0000-000000000002";
let mode=seed.state;
const user={id:subject,email:"signin@tests.invalid"};
let profile={id:"e0939000-0000-0000-0000-000000000001",tenant_id:tenant,linked_user_id:subject,
  first_name:"Test",last_name:"Customer",entity_name:null,street_address:null,city:null,state:null,zip_code:null,
  onboarding_stage:"invited",is_signup_contact:false,paige_shared_context_consent:false,
  paige_shared_context_consent_updated_at:null,updated_at:"2026-10-15T18:00:00Z",email:"client@tests.invalid",phone:"+12025550109",
  contact_methods:[{kind:"email",value:"client@tests.invalid",is_primary:true},{kind:"phone",value:"+12025550109",is_primary:true}]};
let answers:Record<string,unknown>={goal:"Build a clear next step",plan:"Standard"};
const fields=[{key:"goal",label:"Your goal",type:"longtext",required:true},
  {key:"plan",label:"Service plan",type:"select",required:true,options:["Standard","Extended"]},
  {key:"count",label:"Target milestones",type:"number",required:false},
  {key:"start",label:"Preferred start date",type:"date",required:false}];
let token="a".repeat(32),submitted:string|null=null;
const calls:Array<{name:string;pinned:boolean}>=[];
const value=()=>({status:mode==="configuration_required"?mode:"ready",profile,
  fields:mode==="configuration_required"?[]:fields,answers:mode==="configuration_required"?{}:answers,
  intake_updated_at:submitted,intake_submitted_at:submitted,expected_token:mode==="configuration_required"?null:token});
const listeners=new Set<(event:string,session:unknown)=>void>();
export const supabase={auth:{getUser:async()=>({data:{user},error:null}),
  getSession:async()=>mode==="signed_out"?{data:{session:null},error:{status:401}}:{data:{session:{user,access_token:"synthetic-welcome-request"}},error:null},
  onAuthStateChange:(listener:(event:string,session:unknown)=>void)=>{listeners.add(listener);return{data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}};}},
  from:()=>{throw new Error("Raw CRM/intake/workspace reader must not run");},
  rpc:(name:string,args?:Record<string,unknown>)=>{
    const headers=new Headers();
    const request={setHeader:(key:string,v:string)=>{headers.set(key,v);return request;},then:(done:(v:unknown)=>unknown,failed:(e:unknown)=>unknown)=>Promise.resolve().then(()=>{
      const pinned=headers.get("Authorization")==="Bearer synthetic-welcome-request";calls.push({name,pinned});
      if(name==="client_portal_self_profile")return{data:structuredClone(profile),error:null};
      if(name==="get_client_portal_brand")return{data:[{tenant_name:seed.context==="a"?"Test Service Studio":"Second Test Business",primary_color:seed.context==="a"?"#385d4b":"#835b36",logo_url:null}],error:null};
      if(!pinned)throw new Error("Welcome request must retain verified synthetic credential");
      if(name==="client_portal_welcome_state"){
        if(mode==="loading")return new Promise(()=>{});
        if(mode==="unavailable")return{data:null,error:{code:"42501"}};
        if(mode==="read_error")return{data:null,error:{code:"08006"}};
        return{data:structuredClone(value()),error:null};
      }
      if(name!=="client_portal_save_welcome")throw new Error("Unapproved proof contract");
      if(mode==="conflict")return{data:null,error:{code:"40001"}};
      if(mode==="unknown")throw new Error("Synthetic lost acknowledgement");
      if(args?.p_expected_token!==token)return{data:null,error:{code:"40001"}};
      profile={...profile,...args.p_profile as Partial<typeof profile>,onboarding_stage:"signing_agreement",updated_at:"2026-10-15T18:01:00Z"};
      profile.contact_methods=profile.contact_methods.map(m=>m.kind==="phone"&&m.is_primary?{...m,value:profile.phone}:m);
      answers=structuredClone(args.p_answers as Record<string,unknown>);submitted="2026-10-15T18:01:00Z";token="b".repeat(32);
      return{data:structuredClone(value()),error:null};
    }).then(done,failed)};return request;
  }};
Object.assign(window,{welcomeProof:{mode:(next:string)=>{mode=next;},calls:()=>structuredClone(calls)}});
