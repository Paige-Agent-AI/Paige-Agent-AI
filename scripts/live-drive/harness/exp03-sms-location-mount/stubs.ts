export * from "../exp03-composer-inline-check-mount/stubs";
import {supabase as original,TENANT} from "../exp03-composer-inline-check-mount/stubs";
import {runPreSend} from "../../../../supabase/functions/_shared/pre-send-pipeline";
export const CONTACT="e0300000-0000-4000-8000-0000000c0001";
const contact={id:CONTACT,tenant_id:TENANT,first_name:"Jordan",last_name:"Rivera",entity_name:null,client_contact_methods:[{id:"phone",kind:"phone",value:"+12025550123",label:"Mobile",is_primary:true,position:0}]};
const calls:unknown[]=[];Object.assign(window,{smsLocationCalls:calls});
const mockAdmin={from:(table:string)=>{const q={select:()=>q,eq:()=>q,or:()=>q,order:()=>q,limit:async()=>({data:table==="paige_suppressions"?[]:[{action:"granted"}],error:null}),maybeSingle:async()=>({data:table==="clients"?{timezone:new URLSearchParams(location.search).get("zone"),dnd_active:false}:{autosend_dnd_enabled:false,autosend_dnd_timezone:"America/New_York"},error:null})};return q;}};
export const supabase={...original,from:(table:string)=>{
if(table!=="clients")return original.from(table);
const q:Record<string,unknown>=new Proxy({},{get(_t,p){if(p==="single"||p==="maybeSingle")return async()=>({data:contact,error:null});if(p==="then")return(done:(v:unknown)=>unknown)=>Promise.resolve({data:[contact],error:null}).then(done);return()=>q;}});return q;},
functions:{invoke:async(name:string,opts?:{body?:Record<string,unknown>})=>{
if(name!=="send-message")return original.functions.invoke(name,opts);
const body=opts?.body??{};const result=await runPreSend(mockAdmin as unknown as Parameters<typeof runPreSend>[0],{tenantId:TENANT,contactId:CONTACT,channel:"sms",to:"+12025550123",now:new Date("2026-10-30T16:00:00Z")});
calls.push({name,body,result});if(result.proceed)throw Error("Prototype permits no provider dispatch");return{data:{status:"failed",outcome:"failed",reason:result.reason,error:result.reason,scheduled_for:null},error:null};
}}};
