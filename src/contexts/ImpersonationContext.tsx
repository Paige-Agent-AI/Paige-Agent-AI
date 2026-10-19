import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { IMPERSONATION_ACCESS_ENDED, IMPERSONATION_ACCESS_PAUSED, impersonationAccessRefusal } from "@/lib/client-portal-access";

const STORAGE_KEY = "paige_impersonating_contact";

type Target = {
  contactId: string;
  targetUserId: string;
  targetName: string;
};

type Ctx = {
  target: Target | null;
  isImpersonating: boolean;
  /** Effective user id for client-scoped data — falls back to the signed-in user's own id. */
  effectiveUserId: (selfId: string | undefined | null) => string | undefined;
  start: (contactId: string) => Promise<Target>;
  stop: () => Promise<void>;
};

const ImpersonationCtx = createContext<Ctx | null>(null);

function readStored(): Target | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Target;
    if (parsed?.contactId && parsed?.targetUserId) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(() => readStored());

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTarget(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const start = useCallback(async (contactId: string) => {
    const { data, error } = await supabase.rpc("start_client_impersonation", { p_contact_id: contactId });
    if (error) {
      // E09 Slice 7: an ENDED client has no link, so the server answers "has not accepted their invite
      // yet" — true of the link, wrong about the person. Say what actually happened, in the owner's words.
      // 20271111010000 names the state itself; say it in the owner's words.
      // The server's two access messages are pinned against the migration by a test (one home).
      const named = impersonationAccessRefusal(error.message);
      if (named) throw new Error(named);
      if (/not accepted their invite/i.test(error.message ?? "")) {
        let state: string | null | undefined;
        try {
          const { data: row } = await supabase.from("clients").select("portal_access_state").eq("id", contactId).maybeSingle();
          state = (row as { portal_access_state?: string | null } | null)?.portal_access_state;
        } catch { /* the server's own message below is still true */ }
        if (state === "ended") throw new Error(impersonationAccessRefusal(IMPERSONATION_ACCESS_ENDED)!);
        if (state === "paused") throw new Error(impersonationAccessRefusal(IMPERSONATION_ACCESS_PAUSED)!);
      }
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.linked_user_id) throw new Error("Client has not accepted their invite yet.");
    const next: Target = {
      contactId: row.contact_id,
      targetUserId: row.linked_user_id,
      targetName: row.client_name || "Client",
    };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable: the in-memory target still applies */ }
    setTarget(next);
    return next;
  }, []);

  const stop = useCallback(async () => {
    const current = target;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    setTarget(null);
    if (current?.contactId) {
      try { await supabase.rpc("end_client_impersonation", { p_contact_id: current.contactId }); } catch { /* best-effort */ }
    }
  }, [target]);

  const effectiveUserId = useCallback(
    (selfId: string | undefined | null) => target?.targetUserId ?? selfId ?? undefined,
    [target]
  );

  const value = useMemo<Ctx>(() => ({
    target,
    isImpersonating: !!target,
    effectiveUserId,
    start,
    stop,
  }), [target, effectiveUserId, start, stop]);

  return <ImpersonationCtx.Provider value={value}>{children}</ImpersonationCtx.Provider>;
}

export function useImpersonation(): Ctx {
  const ctx = useContext(ImpersonationCtx);
  if (!ctx) {
    // Soft fallback so components outside the provider don't crash.
    return {
      target: null,
      isImpersonating: false,
      effectiveUserId: (selfId) => selfId ?? undefined,
      start: async () => { throw new Error("ImpersonationProvider missing"); },
      stop: async () => {},
    };
  }
  return ctx;
}
