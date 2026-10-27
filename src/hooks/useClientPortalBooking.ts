import { useCallback, useEffect, useRef, useState } from "react";
import { useShellCustomerIdentity } from "@/lib/portal/customerIdentity";
import { createCustomerBooking, reconcileCustomerBooking, type CustomerBookingInput,
  type CustomerBookingReceipt, type CustomerBookingScope } from "@/lib/client-portal-booking";

type Phase = "idle" | "sending" | "checking" | "unverified" | "saved" | "refused" | "storage-unavailable";
type State = { key: string | null; phase: Phase; pending: string | null; booking: CustomerBookingReceipt | null; code: string | null; message: string | null };
const initial = (key: string | null): State => ({ key, phase: "idle", pending: null, booking: null, code: null, message: null });
const requestId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);

/** One nonsecret recovery pointer to ORIGINAL native work, not a local booking
 * record or authority. Persist no bearer, guest details, notes or intake answers.
 * A held pointer is never aged out or discarded to make another create possible.
 */
export const customerBookingRecoveryKey = (actor: string, tenant: string, client: string) =>
  `paige.portal.booking.pending.v1:${actor}:${tenant}:${client}`;

export function useClientPortalBooking() {
  const identity = useShellCustomerIdentity();
  const frame = identity?.viewer === "customer" ? identity.frame : null;
  const actor = frame?.actorId ?? null, tenant = frame?.profile.tenant_id ?? null, client = frame?.profile.id ?? null;
  const key = actor && tenant && client ? customerBookingRecoveryKey(actor, tenant, client) : null;
  const enabled = !!key && identity?.phase === "ready" && !identity.checking;
  const [state, setState] = useState<State>(() => initial(null));
  const life = useRef({ alive: true, key, enabled, generation: 0, busy: false, initialized: false });
  const actual = useRef(state);
  if (life.current.key !== key) life.current = { alive: life.current.alive, key, enabled, generation: life.current.generation + 1, busy: false, initialized: false };
  life.current.enabled = enabled;
  actual.current = state;
  const generation = life.current.generation;
  const current = useCallback(() => life.current.alive && life.current.enabled && life.current.key === key
    && life.current.generation === generation, [key, generation]);
  const scope: CustomerBookingScope | null = actor && tenant && client ? { actorId: actor, tenantId: tenant, clientId: client, current } : null;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const apply = useCallback((value: State) => { actual.current = value; setState(value); }, []);
  const clearPointer = (storageKey: string): boolean => {
    try { localStorage.removeItem(storageKey); return localStorage.getItem(storageKey) === null; } catch { return false; }
  };
  useEffect(() => {
    life.current.alive = true;
    return () => { life.current.alive = false; ++life.current.generation; };
  }, []);
  useEffect(() => {
    if (!key || !enabled || life.current.initialized) return;
    life.current.initialized = true;
    try {
      const pending = localStorage.getItem(key);
      apply(pending === null ? initial(key) : requestId(pending)
        ? { ...initial(key), pending, phase: "unverified" }
        : { ...initial(key), phase: "storage-unavailable" });
    } catch { apply({ ...initial(key), phase: "storage-unavailable" }); }
  }, [key, enabled, apply]);

  const confirm = useCallback(async (input: CustomerBookingInput): Promise<boolean> => {
    const s = scopeRef.current, l = life.current, before = actual.current;
    if (!s || !s.current() || !l.key || before.key !== l.key || l.busy || before.pending || before.phase === "storage-unavailable") return false;
    const storageKey = l.key, marker = crypto.randomUUID();
    try {
      const older = localStorage.getItem(storageKey);
      if (older !== null) {
        apply({ ...initial(storageKey), pending: requestId(older) ? older : null,
          phase: requestId(older) ? "unverified" : "storage-unavailable" }); return false;
      }
      localStorage.setItem(storageKey, marker);
      if (localStorage.getItem(storageKey) !== marker) throw new Error("Recovery pointer unavailable");
    } catch { apply({ ...initial(storageKey), phase: "storage-unavailable" }); return false; }
    l.busy = true;
    apply({ ...initial(storageKey), pending: marker, phase: "sending" });
    const result = await createCustomerBooking(s, marker, input);
    if (!s.current()) {
      l.busy = false;
      if (l === life.current && l.alive) apply({ ...initial(storageKey), pending: marker, phase: "unverified" });
      return false;
    }
    l.busy = false;
    if (result.state === "saved") {
      const cleared = clearPointer(storageKey);
      apply({ ...initial(storageKey), pending: cleared ? null : marker, phase: "saved", booking: result.booking });
      return true;
    }
    if (result.state === "refused") {
      const cleared = clearPointer(storageKey);
      apply({ ...initial(storageKey), pending: cleared ? null : marker, phase: cleared ? "refused" : "unverified", code: result.code, message: result.message });
    } else apply({ ...initial(storageKey), pending: marker, phase: "unverified" });
    return false;
  }, [apply]);
  const reconcile = useCallback(async (): Promise<boolean> => {
    const s = scopeRef.current, l = life.current, before = actual.current;
    if (!s || !s.current() || !l.key || l.busy || before.key !== l.key || !before.pending) return false;
    const marker = before.pending, storageKey = l.key;
    l.busy = true; apply({ ...before, phase: "checking", code: null, message: null });
    const result = await reconcileCustomerBooking(s, marker);
    if (!s.current()) {
      l.busy = false;
      if (l === life.current && l.alive) apply({ ...initial(storageKey), pending: marker, phase: "unverified" });
      return false;
    }
    l.busy = false;
    if (result.state === "saved") {
      const cleared = clearPointer(storageKey);
      apply({ ...initial(storageKey), pending: cleared ? null : marker, phase: "saved", booking: result.booking }); return true;
    }
    apply({ ...initial(storageKey), pending: marker, phase: "unverified" }); return false;
  }, [apply]);
  const resetResult = useCallback(() => {
    const s = scopeRef.current, l = life.current;
    if (s?.current() && !l.busy && !actual.current.pending && l.key && actual.current.phase !== "storage-unavailable") apply(initial(l.key));
  }, [apply]);
  // Hide retired customer data during render, before passive cleanup/effects.
  const shown = enabled && state.key === key ? state : initial(key);
  return { ...shown, scope: enabled ? scope : null, enabled, ready: enabled && state.key === key,
    busy: shown.phase === "sending" || shown.phase === "checking", confirm, reconcile, resetResult };
}
