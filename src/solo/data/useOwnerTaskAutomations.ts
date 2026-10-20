import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { controlOwnerTaskAutomation, readOwnerTaskAutomations, readOwnerTaskHistoryList, readOwnerTaskOutcome, type OwnerTaskCaller,
  type OwnerTaskControl, type OwnerTaskHistoryInvoker, type OwnerTaskHistoryList, type OwnerTaskRead, type OwnerTaskReview, type OwnerTaskScope } from "./ownerTaskAutomation";

type Feedback = { result: OwnerTaskControl; action: "arm" | "pause" };
type Snapshot = { key: string; read: OwnerTaskRead; busy: boolean; needsRefresh: boolean; feedback: Feedback | null };
type HistoryLocator = Readonly<Extract<OwnerTaskHistoryList, { status: "ready" }>["items"][number]>;
type HistoryView = { status: "closed" } | { status: "loading" | "refused" | "unavailable"; processId: string }
  | { status: "ready"; processId: string; list: { items: readonly HistoryLocator[]; hasMore: boolean };
    selected: HistoryLocator | null; outcome: Awaited<ReturnType<typeof readOwnerTaskOutcome>> | { status: "loading" } | null };
type HistorySnapshot = { key: string; view: HistoryView };
const CLOSED_HISTORY: HistoryView = { status: "closed" };
const keyOf = (s: OwnerTaskScope) => JSON.stringify([s.actorId, s.tenantId, s.epoch]);
const same = (a: OwnerTaskScope | null, b: OwnerTaskScope | null) => !!a && !!b && keyOf(a) === keyOf(b);
const caller = supabase as unknown as OwnerTaskCaller;
const historyInvoker = supabase.functions as unknown as OwnerTaskHistoryInvoker;

/** Local interaction fencing only. The existing caller/native writer own authority and persistence. */
export function useOwnerTaskAutomations() {
  const tenant = useTenantContext();
  const { isImpersonating } = useImpersonation();
  const unresolved = tenant.loading || tenant.accountContextLoading || tenant.accountContextStatus === "resolving";
  const allowed = !unresolved && tenant.accountContextStatus === "ready" && !isImpersonating && !!tenant.activeUserId && !!tenant.activeTenantId;
  const identity = JSON.stringify([tenant.activeUserId, tenant.activeTenantId, unresolved, tenant.accountContextStatus, isImpersonating]);
  const identityRef = useRef(identity), epoch = useRef(0), mounted = useRef(false);
  const scopeRef = useRef<OwnerTaskScope | null>(null), sequence = useRef(0);
  const flight = useRef<object | null>(null);
  const historyTicket = useRef(0), historyRef = useRef<HistorySnapshot | null>(null);
  const [authRevision, setAuthRevision] = useState(0);
  if (identityRef.current !== identity) { identityRef.current = identity; epoch.current++; }
  scopeRef.current = allowed ? { actorId: tenant.activeUserId!, tenantId: tenant.activeTenantId!, epoch: epoch.current } : null;
  const scopeKey = scopeRef.current ? keyOf(scopeRef.current) : `${identity}:${epoch.current}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: "", read: { status: "loading" }, busy: false, needsRefresh: false, feedback: null });
  const snapshotRef = useRef(snapshot);
  const [historySnapshot, setHistorySnapshot] = useState<HistorySnapshot>({ key: "", view: CLOSED_HISTORY });
  const current = useCallback(() => mounted.current ? scopeRef.current : null, []);
  const publish = useCallback((value: Snapshot) => { snapshotRef.current = value; setSnapshot(value); }, []);
  const publishHistory = useCallback((value: HistorySnapshot) => {
    Object.freeze(value.view);
    historyRef.current = value; setHistorySnapshot(value);
  }, []);
  const closeHistory = useCallback(() => {
    historyTicket.current++;
    publishHistory({ key: "", view: CLOSED_HISTORY });
  }, [publishHistory]);
  const refresh = useCallback(async () => {
    if (flight.current) return;
    const scope = current(), ticket = ++sequence.current;
    if (!scope) return;
    closeHistory();
    const key = keyOf(scope);
    publish({ key, read: { status: "loading" }, busy: false, needsRefresh: false, feedback: null });
    let read: OwnerTaskRead;
    try { read = await readOwnerTaskAutomations(scope, caller, current); }
    catch { read = { status: "unavailable" }; }
    if (!same(scope, current()) || ticket !== sequence.current) return;
    publish({ key, read, busy: false, needsRefresh: false, feedback: null });
  }, [current, publish, closeHistory]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Synchronous invalidation; never invoke a Supabase read from its auth callback.
      epoch.current++; scopeRef.current = null; sequence.current++;
      historyTicket.current++; historyRef.current = null;
      setAuthRevision(n => n + 1);
    });
    return () => subscription.unsubscribe();
  }, []);
  useLayoutEffect(() => {
    const generation = epoch, reads = sequence, historyReads = historyTicket;
    mounted.current = true; flight.current = null;
    scopeRef.current = allowed ? { actorId: tenant.activeUserId!, tenantId: tenant.activeTenantId!, epoch: epoch.current } : null;
    return () => {
      mounted.current = false; generation.current++; scopeRef.current = null; reads.current++;
      historyReads.current++; historyRef.current = null;
    };
  }, [identity, authRevision, allowed, tenant.activeUserId, tenant.activeTenantId]);
  useEffect(() => {
    if (scopeRef.current) void refresh();
    else publish({ key: "", read: { status: unresolved ? "loading" : "refused" }, busy: false, needsRefresh: false, feedback: null });
    // identity and the auth epoch are the complete invalidation boundary. No polling/replay.
  }, [identity, authRevision, allowed, unresolved, tenant.activeUserId, tenant.activeTenantId, refresh, publish]);

  const openHistory = useCallback(async (review: OwnerTaskReview): Promise<void> => {
    const scope = current(), before = snapshotRef.current;
    if (flight.current || !scope || before.key !== keyOf(scope) || before.read.status !== "ready"
      || before.needsRefresh || !before.read.items.includes(review)
      || review.process.id !== review.id || review.process.tenant_id !== scope.tenantId) return;
    const processId = review.id, key = keyOf(scope), ticket = ++historyTicket.current;
    const stillCurrent = () => ticket === historyTicket.current && same(scope, current()) ? current() : null;
    publishHistory({ key, view: { status: "loading", processId } });
    let read: OwnerTaskHistoryList;
    try { read = await readOwnerTaskHistoryList(scope, processId, caller, stillCurrent); }
    catch { read = { status: "unavailable" }; }
    if (!stillCurrent()) return;
    publishHistory({ key, view: read.status === "ready" ? {
      status: "ready", processId,
      list: Object.freeze({ items: Object.freeze(read.items.map(row => Object.freeze({ ...row }))), hasMore: read.hasMore }),
      selected: null, outcome: null,
    } : { status: read.status, processId } });
  }, [current, publishHistory]);

  const inspectOutcome = useCallback(async (locator: HistoryLocator): Promise<void> => {
    const scope = current(), before = historyRef.current;
    if (flight.current || !scope || !before || before.key !== keyOf(scope) || before.view.status !== "ready"
      || !before.view.list.items.includes(locator)) return;
    const view = before.view, key = before.key;
    const selection = { processId: view.processId, approvalId: locator.approvalId, occurrenceId: locator.occurrenceId };
    const ticket = ++historyTicket.current;
    const stillCurrent = () => ticket === historyTicket.current && same(scope, current()) ? current() : null;
    publishHistory({ key, view: { ...view, selected: locator, outcome: { status: "loading" } } });
    let outcome: Awaited<ReturnType<typeof readOwnerTaskOutcome>>;
    try { outcome = await readOwnerTaskOutcome(scope, selection, caller, historyInvoker, stillCurrent); }
    catch { outcome = { status: "unavailable" }; }
    if (!stillCurrent()) return;
    publishHistory({ key, view: { ...view, selected: locator, outcome } });
  }, [current, publishHistory]);

  const control = useCallback(async (review: OwnerTaskReview, action: "arm" | "pause"): Promise<OwnerTaskControl> => {
    if (flight.current) return { status: "busy" };
    const scope = current(), before = snapshotRef.current;
    if (!scope || before.key !== keyOf(scope) || before.read.status !== "ready" || before.needsRefresh
      || !before.read.items.includes(review)) return { status: "refused" };
    const token = {}; flight.current = token; sequence.current++;
    closeHistory();
    publish({ ...before, busy: true, feedback: null });
    try {
      let result: OwnerTaskControl;
      try { result = await controlOwnerTaskAutomation(scope, review, action, caller, current); }
      catch { result = { status: "unknown" }; }
      if (!same(scope, current()) || flight.current !== token) return { status: "refused" };
      // Never replay and never patch the stored review with an invented version.
      // A deliberate refresh reads canonical configuration before another decision.
      publish({ ...before, read: result.status === "refused" ? { status: "refused" } : before.read,
        busy: false, needsRefresh: true, feedback: { result, action } });
      return result;
    } finally { if (flight.current === token) flight.current = null; }
  }, [current, publish, closeHistory]);
  const visible = snapshot.key === scopeKey && allowed ? snapshot : {
    key: scopeKey, read: { status: unresolved ? "loading" : allowed ? "loading" : "refused" } as OwnerTaskRead,
    busy: false, needsRefresh: false, feedback: null,
  };
  const history = historySnapshot.key === scopeKey && allowed ? historySnapshot.view : CLOSED_HISTORY;
  return { ...visible, scopeKey, refresh, control, history, openHistory, inspectOutcome, closeHistory };
}
