/** CI gate for one independently grounded permanent regression, using existing Evals. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { regressionHash, parseRegressionCase } from '../../supabase/functions/_shared/eval/regression-case.ts';
import { assertRegressionRecord } from './evidence.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const CASE_HASH = 'b05861170c206ba6afae9c0849526bc7348babd715d4cd56d38399c4bc9c7606';
const definition = parseRegressionCase(JSON.parse(readFileSync(path.join(HERE, 'fixtures/credit-sync-audit-reference.case.v1.json'), 'utf8')));
assert.equal(await regressionHash(definition), CASE_HASH, 'released case v1 bytes are immutable; change version, never rewrite history');
const records = [];
for (const mode of ['historical', 'current', 'reintroduced']) {
  const result = spawnSync(process.execPath, ['--import', './scripts/int280-regression/register.mjs', './scripts/int280-regression/credit-sync.mjs'], {
    cwd: ROOT, env: { ...process.env, PAIGE_REGRESSION_MODE: mode }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${mode}: interrupted is not passing evidence`);
  // A startup/import failure must not masquerade as a successfully detected old defect.
  let record;
  try { record = JSON.parse(result.stdout.trim()); } catch { throw new Error(`${mode}: actual handler evidence absent; stderr=${result.stderr.slice(0, 1200)}`); }
  assertRegressionRecord(record, mode, result.status, definition, CASE_HASH);
  records.push(record);
}
assert.equal(records[0].source_hash, definition.source.faulty_source_hash);
assert.equal(records[1].source_hash, records[1].baseline_source_hash);
assert.equal(records[2].baseline_source_hash, records[1].source_hash);
assert.notEqual(records[2].source_hash, records[1].source_hash, 'controlled mutation must change invoked bytes');
const proof = { contract_version: 1, proof_class: 'controlled_offline_regression_lifecycle', case_key: definition.case_key, version: definition.version, case_hash: CASE_HASH,
  historical_fixed_source_matches_current: records[1].source_hash === definition.source.fixed_source_hash,
  records, authenticated_acceptance: 'UNVERIFIED', historical_customer_effect: 'UNKNOWN', production_task_identity: 'unlinked' };
if (process.argv[2]) writeFileSync(path.resolve(process.argv[2]), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
