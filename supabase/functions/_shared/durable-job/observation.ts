export interface DurableObservationReference { threadId: string; intentId: string; workId: string }
export interface DurableObservationCaller {
 auth: { getUser(): PromiseLike<{data:{user:{id:string}|null};error:unknown}> };
 rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>;
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
/** Observation only. Never returns execution eligibility, consumes approval or wakes work. */
export async function readDurableObservation(reference:DurableObservationReference,caller:DurableObservationCaller) {
 try {
  if(!reference||Object.keys(reference).some(k=>!['threadId','intentId','workId'].includes(k))||![reference.threadId,reference.intentId,reference.workId].every(uuid))return null;
  const pin=Object.freeze({...reference});
  const auth=await caller.auth.getUser(); if(auth.error||!uuid(auth.data.user?.id))return null;
  const tenant=await caller.rpc('current_user_tenant_id'); if(tenant.error||!uuid(tenant.data))return null;
  const read=await caller.rpc('read_paige_durable_observation',{_thread:pin.threadId,_intent:pin.intentId,_work:pin.workId});
  if(read.error||!read.data||typeof read.data!=='object'||Array.isArray(read.data))return null;
  const r={...read.data} as Record<string,unknown>;
  const after=await caller.auth.getUser(); const current=await caller.rpc('current_user_tenant_id');
  if(after.error||current.error||after.data.user?.id!==auth.data.user!.id||current.data!==tenant.data||r.actorId!==auth.data.user!.id||r.tenantId!==tenant.data||r.workId!==pin.workId||r.threadId!==pin.threadId||r.intentId!==pin.intentId||!uuid(r.workIntentId)||!['claimed','blocked','succeeded','failed','cancelled','expired','outcome_unknown'].includes(String(r.state))||!Number.isSafeInteger(r.version)||typeof r.artifactVerified!=='boolean'||(r.version as number)<1||!['observed','reconciliation_required','terminal_unverified'].includes(String(r.recoveryState))||(r.artifactVerified===true&&(!uuid(r.artifactRef)||r.state!=='succeeded')))return null;
  const manual=r.observationKind==='systems_check';
  if(r.observationKind!==undefined&&!manual)return null;
  // An original run receipt is never a Document/Research artifact or execution
  // eligibility. The native observer owns its exact Work/run/Rail association.
  if(manual&&(r.artifactVerified!==false||r.artifactRef!==null||typeof r.receiptVerified!=='boolean'
    ||(r.receiptVerified===true&&(r.state!=='succeeded'||r.recoveryState!=='observed'||!uuid(r.receiptRef)))
    ||(r.receiptVerified===false&&(r.receiptRef!==null||(r.state==='succeeded'&&r.recoveryState!=='terminal_unverified')))))return null;
  const keys=['actorId','tenantId','workId','threadId','intentId','workIntentId','state','version','recoveryState','artifactVerified','artifactRef','observationKind','receiptVerified','receiptRef'];
  const snapshot=JSON.stringify(keys.map(k=>r[k]??null));
  const final=await caller.rpc('read_paige_durable_observation',{_thread:pin.threadId,_intent:pin.intentId,_work:pin.workId});
  if(final.error||!final.data||typeof final.data!=='object'||Array.isArray(final.data))return null;
  const fresh=final.data as Record<string,unknown>;
  if(JSON.stringify(keys.map(k=>fresh[k]??null))!==snapshot)return null;
  // Closed projection; raw payloads and forged future execution fields never escape.
  return {workId:pin.workId,threadId:pin.threadId,intentId:pin.intentId,workIntentId:r.workIntentId,state:r.state as string,version:r.version as number,recoveryState:r.recoveryState as string,approvalState:'unavailable' as const,cancelled:r.state==='cancelled',artifactVerified:r.artifactVerified,artifactRef:r.artifactVerified&&uuid(r.artifactRef)?r.artifactRef:null,
    ...(manual?{observationKind:'systems_check' as const,receiptVerified:r.receiptVerified as boolean,receiptRef:r.receiptVerified===true&&uuid(r.receiptRef)?r.receiptRef:null}:{})};
 }catch{return null;}
}
