import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readClientPortalSelfProfile, type ClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

type Draft = { first_name: string; last_name: string; phone: string };
type Outcome = "idle" | "saving" | "invalid" | "conflict" | "unknown" | "saved" | "reconciled";
type Model = {
  phase: "loading" | "ready" | "unavailable" | "signed_out" | "read_error";
  profile: ClientPortalSelfProfile | null; draft: Draft; outcome: Outcome; notice: string;
};
const emptyDraft = (): Draft => ({ first_name: "", last_name: "", phone: "" });
const fromProfile = (p: ClientPortalSelfProfile): Draft => ({ first_name: p.first_name ?? "", last_name: p.last_name ?? "", phone: p.phone ?? "" });
const initial = (): Model => ({ phase: "loading", profile: null, draft: emptyDraft(), outcome: "idle", notice: "" });
const fields = ["first_name", "last_name", "phone"] as const;
const matches = (p: ClientPortalSelfProfile, draft: Draft) => fields.every(k => (p[k] ?? "") === draft[k].trim());
const dirty = (m: Model) => !!m.profile && fields.some(k => m.draft[k] !== (m.profile![k] ?? ""));
class ReadFailure extends Error {
  constructor(readonly phase: "unavailable" | "signed_out" | "read_error") { super(phase); }
}

/** Local edit lifetime only. Native Auth, relationship and versioned writer own authority. */
export function useClientAccount() {
  const [model, setModel] = useState<Model>(initial);
  const latest = useRef(model);
  const actions = useRef<{ load: (reconcile?: boolean) => Promise<void>; save: () => Promise<void> } | null>(null);
  const publish = useCallback((next: Model) => { latest.current = next; setModel(next); }, []);

  useEffect(() => {
    let disposed = false, signedOut = false, generation = 0, writing = false;
    let actor: string | null = null;
    let deferredRead: { generation: number; actor: string; preserve?: Model } | null = null;
    const retire = new AbortController();
    const current = (request: number) => !disposed && !signedOut && request === generation;
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
      if (error) throw new ReadFailure("read_error");
      if (!user) throw new ReadFailure("signed_out");
      if (expected && user.id !== expected) throw new ReadFailure("unavailable");
      return user.id;
    };
    const readProfile = async (request: number, expected?: string, tenantId?: string) => {
      const id = await verifiedActor(request, expected);
      if (!id || !current(request)) return null;
      actor = id;
      const result = await wait(tenantId
        ? supabase.rpc("client_portal_self_profile", { p_tenant_id: tenantId })
        : supabase.rpc("client_portal_self_profile"));
      if (!current(request)) return null;
      if (result.error) throw new ReadFailure(result.error.code === "42501" ? "unavailable" : "read_error");
      const row = readClientPortalSelfProfile(result.data, id, tenantId);
      if (!row) throw new ReadFailure(result.data === null ? "unavailable" : "read_error");
      if (!await verifiedActor(request, id) || !current(request)) return null;
      return row;
    };
    const load = async (preserve?: Model, reconcile = false, expected?: string) => {
      if (disposed || signedOut || writing) return;
      // A retryable read failure hides the form without discarding its local draft.
      preserve ??= ["loading", "read_error"].includes(latest.current.phase) && latest.current.profile ? latest.current : undefined;
      const request = ++generation;
      publish(preserve ? { ...preserve, phase: "loading" } : initial());
      try {
        const p = await readProfile(request, expected);
        if (!p || !current(request)) return;
        const same = preserve?.profile?.id === p.id && preserve.profile.tenant_id === p.tenant_id
          && preserve.profile.linked_user_id === p.linked_user_id;
        let next: Model = { phase: "ready", profile: p, draft: fromProfile(p), outcome: "idle", notice: "" };
        if (same && preserve) {
          next = { ...next, draft: preserve.draft };
          if (reconcile && matches(p, preserve.draft)) {
            next = { ...next, draft: fromProfile(p), outcome: "reconciled", notice: "Your saved information matches this form." };
          } else if (preserve.outcome === "unknown") {
            next = { ...next, outcome: "unknown", notice: "Your edits differ from the saved information. Keep a copy or discard your edits before making another save." };
          } else if (preserve.outcome === "conflict" || (dirty(preserve) && preserve.profile!.updated_at !== p.updated_at)) {
            next = { ...next, outcome: "conflict", notice: "Your information changed in another session. Reload saved information before saving again." };
          }
        }
        publish(next);
      } catch (error) {
        if (current(request)) {
          const phase = error instanceof ReadFailure ? error.phase : "read_error";
          publish(phase === "read_error" && preserve ? { ...preserve, phase } : { ...initial(), phase });
        }
      }
    };
    const save = async () => {
      const before = latest.current;
      if (disposed || signedOut || writing || before.phase !== "ready" || !before.profile || !dirty(before)
        || ["unknown", "conflict"].includes(before.outcome)) return;
      const patch: Partial<Draft> = {};
      for (const key of fields) {
        if (before.draft[key] === (before.profile[key] ?? "")) continue;
        const value = before.draft[key].trim();
        if (!value || value.length > 200) {
          publish({ ...before, outcome: "invalid", notice: key === "phone"
            ? "Enter a phone number. To remove a saved number, contact your business."
            : "Enter a first and last name, up to 200 characters each." });
          return;
        }
        patch[key] = value;
      }
      if (!before.profile.updated_at) {
        publish({ ...before, outcome: "conflict", notice: "Reload saved information before making a change." }); return;
      }
      const request = ++generation;
      writing = true;
      let dispatched = false;
      publish({ ...before, outcome: "saving", notice: "Saving your information…" });
      try {
        const session = await wait(supabase.auth.getSession());
        if (!current(request)) return;
        if (session.error) throw new ReadFailure(session.error.status === 401 ? "signed_out" : "read_error");
        const credential = session.data.session?.access_token;
        if (!credential) throw new ReadFailure("signed_out");
        // Request-local credential, verified by Auth and never persisted or logged.
        // Pin the builder header: SDK token acquisition can finish after a scope switch.
        const id = await verifiedActor(request, before.profile.linked_user_id, credential);
        if (!id || !current(request)) return;
        dispatched = true;
        // This deployed native ABI is not yet present in the generated SDK type snapshot.
        const result = await wait(supabase.rpc("client_portal_update_self_profile" as never, {
          p_expected_updated_at: before.profile.updated_at, p_profile: patch, p_tenant_id: before.profile.tenant_id,
        } as never).setHeader("Authorization", `Bearer ${credential}`)) as { data: unknown; error: { code?: string } | null };
        if (!current(request)) return;
        if (result.error?.code === "42501") throw new ReadFailure("unavailable");
        if (result.error?.code === "40001") {
          publish({ ...before, outcome: "conflict", notice: "Your information changed in another session. Reload saved information before saving again." }); return;
        }
        if (result.error?.code === "22023") {
          publish({ ...before, outcome: "invalid", notice: "Check your name and phone number before trying again." }); return;
        }
        if (result.error) throw new Error("unconfirmed");
        const saved = readClientPortalSelfProfile(result.data, id, before.profile.tenant_id);
        if (!saved || saved.id !== before.profile.id || Object.entries(patch).some(([k, v]) => saved[k as keyof Draft] !== v)) throw new Error("unconfirmed");
        const readback = await readProfile(request, id, before.profile.tenant_id);
        if (!current(request) || !readback) return;
        if (readback.id !== saved.id || fields.some(k => readback[k] !== saved[k]) || readback.updated_at !== saved.updated_at) throw new Error("unconfirmed");
        publish({ phase: "ready", profile: readback, draft: fromProfile(readback), outcome: "saved", notice: "Information saved." });
      } catch (error) {
        if (current(request)) {
          if (error instanceof ReadFailure) publish(error.phase === "read_error"
            ? { ...before, phase: "read_error", outcome: dispatched ? "unknown" : "idle" }
            : { ...initial(), phase: error.phase });
          else if (dispatched) publish({ ...before, outcome: "unknown", notice: "We couldn’t confirm the save. Check saved information before making another save." });
          else publish({ ...before, outcome: "invalid", notice: "Your session could not be verified. Try again when connected." });
        }
      } finally {
        writing = false;
        if (deferredRead && !disposed && !signedOut && deferredRead.generation === generation) {
          const next = deferredRead; deferredRead = null; void load(next.preserve, false, next.actor);
        }
      }
    };
    actions.current = { load: reconcile => load(reconcile ? latest.current : undefined, !!reconcile), save };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor) return;
      const previous = latest.current;
      const preserve = next === actor && previous.profile?.linked_user_id === next
        ? { ...previous, outcome: writing ? "unknown" as const : previous.outcome } : undefined;
      generation += 1; actor = next; signedOut = event === "SIGNED_OUT";
      publish(signedOut || !next ? { ...initial(), phase: "signed_out" }
        : preserve ? { ...preserve, phase: "loading" } : initial());
      if (!next || signedOut) { deferredRead = null; return; }
      const scheduled = generation;
      queueMicrotask(() => {
        if (disposed || signedOut || scheduled !== generation) return;
        if (writing) deferredRead = { generation: scheduled, actor: next, preserve };
        else void load(preserve, false, next);
      });
    });
    const focus = () => { if (!disposed && !signedOut && !writing) void load(latest.current); };
    window.addEventListener("focus", focus);
    void load();
    return () => {
      disposed = true; generation += 1; deferredRead = null; actions.current = null;
      retire.abort(); subscription.unsubscribe(); window.removeEventListener("focus", focus);
    };
  }, [publish]);

  const edit = (field: keyof Draft, value: string) => {
    const m = latest.current;
    if (m.phase !== "ready" || m.outcome === "saving") return;
    publish({ ...m, draft: { ...m.draft, [field]: value }, outcome: ["unknown", "conflict"].includes(m.outcome) ? m.outcome : "idle", notice: ["unknown", "conflict"].includes(m.outcome) ? m.notice : "" });
  };
  return { ...model, dirty: dirty(model), edit,
    save: () => actions.current?.save(), reload: (reconcile = false) => actions.current?.load(reconcile) };
}
