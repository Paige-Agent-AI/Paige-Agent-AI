// Original local SoloApp harness only. Fictional transport, never authenticated/customer proof.
import { supabase as incumbent } from "./supabase-stub";
import { harnessActiveTenant } from "./tenant-context-stub";
const mode=new URLSearchParams(location.search).get("ownerProfile")??"other";
const attempts:unknown[]=[];const saved:Record<string,{job_title:string|null;responsibilities:string|null}>={};
(window as unknown as {__ownerProfileEvidence:{attempts:unknown[]}}).__ownerProfileEvidence={attempts};
function rows(){
 const tenant=harnessActiveTenant();const holder=mode==="holder"||["missing","foreign","transport","refusal","committed-unknown"].includes(mode);
 const actor={membership_id:`${tenant.id}-actor`,user_id:"u-me",full_name:holder?"Morgan Hale":mode==="self"?"Taylor Reed":"Priya Nair",email:"actor@tests.invalid",avatar_url:null,status:"active",permission:holder||mode==="self"?"owner":"admin",is_owner:holder||mode==="self",is_account_holder:holder,job_title:"Delivery lead",responsibilities:"Coordinate the team",last_sign_in_at:null};
 const target=mode==="self"?actor:{...actor,membership_id:`${tenant.id}-profile-owner`,user_id:"u-profile-owner",full_name:"Taylor Reed",email:"owner@tests.invalid",permission:"owner",is_owner:true,is_account_holder:false};
 return [actor,...(mode==="self"?[]:[target])].map(row=>({...row,...saved[row.membership_id]}));
}
export const supabase={...incumbent,rpc:async(name:string,args:Record<string,unknown>={})=>{
 const tenant=harnessActiveTenant();
 if(name==="get_solo_team_workspace")return{data:{tenant_id:tenant.id,tenant_name:tenant.name,viewer_permission:["other","unknown"].includes(mode)?"admin":"owner",can_manage_profiles:true,can_manage_invitations:true,can_change_permissions:true,viewer_is_account_holder:mode==="unknown"?undefined:["holder","missing","foreign","transport","refusal","committed-unknown"].includes(mode),total_members:rows().length,members:rows(),invitations:[]},error:null};
 if(name==="set_solo_team_member_work_profile"){
  attempts.push({name,tenant:tenant.id,...args});
  if(mode==="transport")throw new Error("synthetic transport unavailable");
  if(mode==="refusal")return{data:null,error:{code:"42501",message:"TEAM_OWNER_PROFILE_FORBIDDEN: synthetic authority change"}};
  if(mode==="missing")return{data:null,error:null};
  const target=rows().find(row=>row.user_id===args._member_user_id);
  if(args._expected_tenant_id!==tenant.id)return{data:null,error:{code:"42501",message:"your active workspace changed before this could run; nothing was changed"}};
  if(!target||args._expected_membership_id!==target.membership_id)return{data:null,error:{code:"42501",message:"this team membership changed before this could run; nothing was changed"}};
  const canonical=(v:unknown)=>String(v??"").replace(/^ +| +$/g,"")||null;
  if(mode==="foreign")return{data:{membership_id:"other-seat",job_title:canonical(args._job_title),responsibilities:canonical(args._responsibilities)},error:null};
  const result={job_title:canonical(args._job_title),responsibilities:canonical(args._responsibilities)};
  saved[target.membership_id]=result;
  if(mode==="committed-unknown")throw new Error("synthetic response lost after committed state");
  return{data:{membership_id:target.membership_id,...result},error:null};
 }
 return incumbent.rpc(name,args);
}};
