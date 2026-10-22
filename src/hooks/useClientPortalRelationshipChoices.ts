import {useCallback, useEffect, useRef, useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {fetchClientPortalRelationshipChoices, type ClientPortalRelationshipChoice} from "@/lib/client-portal-relationships";

type State = {actor: string; phase: "loading" | "ready" | "error"; rows: readonly ClientPortalRelationshipChoice[]; after: string | null; more: boolean; loadingMore: boolean; addedId: string | null};
const empty = (actor: string): State => ({actor, phase: "loading", rows: [], after: null, more: false, loadingMore: false, addedId: null});

/** Ephemeral original-native choices; no membership cache or permission decision. */
export function useClientPortalRelationshipChoices(actor: string) {
  const [state, setState] = useState<State>(() => empty(actor));
  const life = useRef({actor, generation: 0, active: true, controller: null as AbortController | null, state: empty(actor)});
  life.current.actor = actor;
  const read = useCallback(async (append = false) => {
    const l = life.current;
    if (!l.active || l.actor !== actor) return;
    const previous = l.state;
    if (append && (previous.actor !== actor || previous.phase !== "ready" || !previous.more || previous.loadingMore)) return;
    l.controller?.abort();
    const controller = new AbortController(); l.controller = controller;
    const generation = ++l.generation;
    const current = () => l.active && l.actor === actor && l.generation === generation;
    const publish = (next: State) => {if (current()) {l.state = next; setState(next);}};
    publish(append ? {...previous, loadingMore: true, addedId: null} : empty(actor));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const page = await Promise.race([
        fetchClientPortalRelationshipChoices(actor, {signal: controller.signal, after: append ? previous.after : null}),
        new Promise<never>((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(new Error("Read timed out"));}, 20_000);}),
      ]);
      if (!current()) return;
      const rows = append ? [...previous.rows, ...page.relationships] : [...page.relationships];
      if (new Set(rows.map(r => r.tenantId)).size !== rows.length || new Set(rows.map(r => r.clientId)).size !== rows.length) throw new Error("Invalid continuation");
      publish({actor, phase: "ready", rows, after: page.nextAfter, more: page.hasMore, loadingMore: false,
        addedId: append ? page.relationships[0]?.clientId ?? null : null});
    } catch {
      // Withhold even previously loaded choices after a failed/session-changed continuation.
      publish({...empty(actor), phase: "error"});
    } finally {clearTimeout(timer);}
  }, [actor]);
  useEffect(() => {
    const l = life.current; l.active = true; l.state = empty(actor); setState(l.state);
    const {data: {subscription}} = supabase.auth.onAuthStateChange((event, session) => {
      if (!l.active || l.actor !== actor) return;
      if (event === "SIGNED_OUT" || session?.user.id !== actor) {
        ++l.generation; l.controller?.abort(); l.state = {...empty(actor), phase: "error"}; setState(l.state); return;
      }
      queueMicrotask(() => {if (l.active && l.actor === actor) void read();});
    });
    const focus = () => {void read();};
    const resume = (event: PageTransitionEvent) => {if (event.persisted) void read();};
    const visible = () => {if (document.visibilityState === "visible") void read();};
    window.addEventListener("focus", focus); window.addEventListener("pageshow", resume); document.addEventListener("visibilitychange", visible); void read();
    return () => {l.active = false; ++l.generation; l.controller?.abort(); subscription.unsubscribe(); window.removeEventListener("focus", focus); window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", visible);};
  }, [actor, read]);
  return {...(state.actor === actor ? state : empty(actor)), reload: () => read(), loadMore: () => read(true)};
}
