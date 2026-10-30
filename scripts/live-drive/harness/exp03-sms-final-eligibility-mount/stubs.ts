export * from "../exp03-composer-inline-check-mount/stubs";
import {supabase as original,TENANT} from "../exp03-composer-inline-check-mount/stubs";
export const CONTACT="e0300000-0000-4000-8000-0000000c0001";
const contact={id:CONTACT,tenant_id:TENANT,first_name:"Jordan",last_name:"Rivera",entity_name:null,client_contact_methods:[{id:"phone",kind:"phone",value:"+12025550123",label:"Mobile",is_primary:true,position:0}]};
const calls:unknown[]=[];Object.assign(window,{smsFinalEligibilityCalls:calls});
export const explanation="This text is on hold because message hours or preferences changed. Nothing was sent or scheduled. Review before trying again.";
export const supabase={...original,from:(table:string)=>{
 if(table!=="clients")return original.from(table);
 const q:Record<string,unknown>=new Proxy({},{get(_t,p){if(p==="single"||p==="maybeSingle")return async()=>({data:contact,error:null});if(p==="then")return(done:(v:unknown)=>unknown)=>Promise.resolve({data:[contact],error:null}).then(done);return()=>q;}});return q;
},functions:{invoke:async(name:string,opts?:{body?:Record<string,unknown>})=>{
 if(name!=="send-message")return original.functions.invoke(name,opts);
 calls.push({name,body:opts?.body});
 // Explicitly injected fictional response, matching the separately tested original handler.
 return{data:{status:"failed",outcome:"failed",reason:explanation,error:explanation,scheduled_for:null},error:null};
}}};
