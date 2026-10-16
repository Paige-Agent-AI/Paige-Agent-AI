// Isolated SDK doubles. No request can reach Auth, email or a real business.
const seed=(window as unknown as {entrySeed:{state:string;context:string}}).entrySeed;
const tenant="e0921000-0000-0000-0000-000000000001",subject="e0911000-0000-0000-0000-000000000001";
let user=seed.state==="ready"||seed.state==="accepted"||seed.state==="wrong"?{id:subject,email:seed.state==="wrong"?"other@tests.invalid":"recipient@tests.invalid",email_confirmed_at:"2026-01-01"}:null;
let accepted=seed.state==="accepted";
const calls:string[]=[],listeners=new Set<(event:string,session:unknown)=>void>();
const receipt=()=>({tenant_id:tenant,client_id:"e0931000-0000-0000-0000-000000000001",accepted_at:"2026-10-16",status:"accepted"});
export const supabase={
 auth:{getUser:async()=>({data:{user},error:seed.state==="error"?{status:503,name:"AuthRetryableFetchError"}:null}),getSession:async()=>({data:{session:user?{user,access_token:"synthetic-entry-only"}:null},error:null}),
  onAuthStateChange:(fn:(event:string,session:unknown)=>void)=>{listeners.add(fn);return{data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
  signUp:async()=>{calls.push("signup");return{data:{user:{id:subject},session:null},error:null};},
  signInWithPassword:async()=>{calls.push("signin");user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};return{data:{user,session:{user}},error:null};},
  resend:async()=>{calls.push("resend");return{error:null};},
  signOut:async()=>{user=null;listeners.forEach(fn=>fn("SIGNED_OUT",null));return{error:null};}},
 rpc:async(name:string)=>{
  calls.push(name);
  if(name==="peek_tenant_invite")return{data:[{tenant_id:tenant,tenant_name:seed.context==="a"?"Test Service Studio":"Second Test Business with a Longer Name",kind:"consumer",is_valid:seed.state!=="invalid"&&seed.state!=="accepted",invited_email:"recipient@tests.invalid",brand:{primary_color:seed.context==="a"?"#26483e":"#694b38"}}],error:null};
  if(seed.state==="error")return{data:null,error:{code:"08006"}};
  if(name==="client_portal_invite_status")return{data:accepted?receipt():null,error:null};
  if(name==="accept_tenant_invite"){accepted=true;if(seed.state==="unknown")throw Error("synthetic lost response");return{data:tenant,error:null};}
  throw Error("Unapproved synthetic contract");
 },from:()=>{throw Error("Customer entry must not access raw CRM/provisioning");},
};
Object.assign(window,{entryProof:{calls:()=>[...calls],confirmed:()=>{user={id:subject,email:"recipient@tests.invalid",email_confirmed_at:"2026-01-01"};listeners.forEach(fn=>fn("SIGNED_IN",{user}));}}});
