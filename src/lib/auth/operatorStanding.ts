/**
 * THE ONE CLIENT HOME for "is the signed-in person a platform operator, and at which tier".
 *
 * Every client surface that decides anything about operators reads it from here, and here reads
 * it from the one server answer, `operator_standing()` (slice G1). No component keeps a list of
 * operator roles; `lint:operator-roles` fails the build if one reappears outside this file.
 *
 * Two entry points, one RPC:
 * - `fetchOperatorStanding()` for code that is not a component (sign-in routing, the tenant
 *   context's load). It answers once, and says so when it could not answer.
 * - `useOperatorStanding()` for components that gate on it. It carries the protections the
 *   operator guard learned the hard way (§32), unchanged:
 *   - A verdict belongs to a PERSON. It is cached against the uid it was issued for, dropped the
 *     moment the uid changes, and burned on sign-out, so one person's grant can never admit
 *     another (the #546 peer-gate finding).
 *   - A cached "no" is never trusted; a cached "yes" only spares the same person a skeleton
 *     flash while the server is re-asked.
 *   - Every answer carries the generation it was asked in; a reply for an older question is
 *     dropped, because postgrest-js can retry a request past the session that started it.
 *   - A failed read is NOT a denial. It is retried three times, then reported as unverifiable.
 *   - A token refresh for the same person does not re-open the question.
 *
 * The server stays the security boundary. This decides what to paint and where to route.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** An operator tier name, as the server reports it. Which roles are tiers is server data (G1). */
export type OperatorTier = string;

export interface OperatorStanding {
  /** The caller's operator tier, or null when they are not an operator. */
  tier: OperatorTier | null;
  /**
   * The tenant the operator's session is scoped to (profiles.active_tenant_id), or null at rest.
   * Reported for operators only. Until slice A2 it is the session scope, not proof of an audited
   * act-as.
   */
  activeTenantId: string | null;
}

/**
 * The owner tier: the one tier the tenant context calls the platform owner (`isPlatformOwner`).
 * Named once, here, so no surface compares against the role word itself.
 */
export const OWNER_TIER: OperatorTier = "super_admin";

export const isOperator = (s: OperatorStanding | null | undefined): boolean => !!s?.tier;
export const isOwnerTier = (s: OperatorStanding | null | undefined): boolean => s?.tier === OWNER_TIER;

type Row = { tier: string | null; active_tenant_id: string | null };

/** Ask the server once. `null` means the read failed — never read it as "not an operator". */
export async function fetchOperatorStanding(): Promise<OperatorStanding | null> {
  try {
    // supabase.rpc() RESOLVES with {data, error}; it does not reject. The error field is the
    // only failure signal, and a failure must not be mistaken for a "no".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("operator_standing");
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    return { tier: row?.tier ?? null, activeTenantId: row?.active_tenant_id ?? null };
  } catch {
    return null;
  }
}

export type OperatorStandingState =
  /** Nothing has answered yet for the person signed in. Never a denial. */
  | { phase: "resolving"; uid: string | null; standing: OperatorStanding | null }
  | { phase: "signed_out"; uid: null; standing: null }
  /** The server answered for this uid. */
  | { phase: "known"; uid: string; standing: OperatorStanding }
  /** Asked three times and could not get an answer. Say so; do not deny. */
  | { phase: "unverifiable"; uid: string; standing: null };

/**
 * The one remembered answer, keyed to the person it was issued for. Module scope so it survives
 * the remounts it exists to smooth over; in memory only, so it never outlives the tab.
 */
let verified: { uid: string; standing: OperatorStanding } | null = null;

/** Test-only: forget the remembered answer. */
export function resetOperatorStandingCache(): void {
  verified = null;
}

export function useOperatorStanding(): OperatorStandingState {
  const [state, setState] = useState<OperatorStandingState>({ phase: "resolving", uid: null, standing: null });

  useEffect(() => {
    let alive = true;
    /** Which question the answers belong to; a reply for an older generation is dropped. */
    let generation = 0;
    /** Whose answer we hold, so a token refresh is not mistaken for a user swap. */
    let subject: string | null = null;

    const ask = async (gen: number, uid: string) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const standing = await fetchOperatorStanding();
        if (!alive || gen !== generation) return;
        if (standing) {
          verified = { uid, standing };
          setState({ phase: "known", uid, standing });
          return;
        }
        // 400ms, then 800ms: long enough to outlast a refresh blip, short enough that a real
        // operator is not left staring at a skeleton.
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        if (!alive || gen !== generation) return;
      }
      if (alive && gen === generation) setState({ phase: "unverifiable", uid, standing: null });
    };

    const readSession = (uid: string | null) => {
      if (!alive) return;
      if (!uid) {
        // Burn the answer with the session that earned it.
        verified = null;
        subject = null;
        generation += 1;
        setState({ phase: "signed_out", uid: null, standing: null });
        return;
      }
      if (uid === subject) return;
      subject = uid;
      const gen = (generation += 1);
      if (verified && verified.uid !== uid) verified = null;
      // Pre-empt the round-trip only from this person's own remembered YES.
      const remembered = verified?.uid === uid && isOperator(verified.standing) ? verified.standing : null;
      setState(
        remembered
          ? { phase: "known", uid, standing: remembered }
          : { phase: "resolving", uid, standing: null },
      );
      void ask(gen, uid);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => readSession(data.session?.user?.id ?? null))
      .catch(() => {
        if (alive) {
          verified = null;
          setState({ phase: "signed_out", uid: null, standing: null });
        }
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => readSession(session?.user?.id ?? null));
    return () => {
      alive = false;
      generation += 1;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
