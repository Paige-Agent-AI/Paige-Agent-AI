import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { controlOwnerTaskAutomation, readOwnerTaskAutomations, type OwnerTaskCaller,
  type OwnerTaskControl, type OwnerTaskRead, type OwnerTaskReview, type OwnerTaskScope } from "./ownerTaskAutomation";

type Feedback = { result: OwnerTaskControl; action: "arm" | "pause" };
type Snapshot = { key: string; read: OwnerTaskRead; busy: boolean; needsRefresh: boolean; feedback: Feedback | null };
const keyOf = (s: OwnerTaskScope) => JSON.stringify([s.actorId, s.tenantId, s.epoch]);
const same = (a: OwnerTaskScope | null, b: OwnerTaskScope | null) => !!a && !!b && keyOf(a) === keyOf(b);
const caller = supabase as unknown as OwnerTaskCaller;

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
  const [authRevision, setAuthRevision] = useState(0);
  if (identityRef.current !== identity) { identityRef.current = identity; epoch.current++; }
  scopeRef.current = allowed ? { actorId: tenant.activeUserId!, tenantId: tenant.activeTenantId!, epoch: epoch.current } : null;
  const scopeKey = scopeRef.current ? keyOf(scopeRef.current) : `${identity}:${epoch.current}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: "", read: { status: "loading" }, busy: false, needsRefresh: false, feedback: null });
  const snapshotRef = useRef(snapshot);
  const current = useCallback(() => mounted.current ? scopeRef.current : null, []);
  const publish = useCallback((value: Snapshot) => { snapshotRef.current = value; setSnapshot(value); }, []);
  const refresh = useCallback(async () => {
    if (flight.current) return;
    const scope = current(), ticket = ++sequence.current;
    if (!scope) return;
    const key = keyOf(scope);
    publish({ key, read: { status: "loading" }, busy: false, needsRefresh: false, feedback: null });
    let read: OwnerTaskRead;
    try { read = await readOwnerTaskAutomations(scope, caller, current); }
    catch { read = { status: "unavailable" }; }
    if (!same(scope, current()) || ticket !== sequence.current) return;
    publish({ key, read, busy: false, needsRefresh: false, feedback: null });
  }, [current, publish]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Synchronous invalidation; never invoke a Supabase read from its auth callback.
      epoch.current++; scopeRef.current = null; sequence.current++;
      setAuthRevision(n => n + 1);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const generation = epoch, reads = sequence;
    mounted.current = true; flight.current = null;
    scopeRef.current = allowed ? { actorId: tenant.activeUserId!, tenantId: tenant.activeTenantId!, epoch: epoch.current } : null;
    if (scopeRef.current) void refresh();
    else publish({ key: "", read: { status: unresolved ? "loading" : "refused" }, busy: false, needsRefresh: false, feedback: null });
    return () => { mounted.current = false; generation.current++; scopeRef.current = null; reads.current++; };
    // identity and the auth epoch are the complete invalidation boundary. No polling/replay.
  }, [identity, authRevision, allowed, unresolved, tenant.activeUserId, tenant.activeTenantId, refresh, publish]);

  const control = useCallback(async (review: OwnerTaskReview, action: "arm" | "pause"): Promise<OwnerTaskControl> => {
    if (flight.current) return { status: "busy" };
    const scope = current(), before = snapshotRef.current;
    if (!scope || before.key !== keyOf(scope) || before.read.status !== "ready" || before.needsRefresh
      || !before.read.items.includes(review)) return { status: "refused" };
    const token = {}; flight.current = token; sequence.current++;
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
  }, [current, publish]);
  const visible = snapshot.key === scopeKey && allowed ? snapshot : {
    key: scopeKey, read: { status: unresolved ? "loading" : allowed ? "loading" : "refused" } as OwnerTaskRead,
    busy: false, needsRefresh: false, feedback: null,
  };
  return { ...visible, scopeKey, refresh, control };
}
