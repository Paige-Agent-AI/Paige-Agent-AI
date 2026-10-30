export * from "../exp03-composer-inline-check-mount/stubs";
import {supabase as original,TENANT,harnessLog} from "../exp03-composer-inline-check-mount/stubs";
const door=new URLSearchParams(location.search).get("door")??"ok";
const contact={id:"e0300000-0000-4000-8000-0000000c0001",tenant_id:TENANT,first_name:"Jordan",last_name:"Rivera",entity_name:null,lifecycle_stage:"client_active",created_at:new Date(0).toISOString(),client_contact_methods:[{id:"email",kind:"email",value:"jordan.rivera@example.com",label:"Work",is_primary:true,position:0}]};
const uploads=new Map<string,{name:string;size:number;mime:string}>();const unknown=new Set<string>();
export const supabase={
  ...original,
  from:(table:string)=>{
    if(table!=="clients")return original.from(table);
    const filters:Array<[string,unknown]>=[];
    const rows=()=>[contact].filter(row=>filters.every(([key,value])=>row[key as keyof typeof row]===value));
    const query:Record<string,unknown>=new Proxy({},{get(_target,prop){
      if(prop==="then")return(done:(value:unknown)=>unknown,fail?:(error:unknown)=>unknown)=>Promise.resolve({data:rows(),error:null}).then(done,fail);
      if(prop==="single"||prop==="maybeSingle")return async()=>({data:rows()[0]??null,error:null});
      if(prop==="eq")return(key:string,value:unknown)=>{filters.push([key,value]);return query;};
      return()=>query;
    }});return query;
  },
  storage:{from:()=>({
    upload:async(path:string,file:File)=>{uploads.set(path,{name:file.name,size:file.size,mime:file.type});return{data:{path},error:null};},
    remove:async(paths:string[])=>{paths.forEach(path=>uploads.delete(path));return{data:null,error:null};},
    createSignedUrl:async()=>({data:null,error:null}),
  })},
  functions:{invoke:async(name:string,opts?:{body?:Record<string,unknown>})=>{
    const body=opts?.body;
    if(name==="comms-email-command"&&body){
      if(door==="member"||unknown.has(String(body.operation_id))){
        harnessLog.rpc.push({name:`functions:${name}`,args:body});
        const result=door==="member"?{ok:false,outcome:"refused",reason:"COMMS_EMAIL_FORBIDDEN"}:{ok:false,outcome:"outcome_unknown",operation_id:body.operation_id};
        return{data:null,error:{context:{status:door==="member"?403:503,json:async()=>result}}};
      }
      const result=await original.functions.invoke(name,opts);
      if(door==="unknown"&&body.approved_fingerprint)unknown.add(String(body.operation_id));
      if(result.data&&typeof result.data==="object"&&result.data.outcome==="approval_required"&&Array.isArray(body.attachments)){
        result.data.preview.attachments=body.attachments.map((attachment:{path:string})=>uploads.get(attachment.path)??{name:"unavailable",size:0,mime:"application/octet-stream"});
      }
      return result;
    }
    return original.functions.invoke(name,opts);
  }},
};
