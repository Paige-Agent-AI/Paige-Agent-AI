import {supabase as original} from "../settings-mount/supabase-paige-stub";
const seat=new URLSearchParams(location.search).get("callingSeat")??"owner";
export const supabase={...original,
  rpc:async(name:string,args?:Record<string,unknown>)=>{
    if(name==="is_current_user_tenant_admin")return{data:seat==="owner",error:seat==="error"?{message:"synthetic unavailable"}:null};
    if(name==="is_platform_owner")return{data:seat==="operator",error:null};
    const result=await original.rpc(name,args);
    if(name==="tenant_comms_readiness")return{...result,data:{...result.data,calling:{ready:false,code:"calling_not_configured",reason_code:null,account:"absent",number_assigned:false,primary_selected:false,primary_e164:null,twiml_app:"absent"}}};
    return result;
  },
  functions:{invoke:async()=>{throw new Error("No provider or business effect is permitted in this rendering fixture");}},
};
