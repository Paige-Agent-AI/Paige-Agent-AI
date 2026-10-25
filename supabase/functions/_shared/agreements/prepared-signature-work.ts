import {object,UUID} from '../sales-collections/primitives.ts';

type Service={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
type Scope={actorId:string;tenantId:string;operationId:string;requestSha256:string;agreementId:string;preparationId:string};
export type PreparedSignatureWorkRecord={kind:'prepared_signature_work';execution:'unavailable';work_id:string;
 work_status:'claimed'|'succeeded'|'failed'|'blocked'|'cancelled'|'expired'|'outcome_unknown';
 operation_id:string;request_sha256:string;agreement_id:string;preparation_id:string};
const uuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const unavailable=():never=>{throw Error('PREPARED_SIGNATURE_WORK_UNAVAILABLE');};

/** Concrete originating adapter to ORIGINAL native Work, not an executor or
 * provider receipt. Scope is established by a genuine authenticated server
 * factory; it is never request-authored permission. The native domain bridge
 * rechecks actor/source/consumed original approval/decision evidence and invokes
 * canonical Work. Current actor/provider authority is still required before any
 * future token or dispatch effect. No production caller is mounted here. */
export function preparedSignatureWorkStore(service:Service,scope:Scope){
 const {actorId,tenantId,operationId,requestSha256,agreementId,preparationId}=scope;
 if(![actorId,tenantId,operationId,agreementId,preparationId].every(uuid)||!hash(requestSha256))return unavailable();
 const bound={_actor:actorId,_tenant:tenantId};
 const projection=(value:unknown):PreparedSignatureWorkRecord=>{
  if(!object(value)||Object.keys(value).sort().join(',')!=='agreement_id,execution,kind,operation_id,preparation_id,request_sha256,work_id,work_status'
   ||value.kind!=='prepared_signature_work'||value.execution!=='unavailable'||!uuid(value.work_id)
   ||value.operation_id!==operationId||value.request_sha256!==requestSha256
   ||value.agreement_id!==agreementId||value.preparation_id!==preparationId
   ||typeof value.work_status!=='string'||!['claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown'].includes(value.work_status))return unavailable();
  return {kind:'prepared_signature_work',execution:'unavailable',work_id:value.work_id,
   work_status:value.work_status as PreparedSignatureWorkRecord['work_status'],operation_id:operationId,
   request_sha256:requestSha256,agreement_id:agreementId,preparation_id:preparationId};
 };
 const read=async(name:string,args:Record<string,unknown>)=>{
  try{const reply=await service.rpc(name,{...bound,...structuredClone(args)});if(!reply||reply.error)return unavailable();return structuredClone(reply.data);}
  catch{return unavailable();}
 };
 return {
  async read():Promise<PreparedSignatureWorkRecord|null>{
   const row=await read('_read_prepared_agreement_work',{_operation:operationId,_request_sha256:requestSha256});
   return row===null?null:projection(row);
  },
  async register(value:unknown):Promise<PreparedSignatureWorkRecord>{
   let copy:unknown;try{copy=structuredClone(value);}catch{return unavailable();}
   if(!object(copy)||Object.keys(copy).sort().join(',')!=='auditId,confirmationId,fingerprint,requestNonce'
    ||!uuid(copy.confirmationId)||!uuid(copy.requestNonce)||!uuid(copy.auditId)
    ||typeof copy.fingerprint!=='string'||!/^[a-f0-9]{16}$/.test(copy.fingerprint))return unavailable();
   // No retry or new identity on a lost acknowledgement. The caller must read
   // the ORIGINAL intent and retain uncertainty if that read is unavailable.
   return projection(await read('_register_prepared_agreement_work',{_confirmation:copy.confirmationId,
    _request_nonce:copy.requestNonce,_fingerprint:copy.fingerprint,_audit:copy.auditId}));
  },
 };
}
