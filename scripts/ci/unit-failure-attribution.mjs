#!/usr/bin/env node
// Additive diagnostic evidence only: the original Vitest exit code remains the gate.
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';

const [input, output] = process.argv.slice(2);
const identity = {
  schema_version: 1,
  sha: process.env.GITHUB_SHA || null,
  run_id: process.env.GITHUB_RUN_ID || null,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
};
const countKeys = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests'];
function valid(report) {
  return report && countKeys.every(key => Number.isInteger(report[key]) && report[key] >= 0)
    && Array.isArray(report.testResults)
    && report.testResults.every(file => typeof file.name === 'string'
      && Array.isArray(file.assertionResults)
      && file.assertionResults.every(test => typeof test.status === 'string'
        && typeof test.fullName === 'string'
        && (test.failureMessages === undefined || (Array.isArray(test.failureMessages)
          && test.failureMessages.every(message => typeof message === 'string')))));
}
function classify(messages) {
  const escaped = messages.some(message => message.includes('UNIT_NETWORK_FORBIDDEN'));
  return { category: escaped ? 'UNIT_NETWORK_ESCAPE' : 'TEST_FAILURE_UNCLASSIFIED', owner: escaped ? 'Release/CI' : 'owning test lane' };
}
let evidence;
try {
  if (!input || !output) throw new Error('arguments');
  const report = JSON.parse(await readFile(input, 'utf8'));
  if (!valid(report)) throw new Error('shape');
  const failures = [];
  for (const file of report.testResults) {
    const failed = file.assertionResults.filter(test => test.status === 'failed');
    for (const test of failed) failures.push({ test_file: relative(process.cwd(), file.name).replaceAll('\\', '/'), test_name: test.fullName, ...classify(test.failureMessages || []) });
    // A suite setup failure may have no assertion entry. Keep it visible and unclassified.
    if (file.status === 'failed' && failed.length === 0) failures.push({ test_file: relative(process.cwd(), file.name).replaceAll('\\', '/'), test_name: null, ...classify(typeof file.message === 'string' ? [file.message] : []) });
  }
  evidence = { ...identity, status: report.numFailedTests > 0 || failures.length > 0 || report.success === false ? 'FAIL' : 'PASS', totals: { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests }, failures };
} catch {
  evidence = { ...identity, status: 'EVIDENCE_UNAVAILABLE', owner: 'Release/CI', totals: null, failures: [] };
  process.exitCode = 1;
}
try {
  if (!output) throw new Error('output');
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
} catch {
  process.stderr.write('Unit failure attribution evidence could not be written.\n');
  process.exitCode = 1;
}
