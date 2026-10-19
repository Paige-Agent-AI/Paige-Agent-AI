import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { portalAccessStateOf } from "@/lib/client-portal-access";

export type ClientOnboardingStatus = {
  contact_id: string;
  linked_user_id: string | null;
  invite_accepted_at: string | null;
  password_set_at: string | null;
  agreement_signed_at: string | null;
  intake_submitted_at: string | null;
  stage: string | null;
  ready: boolean;
  /** E09 Slice 7: the business's access decision, read beside the status (absent → open). */
  portal_access_state?: "open" | "paused" | "ended";
};

/**
 * Live onboarding status for a contact. Drives the staff status panel and
 * gates the "View as Client" impersonation button. Subscribes to realtime
 * `clients` updates so the checklist + button enable instantly.
 */
export function useClientOnboardingStatus(contactId: string | null | undefined) {
  const [data, setData] = useState<ClientOnboardingStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(!!contactId);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    const [{ data: rows, error: err }, access] = await Promise.all([
      supabase.rpc("client_onboarding_status", { p_contact_id: contactId }),
      // A staff read of the contact's own access column. A failure (or a pre-migration database)
      // only means the reason stays the generic one; it never gates anything.
      Promise.resolve(supabase.from("clients").select("portal_access_state").eq("id", contactId).maybeSingle())
        .catch(() => ({ data: null, error: true })),
    ]);
    if (err) {
      setError(err.message);
      setData(null);
    } else {
      const row = Array.isArray(rows) ? rows[0] : rows;
      const state = access && !access.error ? portalAccessStateOf((access.data as { portal_access_state?: unknown } | null)?.portal_access_state) : "open";
      setData(row ? { ...(row as ClientOnboardingStatus), portal_access_state: state } : null);
      setError(null);
    }
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!contactId) return;
    // Unique topic per mount avoids StrictMode double-mount race where the
    // second mount reuses a still-subscribed channel and throws
    // "cannot add postgres_changes callbacks ... after subscribe()".
    const topic = `client-onboarding-${contactId}-${Math.random().toString(36).slice(2, 10)}`;
    const ch = supabase.channel(topic);
    ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "clients", filter: `id=eq.${contactId}` },
      () => { void load(); },
    ).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [contactId, load]);

  return { status: data, loading, error, refresh: load };
}

export function describeBlockedReason(s: ClientOnboardingStatus | null): string | null {
  if (!s) return "Loading…";
  if (s.ready) return null;
  if (s.portal_access_state === "ended") return "Their portal access has ended";
  if (s.portal_access_state === "paused") return "Their portal access is paused";
  if (!s.linked_user_id) return "Client hasn't accepted their invite yet";
  if (!s.agreement_signed_at) return "Client hasn't signed the agreement yet";
  if (s.stage !== "completed") return "Client hasn't completed intake yet";
  return "Client hasn't completed onboarding yet";
}
