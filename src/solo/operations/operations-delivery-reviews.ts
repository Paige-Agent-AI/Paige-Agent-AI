import type { DeliverySourceCaller, DeliverySourceScope } from "./operations-delivery-source";
export type PendingDeliveryReview={submission_id:string;work_item_id:string;plan_id:string;client_id:string;artifact_version_id:string;artifact_digest:string;revision_no:number;submitted_by:string;reviewer_user_id:string;submission_updated_at:string;work_updated_at:string;title:string};
export type PendingDeliveryReviews={kind:"ready";reviews:PendingDeliveryReview[];unavailableCount:number;hasMore:boolean}|{kind:"unavailable"|"refused"|"scope_changed"};
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const instant=(v:unknown):v is string=>typeof v==="string"&&v.length<=80&&Number.isFinite(Date.parse(v));
/** Discover existing nominations; this read grants no generic work edit authority. */
export async function readPendingDeliveryReviews(caller:DeliverySourceCaller,scope:DeliverySourceScope,current:()=>boolean):Promise<PendingDeliveryReviews>{
 if(!current())return{kind:"scope_changed"};
 if(!uuid(scope.actorId)||!uuid(scope.tenantId))return{kind:"unavailable"};
 try{
  if(await caller.getActor()!==scope.actorId||await caller.getTenant()!==scope.tenantId)return{kind:"refused"};
  if(!current())return{kind:"scope_changed"};
  const reply=await caller.rpc("operations_delivery_reviews_scoped",{p_expected_actor_id:scope.actorId,p_expected_tenant_id:scope.tenantId,p_limit:40});
  if(!current())return{kind:"scope_changed"};
  if(reply.error)return{kind:"unavailable"};
  const e=object(reply.data);
  if(!e||e.actor_id!==scope.actorId||e.tenant_id!==scope.tenantId||!Array.isArray(e.reviews)||typeof e.has_more!=="boolean"
    ||!Number.isSafeInteger(e.unavailable_count)||Number(e.unavailable_count)<0||e.reviews.length+Number(e.unavailable_count)>40)return{kind:"unavailable"};
  const reviews:PendingDeliveryReview[]=[],ids=new Set<string>(),work=new Set<string>();
  for(const value of e.reviews){const r=object(value);
   if(!r||![r.submission_id,r.work_item_id,r.plan_id,r.client_id,r.artifact_version_id,r.submitted_by].every(uuid)
     ||r.reviewer_user_id!==scope.actorId||r.submitted_by===scope.actorId||!Number.isSafeInteger(r.revision_no)||Number(r.revision_no)<1
     ||typeof r.artifact_digest!=="string"||!/^[a-f0-9]{64}$/.test(r.artifact_digest)
     ||!instant(r.submission_updated_at)||!instant(r.work_updated_at)||typeof r.title!=="string"||!r.title.trim()||r.title.length>500
     ||ids.has(r.submission_id as string)||work.has(r.work_item_id as string))return{kind:"unavailable"};
   ids.add(r.submission_id as string);work.add(r.work_item_id as string);
   reviews.push({submission_id:r.submission_id as string,work_item_id:r.work_item_id as string,plan_id:r.plan_id as string,client_id:r.client_id as string,artifact_version_id:r.artifact_version_id as string,artifact_digest:r.artifact_digest,revision_no:Number(r.revision_no),submitted_by:r.submitted_by as string,reviewer_user_id:scope.actorId,submission_updated_at:r.submission_updated_at,work_updated_at:r.work_updated_at,title:r.title});
  }
  if(await caller.getActor()!==scope.actorId||await caller.getTenant()!==scope.tenantId)return{kind:"refused"};
  return current()?{kind:"ready",reviews,unavailableCount:Number(e.unavailable_count),hasMore:e.has_more}:{kind:"scope_changed"};
 }catch{return{kind:current()?"unavailable":"scope_changed"};}
}
