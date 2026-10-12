/** Drives the existing captured handler and database double with synthetic data only.
 * Output is minimum non-sensitive evidence, never the prompt/response/database payload.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonicalRegressionJson, parseRegressionCase, regressionHash, classifyRegressionResult, regressionGate } from '../../supabase/functions/_shared/eval/regression-case.ts';
import { DETERMINISTIC_SCORERS } from '../../supabase/functions/_shared/eval/scorers.ts';
import * as fake from '../sync-credit-report-data/fake-supabase.mjs';
import { capturedHandler } from '../sync-credit-report-data/stub-serve.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mode = process.env.PAIGE_REGRESSION_MODE;
if (!['historical', 'current', 'reintroduced'].includes(mode)) throw new Error('unsupported_regression_mode');
const definition = parseRegressionCase(JSON.parse(readFileSync(path.join(HERE, 'fixtures/credit-sync-audit-reference.case.v1.json'), 'utf8')));
const fixture = JSON.parse(readFileSync(path.resolve(HERE, '../../', definition.fixture.path), 'utf8'));
if (await regressionHash(fixture) !== definition.fixture.hash) throw new Error('regression_fixture_hash_mismatch');
const evaluator = JSON.parse(readFileSync(path.join(HERE, 'fixtures/offline-write-integrity.evaluator.v1.json'), 'utf8'));
if (await regressionHash(evaluator) !== definition.evaluator.definition_hash) throw new Error('regression_evaluator_hash_mismatch');
const scorerSource = readFileSync(path.resolve(HERE, '../../supabase/functions/_shared/eval/scorers.ts'), 'utf8').replace(/\r\n/g, '\n');
if (createHash('sha256').update(scorerSource).digest('hex') !== evaluator.source_hash) throw new Error('regression_scorer_version_unavailable');
let source = readFileSync(path.resolve(HERE, mode === 'historical' ? 'fixtures/history/sync-credit-report-data.6c76675.ts.fixture' : '../../supabase/functions/sync-credit-report-data/index.ts'), 'utf8').replace(/\r\n/g, '\n');
const baselineHash = createHash('sha256').update(source).digest('hex');
if (mode === 'historical' && baselineHash !== definition.source.faulty_source_hash) throw new Error('historical_source_hash_mismatch');
if (mode === 'reintroduced') {
  const needle = 'disputes_auto_created: results.disputes_auto_created,';
  if (source.split(needle).length !== 2) throw new Error('regression_mutation_anchor_unavailable');
  source = source.replace(needle, 'disputes_auto_created: disputesCreated,');
}
const sourceHash = createHash('sha256').update(source).digest('hex');
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://unit-test.invalid', SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role' })[k] ?? '' } };
let followups = 0;
globalThis.fetch = async url => {
  if (!/^https:\/\/unit-test\.invalid\/functions\/v1\/(auto-stage-disputes|generate-credit-predictions)$/.test(String(url))) throw new Error('offline_network_refused');
  followups++; return new Response('{}', { status: 200 });
};
// The source module calls the existing capture stub, never a server listener.
const previousLog = console.log; console.log = () => {};
const rec = fake.setScenario({ user: { id: fixture.user_id }, db: { profiles: [{ user_id: fixture.user_id, estimated_fico_eq: 600 }] } });
let output;
try {
  const invokedSource = await import('int280:credit-source');
  if (invokedSource.__regression_source_hash !== sourceHash) throw new Error('invoked_source_hash_mismatch');
  const response = await capturedHandler()(new Request('http://local/sync-credit-report-data', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-user-jwt' },
    body: JSON.stringify({ target_user_id: fixture.user_id, report_type: fixture.report_type, scores: fixture.scores }),
  }));
  const audit = fake.db().audit_logs.find(a => a.action === 'chat_report_analyzed');
  output = { http_status: response.status, audit_recorded: Boolean(audit), disputes_auto_created: audit?.data?.disputes_auto_created ?? null };
  if (fake.db().profiles[0]?.estimated_fico_eq !== fixture.scores.equifax) throw new Error('representative_write_not_exercised');
} finally { rec.restore(); console.log = previousLog; }
const score = DETERMINISTIC_SCORERS.exact_match({ output: canonicalRegressionJson(output), expected: canonicalRegressionJson(definition.expected) });
const verdict = classifyRegressionResult(score, 'applicable', 'complete');
const evidence = {
  case_key: definition.case_key, version: definition.version, case_hash: await regressionHash(definition),
  fixture_hash: definition.fixture.hash, evaluator_hash: definition.evaluator.definition_hash,
  source_hash: sourceHash, baseline_source_hash: baselineHash, mode,
  proof_class: 'controlled_offline_real_handler', evidence_state: 'complete', applicability: 'applicable',
  recorded_at: new Date().toISOString(),
  verdict, score: score.score, passed: score.passed, status: score.status,
  output, representative_score_write_observed: true, followups_stubbed: followups,
  production_task_identity: 'unlinked', authenticated_acceptance: 'UNVERIFIED', provider_calls: 0,
};
console.log(JSON.stringify(evidence));
// Negative modes deliberately fail this same mandatory gate. Parent CI must assert exit1.
process.exitCode = regressionGate(verdict) ? 0 : 1;
