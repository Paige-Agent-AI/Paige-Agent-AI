import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  preferenceRefusal,
  readClientPortalPreferences,
  type ClientPortalPreferences,
  type PreferenceRefusal,
} from "@/lib/client-portal-preferences";

/**
 * E09 Slice 6 — the signed-in customer's messaging preferences and data-sharing choice for their
 * business, on Your account.
 *
 * Reads go through client_portal_communication_preferences(); the writers are
 * client_portal_set_communication_preference() and client_portal_set_shared_context_consent(). All
 * three resolve the customer relationship from the auth subject server-side (§9): no contact id or
 * address ever leaves this page, so nothing here can point a write at another person.
 *
 * A change is reported only after a FRESH read shows it (§70.1). The writer's acknowledgement is
 * never painted on its own: after every attempt — saved, refused or unknown — the page re-reads and
 * repaints from what the server now says. A refusal is named; an answer that cannot be confirmed says
 * so instead of claiming success.
 *
 * The first read pins the business; every later read and write is sent for that business, and an
 * answer for any other is refused. An account linked to more than one business is refused by the
 * relationship resolver (42501) and reported as its own state.
 */

export type PreferencesPhase = "loading" | "ready" | "unavailable" | "multipleBusinesses" | "signed_out" | "error";
export type PreferenceKey = "email" | "sms" | "updates" | "sharing";
export type PreferenceOutcome =
  | { key: PreferenceKey; kind: "saved"; enabled: boolean }
  | { key: PreferenceKey; kind: "refused"; code: PreferenceRefusal | "OTHER" }
  | { key: PreferenceKey; kind: "unconfirmed" }
  | { key: PreferenceKey; kind: "multipleBusinesses" };

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type Rpc = "client_portal_communication_preferences" | "client_portal_set_communication_preference" | "client_portal_set_shared_context_consent";
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: Rpc, args: Record<string, unknown>, credential?: string): PromiseLike<RpcResult> {
  const call = supabase.rpc(name as never, args as never);
  // Pin the request to the credential that was verified for it: SDK token acquisition can finish
  // after an account switch, and a write must never travel under the next account's token.
  const pinned = credential ? call.setHeader("Authorization", `Bearer ${credential}`) : call;
  return pinned as unknown as PromiseLike<RpcResult>;
}

/**
 * 42501 means several things here; only the message tells them apart. "customer authentication required"
 * is signed out; "select an authorized customer relationship" is more than one business; "customer
 * relationship unavailable" is no (longer a) relationship. Anything else — e.g. a writer whose own
 * readback did not hold — is not a definite answer, and the fresh read decides.
 */
function classify42501(error: RpcResult["error"]): "signed_out" | "multipleBusinesses" | "unavailable" | null {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/authentication required/i.test(message)) return "signed_out";
  if (/select an authorized customer relationship/i.test(message)) return "multipleBusinesses";
  if (/relationship unavailable/i.test(message)) return "unavailable";
  return null;
}

class ReadFailure extends Error {
  constructor(readonly phase: Exclude<PreferencesPhase, "loading" | "ready">) { super(phase); }
}

export const PORTAL_PREFERENCE_CHANNEL: Record<Exclude<PreferenceKey, "sharing">, { channel: "email" | "sms"; topic: "newsletter" | null }> = {
  email: { channel: "email", topic: null },
  sms: { channel: "sms", topic: null },
  updates: { channel: "email", topic: "newsletter" },
};

/** Whether a fresh read shows the asked-for choice. */
export function preferenceReached(p: ClientPortalPreferences, key: PreferenceKey, enabled: boolean): boolean {
  if (key === "sharing") return p.data_sharing.allowed === enabled;
  if (key === "updates") return enabled ? p.updates.state === "subscribed" : p.updates.state !== "subscribed";
  const state = key === "email" ? p.email.state : p.sms.state;
  return state === (enabled ? "on" : "off");
}

/**
 * `actorId` is the account this page was opened for (Your account's verified relationship). The page
 * mounts this hook only once that account has resolved and keys it on the account, so a sign-out or
 * an account switch unmounts it; every read and write here still re-checks that the signed-in subject
 * is that account and refuses otherwise.
 */
export function useClientPortalPreferences(options: { actorId: string; onCommitted?: (key: PreferenceKey) => void }) {
  const [phase, setPhase] = useState<PreferencesPhase>("loading");
  const [preferences, setPreferences] = useState<ClientPortalPreferences | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<{ key: PreferenceKey; enabled: boolean } | null>(null);
  const [outcome, setOutcome] = useState<PreferenceOutcome | null>(null);
  const tenant = useRef<string | null>(null);
  const actor = useRef<string>(options.actorId);
  actor.current = options.actorId;
  const generation = useRef(0);
  const writing = useRef(false);
  const signedOut = useRef(false);
  const latest = useRef<ClientPortalPreferences | null>(null);
  const committed = useRef(options.onCommitted);
  committed.current = options.onCommitted;

  const clear = useCallback((next: PreferencesPhase) => {
    latest.current = null; tenant.current = null;
    setPreferences(null); setStale(false); setPending(null); setOutcome(null); setPhase(next);
  }, []);

  /** One read for the pinned business. Throws a ReadFailure for a definite answer, an Error otherwise. */
  const fetchOnce = useCallback(async (credential?: string): Promise<ClientPortalPreferences> => {
    const pin = tenant.current;
    const result = await portalRpc("client_portal_communication_preferences", pin ? { p_tenant_id: pin } : {}, credential);
    if (result.error) {
      const definite = result.error.code === "42501" ? classify42501(result.error) : null;
      if (definite) throw new ReadFailure(definite);
      throw new Error("read failed");
    }
    if (result.data === null || result.data === undefined) throw new ReadFailure("unavailable");
    const parsed = readClientPortalPreferences(result.data, pin);
    if (!parsed) throw new Error("unexpected preferences");
    return parsed;
  }, []);

  const load = useCallback(async () => {
    if (writing.current || signedOut.current) return;
    const request = ++generation.current;
    if (!latest.current) setPhase("loading");
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (request !== generation.current) return;
      if (error?.name === "AuthSessionMissingError" || error?.status === 401 || (!error && !user)) { signedOut.current = true; clear("signed_out"); return; }
      if (error || !user) throw new Error("auth unavailable");
      if (user.id !== actor.current) { signedOut.current = true; clear("signed_out"); return; }
      const next = await fetchOnce();
      if (request !== generation.current) return;
      tenant.current = next.tenant_id; latest.current = next;
      setPreferences(next); setStale(false); setPhase("ready");
    } catch (e) {
      if (request !== generation.current) return;
      if (e instanceof ReadFailure) { clear(e.phase); return; }
      // A refresh that fails keeps what is on screen and says it may be out of date.
      if (latest.current) { setStale(true); setPhase("ready"); } else setPhase("error");
    }
  }, [clear, fetchOnce]);

  const write = useCallback(async (key: PreferenceKey, enabled: boolean) => {
    const before = latest.current;
    if (writing.current || !before || !tenant.current) return;
    writing.current = true;
    const request = ++generation.current;
    setPending({ key, enabled }); setOutcome(null);
    let refusal: PreferenceRefusal | "OTHER" | null = null;
    let dispatched = false;
    try {
      const session = await supabase.auth.getSession();
      const credential = session.data.session?.access_token;
      if (session.error || !credential) throw new ReadFailure("signed_out");
      // The credential's subject is verified by Auth, never inferred from the cached session user.
      const verified = await supabase.auth.getUser(credential);
      if (request !== generation.current) return;
      if (verified.error || verified.data.user?.id !== actor.current) throw new ReadFailure("signed_out");
      dispatched = true;
      const result = key === "sharing"
        ? await portalRpc("client_portal_set_shared_context_consent", { p_allow: enabled, p_tenant_id: tenant.current }, credential)
        : await portalRpc("client_portal_set_communication_preference", {
          p_channel: PORTAL_PREFERENCE_CHANNEL[key].channel, p_topic: PORTAL_PREFERENCE_CHANNEL[key].topic,
          p_enabled: enabled, p_tenant_id: tenant.current,
        }, credential);
      if (request !== generation.current) return;
      const definite = result.error?.code === "42501" ? classify42501(result.error) : null;
      if (definite) throw new ReadFailure(definite);
      refusal = preferenceRefusal(result.data, result.error);
    } catch (e) {
      if (request !== generation.current) return;
      if (e instanceof ReadFailure) {
        writing.current = false;
        if (e.phase === "multipleBusinesses") { clear("multipleBusinesses"); setOutcome({ key, kind: "multipleBusinesses" }); }
        else clear(e.phase);
        return;
      }
      // Transport failure: the change may or may not have landed. The fresh read below decides.
    }
    // Repaint from a fresh read, whatever the writer said.
    let fresh: ClientPortalPreferences | null = null;
    try { fresh = await fetchOnce(); } catch (e) {
      if (request !== generation.current) return;
      if (e instanceof ReadFailure) { writing.current = false; clear(e.phase); return; }
    }
    if (request !== generation.current) return;
    writing.current = false;
    setPending(null);
    if (fresh) { latest.current = fresh; setPreferences(fresh); setStale(false); setPhase("ready"); }
    else setStale(true);
    if (refusal) { setOutcome({ key, kind: "refused", code: refusal }); return; }
    if (dispatched && fresh && preferenceReached(fresh, key, enabled)) {
      setOutcome({ key, kind: "saved", enabled });
      committed.current?.(key);
      return;
    }
    setOutcome({ key, kind: "unconfirmed" });
  }, [clear, fetchOnce]);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState !== "hidden") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      generation.current += 1;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, clear]);

  return {
    phase, preferences, stale, pending, outcome,
    reload: load,
    setChannel: (key: Exclude<PreferenceKey, "sharing">, enabled: boolean) => write(key, enabled),
    setSharing: (allow: boolean) => write("sharing", allow),
    dismissOutcome: () => setOutcome(null),
  };
}
