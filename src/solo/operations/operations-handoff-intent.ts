import type { prepareEngagementHandoff } from "./operations-engagement-handoff";
export type PendingHandoffRequest = NonNullable<ReturnType<typeof prepareEngagementHandoff>>;
const prefix="paige:operations-handoff-intent:";
const key=(actor:string,tenant:string,agreement:string)=>`${prefix}${actor}:${tenant}:${agreement}`;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.trim().length>0&&v.length<=max;
const digest=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
/** Recovery intent only. It is not a signing fact, work record or execution permission. */
export type PendingHandoffState = {kind:"absent"} | {kind:"valid";request:PendingHandoffRequest} | {kind:"blocked"};
export function readPendingHandoff(actor:string,tenant:string,agreement:string):PendingHandoffState {
 try {
  const raw=sessionStorage.getItem(key(actor,tenant,agreement));if(raw===null)return {kind:"absent"};
  const r:unknown=JSON.parse(raw);if(!r||typeof r!=="object"||Array.isArray(r))return {kind:"blocked"};
  const p=r as Record<string,unknown>;
  if(p.p_expected_actor_id!==actor||p.p_expected_tenant_id!==tenant||p.p_agreement_id!==agreement
   ||![p.p_expected_actor_id,p.p_expected_tenant_id,p.p_agreement_id,p.p_expected_contact_id,p.p_expected_terms_id,p.p_expected_offer_id,p.p_request_id,p.p_owner_user_id].every(uuid)
   ||!Number.isSafeInteger(p.p_expected_version)||Number(p.p_expected_version)<1
   ||!digest(p.p_expected_content_sha256)||!digest(p.p_expected_sealed_sha256)
   ||!text(p.p_title,500)||(p.p_summary!==null&&(typeof p.p_summary!=="string"||p.p_summary.length>10000))
   ||!text(p.p_expected_terms_updated_at,64)||!text(p.p_starts_on,10)||!text(p.p_ends_on,10)
   ||!Array.isArray(p.p_milestones)||p.p_milestones.length<1||p.p_milestones.length>50)return {kind:"blocked"};
  const milestones=[];
  for(const step of p.p_milestones){
   if(!step||typeof step!=="object"||Array.isArray(step))return {kind:"blocked"};
   const m=step as Record<string,unknown>;
   if(!text(m.title,500)||!uuid(m.assigned_to_user_id)||typeof m.priority!=="string"||!["low","normal","high","urgent"].includes(m.priority)
    ||(m.summary!==null&&(typeof m.summary!=="string"||m.summary.length>10000))
    ||(m.due_at!==null&&!text(m.due_at,64)))return {kind:"blocked"};
   milestones.push({title:m.title,summary:m.summary as string|null,assigned_to_user_id:m.assigned_to_user_id,priority:m.priority as "low"|"normal"|"high"|"urgent",due_at:m.due_at as string|null});
  }
  // Project only the original typed request; extra/private fields never reach a caller.
  return {kind:"valid",request:{p_expected_actor_id:actor,p_expected_tenant_id:tenant,p_agreement_id:agreement,
   p_expected_contact_id:p.p_expected_contact_id as string,p_expected_terms_id:p.p_expected_terms_id as string,p_expected_offer_id:p.p_expected_offer_id as string,
   p_request_id:p.p_request_id as string,p_expected_version:p.p_expected_version as number,
   p_expected_content_sha256:p.p_expected_content_sha256,p_expected_sealed_sha256:p.p_expected_sealed_sha256,
   p_expected_terms_updated_at:p.p_expected_terms_updated_at,p_title:p.p_title,p_summary:p.p_summary as string|null,
   p_owner_user_id:p.p_owner_user_id as string,p_starts_on:p.p_starts_on,p_ends_on:p.p_ends_on,p_milestones:milestones}};
 }catch{return {kind:"blocked"};}
}
export function retainPendingHandoff(request:PendingHandoffRequest):boolean {
 try{sessionStorage.setItem(key(request.p_expected_actor_id,request.p_expected_tenant_id,request.p_agreement_id),JSON.stringify(request));return true;}catch{return false;}
}
export function clearPendingHandoff(actor:string,tenant:string,agreement:string):boolean {
 try{sessionStorage.removeItem(key(actor,tenant,agreement));return true;}catch{return false;}
}
