import { beforeAll, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import canonical from '@/test/fixtures/canonical-regression-corpus.json';
import { parseRegressionCorpus } from './regressionCorpusContract';
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
it('reads the actual local protected SQL projection and preserves FAIL/PASS/controlled FAIL', async () => {
  const page = await parseRegressionCorpus(canonical);
  expect(page.items[0].history.map(r => r.verdict)).toEqual(['fail', 'pass', 'fail']);
  expect(page.items[0].definition.trajectory.state).toBe('unlinked');
  expect(page.items[0].authenticated_acceptance).toBe('UNVERIFIED');
});
it.each(['contract', 'case_hash', 'evaluator', 'latest', 'cursor', 'duplicate', 'source'])('rejects inconsistent %s provenance', async fault => {
  const page = structuredClone(canonical); const item = page.items[0];
  if (fault === 'contract') page.contract_version = 2;
  if (fault === 'case_hash') item.definition.expected.audit_recorded = false;
  if (fault === 'evaluator') item.history[0].evaluator.hash = '0'.repeat(64);
  if (fault === 'latest') item.latest_corrected_result!.mode = 'historical';
  if (fault === 'cursor') page.next_cursor = { before_at: page.observed_at, before_id: item.case_ref } as never;
  if (fault === 'duplicate') item.history.push(item.history[0]);
  if (fault === 'source') item.history[0].source_hash = '0'.repeat(64);
  await expect(parseRegressionCorpus(page)).rejects.toThrow();
});
it.each(['missing', 'stale', 'partial', 'conflicting', 'unavailable', 'unrelated'])('never accepts a PASS with %s evidence', async state => {
  const page = structuredClone(canonical); page.items[0].history[1].evidence_state = state;
  await expect(parseRegressionCorpus(page)).rejects.toThrow();
});
it('preserves an orphaned result as indeterminate despite recorded successful output', async () => {
  const page = structuredClone(canonical); const row = page.items[0].history[1];
  Object.assign(row, { result_ref: null, verdict: 'indeterminate', evidence_state: 'missing' });
  page.items[0].latest_corrected_result = structuredClone(row);
  const parsed = await parseRegressionCorpus(page); expect(parsed.items[0].latest_corrected_result?.verdict).toBe('indeterminate');
});
it('strips unexpected private fields and refuses private content inside immutable definitions', async () => {
  const page = { ...structuredClone(canonical), raw_prompt: 'PRIVATE' };
  expect(JSON.stringify(await parseRegressionCorpus(page))).not.toContain('PRIVATE');
  Object.assign(page.items[0].definition, { raw_prompt: 'PRIVATE' });
  await expect(parseRegressionCorpus(page)).rejects.toThrow();
});
it('rejects a passed projection with missing output facts and preserves a proven exclusion separately', async () => {
  const page = structuredClone(canonical); Object.assign(page.items[0].history[1].output, { audit_recorded: null });
  await expect(parseRegressionCorpus(page)).rejects.toThrow();
  const excluded = structuredClone(canonical); const row = excluded.items[0].history[1];
  Object.assign(row, { verdict: 'not_applicable', applicability: 'not_applicable' }); excluded.items[0].latest_corrected_result = structuredClone(row);
  expect((await parseRegressionCorpus(excluded)).items[0].latest_corrected_result?.verdict).toBe('not_applicable');
});
