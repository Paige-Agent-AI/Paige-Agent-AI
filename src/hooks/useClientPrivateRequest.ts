import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OwnerActionScope } from "./useClientActionsOwner";
import { parsePrivateRequestHistory, parsePrivateRequestResult, privateHistoryArguments, privateRequestArguments,
  type PrivateHistoryCursor, type PrivateRequestHistory, type PrivateRequestResult, type PrivateRequestScope } from "@/lib/client-private-request";

type Phase = "idle" | "validation" | "preparing" | "checking" | "saved" | "unknown" | "refused" | "error";
type HistoryPhase = "loading" | "ready" | "refused" | "error";
type Words = { title: string; body: string };
type Attempt = { scope: PrivateRequestScope; sent: boolean; busy: boolean; found: boolean };
type Life = { scope: OwnerActionScope; alive: boolean; epoch: number; reads: number; attempt: Attempt | null };
type Draft = { life: Life; phase: Phase; result: PrivateRequestResult | null };
type History = { life: Life; phase: HistoryPhase; data: PrivateRequestHistory | null };
async function bounded<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Read unavailable")), 20_000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Unmounted original-domain consumer. The native APIs enforce authority and
 * save the same private Work; this hook neither shares it nor approves work.
 * A write timeout is unknown, never rejection or an automatic mutation retry.
 */
export function useClientPrivateRequest(scope: OwnerActionScope) {
  const { actor, tenant, contact } = scope;
  const life = useMemo<Life>(() => ({ scope: { actor, tenant, contact }, alive: false, epoch: 0, reads: 0, attempt: null }), [actor, tenant, contact]);
  const active = useRef(life); active.current = life;
  const [draft, setDraft] = useState<Draft>({ life, phase: "idle", result: null });
  const [history, setHistory] = useState<History>({ life, phase: "loading", data: null });
  const current = useCallback((epoch: number) => active.current === life && life.alive && life.epoch === epoch, [life]);
  const put = useCallback((epoch: number, phase: Phase, result: PrivateRequestResult | null = null) => {
    if (current(epoch)) setDraft({ life, phase, result });
  }, [current, life]);
  const refuse = useCallback((epoch: number) => {
    if (!current(epoch)) return;
    ++life.epoch; ++life.reads;
    if (life.attempt) life.attempt.found = false;
    setDraft({ life, phase: "refused", result: null }); setHistory({ life, phase: "refused", data: null });
  }, [current, life]);
  const actualActor = useCallback(async (epoch: number) => {
    const user = await bounded(supabase.auth.getUser());
    if (!current(epoch)) return false;
    if (user.error) throw new Error("Identity unavailable");
    if (user.data.user?.id !== actor) {
      refuse(epoch); return false;
    }
    return true;
  }, [actor, current, refuse]);

  const readHistory = useCallback(async (cursor: PrivateHistoryCursor | null = null) => {
    if (active.current !== life || !life.alive) return;
    const epoch = life.epoch, read = ++life.reads;
    const latest = () => current(epoch) && life.reads === read;
    setHistory({ life, phase: "loading", data: null });
    try {
      const args = privateHistoryArguments(life.scope, cursor);
      if (!await actualActor(epoch) || !latest()) return;
      const response = await bounded(supabase.rpc("list_client_portal_request_drafts", args as never));
      if (!latest()) return;
      if (response.error) { if (response.error.code === "42501") refuse(epoch); else setHistory({ life, phase: "error", data: null }); return; }
      const data = parsePrivateRequestHistory(response.data, life.scope);
      if (!await actualActor(epoch) || !latest()) return;
      setHistory({ life, phase: "ready", data });
    } catch { if (latest()) setHistory({ life, phase: "error", data: null }); }
  }, [actualActor, current, life, refuse]);

  const prepare = useCallback(async (words: Words) => {
    if (active.current !== life || !life.alive || life.attempt) return;
    const epoch = life.epoch;
    let args: ReturnType<typeof privateRequestArguments>, attempt: Attempt;
    try {
      // Reserve synchronously, before the first await. A nonce is correlation,
      // never authority, and it is not regenerated to recover a lost response.
      const requestScope = { ...life.scope, intent: crypto.randomUUID() };
      args = privateRequestArguments(requestScope, words);
      attempt = { scope: requestScope, sent: false, busy: true, found: false }; life.attempt = attempt;
    } catch { put(epoch, "validation"); return; }
    put(epoch, "preparing");
    try {
      if (!await actualActor(epoch) || !current(epoch)) return;
      attempt.sent = true;
      const response = await bounded(supabase.rpc("prepare_client_portal_request", args as never));
      if (!current(epoch)) return;
      if (response.error) { if (response.error.code === "42501") refuse(epoch); else put(epoch, "unknown"); return; }
      const result = parsePrivateRequestResult(response.data, attempt.scope, "preparation");
      if (!await actualActor(epoch) || !current(epoch)) return;
      attempt.found = true; put(epoch, "saved", result);
    } catch { put(epoch, attempt.sent ? "unknown" : "error"); }
    finally {
      attempt.busy = false;
      // No RPC was dispatched, so there is no uncertain native act to recover.
      if (!attempt.sent && life.attempt === attempt) life.attempt = null;
    }
  }, [actualActor, current, life, put, refuse]);

  const checkSaved = useCallback(async (intentId?: string) => {
    if (active.current !== life || !life.alive) return;
    if (!life.attempt) {
      if (!intentId) return;
      // A history selection is only a native read filter, never authority or a
      // replacement for an uncertain request already being reconciled.
      try {
        const requestScope = { ...life.scope, intent: intentId }; privateRequestArguments(requestScope);
        life.attempt = { scope: requestScope, sent: false, busy: false, found: false };
      } catch { put(life.epoch, "validation"); return; }
    } else if (intentId && intentId !== life.attempt.scope.intent) return;
    if (life.attempt.busy) return;
    const attempt = life.attempt, epoch = life.epoch; attempt.busy = true; attempt.found = false; put(epoch, "checking");
    try {
      if (!await actualActor(epoch) || !current(epoch)) return;
      const response = await bounded(supabase.rpc("read_client_portal_request_draft", privateRequestArguments(attempt.scope) as never));
      if (!current(epoch)) return;
      if (response.error) { if (response.error.code === "42501") refuse(epoch); else put(epoch, "unknown"); return; }
      const result = parsePrivateRequestResult(response.data, attempt.scope, "status");
      if (!await actualActor(epoch) || !current(epoch)) return;
      attempt.found = result.found; put(epoch, result.found ? "saved" : "unknown", result);
    } catch { put(epoch, "unknown"); }
    finally { attempt.busy = false; }
  }, [actualActor, current, life, put, refuse]);

  const startAnother = useCallback(() => {
    if (active.current !== life || !life.alive || !life.attempt?.found || life.attempt.busy) return;
    life.attempt = null; put(life.epoch, "idle");
  }, [life, put]);

  useEffect(() => {
    life.alive = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (active.current === life && life.alive && (event === "SIGNED_OUT" || session?.user.id !== actor)) {
        refuse(life.epoch);
      }
    });
    void readHistory();
    return () => { life.alive = false; ++life.epoch; ++life.reads; subscription.unsubscribe(); };
  }, [actor, life, readHistory, refuse]);

  // A render into another relationship hides old data before effects run.
  return { phase: draft.life === life ? draft.phase : "idle" as Phase, result: draft.life === life ? draft.result : null,
    historyPhase: history.life === life ? history.phase : "loading" as HistoryPhase, history: history.life === life ? history.data : null,
    prepare, checkSaved, startAnother, readHistory };
}
