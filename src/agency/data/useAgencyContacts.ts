/**
 * useAgencyContacts — the Agency Contacts + Setup-Owner adapter (Slice C, adapter 7).
 *
 * Mirrors the Solo `src/solo/data` pattern (§18: composes EXISTING seams). Two
 * concerns the agency clients + setup surfaces render:
 *   • CONTACTS — the caller's OWN-BOOK `clients` (RLS `current_user_tenant_id()`), in
 *     BOTH modes. In agency-aggregate mode this is the AGENCY's OWN direct book, NOT a
 *     cross-book aggregate — reading children's contacts here would be the #86 leak, so
 *     there is DELIBERATELY no cross-book roll-up (§13/§51).
 *   • OWNER — the Setup › Owner tab, delegated wholesale to the shipped `useSoloOwner`
 *     seam (own `profiles` row, keyed on the verified session uid; §9, no client id).
 *
 * §13 HONEST PREVIEW: some Setup fields (signature, banking) have NO storage in this
 * schema (useSoloOwner sources only name/email/phone/website/avatar) — they are
 * surfaced as explicit Preview flags, never fabricated.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAgencyAggregate, type AgencyShellCtx } from "./useAgencyRoster";
import {
  useSoloOwner,
  type SoloOwner,
  type SoloOwnerPatch,
} from "@/solo/data/useSoloOwner";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type WithClientContactMethods } from "@/lib/contact-methods";

/** One own-book contact reshaped for the agency clients/setup surfaces. REAL. */
export interface AgencyContact {
  id: string;
  /** "First Last" (or entity_name), present-guarded. REAL */
  name: string;
  email: string | null;
  phone: string | null;
  /** clients.status — REAL */
  status: string;
  /** clients.lifecycle_stage — REAL */
  lifecycleStage: string;
  createdAt: string;
}

/** §13 — Setup fields with no storage in this schema: honest Preview, never faked. */
export interface AgencyContactsPreview {
  /** Owner e-signature block — no signature storage; keep Preview. */
  signature: true;
  /** Banking / payout details — §38 money surface, no storage; keep Preview. */
  banking: true;
}

export interface AgencyContactsData {
  /** Own-book contacts (both modes; NEVER cross-book). REAL */
  contacts: AgencyContact[];
  contactsLoading: boolean;
  contactsError: boolean;
  /** Setup › Owner (delegated to useSoloOwner) — REAL. */
  owner: SoloOwner;
  ownerLoading: boolean;
  ownerSaving: boolean;
  ownerError: string | null;
  /** Own-row profiles write (§9 uid-keyed) — REAL. */
  saveOwner: (patch: SoloOwnerPatch) => Promise<{ ok: boolean; error?: string }>;
  /** §13 — Setup fields with no backend, kept Preview. */
  preview: AgencyContactsPreview;
  /** True when this is the agency-aggregate context (informational; scope is own-book either way). */
  aggregate: boolean;
  refresh: () => void;
}

const PREVIEW: AgencyContactsPreview = { signature: true, banking: true };

// Widened to string: the generated types do not know the contact-methods embed yet.
const AGENCY_CONTACT_SELECT: string = `id,first_name,last_name,entity_name,${CLIENT_CONTACT_METHODS_EMBED},status,lifecycle_stage,created_at`;

interface ClientRow extends WithClientContactMethods {
  id: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  status: string | null;
  lifecycle_stage: string | null;
  created_at: string;
}

function displayName(r: ClientRow): string {
  const full = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
  return full || (r.entity_name ?? "").trim() || "Unnamed contact";
}

export function useAgencyContacts(
  ctx: AgencyShellCtx,
  opts?: { fetchContacts?: boolean },
): AgencyContactsData {
  const aggregate = isAgencyAggregate(ctx);

  // Own-book contacts — RLS scopes to the caller's tenant. NO cross-book read (§51).
  // Gated OFF by default (§13 efficiency): Setup consumes only `owner`, so the 500-row
  // clients read must not fire on every mount. A clients/directory surface opts in via
  // { fetchContacts: true }.
  const contactsQ = useQuery({
    queryKey: ["agency-contacts-ownbook"],
    staleTime: 30_000,
    enabled: opts?.fetchContacts ?? false,
    queryFn: async (): Promise<AgencyContact[]> => {
      const { data, error } = await supabase
        .from("clients")
        .select(AGENCY_CONTACT_SELECT)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as unknown as ClientRow[]).map((r): AgencyContact => ({
        id: r.id,
        name: displayName(r),
        // The contact's PRIMARY email and phone, from its contact methods.
        ...primaryAddressesOf(r.client_contact_methods),
        status: r.status ?? "unknown",
        lifecycleStage: r.lifecycle_stage ?? "unknown",
        createdAt: r.created_at,
      }));
    },
  });

  // Setup › Owner — the shipped own-row seam, unchanged (§18).
  const {
    owner,
    loading: ownerLoading,
    saving: ownerSaving,
    error: ownerError,
    saveOwner,
    refresh: refreshOwner,
  } = useSoloOwner();

  const contacts = useMemo(() => contactsQ.data ?? [], [contactsQ.data]);

  const refresh = useCallback(() => {
    void contactsQ.refetch();
    refreshOwner();
  }, [contactsQ, refreshOwner]);

  return {
    contacts,
    contactsLoading: contactsQ.isLoading,
    contactsError: contactsQ.isError,
    owner,
    ownerLoading,
    ownerSaving,
    ownerError,
    saveOwner,
    preview: PREVIEW,
    aggregate,
    refresh,
  };
}
