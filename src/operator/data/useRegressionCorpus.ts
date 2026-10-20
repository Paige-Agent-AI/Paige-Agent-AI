import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { IntelligenceRead } from './intelligenceContract';
import { parseRegressionCorpus, type RegressionCorpusCursor, type RegressionCorpusRead } from './regressionCorpusContract';
/** Shares the existing Operator subject/epoch fence and whole-surface refusal. Read only. */
export function useRegressionCorpus(scope: Pick<IntelligenceRead, 'subject' | 'epoch' | 'access'>, refuse: (subject: string | null, epoch: number) => void): RegressionCorpusRead {
  const [selection, setSelection] = useState({ subject: scope.subject, epoch: scope.epoch, cursor: null as RegressionCorpusCursor });
  const cursor = selection.subject === scope.subject && selection.epoch === scope.epoch ? selection.cursor : null;
  const enabled = scope.access === 'allowed';
  const refusal = useRef(refuse); refusal.current = refuse;
  const query = useQuery({ enabled, retry: false, gcTime: 0, refetchOnWindowFocus: false,
    queryKey: ['operator_intelligence', scope.subject, scope.epoch, 'regression_corpus', cursor],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('operator_intelligence_regression_corpus' as never, {
        p_limit: 25, p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null,
      } as never).abortSignal(signal);
      if (error) { if (error.code === '42501') refusal.current(scope.subject, scope.epoch); throw error; }
      return parseRegressionCorpus(data);
    },
  });
  const code = (query.error as { code?: string } | null)?.code;
  return { cursor, pageOlder: next => { if (enabled) setSelection({ subject: scope.subject, epoch: scope.epoch, cursor: next }); },
    page: { data: enabled && !query.isError && !query.isFetching ? query.data : undefined, loading: query.isLoading, fetching: query.isFetching,
      error: query.isError, unavailable: code === 'PGRST202' || code === '42883', updatedAt: query.dataUpdatedAt, refresh: () => { if (enabled) void query.refetch(); } },
  };
}
