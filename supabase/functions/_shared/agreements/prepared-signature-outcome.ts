import {object,UUID} from '../sales-collections/primitives.ts';
import type {OwnerPreparationCaller} from './owner-preparation.ts';

type Service={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export class PreparedSignatureStatusUnavailable extends Error{
 constructor(readonly code:'INVALID'|'ACCESS_UNVERIFIED'|'UNAVAILABLE'){super('PREPARED_SIGNATURE_STATUS_'+code);}
}
const fail=(code:PreparedSignatureStatusUnavailable['code']):never=>{throw new PreparedSignatureStatusUnavailable(code);};
const uuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const closed=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)
 &&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

/** Ordinary private history over ORIGINAL Work/consumed approval/preparation.
 * This projection cannot prove delivery: only prepared or outcome_unknown is
 * admitted until the original canonical message/provider receipts are wired.
 * No fresh approval, claim, credential, provider attempt or fallback is issued.
 * The native reader rechecks actual actor authority; JWT checks around its
 * await retire a result from a changed business/session before disclosure. */
export async function readPreparedSignatureOutcome(value:unknown,caller:OwnerPreparationCaller,
 service:Service,expectedActorId:string){
 let input:unknown;try{input=structuredClone(value);}catch{return fail('INVALID');}
 if(!closed(input,['tenant_id','agreement_id','operation_id','expected_request_sha256'])
  ||!uuid(input.tenant_id)||!uuid(input.agreement_id)||!uuid(input.operation_id)
  ||!hash(input.expected_request_sha256)||!uuid(expectedActorId))return fail('INVALID');
 const {tenant_id:tenant,agreement_id:agreement,operation_id:operation,expected_request_sha256:digest}=input;
 const authorize=async()=>{
  try{
   const user=await caller.auth.getUser();
   if(user.error||!user.data.user||user.data.user.id!==expectedActorId||user.data.user.is_anonymous===true)return fail('ACCESS_UNVERIFIED');
   const current=await caller.rpc('current_user_tenant_id');
   if(current.error||current.data!==tenant)return fail('ACCESS_UNVERIFIED');
   const role=await caller.rpc('is_tenant_admin',{_tenant:tenant});
   if(role.error||role.data!==true)return fail('ACCESS_UNVERIFIED');
  }catch{return fail('ACCESS_UNVERIFIED');}
 };
 await authorize();
 let data:unknown;
 try{
  const reply=await service.rpc('_read_prepared_agreement_request_status',{
   _actor:expectedActorId,_tenant:tenant,_operation:operation,_request_sha256:digest,
  });
  if(!reply||reply.error)return fail('UNAVAILABLE');
  data=structuredClone(reply.data);
 }catch{return fail('UNAVAILABLE');}
 await authorize();
 if(data===null)return null;
 if(!closed(data,['kind','state','tenant_id','actor_id','operation_id','request_sha256','agreement_id','work_id','receipt_id'])
  ||data.kind!=='prepared_signature_request_result'||typeof data.state!=='string'
  ||!['prepared','outcome_unknown'].includes(data.state)||data.tenant_id!==tenant||data.actor_id!==expectedActorId
  ||data.operation_id!==operation||data.request_sha256!==digest||data.agreement_id!==agreement
  ||!uuid(data.work_id)||data.receipt_id!==null)return fail('UNAVAILABLE');
 return {kind:'prepared_signature_request_result' as const,state:data.state as 'prepared'|'outcome_unknown',
  tenant_id:tenant,actor_id:expectedActorId,operation_id:operation,request_sha256:digest,
  agreement_id:agreement,work_id:data.work_id,receipt_id:null};
}
