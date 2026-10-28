/**
 * Consumer contract for the original reviewed Planning manifest and per-version
 * Operations decisions. No writer, payment calculation or completion authority.
 * The originating native projection must establish access, current scope,
 * latest submission and artifact integrity. This parser cannot establish them.
 */
export type ReviewedDeliveryScope = {
  tenantId:string;clientId:string;termsId:string;signingId:string;signingVersion:number;
  contentSha256:string;sealedSha256:string;
};
type Phase='not_submitted'|'internal_review'|'internal_revision_requested'|'not_released'|'awaiting_client'|'revision_requested'|'accepted';
export type ReviewedDeliveryItem = {
  workItemId:string;phase:Phase;submissionId:string|null;revision:number|null;
  artifactDigest:string|null;releaseId:string|null;decisionAt:string|null;
};
export type ReviewedDeliveryEvidence = {
  state:'unavailable'|'not_linked'|'scope_changed'|'in_progress'|'awaiting_client'|'revision_requested'|'accepted';
  projectId:string|null;total:number|null;accepted:number|null;awaiting:number|null;revisions:number|null;
  items:ReviewedDeliveryItem[];
  /** Acceptance of tracked milestones alone never closes the commercial engagement. */
  engagementCompletion:'not_determined';
};
type RecordValue=Record<string,unknown>;
const record=(v:unknown):v is RecordValue=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const instant=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const unknownResult=(state:ReviewedDeliveryEvidence['state']='unavailable',projectId:string|null=null):ReviewedDeliveryEvidence=>({state,projectId,total:null,accepted:null,awaiting:null,revisions:null,items:[],engagementCompletion:'not_determined'});

function item(value:unknown):ReviewedDeliveryItem|null {
 if(!record(value)||!uuid(value.work_item_id))return null;
 const phase=value.phase;
 if(typeof phase!=='string'||!['not_submitted','internal_review','internal_revision_requested','not_released','awaiting_client','revision_requested','accepted'].includes(phase))return null;
 if(phase==='not_submitted'){
  if(value.submission_id!==null||value.submission_revision!==null||value.artifact_digest!==null||value.release_id!==null||value.decision_at!==null)return null;
  return {workItemId:value.work_item_id,phase,submissionId:null,revision:null,artifactDigest:null,releaseId:null,decisionAt:null};
 }
 if(!uuid(value.submission_id)||!positive(value.submission_revision)||!digest(value.artifact_digest))return null;
 if(phase==='internal_revision_requested'){
  if(value.release_id!==null||!instant(value.decision_at))return null;
 }else if(phase==='internal_review'||phase==='not_released'){
  if(value.release_id!==null||value.decision_at!==null)return null;
 }else if(!uuid(value.release_id)||(phase==='awaiting_client'?value.decision_at!==null:!instant(value.decision_at)))return null;
 return {workItemId:value.work_item_id,phase:phase as Phase,submissionId:value.submission_id,revision:value.submission_revision,
  artifactDigest:value.artifact_digest,releaseId:value.release_id as string|null,decisionAt:value.decision_at as string|null};
}

/** Absent/older/malformed/foreign evidence is unknown, never zero or accepted. */
export function readReviewedDeliveryEvidence(value:unknown,scope:ReviewedDeliveryScope|null):ReviewedDeliveryEvidence {
 if(!scope||!record(value)||value.schema_version!==1||!uuid(scope.tenantId)||!uuid(scope.clientId)||!uuid(scope.termsId)
  ||!uuid(scope.signingId)||!positive(scope.signingVersion)||!digest(scope.contentSha256)||!digest(scope.sealedSha256)
  ||value.tenant_id!==scope.tenantId||value.client_id!==scope.clientId||value.commercial_terms_id!==scope.termsId
  ||value.signing_id!==scope.signingId||value.signing_version!==scope.signingVersion
  ||value.content_sha256!==scope.contentSha256||value.sealed_sha256!==scope.sealedSha256)return unknownResult();
 if(value.state==='unavailable'||value.state==='not_linked')return unknownResult(value.state);
 if(value.state==='scope_changed')return unknownResult('scope_changed',uuid(value.plan_id)?value.plan_id:null);
 if(value.state!=='verified'||value.coverage_complete!==true||value.has_more!==false
  ||!uuid(value.plan_id)||!positive(value.milestone_count)||value.milestone_count>50
  ||!Array.isArray(value.items)||value.items.length!==value.milestone_count)return unknownResult();
 const items:ReviewedDeliveryItem[]=[],workIds=new Set<string>(),submissionIds=new Set<string>(),releaseIds=new Set<string>();
 for(const raw of value.items){
  const parsed=item(raw);
  if(!parsed||workIds.has(parsed.workItemId)||parsed.submissionId&&submissionIds.has(parsed.submissionId)
   ||parsed.releaseId&&releaseIds.has(parsed.releaseId))return unknownResult();
  workIds.add(parsed.workItemId);if(parsed.submissionId)submissionIds.add(parsed.submissionId);if(parsed.releaseId)releaseIds.add(parsed.releaseId);items.push(parsed);
 }
 const accepted=items.filter(i=>i.phase==='accepted').length,awaiting=items.filter(i=>i.phase==='awaiting_client').length,revisions=items.filter(i=>i.phase==='revision_requested'||i.phase==='internal_revision_requested').length;
 return {state:accepted===items.length?'accepted':revisions?'revision_requested':awaiting?'awaiting_client':'in_progress',
  projectId:value.plan_id,total:items.length,accepted,awaiting,revisions,items,engagementCompletion:'not_determined'};
}
