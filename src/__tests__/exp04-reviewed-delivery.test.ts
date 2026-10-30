import {describe,expect,it} from 'vitest';
import {readReviewedDeliveryEvidence} from '../../supabase/functions/_shared/client-engagement/reviewed-delivery';

const id=(n:number)=>`e4750000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={tenantId:id(1),clientId:id(2),termsId:id(3),signingId:id(4),signingVersion:2,contentSha256:'a'.repeat(64),sealedSha256:'b'.repeat(64)};
const accepted=(n:number)=>({work_item_id:id(n),phase:'accepted',submission_id:id(n+100),submission_revision:1,artifact_digest:'c'.repeat(64),release_id:id(n+200),decision_at:'2026-10-20T12:00:00Z'});
const payload=()=>({schema_version:1,state:'verified',tenant_id:scope.tenantId,client_id:scope.clientId,commercial_terms_id:scope.termsId,signing_id:scope.signingId,signing_version:scope.signingVersion,content_sha256:scope.contentSha256,sealed_sha256:scope.sealedSha256,plan_id:id(5),coverage_complete:true,has_more:false,milestone_count:2,items:[accepted(10),accepted(11)]});

describe('original reviewed delivery evidence — no task/payment or closure inference',()=>{
 it('distinguishes an internal revision request from waiting for internal review or a client decision',()=>{
  const value=payload();Object.assign(value.items[0],{phase:'internal_revision_requested',release_id:null,decision_at:'2026-10-20T11:00:00Z'});
  const result=readReviewedDeliveryEvidence(value,scope);
  expect(result).toMatchObject({state:'revision_requested',accepted:1,revisions:1,engagementCompletion:'not_determined'});
  expect(result.items[0]).toMatchObject({phase:'internal_revision_requested',releaseId:null,decisionAt:'2026-10-20T11:00:00Z'});
 });
 it.each([null,'not-a-date'])('withholds an internal revision request without its actual review time: %j',decision_at=>{
  const value=payload();Object.assign(value.items[0],{phase:'internal_revision_requested',release_id:null,decision_at});
  expect(readReviewedDeliveryEvidence(value,scope).state).toBe('unavailable');
 });
 it('refuses a client release smuggled into an internal revision request',()=>{
  const value=payload();Object.assign(value.items[0],{phase:'internal_revision_requested'});
  expect(readReviewedDeliveryEvidence(value,scope).state).toBe('unavailable');
 });
 it.each([undefined,null,{}, {total:2,done:2}, {paid:true,client_accepted:true}])('withholds acceptance without the original scoped manifest: %j',value=>{
  expect(readReviewedDeliveryEvidence(value,scope)).toMatchObject({state:'unavailable',engagementCompletion:'not_determined',projectId:null});
 });
 it('retains exact original decision references without declaring the engagement complete',()=>{
  const result=readReviewedDeliveryEvidence(payload(),scope);
  expect(result).toMatchObject({state:'accepted',projectId:id(5),total:2,accepted:2,awaiting:0,revisions:0,engagementCompletion:'not_determined'});
  expect(result.items[0]).toMatchObject({workItemId:id(10),submissionId:id(110),releaseId:id(210),revision:1,decisionAt:'2026-10-20T12:00:00Z'});
 });
 it.each(['tenant_id','client_id','commercial_terms_id','signing_id','signing_version','content_sha256','sealed_sha256'])('rejects a mismatched original %s',field=>{
  const value=payload();Object.assign(value,{[field]:field==='signing_version'?3:field.endsWith('sha256')?'d'.repeat(64):id(99)});
  expect(readReviewedDeliveryEvidence(value,scope).state).toBe('unavailable');
 });
 it.each([0,51,1,2.5])('withholds completeness for an invalid or incomplete milestone count %s',milestone_count=>{
  expect(readReviewedDeliveryEvidence({...payload(),milestone_count},scope).state).toBe('unavailable');
 });
 it('does not count the same work item twice',()=>{
  const value=payload();value.items[1].work_item_id=value.items[0].work_item_id;
  expect(readReviewedDeliveryEvidence(value,scope).state).toBe('unavailable');
 });
 it.each([{release_id:null},{decision_at:null},{decision_at:'not a date'},{submission_id:null},{submission_revision:0},{artifact_digest:'invalid'},{phase:'done'}])('refuses unsupported acceptance evidence: %j',patch=>{
  const value=payload();Object.assign(value.items[0],patch);
  expect(readReviewedDeliveryEvidence(value,scope).state).toBe('unavailable');
 });
 it('uses the current submission phase instead of an earlier accepted revision',()=>{
  const value=payload();Object.assign(value.items[1],{phase:'internal_review',submission_revision:2,release_id:null,decision_at:null});
  expect(readReviewedDeliveryEvidence(value,scope)).toMatchObject({state:'in_progress',accepted:1,total:2,engagementCompletion:'not_determined'});
 });
 it('keeps a current client decision pending even when all other records are accepted',()=>{
  const value=payload();Object.assign(value.items[1],{phase:'awaiting_client',decision_at:null});
  expect(readReviewedDeliveryEvidence(value,scope)).toMatchObject({state:'awaiting_client',accepted:1,awaiting:1});
 });
 it('keeps an actual revision request distinct from pending and accepted',()=>{
  const value=payload();Object.assign(value.items[1],{phase:'revision_requested'});
  expect(readReviewedDeliveryEvidence(value,scope)).toMatchObject({state:'revision_requested',accepted:1,revisions:1});
 });
 it('treats missing submission/release as unsubmitted work, never client acceptance',()=>{
  const value=payload();Object.assign(value.items[1],{phase:'not_submitted',submission_id:null,submission_revision:null,artifact_digest:null,release_id:null,decision_at:null});
  expect(readReviewedDeliveryEvidence(value,scope)).toMatchObject({state:'in_progress',accepted:1});
 });
 it.each(['scope_changed','not_linked','unavailable'])('retains explicit native %s without stale counts',state=>{
  const result=readReviewedDeliveryEvidence({...payload(),state},scope);
  expect(result.state).toBe(state);expect(result.items).toEqual([]);expect(result.accepted).toBeNull();expect(result.engagementCompletion).toBe('not_determined');
 });
 it('rejects unsupported source revisions and never trusts a complete aggregate flag',()=>{
  expect(readReviewedDeliveryEvidence({...payload(),schema_version:2,complete:true},scope).state).toBe('unavailable');
 });
 it('rejects a JSON array pretending to be a decision phase',()=>{
  const value=payload();Object.assign(value.items[1],{phase:['accepted']});
  expect(readReviewedDeliveryEvidence(value,scope).state).toBe('unavailable');
 });
 it.each([{coverage_complete:false},{has_more:true}])('withholds an all-accepted claim when source coverage is incomplete: %j',patch=>{
  expect(readReviewedDeliveryEvidence({...payload(),...patch},scope).state).toBe('unavailable');
 });
});
