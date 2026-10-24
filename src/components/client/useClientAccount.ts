import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useShellCustomerIdentity } from "@/lib/portal/customerIdentity";
import { captureClientPortalAuthorization, withClientPortalBusiness } from "@/lib/client-portal-scope";
import { readClientPortalSelfProfile, type ClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

type Draft = {
  first_name: string; last_name: string; phone: string;
  street_address: string; city: string; state: string; zip_code: string;
};
type Outcome = "idle" | "saving" | "invalid" | "conflict" | "unknown" | "saved" | "reconciled";
type Model = {
  phase: "loading" | "ready" | "unavailable" | "multiple_businesses" | "signed_out" | "read_error";
  profile: ClientPortalSelfProfile | null; draft: Draft; outcome: Outcome; notice: string;
};
const emptyDraft = (): Draft => ({ first_name: "", last_name: "", phone: "", street_address: "", city: "", state: "", zip_code: "" });
const fromProfile = (p: ClientPortalSelfProfile): Draft => ({
  first_name: p.first_name ?? "", last_name: p.last_name ?? "", phone: p.phone ?? "",
  street_address: p.street_address ?? "", city: p.city ?? "", state: p.state ?? "", zip_code: p.zip_code ?? "",
});
const initial = (): Model => ({ phase: "loading", profile: null, draft: emptyDraft(), outcome: "idle", notice: "" });
const fields = ["first_name", "last_name", "phone", "street_address", "city", "state", "zip_code"] as const;
/** The address may be cleared: the writer stores '' as NULL (20271102130000 :65-68). Names and phone may not. */
const clearable = new Set<keyof Draft>(["street_address", "city", "state", "zip_code"]);
/** The writer's own caps (20271102130000 :56-58): 500 for the street, 200 for everything else. */
export const CLIENT_ACCOUNT_MAX: Record<keyof Draft, number> = {
  first_name: 200, last_name: 200, phone: 200, street_address: 500, city: 200, state: 200, zip_code: 200,
};
const matches = (p: ClientPortalSelfProfile, draft: Draft) => fields.every(k => (p[k] ?? "") === draft[k].trim());
const dirty = (m: Model) => !!m.profile && fields.some(k => m.draft[k] !== (m.profile![k] ?? ""));
class ReadFailure extends Error {
  constructor(readonly phase: "unavailable" | "multiple_businesses" | "signed_out" | "read_error", readonly conceal = false) { super(phase); }
}

/** Local edit lifetime only. Native Auth, relationship and versioned writer own authority. */
export function useClientAccount() {
  const identity = useShellCustomerIdentity();
  const frame = identity?.viewer === "customer" ? identity.frame : null;
  const wantedActor = frame?.actorId, wantedTenant = frame?.profile.tenant_id, wantedClient = frame?.profile.id;
  const key = identity ? JSON.stringify([identity.viewer,wantedActor,wantedTenant,wantedClient]) : "legacy";
  const enabled = !identity || identity.viewer === "customer" && !!wantedActor && !!wantedTenant && !!wantedClient && identity.phase === "ready" && !identity.checking;
  const origin = useRef({key,enabled,generation:0});
  if (origin.current.key !== key || origin.current.enabled !== enabled) origin.current = {key,enabled,generation:origin.current.generation+1};
  const scopeGeneration = origin.current.generation;
  const applied = useRef(key), shownGeneration = useRef(-1), observedSignedOut = useRef(false);
  const inScope = useCallback(() => origin.current.generation === scopeGeneration && origin.current.enabled
    && applied.current === key && !observedSignedOut.current,[scopeGeneration,key]);
  const inView = () => inScope() && shownGeneration.current === scopeGeneration;
  const [model, setModel] = useState<Model>(initial);
  const latest = useRef(model);
  const actions = useRef<{ load: (reconcile?: boolean) => Promise<void>; save: () => Promise<void>; revalidate: () => void } | null>(null);
  const publish = useCallback((next: Model) => { latest.current = next; setModel(next); }, []);

  useEffect(() => {
    const prior = applied.current === key ? latest.current : null;
    applied.current = key;
    if (!prior) latest.current = initial();
    const preserved = prior?.profile ? {...prior,outcome:prior.outcome === "saving" ? "unknown" as const : prior.outcome} : undefined;
    if (preserved) latest.current = preserved;
    let disposed = false, signedOut = observedSignedOut.current, generation = 0, writing = false;
    let actor: string | null = wantedActor ?? preserved?.profile?.linked_user_id ?? null;
    const commit = (next:Model) => {
      if (disposed || origin.current.generation !== scopeGeneration || applied.current !== key) return;
      shownGeneration.current = scopeGeneration; publish(next);
    };
    let deferredRead: { generation: number; actor: string; preserve?: Model } | null = null;
    const retire = new AbortController();
    const current = (request: number) => !disposed && !signedOut && inScope() && request === generation;
    // Bound local waiting without claiming the server request was cancelled.
    const wait = <T,>(value: PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
      const finish = (fn: () => void) => { clearTimeout(timer); retire.signal.removeEventListener("abort", abort); fn(); };
      const abort = () => finish(() => reject(new Error("retired")));
      const timer = setTimeout(() => finish(() => reject(new Error("timeout"))), 20_000);
      retire.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(value).then(v => finish(() => resolve(v)), error => finish(() => reject(error)));
    });
    const verifiedActor = async (request: number, expected?: string, credential?: string) => {
      const { data: { user }, error } = await wait(credential ? supabase.auth.getUser(credential) : supabase.auth.getUser());
      if (!current(request)) return null;
      if (error?.name === "AuthSessionMissingError" || error?.status === 401) throw new ReadFailure("signed_out");
      if (error) throw new ReadFailure("read_error",true);
      if (!user) throw new ReadFailure("signed_out");
      if (expected && user.id !== expected) throw new ReadFailure("unavailable");
      return user.id;
    };
    const readProfile = async (request: number, expected?: string, tenantId?: string) => {
      const id = await verifiedActor(request, expected ?? wantedActor);
      if (!id || !current(request)) return null;
      actor = id;
      const business = wantedTenant ?? tenantId ?? latest.current.profile?.tenant_id;
      const expectedClient = wantedClient ?? (latest.current.profile?.linked_user_id === id ? latest.current.profile.id : undefined);
      let authorization: string;
      try { authorization = await wait(captureClientPortalAuthorization(supabase.auth,id,() => current(request))); }
      catch { throw new ReadFailure("read_error",true); }
      if (!current(request)) return null;
      let call = business ? supabase.rpc("client_portal_self_profile",{p_tenant_id:business}) : supabase.rpc("client_portal_self_profile");
      if (business) call = withClientPortalBusiness(call,business);
      const result = await wait(call.setHeader("Authorization",authorization));
      if (!current(request)) return null;
      // Original native ambiguity is resolved through the canonical business-choice route, never a guessed fallback.
      if (result.error) throw new ReadFailure(result.error.code !== "42501" ? "read_error"
        : /select an authorized customer relationship/i.test(result.error.message ?? "") ? "multiple_businesses" : "unavailable");
      const row = readClientPortalSelfProfile(result.data, id, business);
      if (!row) throw new ReadFailure(result.data === null ? "unavailable" : "read_error");
      if (expectedClient && row.id !== expectedClient) throw new ReadFailure("unavailable");
      if (!await verifiedActor(request, id) || !current(request)) return null;
      return row;
    };
    const load = async (preserve?: Model, reconcile = false, expected?: string, quiet = false) => {
      if (disposed || signedOut || !inScope() || writing) return;
      // A retryable read failure hides the form without discarding its local draft.
      preserve ??= ["loading", "read_error"].includes(latest.current.phase) && latest.current.profile ? latest.current : undefined;
      const request = ++generation;
      if (!quiet) commit(preserve ? { ...preserve, phase: "loading" } : initial());
      try {
        const p = await readProfile(request, expected);
        if (!p || !current(request)) return;
        // A quiet native refresh must not replace edits made while its read was in flight.
        if (quiet && latest.current.profile?.id === p.id && latest.current.profile.tenant_id === p.tenant_id
          && latest.current.profile.linked_user_id === p.linked_user_id) preserve = latest.current;
        const same = preserve?.profile?.id === p.id && preserve.profile.tenant_id === p.tenant_id
          && preserve.profile.linked_user_id === p.linked_user_id;
        let next: Model = { phase: "ready", profile: p, draft: fromProfile(p), outcome: "idle", notice: "" };
        if (same && preserve) {
          next = { ...next, draft: preserve.draft };
          if (reconcile && matches(p, preserve.draft)) {
            next = { ...next, draft: fromProfile(p), outcome: "reconciled", notice: "Your saved information matches this form." };
          } else if (preserve.outcome === "unknown") {
            next = { ...next, outcome: "unknown", notice: "Check saved information before saving again. Keep a copy or discard your edits if they differ." };
          } else if (preserve.outcome === "conflict" || (dirty(preserve) && preserve.profile!.updated_at !== p.updated_at)) {
            next = { ...next, outcome: "conflict", notice: "Your information changed in another session. Reload saved information before saving again." };
          }
        }
        commit(next);
      } catch (error) {
        if (current(request)) {
          const phase = error instanceof ReadFailure ? error.phase : "read_error";
          // A quiet re-read that fails keeps the form; its next save meets the writer's version check.
          if (quiet && phase === "read_error" && !(error instanceof ReadFailure && error.conceal)) return;
          commit(phase === "read_error" && preserve ? { ...preserve, phase } : { ...initial(), phase });
        }
      }
    };
    const save = async () => {
      const before = latest.current;
      if (disposed || signedOut || !inScope() || writing || before.phase !== "ready" || !before.profile || !dirty(before)
        || ["unknown", "conflict"].includes(before.outcome)) return;
      const patch: Partial<Draft> = {};
      for (const key of fields) {
        if (before.draft[key] === (before.profile[key] ?? "")) continue;
        const value = before.draft[key].trim();
        if (value.length > CLIENT_ACCOUNT_MAX[key]) {
          commit({ ...before, outcome: "invalid", notice: key === "street_address"
            ? "Shorten the street address to 500 characters or fewer."
            : "Shorten that entry to 200 characters or fewer." });
          return;
        }
        if (!value && !clearable.has(key)) {
          commit({ ...before, outcome: "invalid", notice: key === "phone"
            ? "Enter a phone number. To remove a saved number, contact your business."
            : "Enter a first and last name, up to 200 characters each." });
          return;
        }
        patch[key] = value;
      }
      if (!before.profile.updated_at) {
        commit({ ...before, outcome: "conflict", notice: "Reload saved information before making a change." }); return;
      }
      const request = ++generation;
      writing = true;
      let dispatched = false;
      commit({ ...before, outcome: "saving", notice: "Saving your information…" });
      try {
        const id = before.profile.linked_user_id;
        let authorization:string;
        try { authorization = await wait(captureClientPortalAuthorization(supabase.auth,id,() => current(request))); }
        catch { throw new ReadFailure("read_error"); }
        if (!current(request)) return;
        dispatched = true;
        // This deployed native ABI is not yet present in the generated SDK type snapshot.
        const result = await wait(withClientPortalBusiness(supabase.rpc("client_portal_update_self_profile_scoped" as never, {
          p_expected_updated_at: before.profile.updated_at, p_profile: patch, p_tenant_id: before.profile.tenant_id, p_expected_client_id: before.profile.id,
        } as never),before.profile.tenant_id).setHeader("Authorization", authorization)) as { data: unknown; error: { code?: string } | null };
        if (!current(request)) return;
        if (result.error?.code === "42501") throw new ReadFailure("unavailable");
        if (result.error?.code === "40001") {
          commit({ ...before, outcome: "conflict", notice: "Your information changed in another session. Reload saved information before saving again." }); return;
        }
        if (result.error?.code === "22023") {
          commit({ ...before, outcome: "invalid", notice: "Check your name, phone number and address before trying again." }); return;
        }
        if (result.error) throw new Error("unconfirmed");
        const saved = readClientPortalSelfProfile(result.data, id, before.profile.tenant_id);
        if (!saved || saved.id !== before.profile.id || Object.entries(patch).some(([k, v]) => (saved[k as keyof Draft] ?? "") !== v)) throw new Error("unconfirmed");
        const readback = await readProfile(request, id, before.profile.tenant_id);
        if (!current(request) || !readback) return;
        if (readback.id !== saved.id || fields.some(k => readback[k] !== saved[k]) || readback.updated_at !== saved.updated_at) throw new Error("unconfirmed");
        commit({ phase: "ready", profile: readback, draft: fromProfile(readback), outcome: "saved", notice: "Information saved." });
      } catch (error) {
        if (current(request)) {
          if (error instanceof ReadFailure) commit(error.phase === "read_error"
            ? { ...before, phase: "read_error", outcome: dispatched ? "unknown" : "idle" }
            : { ...initial(), phase: error.phase });
          else if (dispatched) commit({ ...before, outcome: "unknown", notice: "We couldn’t confirm the save. Check saved information before making another save." });
          else commit({ ...before, outcome: "invalid", notice: "Your session could not be verified. Try again when connected." });
        }
      } finally {
        writing = false;
        if (deferredRead && !disposed && !signedOut && deferredRead.generation === generation) {
          const next = deferredRead; deferredRead = null; void load(next.preserve, false, next.actor);
        }
      }
    };
    // A preference or sharing write on this page moves clients.updated_at. A clean form re-reads so its
    // version stays current; a dirty form is left alone, and its next save meets the writer's 40001.
    const revalidate = () => {
      const m = latest.current;
      if (!disposed && !signedOut && inScope() && !writing && m.phase === "ready" && m.outcome !== "saving" && !dirty(m)) void load(m, false, undefined, true);
    };
    actions.current = { load: reconcile => load(reconcile ? latest.current : undefined, !!reconcile), save, revalidate };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      const next = session?.user.id ?? null;
      if (observedSignedOut.current && event !== "SIGNED_IN") return;
      if (event === "INITIAL_SESSION" && next && (!actor || next === actor)) return;
      if (event === "SIGNED_OUT" || !next || observedSignedOut.current || actor && next !== actor) {
        signedOut = event === "SIGNED_OUT" || !next; observedSignedOut.current = signedOut;
        generation += 1; actor = next; deferredRead = null;
        ++origin.current.generation; shownGeneration.current = origin.current.generation;
        publish(signedOut ? {...initial(),phase:"signed_out"} : initial());
        return;
      }
      const previous = latest.current;
      const preserve = next === actor && previous.profile?.linked_user_id === next
        ? { ...previous, outcome: writing ? "unknown" as const : previous.outcome } : undefined;
      generation += 1; actor = next; signedOut = false;
      commit(signedOut || !next ? { ...initial(), phase: "signed_out" }
        : preserve ? { ...preserve, phase: "loading" } : initial());
      if (!next || signedOut) { deferredRead = null; return; }
      const scheduled = generation;
      queueMicrotask(() => {
        if (disposed || signedOut || scheduled !== generation) return;
        if (writing) deferredRead = { generation: scheduled, actor: next, preserve };
        else void load(preserve, false, next);
      });
    });
    const focus = () => { if (!disposed && !signedOut && inScope() && !writing) void load(latest.current,false,undefined,true); };
    window.addEventListener("focus", focus);
    if (enabled && !signedOut) void load(preserved);
    return () => {
      disposed = true; generation += 1; deferredRead = null; actions.current = null;
      retire.abort(); subscription.unsubscribe(); window.removeEventListener("focus", focus);
    };
  }, [publish,inScope,key,enabled,scopeGeneration,wantedActor,wantedTenant,wantedClient]);

  const edit = (field: keyof Draft, value: string) => {
    const m = latest.current;
    if (!inView() || m.phase !== "ready" || m.outcome === "saving") return;
    publish({ ...m, draft: { ...m.draft, [field]: value }, outcome: ["unknown", "conflict"].includes(m.outcome) ? m.outcome : "idle", notice: ["unknown", "conflict"].includes(m.outcome) ? m.notice : "" });
  };
  const sameView = applied.current === key;
  const masked = !inScope() || shownGeneration.current !== scopeGeneration;
  const retained = sameView ? latest.current : initial();
  const visible = masked ? {...initial(),phase:observedSignedOut.current ? "signed_out" as const : "loading" as const,
    outcome:retained.outcome === "saving" ? "unknown" as const : retained.outcome} : model;
  return { ...visible,profile:visible.phase === "ready" ? visible.profile : null,
    draft:visible.phase === "ready" ? visible.draft : emptyDraft(),dirty:sameView && dirty(retained),edit,
    save: () => inView() ? actions.current?.save() : undefined,
    reload: (reconcile = false) => inScope() ? actions.current?.load(reconcile) : undefined,
    revalidate: () => inView() ? actions.current?.revalidate() : undefined };

}
