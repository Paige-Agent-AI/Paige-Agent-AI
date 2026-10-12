/** Metadata boundary for the existing audited Operator RPC. Never executes or scores a case. */
import { z } from 'zod';
import { parseRegressionCase, regressionHash } from '../../../supabase/functions/_shared/eval/regression-case';
import type { ReadState } from './intelligenceContract';
const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const history = z.object({
  run_ref: uuid, result_ref: uuid.nullable(), mode: z.enum(['historical', 'current', 'reintroduced']), recorded_at: timestamp,
  source_hash: hash, baseline_source_hash: hash, evidence_hash: hash, hash_encoding: z.literal('sha256_postgresql_jsonb_text_utf8'),
  evaluator: z.object({ id: z.literal('offline-write-integrity'), version: z.literal('1.0.0'), hash }),
  verdict: z.enum(['pass', 'fail', 'indeterminate', 'not_applicable']),
  evidence_state: z.enum(['complete', 'missing', 'stale', 'partial', 'conflicting', 'unrelated', 'unavailable']),
  output: z.object({ http_status: z.number().int().min(100).max(599).nullable(), audit_recorded: z.boolean().nullable(), disputes_auto_created: z.literal(0).nullable() }),
  proof_class: z.literal('controlled_offline_real_handler'), applicability: z.enum(['applicable', 'not_applicable', 'unknown']).nullable(),
});
const item = z.object({ case_ref: uuid, case_hash: hash, definition: z.unknown().transform(parseRegressionCase), published_at: timestamp,
  history: z.array(history).max(25), history_limit_reached: z.boolean(), latest_corrected_result: history.nullable(),
  latest_corrected_result_scope: z.literal('returned_history_at_reproduction'), authenticated_acceptance: z.literal('UNVERIFIED'),
  historical_customer_effect: z.literal('UNKNOWN'), source_basis: z.literal('offline_reproduction_not_production_execution'),
});
const page = z.object({ contract_version: z.literal(1), observed_at: timestamp, limit: z.number().int().min(1).max(25),
  items: z.array(item).max(25), next_cursor: z.object({ before_at: timestamp, before_id: uuid }).nullable(),
  collection: z.literal('reviewed_platform_synthetic'), publication: z.literal('reviewed_migration_only'), execution: z.literal('offline_ci_only'),
});
export type RegressionCorpusPage = z.infer<typeof page>;
export type RegressionCorpusCase = RegressionCorpusPage['items'][number];
export type RegressionHistory = RegressionCorpusCase['history'][number];
export type RegressionCorpusCursor = RegressionCorpusPage['next_cursor'];
export type RegressionCorpusRead = { page: ReadState<RegressionCorpusPage>; cursor: RegressionCorpusCursor; pageOlder: (cursor: RegressionCorpusCursor) => void };
/** Verify the server's projection identities, not assistant prose or proximity of timestamps. */
export async function parseRegressionCorpus(value: unknown): Promise<RegressionCorpusPage> {
  const parsed = page.parse(value);
  if (parsed.items.length > parsed.limit || new Set(parsed.items.map(i => i.case_ref)).size !== parsed.items.length) throw new Error('Invalid corpus bounds');
  for (const c of parsed.items) {
    if (await regressionHash(c.definition) !== c.case_hash) throw new Error('Corpus definition hash mismatch');
    const runs = c.history.map(r => r.run_ref); const results = c.history.flatMap(r => r.result_ref ? [r.result_ref] : []);
    if (new Set(runs).size !== runs.length || new Set(results).size !== results.length) throw new Error('Duplicate corpus history');
    for (const r of c.history) {
      if (r.evaluator.hash !== c.definition.evaluator.definition_hash ||
        r.baseline_source_hash !== (r.mode === 'historical' ? c.definition.source.faulty_source_hash : c.definition.source.fixed_source_hash) ||
        (r.mode !== 'reintroduced' && r.source_hash !== r.baseline_source_hash)) throw new Error('Corpus source identity mismatch');
      if ((r.verdict === 'pass' || r.verdict === 'fail') && (r.evidence_state !== 'complete' || r.applicability !== 'applicable' || !r.result_ref))
        throw new Error('Resolved verdict without complete evidence');
      if (r.verdict === 'pass' && Object.entries(c.definition.expected).some(([key, expected]) => r.output[key as keyof typeof r.output] !== expected))
        throw new Error('Passed projection conflicts with expected facts');
      if (!r.result_ref && (r.verdict !== 'indeterminate' || r.evidence_state !== 'missing')) throw new Error('Missing result misclassified');
      if (r.verdict === 'not_applicable' && (r.applicability !== 'not_applicable' || r.evidence_state !== 'complete' || !r.result_ref)) throw new Error('Unsupported exclusion');
    }
    const corrected = c.history.filter(r => r.mode === 'current').sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
    if (c.latest_corrected_result ? !corrected.some(r => r.recorded_at === corrected[0]?.recorded_at && JSON.stringify(r) === JSON.stringify(c.latest_corrected_result)) : corrected.length)
      throw new Error('Unanchored corrected-source result');
  }
  const last = parsed.items[parsed.items.length - 1];
  if (parsed.next_cursor && (!last || parsed.next_cursor.before_id !== last.case_ref || parsed.next_cursor.before_at !== last.published_at)) throw new Error('Unanchored corpus cursor');
  return parsed;
}
