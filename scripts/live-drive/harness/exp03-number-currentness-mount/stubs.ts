import {supabase as original} from "../exp03-calling-authority-mount/stubs";
const tenant=new URLSearchParams(location.search).get("tenant")==="second"?"harness-tenant-second":"harness-tenant";
const attempts:unknown[]=[];
Object.assign(window,{__exp03NumberCurrentness:{attempts}});
export const supabase={...original,
 from:(table:string)=>{
  if(table!=="tenant_phone_numbers")return original.from(table);
  let scope:string|null=null;
  const result=()=>({data:scope===tenant?[{id:"fixture-number",tenant_id:tenant,phone_number:"+15555550101",is_primary:false,status:"active",friendly_name:"Fictional intake"}]:[],error:null});
  const q:Record<string,unknown>={select:()=>q,eq:(key:string,value:string)=>{if(key==="tenant_id")scope=value;return q;},order:async()=>result()};return q;
 },
 rpc:async(name:string,args?:Record<string,unknown>)=>{
  if(name==="tenant_phone_number_rename"||name==="tenant_phone_number_set_primary"){
   attempts.push({name,args:structuredClone(args)});
   return{data:null,error:{message:"NUMBER_AUTHORITY_CHANGED",hint:"NUMBER_AUTHORITY_CHANGED"}};
  }
  return original.rpc(name,args);
 },
 functions:{invoke:async()=>{throw Error("No provider or business effect allowed in this fictional render");}},
};
