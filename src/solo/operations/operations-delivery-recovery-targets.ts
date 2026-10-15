import type {StaffDeliveryScope} from "./operations-delivery-staff";
import {deliveryRecoveryKey,readDeliveryRecovery} from "./operations-delivery-local-recovery";
export type RecoveryTarget={scope:StaffDeliveryScope;mode:"preparation"|"review";kind:"draft"|"attempt"};
export type RecoveryTargets={kind:"ready";targets:RecoveryTarget[];partial:boolean;unavailableCount:number}|{kind:"unavailable"};
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
/** Discover existing scoped UI targets only. Fresh domain readers establish all actual authority. */
export function readDeliveryRecoveryTargets(storage:Storage,actorId:string,tenantId:string):RecoveryTargets{
 if(!uuid(actorId)||!uuid(tenantId))return{kind:"unavailable"};
 try{
  const length=storage.length;if(!Number.isSafeInteger(length)||length<0)return{kind:"unavailable"};
  const prefix=`paige:operations-delivery-inspection:${actorId}:${tenantId}:`,targets:RecoveryTarget[]=[];let unavailableCount=0;
  for(let index=0;index<Math.min(length,200);index++){
   const key=storage.key(index);if(!key?.startsWith(prefix))continue;
   try{
    const raw=storage.getItem(key);if(raw===null||raw.length>16000){unavailableCount++;continue;}
    const candidate=object(object(JSON.parse(raw))?.scope) as StaffDeliveryScope|null;
    if(!candidate||candidate.actorId!==actorId||candidate.tenantId!==tenantId||deliveryRecoveryKey(candidate)!==key){unavailableCount++;continue;}
    const read=readDeliveryRecovery(storage,candidate);if(read.kind!=="retained"){unavailableCount++;continue;}
    const retained=read.recovery,mode=retained.kind==="attempt"?retained.action.kind==="submit"?"preparation":"review":retained.draft.kind==="preparation"?"preparation":"review";
    targets.push({scope:retained.scope,mode,kind:retained.kind});
   }catch{unavailableCount++;}
  }
  return{kind:"ready",targets,partial:length>200,unavailableCount};
 }catch{return{kind:"unavailable"};}
}
