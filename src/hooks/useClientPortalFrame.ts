import {useCallback, useEffect, useRef, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {readClientPortalFrame, sameClientPortalFrame, type ClientPortalFrame} from "@/lib/client-portal-frame";

type Phase = "loading" | "ready" | "not-client" | "unavailable" | "error";
type State = {actorId: string | null; phase: Phase; frame: ClientPortalFrame | null; checking: boolean; epoch: number};
type Result = {data: unknown; error: {code?: string} | null};
const initial = (actorId: string | null, epoch = 0): State => ({actorId, phase: actorId ? "loading" : "not-client", frame: null, checking: !!actorId, epoch});
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
      setState({actorId: requestedActor, phase: "unavailable", frame: null, checking: false, epoch: ++l.epoch});
    };
    try {
      const identity = await wait(supabase.auth.getUser(), deadline);
      if (!current()) return;
      if (identity.error) throw new Error("Session could not be checked");
      if (identity.data.user?.id !== requestedActor) {refuse(); return;}
      const result = await wait(supabase.rpc("client_portal_frame" as never) as unknown as PromiseLike<Result>, deadline);
      if (!current()) return;
      if (result.error?.code === "42501") {refuse(); return;}
      if (result.error) throw new Error("Customer view unavailable");
      const frame = result.data === null ? null : readClientPortalFrame(result.data, requestedActor);
      if (result.data !== null && !frame) throw new Error("Invalid customer view");
      const final = await wait(supabase.auth.getUser(), deadline);
      if (!current()) return;
      if (final.error) throw new Error("Session could not be checked");
      if (final.data.user?.id !== requestedActor) {refuse(); return;}
      if (!frame) {
        if (l.frame || requireCustomer) {refuse(); return;}
        setState({actorId: requestedActor, phase: "not-client", frame: null, checking: false, epoch: l.epoch}); return;
      }
      if (!l.frame || !sameClientPortalFrame(l.frame, frame)) ++l.epoch;
      l.frame = frame;
      setState({actorId: requestedActor, phase: "ready", frame, checking: false, epoch: l.epoch});
    } catch {
      if (current()) setState({actorId: requestedActor, phase: "error", frame: l.frame, checking: false, epoch: l.epoch});
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
        setState({actorId: requestedActor, phase: "unavailable", frame: null, checking: false, epoch: ++l.epoch}); return;
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
