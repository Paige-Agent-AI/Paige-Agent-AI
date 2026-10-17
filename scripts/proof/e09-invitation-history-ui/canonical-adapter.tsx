// Explicit local transport for actual production UI; no hosted Auth/database/provider call.
export * from './adapter';
import {supabase as base} from './adapter';
const options=(window as unknown as {portalProof:{tenant:string}}).portalProof;
const actor='e0911000-0000-0000-0000-000000000001',contact='e0931000-0000-0000-0000-000000000001';
const invitation='e0941000-0000-0000-0000-000000000001',receipt='e0951000-0000-0000-0000-000000000001';
const calls:Array<{name:string;args:Record<string,unknown>}>=[];
let next:'accepted'|'uncertain'|'refused'='accepted',phase=next as string,effects=0,reads=0,cycle=0,operation:string|undefined,fingerprint='',expired=false;
const originalProof=(window as unknown as {invitationProof:()=>Record<string,unknown>}).invitationProof;
Object.assign(window,{invitationCommandPrototype:{setOutcome:(v:typeof next)=>{next=v},expireAuth:()=>{expired=true},records:()=>[[contact,{phase,effects,reads,cycle}]]},
 invitationProof:()=>({...originalProof(),command:{calls,effects,reads,provider:'NOT_CALLED',actualAuthority:false}})});
export const supabase={...base,
 auth:{...base.auth,getUser:async()=>expired?{data:{user:null},error:null}:base.auth.getUser()},
 functions:{invoke:async(name:string,{body}:{body:Record<string,unknown>})=>{
  calls.push({name,args:body});
  if(name!=='send-portal-invite'||body.expected_tenant_id!==options.tenant||body.contact_id!==contact||typeof body.operation_id!=='string'
   ||Object.keys(body).some(k=>!['expected_tenant_id','contact_id','operation_id','approved_fingerprint'].includes(k)))throw Error('Offline command refuses scope/body');
  if(!body.approved_fingerprint){operation=body.operation_id;fingerprint=(++cycle).toString(16).padStart(16,'0');return {data:{outcome:'approval_required',capability:'client_portal_invitation_send',operation_id:operation,fingerprint,summary:'Email the existing one-use portal invitation to client0@example.test. Delivery and customer acceptance are separate.',expires_at:new Date(Date.now()+600000).toISOString()},error:null}}
  if(body.approved_fingerprint!==fingerprint||body.operation_id!==operation)throw Error('Offline command refuses unpaired approval');
  effects++;await new Promise(resolve=>setTimeout(resolve,120));phase=next;
  return {data:{ok:next==='accepted',outcome:next==='accepted'?'provider_accepted':next==='uncertain'?'outcome_unknown':'refused',operation_id:operation,invitation_id:invitation,receipt_id:receipt,delivery_confirmed:false},error:null};
 }},
 rpc:(name:string,args:Record<string,unknown>={})=>{
  if(name!=='read_client_portal_invitation_delivery')return base.rpc(name,args);
  calls.push({name,args});
  if(args.p_tenant_id!==options.tenant||args.p_operation_id!==operation)throw Error('Offline receipt refuses scope');
  reads++;
  return Promise.resolve({data:{actor_id:actor,tenant_id:options.tenant,operation_id:operation,found:true,invitation_id:invitation,receipt_id:receipt,requested_by:actor,reconciled_by:actor,
   outcome:phase==='accepted'?'provider_accepted':phase==='uncertain'?'outcome_unknown':'refused',provider_message_id:phase==='accepted'?'controlled-provider-observation':null,observed_at:'2026-10-17T12:00:00Z'},error:null});
 },
};
