/** LOCAL SYNTHETIC adapter for the existing isolated review root. Never a production import. */
import canonical from '@/test/fixtures/canonical-task-scorecard.json';
import corpus from '@/test/fixtures/canonical-regression-corpus.json';
import { summarizeEvaluatorVerdicts } from '../../../../supabase/functions/_shared/eval/trajectory-registry';
const pages = { '1.0.0': structuredClone(canonical.v1), '1.1.0': structuredClone(canonical.v2) };
let serial = 100;
function project(version: keyof typeof pages, run?: string, empty = false, paging = false, before?: string, beforeId?: string) {
  const page = structuredClone(pages[version]);
  if (run) page.items = page.items.filter(i => i.run_ref === run);
  if (empty) page.items = [];
  page.next_cursor = null;
  // Explicit isolated review state: page existing controlled SQL records, never invented task links.
  if (paging && !run) {
    page.items.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.run_ref.localeCompare(a.run_ref));
    if (before && beforeId) page.items = page.items.filter(i => i.created_at < before || (i.created_at === before && i.run_ref < beforeId));
    const more = page.items.length > 1; page.items = page.items.slice(0, 1);
    const last = page.items.at(-1);
    if (more && last) page.next_cursor = { at: last.created_at, id: last.run_ref };
  }
  page.sample = { evaluations: page.items.length, task_subjects: new Set(page.items.map(i => i.work_ref)).size, observations: page.items.filter(i => i.mode === 'observation').length, replays: page.items.filter(i => i.mode === 'replay').length };
  page.criteria = page.items.length ? page.criteria.map(c => ({ ...c, ...summarizeEvaluatorVerdicts(page.items.flatMap(i => i.results.filter(r => r.scorer === c.scorer).map(r => r.verdict)) as Parameters<typeof summarizeEvaluatorVerdicts>[0]) })) : [];
  return page;
}
export const supabase = {
  auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({ error: null }) },
  rpc(name: string, args: Record<string, string> = {}) {
    return { abortSignal: async () => {
      if (name === 'operator_intelligence_regression_corpus') {
        const state = new URLSearchParams(location.search).get('corpusState');
        if (state === 'loading') return new Promise(() => {});
        if (state === 'error' || state === 'interrupted') throw new Error('LOCAL SYNTHETIC interrupted corpus read');
        if (state === 'unavailable') return { data: null, error: { code: 'PGRST202' } };
        if (state === 'denied' || state === 'expired') return { data: null, error: { code: '42501' } };
        const page = structuredClone(corpus);
        if (state === 'empty') page.items = [];
        if (['missing','stale','partial','conflicting','unavailable_evidence','indeterminate'].includes(state ?? '')) {
          const row = page.items[0].history[1]; row.verdict = 'indeterminate'; row.evidence_state = state === 'indeterminate' ? 'partial' : state === 'unavailable_evidence' ? 'unavailable' : state!;
          if (state === 'missing') Object.assign(row, { result_ref: null });
          page.items[0].latest_corrected_result = structuredClone(row);
        }
        return { data: page, error: null };
      }
      const state = new URLSearchParams(location.search).get('scoreState');
      if (state === 'loading' || (name === 'operator_intelligence_evaluate_task' && state === 'pending')) return new Promise(() => {});
      if (state === 'error') throw new Error('LOCAL SYNTHETIC offline fixture');
      if (state === 'unavailable') return { data: null, error: { code: 'PGRST202' } };
      const version = args.p_set_version as keyof typeof pages;
      if (!pages[version]) return { data: null, error: { code: '22023' } };
      if (name === 'operator_intelligence_task_scorecard') return { data: project(version, args.p_run_id, state === 'empty', state === 'paging', args.p_before_at, args.p_before_id), error: null };
      if (name === 'operator_intelligence_evaluate_task') {
        if (state === 'uncertain') throw new Error('LOCAL SYNTHETIC unconfirmed write');
        const prior = Object.values(pages).flatMap(p => p.items).find(i => i.run_ref === args.p_replay_run_id);
        const base = prior ?? pages[version].items.find(i => i.mode === 'observation');
        if (!base || (!prior && args.p_work_id !== base.work_ref)) return { data: null, error: { code: '22023' } };
        const item = { ...structuredClone(base), run_ref: `20000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`, previous_run_ref: prior?.run_ref ?? null, mode: prior ? 'replay' : 'observation', created_at: new Date().toISOString() };
        item.results = pages[version].items.find(i => i.mode === 'observation')!.results.map(r => ({ ...r, result_ref: `30000000-0000-4000-8000-${String(serial++).padStart(12, '0')}` }));
        pages[version].items.unshift(item); return { data: { run_ref: item.run_ref }, error: null };
      }
      return { data: null, error: { code: 'PGRST202' } };
    } };
  },
};
