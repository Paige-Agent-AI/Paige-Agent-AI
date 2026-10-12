/** Minimum evidence validation for the existing offline gate; does not score or execute. */
import assert from 'node:assert/strict';
export function assertRegressionRecord(record, mode, exitStatus, definition, caseHash) {
 assert.ok(['historical','current','reintroduced'].includes(mode));
 assert.equal(record.case_hash,caseHash); assert.equal(record.case_key,definition.case_key); assert.equal(record.version,definition.version);
 assert.equal(record.fixture_hash,definition.fixture.hash); assert.equal(record.evaluator_hash,definition.evaluator.definition_hash);
 assert.equal(record.mode,mode); assert.equal(record.proof_class,'controlled_offline_real_handler');
 assert.equal(record.evidence_state,'complete'); assert.equal(record.applicability,'applicable');
 assert.equal(record.representative_score_write_observed,true); assert.equal(record.provider_calls,0);
 assert.equal(record.production_task_identity,'unlinked'); assert.equal(record.authenticated_acceptance,'UNVERIFIED');
 assert.equal(record.status,'scored'); assert.match(record.source_hash,/^[0-9a-f]{64}$/); assert.match(record.baseline_source_hash,/^[0-9a-f]{64}$/);
 assert.ok(Number.isFinite(Date.parse(record.recorded_at)),'actual offline observation time required');
 if(mode==='current'){
  assert.equal(exitStatus,0,'current real handler must pass the same required gate'); assert.equal(record.verdict,'pass'); assert.equal(record.passed,true); assert.equal(record.score,1);
  assert.deepEqual(record.output,{http_status:200,audit_recorded:true,disputes_auto_created:0});
 }else{
  assert.equal(exitStatus,1,'historical/reintroduced defects must fail the same required gate'); assert.equal(record.verdict,'fail'); assert.equal(record.passed,false); assert.equal(record.score,0);
  assert.deepEqual(record.output,{http_status:500,audit_recorded:false,disputes_auto_created:null});
 }
}
