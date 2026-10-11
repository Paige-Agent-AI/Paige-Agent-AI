import { describe, expect, it } from 'vitest';
import { canonicalRegressionJson, classifyRegressionResult, parseRegressionCase, regressionHash, regressionGate } from '../../supabase/functions/_shared/eval/regression-case';

const manifest = () => ({
  contract_version: 1, case_key: 'credit-sync-audit-reference', version: '1.0.0', category: 'write_integrity',
  scope: 'platform_synthetic', authority: 'observe_only',
  source: {
    repository: 'Paige-Agent-AI/Paige-Agent-AI', issue: 734, fix_pr: 1917, review_comment: 6101464003,
    faulty_commit: '6c76675dc57d1595ff9160e736a0d3723ac8010e',
    fixed_commit: 'e648864ad9ae277ab24b5f4eb49dd14027aeafea',
    merge_commit: '9512e649ba347bf6335540d38f8bb9d9b0ef0661',
    source_path: 'supabase/functions/sync-credit-report-data/index.ts',
    faulty_source_hash: 'a'.repeat(64), fixed_source_hash: 'b'.repeat(64),
  },
  fixture: { kind: 'synthetic_offline', path: 'scripts/int280-regression/fixtures/credit-sync-audit-reference.v1.json', hash: 'c'.repeat(64) },
  evaluator: { set_id: 'offline-write-integrity', set_version: '1.0.0', id: 'exact_match', version: '1.0.0', definition_hash: 'd'.repeat(64) },
  runner: 'scripts/int280-regression/credit-sync.mjs',
  expected: { http_status: 200, audit_recorded: true, disputes_auto_created: 0 },
  trajectory: { state: 'unlinked', reason: 'historical_identity_unavailable' },
});
const passed = { scorer: 'exact_match', scorerKind: 'deterministic', score: 1, passed: true, status: 'scored' } as const;

describe('immutable regression-case metadata contract', () => {
  it('retains independently referenced lineage, sanitized fixture identity and no invented task', () => {
    const parsed = parseRegressionCase(manifest());
    expect(parsed.source.issue).toBe(734);
    expect(parsed.trajectory.state).toBe('unlinked');
    expect(Object.isFrozen(parsed.expected)).toBe(true);
  });
  it('hashes canonical key order without discarding any semantic value', async () => {
    const value = manifest();
    const reverse = Object.fromEntries(Object.entries(value).reverse());
    expect(await regressionHash(value)).toEqual(await regressionHash(reverse));
    expect(await regressionHash({ ...value, version: '1.0.1' })).not.toEqual(await regressionHash(value));
    expect(canonicalRegressionJson({ b: true, a: 0 })).toBe('{"a":0,"b":true}');
  });
  it.each(['prompt', 'tenant_id', 'actor_id', 'raw_conversation', 'credentials', 'source_payload'])('rejects unexpected customer-content field %s', key => {
    expect(() => parseRegressionCase({ ...manifest(), [key]: 'private' })).toThrow('invalid_regression_case');
  });
  it.each([
    (m: ReturnType<typeof manifest>) => ({ ...m, fixture: { ...m.fixture, kind: 'customer_export' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, fixture: { ...m.fixture, path: '../../secrets.json' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, fixture: { ...m.fixture, hash: 'unknown' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, source: { ...m.source, repository: 'another/private' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, source: { ...m.source, fixed_commit: 'main' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, expected: { ...m.expected, account_number: 'secret' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, trajectory: { state: 'linked', work_ref: 'invented' } }),
    (m: ReturnType<typeof manifest>) => ({ ...m, contract_version: 2 }),
    (m: ReturnType<typeof manifest>) => ({ ...m, evaluator: { ...m.evaluator, id: 'llm_judge' } }),
  ])('fails closed for unsafe, unsupported or incomplete identity', change => {
    expect(() => parseRegressionCase(change(manifest()))).toThrow('invalid_regression_case');
  });
  it.each([undefined, NaN, Infinity, { missing: undefined }, { constructor: true }, Array(1)])('rejects noncanonical JSON %j', value => {
    expect(() => canonicalRegressionJson(value)).toThrow('invalid_regression_json');
  });
  it('does not freeze or rewrite the caller when it returns immutable metadata', () => {
    const value = manifest(); parseRegressionCase(value);
    expect(Object.isFrozen(value.source)).toBe(false);
    value.source.issue = 999;
    expect(value.source.issue).toBe(999);
  });
  it.each([0, 99, 600, 999])('rejects invalid HTTP status %i', http_status => {
    const value = manifest(); value.expected.http_status = http_status;
    expect(() => parseRegressionCase(value)).toThrow('invalid_regression_case');
  });
  it.each([100, 599])('accepts HTTP protocol boundary %i', http_status => {
    const value = manifest(); value.expected.http_status = http_status;
    expect(parseRegressionCase(value).expected.http_status).toBe(http_status);
  });
  it.each([1, 999])('rejects automatic dispute count %i against the frozen §194 rule', disputes_auto_created => {
    const value = manifest(); value.expected.disputes_auto_created = disputes_auto_created;
    expect(() => parseRegressionCase(value)).toThrow('invalid_regression_case');
  });
});

describe('existing Eval score and AI-2 verdict reuse', () => {
  it('accepts only a complete applicable matching deterministic score', () => {
    expect(classifyRegressionResult(passed, 'applicable', 'complete')).toBe('pass');
    expect(classifyRegressionResult({ ...passed, score: 0, passed: false }, 'applicable', 'complete')).toBe('fail');
  });
  it.each(['missing', 'stale', 'partial', 'conflicting', 'unrelated', 'unavailable'] as const)('never passes %s evidence', evidence => {
    expect(classifyRegressionResult(passed, 'applicable', evidence)).toBe('indeterminate');
  });
  it('preserves unsupported/applicability uncertainty and genuine exclusion separately', () => {
    expect(classifyRegressionResult(undefined, 'applicable', 'complete')).toBe('indeterminate');
    expect(classifyRegressionResult({ ...passed, status: 'needs_config', score: null, passed: null }, 'applicable', 'complete')).toBe('indeterminate');
    expect(classifyRegressionResult(passed, 'unknown', 'complete')).toBe('indeterminate');
    expect(classifyRegressionResult(passed, 'not_applicable', 'complete')).toBe('not_applicable');
    expect(classifyRegressionResult({ ...passed, scorer: 'unrecognized' }, 'applicable', 'complete')).toBe('indeterminate');
    expect(classifyRegressionResult({ ...passed, score: 0 }, 'applicable', 'complete')).toBe('indeterminate');
  });
  it.each(['fail', 'indeterminate', 'not_applicable'] as const)('does not let %s satisfy the mandatory regression gate', verdict => {
    expect(regressionGate(verdict)).toBe(false);
  });
});
