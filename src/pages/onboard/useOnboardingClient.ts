import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type WithClientContactMethods } from "@/lib/contact-methods";
import { contactIdsWithAddress } from "@/lib/contacts";

// Widened to string: the generated types do not know the contact-methods embed yet.
const ONBOARD_CLIENT_SELECT: string = `id, tenant_id, first_name, last_name, ${CLIENT_CONTACT_METHODS_EMBED}, entity_name, linked_user_id, onboarding_stage, lifecycle_stage`;

/** `email` and `phone` are the contact's PRIMARY addresses, from its contact methods. */
const toOnboardClient = (row: Omit<OnboardClient, "email" | "phone"> & WithClientContactMethods): OnboardClient => {
  const { client_contact_methods: methods, ...rest } = row;
  return { ...rest, ...primaryAddressesOf(methods) };
};

export interface OnboardClient {
  id: string;
  tenant_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  entity_name: string | null;
  linked_user_id: string | null;
  onboarding_stage: string | null;
  lifecycle_stage: string | null;
}

interface State {
  loading: boolean;
  error: string | null;
  client: OnboardClient | null;
  userEmail: string | null;
}

export function useOnboardingClient() {
  const [state, setState] = useState<State>({ loading: true, error: null, client: null, userEmail: null });

  const refresh = async () => {
    setState((s) => ({ ...s, loading: true }));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setState({ loading: false, error: "not_authenticated", client: null, userEmail: null });
      return;
    }
    // Match by linked_user_id first, then by email (so we can claim the row).
    const { data: linked } = await supabase
      .from("clients")
      .select(ONBOARD_CLIENT_SELECT)
      .eq("linked_user_id", user.id)
      .maybeSingle();
    let client = linked ? toOnboardClient(linked as unknown as Omit<OnboardClient, "email" | "phone"> & WithClientContactMethods) : null;

    if (!client && user.email) {
      // The contact holding the sign-in address as ANY of its emails. Exactly one, or none: two
      // contacts holding it (in different workspaces) is ambiguous, and nothing is claimed.
      // A failed lookup claims nothing, and says why.
      const holders = await contactIdsWithAddress("email", user.email, 2).catch((cause: unknown) => {
        console.warn("[onboarding] looking up the contact by sign-in email failed", cause);
        return [] as string[];
      });
      const { data: found } = holders.length === 1
        ? await supabase.from("clients").select(ONBOARD_CLIENT_SELECT).eq("id", holders[0]).maybeSingle()
        : { data: null };
      const byEmail = found ? toOnboardClient(found as unknown as Omit<OnboardClient, "email" | "phone"> & WithClientContactMethods) : null;
      if (byEmail) {
        // Bind it.
        if (!byEmail.linked_user_id) {
          await supabase.from("clients").update({ linked_user_id: user.id }).eq("id", byEmail.id);
          byEmail.linked_user_id = user.id;
        }
        client = byEmail;
      }
    }

    if (!client) {
      setState({
        loading: false,
        error: "no_client_record",
        client: null,
        userEmail: user.email ?? null,
      });
      return;
    }

    setState({ loading: false, error: null, client, userEmail: user.email ?? null });
  };

  useEffect(() => { refresh(); }, []);

  return { ...state, refresh };
}

export async function advanceOnboardingStage(
  _clientId: string,
  toStage: string,
  extraPatch: Record<string, unknown> = {},
) {
  // Direct UPDATE on public.clients is blocked for linked clients by RLS, so
  // we go through the SECURITY DEFINER RPC which validates ownership, enforces
  // forward-only transitions, and writes an audit row admins can watch live.
  return supabase.rpc("client_advance_onboarding_stage", {
    p_to_stage: toStage,
    p_payload: extraPatch as never,
  });
}
