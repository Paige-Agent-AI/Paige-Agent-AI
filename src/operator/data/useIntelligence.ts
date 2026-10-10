import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EvalRun, IntelligenceMetrics, IntelligenceRead, IntelligenceTrace, ReadState, TrajectoryPage, TrajectoryRequest } from "./intelligenceContract";

/** Each identity/authority resolution has its own query keys; no inherited fleet cache. */
export function useIntelligence(): IntelligenceRead {
  const [scope, setScope] = useState<{ subject: string | null; epoch: number; access: IntelligenceRead["access"] }>({ subject: null, epoch: 0, access: "checking" });
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const resolution = useRef(0);
  const current = useRef(scope);
  const cache = useQueryClient();
  const [taskSelection, setTaskSelection] = useState<{ subject: string | null; epoch: number; request: TrajectoryRequest | null; cursor: TrajectoryPage['next_cursor'] } | null>(null);
  const change = useCallback((next: typeof scope) => {
    const previous = current.current;
    current.current = next; setScope(next);
    if (next.access !== "allowed" || next.subject !== previous.subject || next.epoch !== previous.epoch)
      void cache.cancelQueries({ queryKey: ["operator_intelligence", previous.subject, previous.epoch] });
  }, [cache]);
  function refuse(subject: string | null, readEpoch: number) {
    if (current.current.subject !== subject || current.current.epoch !== readEpoch) return;
    resolution.current++;
    change({ subject, epoch: ++epoch.current, access: "denied" });
  }
  useEffect(() => {
    let alive = true;
    const resolve = (subject: string | null) => {
      const ticket = ++resolution.current;
      // Same-user token renewal rechecks authority without destroying session drafts.
      const preserve = subject !== null && current.current.subject === subject && current.current.access === "allowed";
      const readEpoch = preserve ? current.current.epoch : ++epoch.current;
      if (!preserve) {
        change({ subject, epoch: readEpoch, access: subject ? "checking" : "denied" });
      }
      if (!subject) return;
      // Auth callbacks must remain synchronous. Resolve outside the auth lock.
      queueMicrotask(async () => {
        try {
          const { data, error } = await supabase.rpc("is_platform_admin");
          if (alive && ticket === resolution.current) change({ subject, epoch: readEpoch, access: error ? "error" : data === true ? "allowed" : "denied" });
        } catch {
          if (alive && ticket === resolution.current) change({ subject, epoch: readEpoch, access: "error" });
        }
      });
    };
    const start = resolution.current;
    supabase.auth.getSession().then(({ data }) => {
      if (alive && resolution.current === start) resolve(data.session?.user?.id ?? null);
    }).catch(() => { if (alive && resolution.current === start) change({ subject: null, epoch: ++epoch.current, access: "error" }); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) resolve(session?.user?.id ?? null);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [retry, change]);

  const enabled = scope.access === "allowed";
  const options = { enabled, retry: false as const, refetchOnWindowFocus: false, gcTime: 0 };
  const metrics = useQuery({
    ...options, queryKey: ["operator_intelligence", scope.subject, scope.epoch, "metrics"],
    queryFn: async ({ signal }): Promise<IntelligenceMetrics> => {
      const { data, error } = await supabase.rpc("operator_intelligence_metrics" as never, { p_window_days: 30 } as never).abortSignal(signal);
      if (error) { if (error.code === "42501") refuse(scope.subject, scope.epoch); throw error; }
      return (data ?? {}) as IntelligenceMetrics;
    }, refetchInterval: enabled ? 30000 : false,
  });
  const traces = useQuery({
    ...options, queryKey: ["operator_intelligence", scope.subject, scope.epoch, "traces"],
    queryFn: async ({ signal }): Promise<IntelligenceTrace[]> => {
      const { data, error } = await supabase.rpc("operator_intelligence_trace_tail" as never, { p_limit: 50 } as never).abortSignal(signal);
      if (error) { if (error.code === "42501") refuse(scope.subject, scope.epoch); throw error; }
      return (data ?? []) as IntelligenceTrace[];
    },
  });
  const evals = useQuery({
    ...options, queryKey: ["operator_intelligence", scope.subject, scope.epoch, "evals"],
    queryFn: async ({ signal }): Promise<EvalRun[]> => {
      const { data, error } = await supabase.rpc("operator_intelligence_eval_history" as never, { p_limit: 25 } as never).abortSignal(signal);
      if (error) { if (error.code === "42501") refuse(scope.subject, scope.epoch); throw error; }
      return (data ?? []) as EvalRun[];
    },
  });
  const selection = taskSelection?.subject === scope.subject && taskSelection?.epoch === scope.epoch ? taskSelection : null;
  const cursor = selection?.cursor ?? null;
  const request = selection?.request ?? null;
  const readTrajectories = async (signal: AbortSignal, args: Record<string, unknown>): Promise<TrajectoryPage> => {
    const { data, error } = await supabase.rpc("operator_intelligence_trajectories" as never, args as never).abortSignal(signal);
    if (error) { if (error.code === "42501") refuse(scope.subject, scope.epoch); throw error; }
    if (!data || (data as unknown as TrajectoryPage).contract_version !== 1 || !Array.isArray((data as unknown as TrajectoryPage).items)) throw new Error("Unsupported trajectory response");
    return data as unknown as TrajectoryPage;
  };
  const trajectories = useQuery({ ...options,
    queryKey: ["operator_intelligence", scope.subject, scope.epoch, "trajectories", cursor],
    queryFn: ({ signal }) => readTrajectories(signal, { p_limit: 25, p_before_at: cursor?.at ?? null, p_before_id: cursor?.id ?? null }),
  });
  const selectedTrajectory = useQuery({ ...options, enabled: enabled && request !== null,
    queryKey: ["operator_intelligence", scope.subject, scope.epoch, "trajectory", request],
    queryFn: ({ signal }) => readTrajectories(signal, { p_limit: 1, ...request && ('workId' in request ? { p_work_id: request.workId } : { p_trace_id: request.traceId }) }),
  });
  function state<T>(query: { data?: T; isLoading: boolean; isFetching: boolean; isError: boolean; error: unknown; dataUpdatedAt: number; refetch: () => unknown }): ReadState<T> {
    const code = (query.error as { code?: string } | null)?.code;
    return { data: enabled && !query.isError ? query.data : undefined, loading: query.isLoading, fetching: query.isFetching,
      error: query.isError, unavailable: code === "PGRST202" || code === "42883",
      updatedAt: query.dataUpdatedAt, refresh: () => { void query.refetch(); } };
  }
  return { ...scope, retryAccess: () => setRetry((n) => n + 1), metrics: state(metrics), traces: state(traces), evals: state(evals),
    trajectories: state(trajectories), selectedTrajectory: state(selectedTrajectory), trajectoryRequest: request,
    inspectTrajectory: (next) => setTaskSelection({ subject: scope.subject, epoch: scope.epoch, request: next, cursor }),
    pageTrajectories: (next) => setTaskSelection({ subject: scope.subject, epoch: scope.epoch, request: null, cursor: next }),
  };
}
