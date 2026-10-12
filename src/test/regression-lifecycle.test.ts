import { describe,it,expect } from 'vitest';
import { assertRegressionRecord } from '../../scripts/int280-regression/evidence.mjs';
import definition from '../../scripts/int280-regression/fixtures/credit-sync-audit-reference.case.v1.json';
function current(): Record<string,unknown> {return {case_hash:'case-hash',case_key:definition.case_key,version:definition.version,fixture_hash:definition.fixture.hash,evaluator_hash:definition.evaluator.definition_hash,mode:'current',proof_class:'controlled_offline_real_handler',evidence_state:'complete',applicability:'applicable',representative_score_write_observed:true,provider_calls:0,production_task_identity:'unlinked',authenticated_acceptance:'UNVERIFIED',status:'scored',source_hash:'a'.repeat(64),baseline_source_hash:'a'.repeat(64),recorded_at:'2026-10-11T06:00:00Z',verdict:'pass',passed:true,score:1,output:{http_status:200,audit_recorded:true,disputes_auto_created:0}};}
function check(record: Record<string,unknown>,exit=0){return()=>assertRegressionRecord(record,'current',exit,definition,'case-hash');}
describe('offline mandatory gate refuses unavailable or false evidence',()=>{
 it('accepts a complete applicable deterministic record, separately from actual handler execution proof',()=>expect(check(current())).not.toThrow());
 it.each(['missing','stale','partial','conflicting','unrelated','unavailable','unknown'])('does not pass %s evidence',e=>expect(check({...current(),evidence_state:e})).toThrow());
 it.each(['unknown','not_applicable'])('does not pass %s applicability',a=>expect(check({...current(),applicability:a})).toThrow());
 it.each(['needs_config','error','low_confidence','skipped'])('does not pass %s scoring',s=>expect(check({...current(),status:s})).toThrow());
 it.each(['case_hash','fixture_hash','evaluator_hash','case_key','version','source_hash','recorded_at'])('refuses missing %s',key=>{const r=current();delete r[key];expect(check(r)).toThrow();});
 it('refuses HTTP200 without the required audit',()=>expect(check({...current(),output:{http_status:200,audit_recorded:false,disputes_auto_created:0}})).toThrow());
 it('refuses assistant-only success without actual exercised write evidence',()=>expect(check({...current(),representative_score_write_observed:false})).toThrow());
 it('refuses a null score disguised as a pass',()=>expect(check({...current(),score:null})).toThrow());
 it('refuses a failed or interrupted child disguised as a pass',()=>{expect(check(current(),1)).toThrow();expect(check(current(),null as unknown as number)).toThrow();});
 it('refuses a provider call or fabricated production task identity',()=>{expect(check({...current(),provider_calls:1})).toThrow();expect(check({...current(),production_task_identity:'fabricated'})).toThrow();});
});
