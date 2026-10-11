/** INT-280 AI-3A: metadata inside existing Evals, never execution or publication authority.
 * This first version supports reviewed repository defects with synthetic offline fixtures.
 * Syntax validation is NOT evidence review, source verification or permission to publish.
 * Database publication must match a separately reviewed immutable case/fixture definition.
 */
import { evaluatorVerdict } from './trajectory-registry.ts';
import type { EvaluatorApplicability, EvaluatorEvidenceState, EvaluatorVerdict } from './trajectory-registry.ts';
import type { ScoreResult } from './types.ts';

type Fact = number | boolean | 'complete' | 'partial' | 'failed';
export interface RegressionCaseV1 {
  contract_version: 1;
  case_key: string;
  version: string;
  category: 'write_integrity';
  scope: 'platform_synthetic';
  authority: 'observe_only';
  source: {
    repository: 'Paige-Agent-AI/Paige-Agent-AI'; issue: number; fix_pr: number; review_comment: number;
    faulty_commit: string; fixed_commit: string; merge_commit: string;
    source_path: string; faulty_source_hash: string; fixed_source_hash: string;
  };
  fixture: { kind: 'synthetic_offline'; path: string; hash: string };
  evaluator: { set_id: 'offline-write-integrity'; set_version: '1.0.0'; id: 'exact_match'; version: '1.0.0'; definition_hash: string };
  runner: 'scripts/int280-regression/credit-sync.mjs';
  expected: Record<string, Fact>;
  trajectory: { state: 'unlinked'; reason: 'historical_identity_unavailable' };
}

const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const KEY = /^[a-z][a-z0-9-]{2,79}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SOURCE = /^supabase\/functions\/[a-z0-9-]+\/index\.ts$/;
const FIXTURE = /^scripts\/int280-regression\/fixtures\/[a-z0-9.-]+\.json$/;
const FACTS = new Set(['http_status', 'audit_recorded', 'disputes_auto_created', 'write_failure_reported', 'outcome']);

function invalid(): never { throw new Error('invalid_regression_case'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  return value as Record<string, unknown>;
}
function fields(value: unknown, names: string[]): Record<string, unknown> {
  const o = record(value);
  if (Object.keys(o).length !== names.length || names.some(k => !Object.hasOwn(o, k))) invalid();
  return o;
}
function matches(value: unknown, pattern: RegExp) { if (typeof value !== 'string' || !pattern.test(value)) invalid(); }
function positive(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Reject raw prompts, tenant/actor identifiers and arbitrary payload fields at every level.
 * Only reviewed code provenance and a bounded set of non-sensitive expected facts fit v1.
 * No historical task link can be manufactured by a caller or a close timestamp.
 */
export function parseRegressionCase(value: unknown): Readonly<RegressionCaseV1> {
  const o = fields(value, ['contract_version', 'case_key', 'version', 'category', 'scope', 'authority', 'source', 'fixture', 'evaluator', 'runner', 'expected', 'trajectory']);
  if (o.contract_version !== 1 || o.category !== 'write_integrity' || o.scope !== 'platform_synthetic' || o.authority !== 'observe_only') invalid();
  matches(o.case_key, KEY); matches(o.version, VERSION);
  const s = fields(o.source, ['repository', 'issue', 'fix_pr', 'review_comment', 'faulty_commit', 'fixed_commit', 'merge_commit', 'source_path', 'faulty_source_hash', 'fixed_source_hash']);
  if (s.repository !== 'Paige-Agent-AI/Paige-Agent-AI') invalid();
  for (const k of ['issue', 'fix_pr', 'review_comment']) positive(s[k]);
  for (const k of ['faulty_commit', 'fixed_commit', 'merge_commit']) matches(s[k], SHA);
  for (const k of ['faulty_source_hash', 'fixed_source_hash']) matches(s[k], HASH);
  matches(s.source_path, SOURCE);
  const f = fields(o.fixture, ['kind', 'path', 'hash']);
  if (f.kind !== 'synthetic_offline') invalid(); matches(f.path, FIXTURE); matches(f.hash, HASH);
  const e = fields(o.evaluator, ['set_id', 'set_version', 'id', 'version', 'definition_hash']);
  if (e.set_id !== 'offline-write-integrity' || e.set_version !== '1.0.0' || e.id !== 'exact_match' || e.version !== '1.0.0') invalid();
  matches(e.definition_hash, HASH);
  if (o.runner !== 'scripts/int280-regression/credit-sync.mjs') invalid();
  const facts = record(o.expected);
  if (!Object.keys(facts).length || Object.keys(facts).some(k => !FACTS.has(k))) invalid();
  for (const [key, fact] of Object.entries(facts)) {
    if (key === 'outcome') { if (!['complete', 'partial', 'failed'].includes(fact as string)) invalid(); }
    else if (key === 'audit_recorded' || key === 'write_failure_reported') { if (typeof fact !== 'boolean') invalid(); }
    else if (!Number.isSafeInteger(fact) || (fact as number) < 0 || (fact as number) > 999) invalid();
  }
  const t = fields(o.trajectory, ['state', 'reason']);
  if (t.state !== 'unlinked' || t.reason !== 'historical_identity_unavailable') invalid();
  // Copy before freezing: never mutate the caller's object graph.
  return freeze(JSON.parse(canonicalRegressionJson(o)) as RegressionCaseV1);
}

/** SHA-256 uses this bounded, sorted-key UTF-8 representation. Arrays retain their order.
 * Missing/nonfinite values and dangerous object keys fail instead of disappearing in JSON.
 */
export function canonicalRegressionJson(value: unknown): string {
  function visit(v: unknown, depth: number): unknown {
    if (depth > 12) throw new Error('invalid_regression_json');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string' && v.length <= 4096) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v) && v.length <= 64) return Array.from(v, c => visit(c, depth + 1));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const keys = Object.keys(v).sort();
      if (keys.length > 64 || keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('invalid_regression_json');
      return Object.fromEntries(keys.map(k => [k, visit((v as Record<string, unknown>)[k], depth + 1)]));
    }
    throw new Error('invalid_regression_json');
  }
  const json = JSON.stringify(visit(value, 0));
  if (json.length > 16384) throw new Error('invalid_regression_json');
  return json;
}

export async function regressionHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRegressionJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** Uses existing Eval score output and existing AI-2 four-state verdict semantics.
 * The caller still owes hash/identity/source freshness and applicability verification.
 * No new scorer, judge, router, task executor or publication endpoint exists here.
 */
export function classifyRegressionResult(result: ScoreResult | undefined, applicability: EvaluatorApplicability, evidence: EvaluatorEvidenceState): EvaluatorVerdict {
  const usable = result?.scorer === 'exact_match' && result.scorerKind === 'deterministic' && result.status === 'scored'
    && ((result.score === 1 && result.passed === true) || (result.score === 0 && result.passed === false));
  return evaluatorVerdict(applicability, evidence, usable ? result.score === 1 ? 'met' : 'not_met' : 'unknown');
}

/** Required offline corpus gate: a genuine exclusion remains visible but is not a pass. */
export function regressionGate(verdict: EvaluatorVerdict): boolean { return verdict === 'pass'; }
