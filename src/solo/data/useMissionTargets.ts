import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mutateMissionTarget, readMissionTargets, readMissionTargetActual, readMissionTargetHistory, readMissionTargetMetric,
  type TargetActual, type TargetCaller, type TargetList, type TargetMutation, type TargetScope } from "../mission-target-client";
import { readTargetAttempt, retainTargetAttempt, settleTargetAttempt, type TargetAttempt } from "../mission-target-recovery";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type View = { stamp: number; offset: number; list: TargetList | { kind: "loading" }; actuals: Record<string, TargetActual>;
  pending: TargetAttempt | null; recoveryUnavailable: boolean; busy: boolean; notice: string | null;
  receipt: Extract<TargetMutation, { kind: "verified" }>["receipt"] | null; railRecorded: boolean };
const empty = (stamp: number): View => ({ stamp, offset: 0, list: { kind: "loading" }, actuals: {}, pending: null,
  recoveryUnavailable: false, busy: false, notice: null, receipt: null, railRecorded: false });
function storage(): StoragePort {
  try { return window.sessionStorage; }
  catch { return { getItem: () => { throw Error("Recovery unavailable"); }, setItem: () => { throw Error("Recovery unavailable"); }, removeItem: () => { throw Error("Recovery unavailable"); } }; }
}
// These failures occur only after the existing target RPC has locked the Mission
// and checked this exact actor/request receipt. Auth/preflight refusals never
// prove an older uncertain request absent and must retain its recovery identity.
const settledRefusals = new Set(["MISSION_REVISION_CONFLICT", "MISSION_CLOSED", "MISSION_TARGET_NOT_FOUND",
  "MISSION_TARGET_REVISION_CONFLICT", "MISSION_TARGET_RETIRED", "MISSION_TARGET_INVALID_TRANSITION",
  "MISSION_TARGET_METRIC_MISMATCH", "ANALYTICS_EVIDENCE_UNAVAILABLE"]);

export function useMissionTargets(actorId: string | null, tenantId: string | null, missionId: string,
  ports?: { caller: TargetCaller; storage: StoragePort }) {
  const caller = ports?.caller ?? supabase as unknown as TargetCaller;
  const [browserStorage] = useState(storage);
  const store = ports?.storage ?? browserStorage;
  const key = `${actorId}:${tenantId}:${missionId}`;
  const identity = useRef({ key, stamp: 0, alive: true });
  if (identity.current.key !== key) identity.current = { key, stamp: identity.current.stamp + 1, alive: true };
  const stamp = identity.current.stamp;
  const reads = useRef(0), flight = useRef<number | null>(null);
  const [saved, setSaved] = useState<View>(() => empty(stamp));
  const capture = useCallback((read?: number): TargetScope | null => {
    if (!actorId || !tenantId) return null;
    const captured = identity.current.stamp;
    return { actorId, tenantId, missionId, current: () => identity.current.alive && identity.current.key === key
      && identity.current.stamp === captured && (read === undefined || reads.current === read) };
  }, [actorId, tenantId, missionId, key]);
  const refresh = useCallback(async (offset = 0) => {
    const sequence = ++reads.current, scope = capture(sequence);
    if (!scope) { setSaved({ ...empty(identity.current.stamp), list: { kind: "refused" } }); return; }
    const list = await readMissionTargets(caller, scope, offset);
    if (!scope.current()) return;
    const recovery = list.kind === "ready" ? readTargetAttempt(store, scope) : { kind: "absent" as const };
    setSaved(previous => ({ ...previous, stamp: identity.current.stamp, offset, list, actuals: {},
      pending: recovery.kind === "retained" ? recovery.attempt : null, recoveryUnavailable: recovery.kind === "unavailable" }));
    if (list.kind !== "ready") return;
    // Four bounded reads at a time, through the existing issuer; no new snapshot
    // store or competing raw metric query. Only the selected page is read.
    for (let start = 0; start < list.targets.length && scope.current(); start += 4) {
      const batch = await Promise.all(list.targets.slice(start, start + 4).map(async target => ({ id: target.id, value: await readMissionTargetActual(caller, scope, target) })));
      if (!scope.current()) return;
      setSaved(previous => ({ ...previous, actuals: { ...previous.actuals, ...Object.fromEntries(batch.map(row => [row.id, row.value])) } }));
    }
  }, [caller, store, capture]);

  useEffect(() => {
    identity.current.alive = true;
    setSaved(empty(identity.current.stamp));
    void refresh();
    return () => { identity.current.alive = false; identity.current.stamp += 1; reads.current += 1; };
  }, [key, refresh]);

  // Expired evidence is removed even when the owner leaves this view open.
  useEffect(() => {
    const targets = saved.list.kind === 'ready' ? saved.list.targets : [];
    const times = Object.entries(saved.actuals).flatMap(([id, row]) => {
      if (row.kind !== 'ready') return [];
      const target = targets.find(t => t.id === id);
      return [Date.parse(row.metric.reference_expires_at), ...(target && target.metric.semantics !== 'event_timestamp_cohort'
        && row.observation.state !== 'unavailable' ? [Date.parse(target.period.end) + 1] : [])];
    });
    if (!times.length) return;
    const delay = Math.max(0, Math.min(...times) - Date.now());
    const timer = window.setTimeout(() => setSaved(previous => ({ ...previous, actuals: Object.fromEntries(Object.entries(previous.actuals)
      .map(([id, row]) => {
        if (row.kind !== 'ready') return [id, row];
        if (Date.parse(row.metric.reference_expires_at) <= Date.now()) return [id, { kind: 'unavailable' }];
        const target = targets.find(t => t.id === id);
        return [id, target && target.metric.semantics !== 'event_timestamp_cohort' && Date.now() > Date.parse(target.period.end)
          ? { ...row, observation: { state: 'unavailable', reason: 'historical_snapshot_unavailable' } } : row];
      })) })), delay);
    return () => window.clearTimeout(timer);
  }, [saved.actuals, saved.list]);

  const run = useCallback(async (attempt: TargetAttempt): Promise<TargetMutation | null> => {
    const scope = capture(); if (!scope || flight.current === identity.current.stamp) return null;
    if (!retainTargetAttempt(store, scope, attempt)) {
      setSaved(previous => ({ ...previous, recoveryUnavailable: true, notice: "Your original request could not be safely retained. No change was sent." })); return null;
    }
    const started = identity.current.stamp; flight.current = started;
    setSaved(previous => ({ ...previous, stamp: started, pending: attempt, busy: true, notice: "Verifying your target change." }));
    const result = await mutateMissionTarget(caller, scope, attempt.tool, attempt.args);
    if (flight.current === started) flight.current = null;
    if (!scope.current()) return result;
    const settled = result.kind === "verified" && result.railRecorded
      || result.kind === "refused" && settledRefusals.has(result.code);
    const cleared = settled && settleTargetAttempt(store, scope, String(attempt.args.request_key));
    setSaved(previous => ({ ...previous, busy: false, pending: cleared ? null : attempt,
      recoveryUnavailable: settled && !cleared,
      receipt: result.kind === "verified" ? result.receipt : previous.receipt,
      railRecorded: result.kind === "verified" && result.railRecorded,
      notice: result.kind === "verified" ? result.railRecorded
        ? "Target revision saved and verified. Activity recorded." : "Target revision saved and verified. Activity still needs confirmation."
        : result.kind === "refused" && settledRefusals.has(result.code)
          ? "This request did not change the target. Review the latest record before trying again."
          : "The original request is not confirmed. Check it again before starting another change." }));
    await refresh();
    return result;
  }, [caller, store, capture, refresh]);

  const view = saved.stamp === stamp ? saved : empty(stamp);
  return { ...view, refresh, run,
    reconcile: () => view.pending ? run(view.pending) : Promise.resolve(null),
    readMetric: (query: Parameters<typeof readMissionTargetMetric>[2]) => {
      const scope = capture(); return scope ? readMissionTargetMetric(caller, scope, query) : Promise.resolve({ kind: "refused" as const });
    },
    history: (targetId: string, offset = 0) => {
      const scope = capture(); return scope ? readMissionTargetHistory(caller, scope, targetId, offset) : Promise.resolve({ kind: "refused" as const });
    },
  };
}
