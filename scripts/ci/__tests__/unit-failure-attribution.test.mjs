import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = new URL('../unit-failure-attribution.mjs', import.meta.url);
const report = (messages = []) => ({ numTotalTests: messages.length || 1, numPassedTests: messages.length ? 0 : 1, numFailedTests: messages.length, numPendingTests: 0, testResults: [{ name: '/repo/src/example.test.ts', status: messages.length ? 'failed' : 'passed', assertionResults: messages.map((message, i) => ({ fullName: `example ${i}`, status: 'failed', failureMessages: [message] })) }] });
async function run(input) {
  const dir = await mkdtemp(join(tmpdir(), 'unit-attribution-'));
  try {
    const source = join(dir, 'input.json');
    const output = join(dir, 'output.json');
    if (input !== undefined) await writeFile(source, typeof input === 'string' ? input : JSON.stringify(input));
    const result = spawnSync(process.execPath, [fileURLToPath(script), source, output], { encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' } });
    return { code: result.status, evidence: JSON.parse(await readFile(output, 'utf8')) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('passing evidence retains identity and totals', async () => {
  const { code, evidence } = await run(report());
  assert.equal(code, 0); assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.sha, 'a'.repeat(40)); assert.equal(evidence.run_id, '123'); assert.equal(evidence.run_attempt, '2');
  assert.equal(evidence.totals.passed, 1); assert.deepEqual(evidence.failures, []);
});
test('network escape is attributed without raw failure payload', async () => {
  const { code, evidence } = await run(report(['UNIT_NETWORK_FORBIDDEN https://secret.example?token=password']));
  assert.equal(code, 0); assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.failures[0].category, 'UNIT_NETWORK_ESCAPE');
  assert.equal(evidence.failures[0].owner, 'Release/CI');
  assert.equal(evidence.failures[0].test_name, 'example 0');
  assert.ok(!JSON.stringify(evidence).includes('password'));
});
test('assertion failure stays unclassified', async () => {
  const { evidence } = await run(report(['expected true to equal false']));
  assert.equal(evidence.failures[0].category, 'TEST_FAILURE_UNCLASSIFIED');
  assert.equal(evidence.failures[0].owner, 'owning test lane');
});
test('mixed failures retain individual ownership', async () => {
  const { evidence } = await run(report(['UNIT_NETWORK_FORBIDDEN', 'assertion failed']));
  assert.deepEqual(evidence.failures.map(f => f.category), ['UNIT_NETWORK_ESCAPE', 'TEST_FAILURE_UNCLASSIFIED']);
});
test('failed setup without assertions never becomes passing evidence', async () => {
  const input = report(); input.testResults[0].status = 'failed';
  const { evidence } = await run(input);
  assert.equal(evidence.status, 'FAIL');
  assert.equal(evidence.failures[0].category, 'TEST_FAILURE_UNCLASSIFIED');
});
for (const [name, input] of [['missing', undefined], ['malformed JSON', '{'], ['malformed structure', {}]]) {
  test(`${name} evidence fails closed`, async () => {
    const { code, evidence } = await run(input);
    assert.notEqual(code, 0); assert.equal(evidence.status, 'EVIDENCE_UNAVAILABLE');
  });
}
