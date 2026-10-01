import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type ContactMethodRow } from "@/lib/contact-methods";
import { readUserPrimaryAddress } from "@/lib/contacts";
import type { Tables } from "@/integrations/supabase/types";

// Widened to string: the generated types do not know the contact-methods embed yet.
const DISPLAY_CLIENT_SELECT: string = `first_name, last_name, ${CLIENT_CONTACT_METHODS_EMBED}, entity_name, street_address, city, state, zip_code`;

/** The row DISPLAY_CLIENT_SELECT reads from `clients`. */
type DisplayClientRow = Pick<
  Tables<"clients">,
  "first_name" | "last_name" | "entity_name" | "street_address" | "city" | "state" | "zip_code"
> & { client_contact_methods?: ContactMethodRow[] | null };

/** The profile fields read for display. Not every one is a `profiles` column, so each may be absent. */
interface DisplayProfileFields {
  full_name?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}

/**
 * Standardized client display info returned by getClientDisplayInfo.
 * Every document-generating component should use this interface.
 */
export interface ClientDisplayInfo {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  entity_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address_complete: boolean;
  formatted_address: string | null;
}

/**
 * Fetches standardised display info for a client.
 *
 * Resolution order:
 *  1. If `clientId` is provided → query the `clients` table (internal CRM record).
 *  2. If only `userId` is provided → query the `profiles` table (auth user).
 *  3. For entity_name, also check the `businesses` table.
 *
 * SSN is never included for security.
 */
export async function getClientDisplayInfo(opts: {
  clientId?: string;
  userId?: string;
}): Promise<ClientDisplayInfo> {
  const blank: ClientDisplayInfo = {
    full_name: "Consumer",
    first_name: "",
    last_name: "",
    email: null,
    phone: null,
    entity_name: null,
    street_address: null,
    city: null,
    state: null,
    zip: null,
    address_complete: false,
    formatted_address: null,
  };

  // --- Internal client (clients table) ---
  if (opts.clientId) {
    const { data } = await supabase
      .from("clients")
      .select(DISPLAY_CLIENT_SELECT)
      .eq("id", opts.clientId)
      .maybeSingle();

    if (data) {
      const d = data as unknown as DisplayClientRow;
      // The contact's PRIMARY email and phone, from its contact methods.
      const primary = primaryAddressesOf(d.client_contact_methods as ContactMethodRow[] | null);
      const address_complete = !!(d.street_address && d.city && d.state && d.zip_code);
      const formatted_address = address_complete
        ? `${d.street_address}\n${d.city}, ${d.state} ${d.zip_code}`
        : null;

      return {
        full_name: `${d.first_name || ""} ${d.last_name || ""}`.trim() || "Consumer",
        first_name: d.first_name || "",
        last_name: d.last_name || "",
        email: primary.email,
        phone: primary.phone,
        entity_name: d.entity_name || null,
        street_address: d.street_address || null,
        city: d.city || null,
        state: d.state || null,
        zip: d.zip_code || null,
        address_complete,
        formatted_address,
      };
    }
  }

  // --- Auth user (profiles table) ---
  if (opts.userId) {
    const [{ data: profile }, { data: businesses }, phone] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, street_address, city, state, zip_code")
        .eq("user_id", opts.userId)
        .maybeSingle(),
      supabase
        .from("businesses")
        .select("legal_name")
        .eq("owner_user_id", opts.userId)
        .limit(1),
      // The person's PRIMARY phone, from their contact methods.
      readUserPrimaryAddress(opts.userId, "phone"),
    ]);

    // Get email from auth user
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.id === opts.userId ? user?.email || null : null;

    const p = (profile || {}) as DisplayProfileFields;
    const nameParts = (p.full_name || "").split(" ");
    const address_complete = !!(p.street_address && p.city && p.state && p.zip_code);
    const formatted_address = address_complete
      ? `${p.street_address}\n${p.city}, ${p.state} ${p.zip_code}`
      : null;

    return {
      full_name: p.full_name || email || "Consumer",
      first_name: nameParts[0] || "",
      last_name: nameParts.slice(1).join(" ") || "",
      email,
      phone,
      entity_name: businesses?.[0]?.legal_name || null,
      street_address: p.street_address || null,
      city: p.city || null,
      state: p.state || null,
      zip: p.zip_code || null,
      address_complete,
      formatted_address,
    };
  }

  return blank;
}

/**
 * React Query hook wrapper around getClientDisplayInfo.
 */
export function useClientDisplayInfo(opts: { clientId?: string; userId?: string }) {
  return useQuery({
    queryKey: ["client-display-info", opts.clientId, opts.userId],
    enabled: !!(opts.clientId || opts.userId),
    staleTime: 5 * 60 * 1000,
    queryFn: () => getClientDisplayInfo(opts),
  });
}
