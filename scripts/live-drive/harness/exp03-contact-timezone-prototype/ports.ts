// Deterministic LOCAL prototype only. Never imports the real Supabase client.
export const scenario=new URLSearchParams(location.search).get("scenario")??"success";
export const tenant="10000000-0000-4000-8000-000000000001";
export const contactId="20000000-0000-4000-8000-000000000001";
export const record={id:contactId,current_notes:"Saved relationship note",timezone:"America/New_York",timezone_verified:false,updated_at:"2026-10-30T18:00:00.123456+00:00"};
export const attempts:unknown[]=[];
export const supabase={rpc:async(name:string,args?:{p_patch:Record<string,unknown>})=>{
 if(name==="get_tenant_assignable_members")return{data:[],error:null};
 if(name!=="upsert_contact")throw Error("Unexpected prototype RPC");
 attempts.push(structuredClone(args));
 await new Promise(resolve=>setTimeout(resolve,350));
 if(scenario==="refused")return{data:null,error:{message:"CONTACT_AUTHORITY_CHANGED"}};
 if(scenario==="unavailable")return{data:null,error:{message:"CONTACT_FIELDS_FORBIDDEN"}};
 if(scenario==="stale"){record.timezone="America/Chicago";record.timezone_verified=true;record.updated_at="2026-10-30T18:01:00.654321+00:00";return{data:null,error:{message:"CONTACT_TIMEZONE_STALE"}};}
 Object.assign(record,args?.p_patch,{updated_at:"2026-10-30T18:02:00.999999+00:00"});
 if(scenario==="unknown")throw Error("PROTOTYPE_RESULT_UNKNOWN");
 return{data:contactId,error:null};
},from:()=>{throw Error("Unexpected prototype database read");}};
Object.assign(window,{__exp03ContactPrototype:{record,attempts}});
