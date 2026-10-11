import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';
import type { IntelligenceRead } from './intelligenceContract';
import { parseTaskScorecard, type EvaluateTaskRequest, type TaskScorecardCursor, type TaskScorecardRead, type TaskSetVersion } from './taskScorecardContract';

type Scope = Pick<IntelligenceRead, 'subject' | 'epoch' | 'access'>;
/** Existing Operator authority owns the scope. No caller-supplied tenant or client verdict. */
export function useTaskScorecard(scope: Scope, refuse: (subject: string | null, epoch: number) => void): TaskScorecardRead {
  const [selection, setSelection] = useState({ subject: scope.subject, epoch: scope.epoch, version: '1.1.0' as TaskSetVersion, cursor: null as TaskScorecardCursor });
  const [action, setAction] = useState<TaskScorecardRead['action']>({ status: 'idle' });
  const current = useRef(scope); current.current = scope;
  const refusal = useRef(refuse); refusal.current = refuse;
  const sequence = useRef(0); const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const invalidate = useRef(() => { sequence.current++; controller.current?.abort(); locked.current = false; });
  const sameScope = selection.subject === scope.subject && selection.epoch === scope.epoch;
  const version = sameScope ? selection.version : '1.1.0';
  const cursor = sameScope ? selection.cursor : null;
  const enabled = scope.access === 'allowed';
  useEffect(() => {
    const fence = invalidate.current; fence(); setAction({ status: 'idle' });
    setSelection(previous => ({ subject: scope.subject, epoch: scope.epoch, version: previous.subject === scope.subject ? previous.version : '1.1.0', cursor: null }));
    return fence;
  }, [scope.subject, scope.epoch, scope.access]);
  const validScope = () => current.current.subject === scope.subject && current.current.epoch === scope.epoch && current.current.access === 'allowed';
  async function fetchPage(signal: AbortSignal, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc('operator_intelligence_task_scorecard' as never, { p_set_version: version, p_limit: 25, ...args } as never).abortSignal(signal);
    if (error) { if (error.code === '42501') refusal.current(scope.subject, scope.epoch); throw error; }
    return parseTaskScorecard(data, version);
  }
  const query = useQuery({ enabled, retry: false, gcTime: 0, refetchOnWindowFocus: false,
    queryKey: ['operator_intelligence', scope.subject, scope.epoch, 'task_scorecard', version, cursor],
    queryFn: ({ signal }) => fetchPage(signal, { p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null }),
  });
  async function refresh() {
    const ticket = sequence.current;
    const response = await query.refetch();
    // Explicit read reconciliation, never an automatic retry of the write.
    if (!response.isError && validScope() && ticket === sequence.current && !controller.current) {
      locked.current = false; setAction({ status: 'idle' });
    }
  }
  function selectVersion(next: TaskSetVersion) {
    if (locked.current) return;
    sequence.current++; setAction({ status: 'idle' });
    setSelection({ subject: scope.subject, epoch: scope.epoch, version: next, cursor: null });
  }
  function stopWaiting() {
    if (!controller.current) return;
    sequence.current++; controller.current.abort(); controller.current = null;
    setAction({ status: 'unconfirmed', message: 'Stopped waiting. A result may still have been recorded. Refresh recorded evaluations before trying again.' });
  }
  async function evaluate(request: EvaluateTaskRequest) {
    if (!enabled || locked.current || request.version !== version) return;
    const id = request.workId ?? request.replayRunId;
    if (!z.string().uuid().safeParse(id).success) { setAction({ status: 'refused', message: 'A canonical task or evaluation reference is required.' }); return; }
    locked.current = true; const ticket = ++sequence.current; const abort = new AbortController(); controller.current = abort;
    let accepted = false;
    setAction({ status: 'pending', message: 'Evaluating recorded evidence…' });
    try {
      const { data, error } = await supabase.rpc('operator_intelligence_evaluate_task' as never, {
        p_work_id: request.workId ?? null, p_replay_run_id: request.replayRunId ?? null, p_set_version: request.version,
      } as never).abortSignal(abort.signal);
      if (error) throw error;
      accepted = true;
      if (!validScope() || ticket !== sequence.current) return;
      const recorded = z.object({ run_ref: z.string().uuid() }).parse(data);
      const page = await fetchPage(abort.signal, { p_run_id: recorded.run_ref });
      const item = page.items.find(i => i.run_ref === recorded.run_ref);
      if (!item || page.items.length !== 1 || (request.workId ? item.work_ref !== request.workId || item.mode !== 'observation' : item.mode !== 'replay' || item.previous_run_ref !== request.replayRunId)) throw new Error('Evaluation readback mismatch');
      if (!validScope() || ticket !== sequence.current) return;
      locked.current = false; setAction({ status: 'recorded', item, message: item.mode === 'replay'
        ? 'Historical replay recorded. The destination was not reverified.' : 'Evaluation recorded. Task execution was not changed.' });
      void query.refetch();
    } catch (error) {
      if (!validScope() || ticket !== sequence.current) return;
      const code = (error as { code?: string })?.code;
      if (code === '42501') refusal.current(scope.subject, scope.epoch);
      if (!accepted && ['22023', '40001', 'PGRST202', '42883'].includes(code ?? '')) {
        locked.current = false; setAction({ status: 'refused', message: code === '40001' ? 'Evidence changed during observation. Refresh the task before evaluating again.'
          : code === '22023' ? 'The selected task or evaluator version is unavailable. No evaluation was recorded.' : 'The evaluation contract is unavailable. No evaluation was recorded.' });
      } else setAction({ status: 'unconfirmed', message: 'The evaluation result is unconfirmed. Refresh recorded evaluations before trying again; a record may already exist.' });
    } finally { if (ticket === sequence.current) controller.current = null; }
  }
  const code = (query.error as { code?: string })?.code;
  return { version, selectVersion, pageOlder: next => { if (!locked.current) setSelection({ subject: scope.subject, epoch: scope.epoch, version, cursor: next }); }, evaluate, stopWaiting,
    action: enabled && sameScope ? action : { status: 'idle' },
    page: { data: enabled && !query.isError ? query.data : undefined, loading: query.isLoading, fetching: query.isFetching, error: query.isError,
      unavailable: code === 'PGRST202' || code === '42883', updatedAt: query.dataUpdatedAt, refresh: () => { void refresh(); } },
  };
}
