import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readClientPortalSelfProfile, type ClientPortalSelfProfile } from "@/lib/client-portal-self-profile";

export type OnboardClient = ClientPortalSelfProfile;
interface State {
  loading: boolean;
  error: "not_authenticated" | "no_client_record" | "profile_unavailable" | null;
  client: OnboardClient | null;
  userEmail: string | null;
}

export function useOnboardingClient() {
  const [state, setState] = useState<State>({ loading: true, error: null, client: null, userEmail: null });
  const mounted = useRef(false);
  const request = useRef(0);
  const actor = useRef<string | null>(null);
  const invalidateRequests = useCallback(() => { request.current += 1; }, []);
  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    const current = () => mounted.current && sequence === request.current;
    setState({ loading: true, error: null, client: null, userEmail: null });
    let userEmail: string | null = null;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!current()) return;
      if (authError?.name === "AuthSessionMissingError" || authError?.status === 401) {
        actor.current = null;
        setState({ loading: false, error: "not_authenticated", client: null, userEmail: null });
        return;
      }
      if (authError) throw new Error("profile_unavailable");
      actor.current = user?.id ?? null;
      if (!user) {
        setState({ loading: false, error: "not_authenticated", client: null, userEmail: null });
        return;
      }
      userEmail = user.email ?? null;
      // Identity and eligibility come from the server. Never search by email,
      // claim an unlinked CRM row or read the raw relationship.
      const { data, error } = await supabase.rpc("client_portal_self_profile");
      if (!current()) return;
      if (error) throw new Error("profile_unavailable");
      const client = data === null ? null : readClientPortalSelfProfile(data, user.id);
      if (data !== null && !client) throw new Error("profile_unavailable");
      setState({ loading: false, error: client ? null : "no_client_record", client, userEmail });
    } catch {
      if (current()) setState({ loading: false, error: "profile_unavailable", client: null, userEmail });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next === actor.current) return;
      actor.current = next;
      invalidateRequests();
      setState({ loading: Boolean(next), error: next ? null : "not_authenticated", client: null, userEmail: null });
      // Auth callbacks hold the SDK lock; schedule the new read after returning.
      if (next) queueMicrotask(() => { if (mounted.current) void refresh(); });
    });
    void refresh();
    return () => { mounted.current = false; invalidateRequests(); subscription.unsubscribe(); };
  }, [refresh, invalidateRequests]);
  return { ...state, refresh };
}

export async function advanceOnboardingStage(_clientId: string, toStage: string, extraPatch: Record<string, unknown> = {}) {
  // Existing canonical checked writer owns stage transitions and audit attribution.
  return supabase.rpc("client_advance_onboarding_stage", { p_to_stage: toStage, p_payload: extraPatch as never });
}
