import {createContext, useCallback, useContext, useEffect, useRef, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {readClientPortalFrame, sameClientPortalFrame, type ClientPortalFrame} from "@/lib/client-portal-frame";
import {fetchWithheldCustomerAccess} from "@/lib/client-portal-access";

/** `paused` / `ended` (E09 Slice 7): the business withheld this person's access. Not a fault. */
type Phase = "loading" | "ready" | "not-client" | "unavailable" | "error" | "paused" | "ended";
/** The business's public presentation only — never the reason, the note, or any id. */
export type WithheldCustomerAccess = {businessName: string; logoUrl: string | null; logoDarkUrl: string | null; since: string | null};
type State = {actorId: string | null; phase: Phase; frame: ClientPortalFrame | null; access: WithheldCustomerAccess | null; checking: boolean; epoch: number};
type Result = {data: unknown; error: {code?: string} | null};
const initial = (actorId: string | null, epoch = 0): State => ({actorId, phase: actorId ? "loading" : "not-client", frame: null, access: null, checking: !!actorId, epoch});
const RETRY_MS = 8_000;
async function wait<T>(value: PromiseLike<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Read timed out");
  let timer: ReturnType<typeof setTimeout>;
  try {return await Promise.race([Promise.resolve(value), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Read timed out")), remaining);
  })]);} finally {clearTimeout(timer!);}
}

/**
 * One native identity/brand/config snapshot plus actual Auth readback. This is
 * ephemeral presentation state, not a second identity or business selector.
 * On transient read failure a prior frame remains retained but UNVERIFIED:
 * the host must conceal/inert its body while retaining same-scope local drafts.
 *
 * When no relationship resolves (a NULL frame, or 42501), the person's own access state is asked
 * BEFORE any refusal or fallback (E09 Slice 7): a business that paused or ended their access is named
 * as such — on first open, mid-session, and on routes that require a customer — rather than reading
 * as "unavailable" or falling through to the platform shell.
 */
export function useClientPortalFrame(actorId: string | null, enabled = true, requireCustomer = false) {
  const requestedActor = enabled ? actorId : null;
  const [state, setState] = useState<State>(() => initial(requestedActor));
  const life = useRef({alive: true, request: 0, epoch: 0, frame: null as ClientPortalFrame | null});
  const reload = useCallback(async () => {
    const l = life.current;
    if (!l.alive) return;
    const request = ++l.request;
    const current = () => l.alive && l.request === request;
    if (!requestedActor) {l.frame = null; setState(initial(null, ++l.epoch)); return;}
    const deadline = Date.now() + 20_000;
    setState(s => s.actorId === requestedActor ? {...s, checking: true} : initial(requestedActor, l.epoch));
    const refuse = () => {
      l.frame = null;
      setState({actorId: requestedActor, phase: "unavailable", frame: null, access: null, checking: false, epoch: ++l.epoch});
    };
    /**
     * Asks once more, on its own short deadline, before an unknown answer is final: one dropped request
     * must not turn a staff member's or a non-customer's /app into "couldn't be checked" (review 7).
     */
    const askAccess = async () => {
      try {return await wait(fetchWithheldCustomerAccess(), deadline);} catch (first) {
        if (!current()) throw first;
        return await wait(fetchWithheldCustomerAccess(), Date.now() + RETRY_MS);
      }
    };
    /** True when the access state was published (paused/ended). Throws when the answer is unknown. */
    const withheld = async (): Promise<boolean> => {
      const access = await askAccess();
      if (!current() || !access) return !current();
      l.frame = null;
      setState({actorId: requestedActor, phase: access.state, frame: null, checking: false, epoch: ++l.epoch,
        access: {businessName: access.businessName, logoUrl: access.logoUrl, logoDarkUrl: access.logoDarkUrl, since: access.since}});
      return true;
    };
    /** Every refusal after a missing relationship first asks whether access was withheld. */
    const refuseUnlessWithheld = async () => {
      let named = false;
      try {named = await withheld();} catch {/* unknown: the refusal below is the safe answer */}
      if (!named && current()) refuse();
    };
    try {
      const identity = await wait(supabase.auth.getUser(), deadline);
      if (!current()) return;
      if (identity.error) throw new Error("Session could not be checked");
      if (identity.data.user?.id !== requestedActor) {refuse(); return;}
      const result = await wait(supabase.rpc("client_portal_frame" as never) as unknown as PromiseLike<Result>, deadline);
      if (!current()) return;
      if (result.error?.code === "42501") {await refuseUnlessWithheld(); return;}
      if (result.error) throw new Error("Customer view unavailable");
      const frame = result.data === null ? null : readClientPortalFrame(result.data, requestedActor);
      if (result.data !== null && !frame) throw new Error("Invalid customer view");
      const final = await wait(supabase.auth.getUser(), deadline);
      if (!current()) return;
      if (final.error) throw new Error("Session could not be checked");
      if (final.data.user?.id !== requestedActor) {refuse(); return;}
      if (!frame) {
        if (l.frame || requireCustomer) {await refuseUnlessWithheld(); return;}
        // An unknown access answer throws to "error" here: never the platform shell on a guess.
        if (await withheld()) return;
        setState({actorId: requestedActor, phase: "not-client", frame: null, access: null, checking: false, epoch: l.epoch}); return;
      }
      if (!l.frame || !sameClientPortalFrame(l.frame, frame)) ++l.epoch;
      l.frame = frame;
      setState({actorId: requestedActor, phase: "ready", frame, access: null, checking: false, epoch: l.epoch});
    } catch {
      if (current()) setState({actorId: requestedActor, phase: "error", frame: l.frame, access: null, checking: false, epoch: l.epoch});
    }
  }, [requestedActor, requireCustomer]);
  useEffect(() => {
    const l = life.current; l.alive = true; l.frame = null; ++l.epoch;
    setState(initial(requestedActor, l.epoch));
    if (!requestedActor) return () => {l.alive = false; ++l.request;};
    const {data: {subscription}} = supabase.auth.onAuthStateChange((event, session) => {
      if (!l.alive) return;
      if (event === "SIGNED_OUT" || session?.user.id !== requestedActor) {
        ++l.request; l.frame = null;
        setState({actorId: requestedActor, phase: "unavailable", frame: null, access: null, checking: false, epoch: ++l.epoch}); return;
      }
      queueMicrotask(() => {if (l.alive) void reload();});
    });
    const focus = () => {void reload();};
    window.addEventListener("focus", focus); void reload();
    return () => {l.alive = false; ++l.request; subscription.unsubscribe(); window.removeEventListener("focus", focus);};
  }, [requestedActor, reload]);
  // Retire the old subject synchronously, before effects or late reads settle.
  const visible = state.actorId === requestedActor ? state : initial(requestedActor, life.current.epoch);
  return {...visible, reload};
}

type FrameValue = ReturnType<typeof useClientPortalFrame>;
const SharedFrame = createContext<{actorId: string; value: FrameValue} | null>(null);
/**
 * One reader per /app page (review 7): CustomerAccessGate owns the read and provides it, so the shell's
 * home and its chat do not each re-run the frame and access calls on every focus.
 */
export const ClientPortalFrameProvider = SharedFrame.Provider;
/**
 * The gate's reading when it is for this same person and nothing narrower is asked; otherwise this
 * component's own reader (staff viewing as a client, a route that requires a customer, no gate).
 */
export function useSharedClientPortalFrame(actorId: string | null, enabled = true): FrameValue {
  const shared = useContext(SharedFrame);
  const use = !!shared && enabled && !!actorId && shared.actorId === actorId;
  const own = useClientPortalFrame(actorId, enabled && !use);
  return use ? shared!.value : own;
}
