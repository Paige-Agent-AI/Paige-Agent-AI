import {parseStaffSubmissions,type StaffDeliveryScope,type StaffDeliveryAction,type StaffSubmission} from "./operations-delivery-staff";
export type DeliveryUiDraft={kind:"preparation";sessionId:string|null;artifactId:string|null;versionId:string|null;reviewerId:string|null}|{kind:"review";submission:StaffSubmission;note:string};
export type DeliveryRecovery={version:1;scope:StaffDeliveryScope;kind:"draft";draft:DeliveryUiDraft}|{version:1;scope:StaffDeliveryScope;kind:"attempt";action:StaffDeliveryAction};
export type RecoveryStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const instant=(v:unknown):v is string=>typeof v==="string"&&v.length<=80&&Number.isFinite(Date.parse(v));
const validScope=(s:StaffDeliveryScope)=>instant(s.workUpdatedAt)&&parseStaffSubmissions({work_item_id:s.workItemId,submissions:[]},s)!==null;
/** Same scoped ephemeral UI pattern as CRM recovery; never domain truth or authority. */
export function deliveryRecoveryKey(scope:StaffDeliveryScope):string|null{return validScope(scope)?`paige:operations-delivery-inspection:${scope.actorId}:${scope.tenantId}:${scope.workItemId}`:null;}
function parseScope(value:unknown,current:StaffDeliveryScope):StaffDeliveryScope|null{
 const r=object(value);if(!r)return null;
 const scope={actorId:r.actorId,tenantId:r.tenantId,workItemId:r.workItemId,planId:r.planId,clientId:r.clientId,workUpdatedAt:r.workUpdatedAt} as StaffDeliveryScope;
 if(!validScope(scope)||!validScope(current)||["actorId","tenantId","workItemId","planId","clientId"].some(k=>scope[k as keyof StaffDeliveryScope]!==current[k as keyof StaffDeliveryScope]))return null;
 // Preserve the original CAS even if the currently visible row version changed.
 return scope;
}
function submission(value:unknown,scope:StaffDeliveryScope):StaffSubmission|null{
 const r=object(value);if(!r||!instant(r.submitted_at)||!instant(r.updated_at)||(r.reviewed_at!==null&&!instant(r.reviewed_at)))return null;
 const rows=parseStaffSubmissions({work_item_id:scope.workItemId,submissions:[{...r,review_note:null}]},scope);
 // No source body, recorded review note, profile/name or customer snapshot retained.
 return rows?.[0]??null;
}
function parseDraft(value:unknown,scope:StaffDeliveryScope):DeliveryUiDraft|null{
 const r=object(value);if(!r)return null;
 if(r.kind==="preparation"){
  if([r.sessionId,r.artifactId,r.versionId,r.reviewerId].some(v=>v!==null&&!uuid(v))||r.reviewerId===scope.actorId)return null;
  return{kind:"preparation",sessionId:r.sessionId as string|null,artifactId:r.artifactId as string|null,versionId:r.versionId as string|null,reviewerId:r.reviewerId as string|null};
 }
 const row=submission(r.submission,scope);
 return r.kind==="review"&&row?.state==="in_review"&&row.reviewer_user_id===scope.actorId&&typeof r.note==="string"&&r.note.length<=4000?{kind:"review",submission:row,note:r.note}:null;
}
function parseAction(value:unknown,scope:StaffDeliveryScope):StaffDeliveryAction|null{
 const r=object(value);if(!r)return null;
 if(r.kind==="submit")return uuid(r.artifactVersionId)&&uuid(r.reviewerId)&&r.reviewerId!==scope.actorId&&Number.isSafeInteger(r.expectedRevisionNo)&&Number(r.expectedRevisionNo)>=0?
  {kind:"submit",artifactVersionId:r.artifactVersionId,reviewerId:r.reviewerId,expectedRevisionNo:Number(r.expectedRevisionNo)}:null;
 const row=submission(r.submission,scope);if(!row)return null;
 if(r.kind==="release")return row.state==="approved"?{kind:"release",submission:row}:null;
 if(r.kind!=="review"||row.state!=="in_review"||row.reviewer_user_id!==scope.actorId||typeof r.decision!=="string"||!["approved","revision_requested"].includes(r.decision)||!(r.note===null||typeof r.note==="string"&&r.note.length<=4000)||r.decision==="revision_requested"&&!(typeof r.note==="string"&&r.note.trim()))return null;
 return{kind:"review",submission:row,decision:r.decision as "approved"|"revision_requested",note:r.note as string|null};
}
function parseRecovery(value:unknown,current:StaffDeliveryScope):DeliveryRecovery|null{
 const r=object(value);if(!r||r.version!==1)return null;
 const scope=parseScope(r.scope,current);if(!scope)return null;
 if(r.kind==="draft"){const draft=parseDraft(r.draft,scope);return draft?{version:1,scope,kind:"draft",draft}:null;}
 if(r.kind==="attempt"){const action=parseAction(r.action,scope);return action?{version:1,scope,kind:"attempt",action}:null;}
 return null;
}
/** Syntax/target binding only. Caller must separately revalidate session and source access. */
export function readDeliveryRecovery(storage:RecoveryStorage,scope:StaffDeliveryScope):{kind:"absent"|"unavailable"}|{kind:"retained";recovery:DeliveryRecovery}{
 try{const key=deliveryRecoveryKey(scope);if(!key)return{kind:"unavailable"};const raw=storage.getItem(key);if(raw===null)return{kind:"absent"};if(raw.length>16000)return{kind:"unavailable"};
  const recovery=parseRecovery(JSON.parse(raw),scope);return recovery?{kind:"retained",recovery}:{kind:"unavailable"};
 }catch{return{kind:"unavailable"};}
}
/** Retain before a consequential writer; false must prevent that write. Never executes/retries. */
export function saveDeliveryRecovery(storage:RecoveryStorage,scope:StaffDeliveryScope,value:DeliveryRecovery):boolean{
 try{const key=deliveryRecoveryKey(scope),parsed=parseRecovery(value,scope);if(!key||!parsed)return false;const previous=readDeliveryRecovery(storage,scope);if(previous.kind==="unavailable"||previous.kind==="retained"&&previous.recovery.kind==="attempt"&&JSON.stringify(previous.recovery)!==JSON.stringify(parsed))return false;const raw=JSON.stringify(parsed);if(raw.length>16000)return false;storage.setItem(key,raw);return storage.getItem(key)===raw;}catch{return false;}
}
/** Explicit UI clearance only; cannot cancel or remove a canonical domain record. */
export function clearDeliveryRecovery(storage:RecoveryStorage,scope:StaffDeliveryScope,expected?:DeliveryRecovery):boolean{
 try{const key=deliveryRecoveryKey(scope);if(!key)return false;const previous=readDeliveryRecovery(storage,scope);if(previous.kind==="unavailable")return false;if(previous.kind==="retained"&&previous.recovery.kind==="attempt"){const original=expected&&parseRecovery(expected,scope);if(!original||JSON.stringify(original)!==JSON.stringify(previous.recovery))return false;}storage.removeItem(key);return storage.getItem(key)===null;}catch{return false;}
}

/** Tab-scoped existing browser UI retention; unavailable storage must fail closed. */
export function browserDeliveryRecoveryStorage():RecoveryStorage{
 try{return window.sessionStorage;}catch{return{getItem:()=>{throw Error("UI recovery unavailable");},setItem:()=>{throw Error("UI recovery unavailable");},removeItem:()=>{throw Error("UI recovery unavailable");}};}
}
