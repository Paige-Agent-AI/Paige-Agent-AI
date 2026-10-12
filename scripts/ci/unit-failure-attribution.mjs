#!/usr/bin/env node
// Additive diagnostic evidence only: the original Vitest exit code remains the gate.
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';

const [input, output] = process.argv.slice(2);
const identity = {
  schema_version: 1,
  executed_sha: process.env.CI_EXECUTED_SHA || null,
  workflow_sha: process.env.GITHUB_SHA || null,
  candidate_sha: process.env.CI_CANDIDATE_SHA || null,
  run_id: process.env.GITHUB_RUN_ID || null,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
};
const countKeys = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests'];
function valid(report) {
  const suiteStatuses = ['passed', 'failed', 'pending'];
  const assertionStatuses = ['passed', 'failed', 'pending', 'skipped', 'todo'];
  const shape = report && typeof report.success === 'boolean'
    && countKeys.every(key => Number.isInteger(report[key]) && report[key] >= 0)
    && (report.numTodoTests === undefined || (Number.isInteger(report.numTodoTests) && report.numTodoTests >= 0))
    && Array.isArray(report.testResults)
    && report.testResults.every(file => typeof file.name === 'string'
      && suiteStatuses.includes(file.status)
      && Array.isArray(file.assertionResults)
      && file.assertionResults.every(test => assertionStatuses.includes(test.status)
        && typeof test.fullName === 'string'
        && (test.failureMessages === undefined || (Array.isArray(test.failureMessages)
          && test.failureMessages.every(message => typeof message === 'string')))));
  if (!shape) return false;
  const counts = { passed: 0, failed: 0, pending: 0, todo: 0 };
  for (const file of report.testResults) {
    for (const test of file.assertionResults) counts[test.status === 'skipped' ? 'pending' : test.status]++;
    if (file.status === 'passed' && file.assertionResults.some(test => test.status === 'failed')) return false;
  }
  if (report.numPassedTests !== counts.passed || report.numFailedTests !== counts.failed
    || report.numPendingTests !== counts.pending || (report.numTodoTests ?? 0) !== counts.todo
    || report.numTotalTests !== counts.passed + counts.failed + counts.pending + counts.todo) return false;
  // Failed imports/setup may have no assertions. They remain valid FAIL evidence;
  // empty or entirely skipped execution can never substantiate PASS.
  if (report.success && (report.testResults.length === 0 || counts.passed === 0
    || counts.failed > 0 || report.testResults.some(file => file.status === 'failed'))) return false;
  return true;
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
  evidence = { ...identity, status: report.numFailedTests > 0 || failures.length > 0 || report.success === false ? 'FAIL' : 'PASS', totals: { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, pending: report.numPendingTests, todo: report.numTodoTests ?? 0 }, failures };
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
