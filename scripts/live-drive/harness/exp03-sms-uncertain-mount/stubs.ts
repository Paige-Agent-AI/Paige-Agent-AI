export * from "../exp03-composer-inline-check-mount/stubs";
import {supabase as original,TENANT} from "../exp03-composer-inline-check-mount/stubs";
export const CONTACT="e0300000-0000-4000-8000-0000000c0001";
const contact={id:CONTACT,tenant_id:TENANT,first_name:"Jordan",last_name:"Rivera",entity_name:null,client_contact_methods:[{id:"phone",kind:"phone",value:"+12025550123",label:"Mobile",is_primary:true,position:0}]};
const calls:unknown[]=[];Object.assign(window,{smsUncertainCalls:calls,smsUncertainReturns:0});
export const supabase={...original,from:(table:string)=>{
if(table!=="clients")return original.from(table);
const q:Record<string,unknown>=new Proxy({},{get(_t,p){if(p==="single"||p==="maybeSingle")return async()=>({data:contact,error:null});if(p==="then")return(done:(v:unknown)=>unknown)=>Promise.resolve({data:[contact],error:null}).then(done);return()=>q;}});return q;},
functions:{invoke:async(name:string,opts?:{body?:Record<string,unknown>})=>{
if(name!=="send-message")return original.functions.invoke(name,opts);
calls.push({name,body:opts?.body});
// The backend's actual source has separate handler/adapter tests. This UI fixture injects its response;
// it does not claim a real provider attempt, saved customer row, or completed thread navigation.
return{data:{status:"failed",outcome:"outcome_unknown",unconfirmed:true,error:"delivery_unconfirmed",message_id:"e0300000-0000-4000-8000-0000000a0001",scheduled_for:null},error:null};
}}};
