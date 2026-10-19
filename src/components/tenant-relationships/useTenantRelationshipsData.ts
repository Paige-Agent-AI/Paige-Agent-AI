import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalConfig } from "@/hooks/usePortalConfig";
import { missingPortalAccessColumns, portalAccessStateOf, withoutPortalAccessColumns, type PortalAccessStateName } from "@/lib/client-portal-access";
import { CLIENT_CONTACT_METHODS_EMBED, orderContactMethods, primaryValue, type ContactMethod, type ContactMethodRow } from "@/lib/contact-methods";

export type RelationshipWorkspaceVariant = "relationships" | "clients";

export interface RelationshipPerson {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  recordType: "person" | "business";
  entityType: string | null;
  company: string | null;
  /** Every email and phone, primary first. `email` / `phone` are the primaries, for display. */
  contactMethods: ContactMethod[];
  email: string | null;
  phone: string | null;
  title: string | null;
  website: string | null;
  linkedinUrl: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  location: string | null;
  source: string | null;
  status: string;
  tags: string[];
  doNotContact: boolean;
  sharedContextConsent: boolean;
  linkedUserId: string | null;
  /** E09 Slice 7: the business's access decision for this contact. `open` until it pauses or ends it. */
  portalAccess: PortalAccessStateName;
  portalAccessChangedAt: string | null;
  relationship: string;
  lifecycleStage: string;
  primaryOffer: string | null;
  notes: string | null;
  assignedCoachUserId: string | null;
  owner: string;
  lastTouch: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  entity_type: string | null;
  client_contact_methods: ContactMethodRow[] | null;
  title: string | null;
  website: string | null;
  linkedin_url: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  source: string | null;
  status: string;
  tags: string[];
  do_not_contact: boolean;
  paige_shared_context_consent: boolean;
  linked_user_id: string | null;
  portal_access_state?: string | null;
  portal_access_changed_at?: string | null;
  lifecycle_stage: string | null;
  primary_offer: string | null;
  current_notes: string | null;
  assigned_coach_user_id: string | null;
  lead_owner_user_id?: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
}

const clientName = (row: ClientRow, primaryEmail: string | null) => {
  const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  const company = row.entity_name?.trim();
  if (company && (Boolean(row.entity_type?.trim()) || !full)) return company;
  return full || company || primaryEmail || "Unnamed contact";
};

// Widened to string on purpose: the generated types do not know the contact-methods embed yet,
// and a literal select string makes the client's type parser recurse past its limit.
const SOLO_PERSON_SELECT: string = `id,first_name,last_name,entity_name,entity_type,${CLIENT_CONTACT_METHODS_EMBED},title,website,linkedin_url,street_address,city,state,zip_code,source,status,tags,do_not_contact,paige_shared_context_consent,linked_user_id,portal_access_state,portal_access_changed_at,lifecycle_stage,primary_offer,current_notes,assigned_coach_user_id,lead_owner_user_id,last_contacted_at,created_at,updated_at`;
const ROSTER_PERSON_SELECT: string = `id,first_name,last_name,entity_name,${CLIENT_CONTACT_METHODS_EMBED},linked_user_id,lifecycle_stage,assigned_coach_user_id,last_contacted_at`;

const trimOrNull = (value: string | null | undefined) => value?.trim() || null;

const recordType = (row: ClientRow): RelationshipPerson["recordType"] => {
  const hasPersonName = Boolean(trimOrNull(row.first_name) || trimOrNull(row.last_name));
  const hasBusinessEvidence = Boolean(trimOrNull(row.entity_type)) || (!hasPersonName && Boolean(trimOrNull(row.entity_name)));
  return hasBusinessEvidence ? "business" : "person";
};

const mapClient = (row: ClientRow, soloPeople = false): RelationshipPerson => {
  const contactMethods = orderContactMethods(row.client_contact_methods);
  const email = primaryValue(contactMethods, "email");
  return {
  id: row.id,
  firstName: row.first_name ?? "",
  lastName: row.last_name ?? "",
  name: clientName(row, email),
  recordType: recordType(row),
  entityType: trimOrNull(row.entity_type),
  company: trimOrNull(row.entity_name),
  contactMethods,
  email,
  phone: primaryValue(contactMethods, "phone"),
  title: trimOrNull(row.title),
  website: trimOrNull(row.website),
  linkedinUrl: trimOrNull(row.linkedin_url),
  streetAddress: trimOrNull(row.street_address),
  city: trimOrNull(row.city),
  state: trimOrNull(row.state),
  zipCode: trimOrNull(row.zip_code),
  location: [trimOrNull(row.city), trimOrNull(row.state)].filter(Boolean).join(", ") || null,
  source: trimOrNull(row.source),
  status: trimOrNull(row.status) || "Not classified",
  tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())) : [],
  doNotContact: Boolean(row.do_not_contact),
  sharedContextConsent: Boolean(row.paige_shared_context_consent),
  linkedUserId: row.linked_user_id,
  portalAccess: portalAccessStateOf(row.portal_access_state),
  portalAccessChangedAt: row.portal_access_changed_at ?? null,
  relationship: row.lifecycle_stage?.split("_").join(" ") || "Not classified",
  lifecycleStage: trimOrNull(row.lifecycle_stage) || "new_lead",
  primaryOffer: trimOrNull(row.primary_offer),
  notes: trimOrNull(row.current_notes),
  assignedCoachUserId: row.assigned_coach_user_id,
  // SOLO contact ownership is independent of coaching; retain the legacy roster's projection.
  owner: (soloPeople ? row.lead_owner_user_id : row.assigned_coach_user_id) ? "Assigned owner" : "Unassigned",
  lastTouch: row.last_contacted_at,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
  };
};

/**
 * Account-keyed read adapter for the approved workspace. The authoritative tenant id comes
 * only from TenantProvider. Explicit tenant filters are defense-in-depth for browser roles
 * whose RLS may span more than one tenant; URL account numbers never enter these queries.
 */
export function useTenantRelationshipsData({
  activeTenantId,
  variant,
  soloPeople = false,
  deepLinkedContactId = null,
}: {
  activeTenantId: string | null;
  variant: RelationshipWorkspaceVariant;
  soloPeople?: boolean;
  deepLinkedContactId?: string | null;
}) {
  const queryClient = useQueryClient();
  const peopleKey = useMemo(() => ["tenant-relationships", "people", activeTenantId, soloPeople ? "solo-enriched" : "legacy"] as const, [activeTenantId, soloPeople]);
  const personKey = useMemo(() => ["tenant-relationships", "person", activeTenantId, deepLinkedContactId] as const, [activeTenantId, deepLinkedContactId]);
  const scope = useMemo(() => ({ activeTenantId, variant, soloPeople }), [activeTenantId, variant, soloPeople]);
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const lifetime = useRef({ mounted: false, generation: 0 });
  useEffect(() => {
    const mounted = lifetime.current;
    mounted.mounted = true;
    mounted.generation++;
    return () => { mounted.mounted = false; mounted.generation++; };
  }, []);
  const peopleQuery = useQuery({
    queryKey: peopleKey,
    enabled: variant === "clients" && !!activeTenantId,
    staleTime: 30_000,
    queryFn: async (): Promise<RelationshipPerson[]> => {
      if (!activeTenantId) return [];
      const list = (select: string) => supabase
        .from("clients")
        .select(select)
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false })
        .limit(250);
      let { data, error } = await list(soloPeople ? SOLO_PERSON_SELECT : ROSTER_PERSON_SELECT);
      // Web ahead of migration 20271111010000: read without the access columns (everyone reads open).
      if (soloPeople && missingPortalAccessColumns(error)) ({ data, error } = await list(withoutPortalAccessColumns(SOLO_PERSON_SELECT)));
      if (error) throw error;
      return ((data ?? []) as unknown as ClientRow[]).map((row) => mapClient(row, soloPeople));
    },
  });

  const deepLinkQuery = useQuery({
    queryKey: personKey,
    enabled: soloPeople && !!activeTenantId && !!deepLinkedContactId,
    staleTime: 30_000,
    queryFn: async (): Promise<RelationshipPerson | null> => {
      if (!activeTenantId || !deepLinkedContactId) return null;
      const one = (select: string) => supabase
        .from("clients")
        .select(select)
        .eq("tenant_id", activeTenantId)
        .eq("id", deepLinkedContactId)
        .maybeSingle();
      let { data, error } = await one(SOLO_PERSON_SELECT);
      if (missingPortalAccessColumns(error)) ({ data, error } = await one(withoutPortalAccessColumns(SOLO_PERSON_SELECT)));
      if (error) throw error;
      return data ? mapClient(data as unknown as ClientRow, true) : null;
    },
  });

  const portal = usePortalConfig(variant === "clients" ? activeTenantId : null);

  // The existing Chat event means "look again", never that a mutation succeeded. Cancel first:
  // an initial fetch otherwise shares its pre-turn promise even when explicitly refetched.
  const refreshPeopleAfterTurn = useCallback(async () => {
    const generation = lifetime.current.generation;
    const current = () => lifetime.current.mounted && lifetime.current.generation === generation && latestScope.current === scope;
    if (!current() || !scope.activeTenantId || scope.variant !== "clients" || !scope.soloPeople) return;
    const keys = deepLinkedContactId ? [peopleKey, personKey] : [peopleKey];
    const retiring = keys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true }));
    // Cancellation reverts query state. Mark stale after that, without a read, so leaving during
    // its await cannot make this pre-turn cache look fresh when the person returns.
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
    await Promise.all(retiring);
    if (!current()) return;
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" })));
  }, [queryClient, scope, peopleKey, personKey, deepLinkedContactId]);

  return {
    people: peopleQuery.data ?? [],
    peopleLoading: variant === "clients" && peopleQuery.isLoading,
    peopleError: variant === "clients" && peopleQuery.isError,
    retryPeople: peopleQuery.refetch,
    refreshPeopleAfterTurn,
    peopleAvailable: variant === "clients",
    deepLinkedPerson: deepLinkQuery.data ?? null,
    deepLinkLoading: deepLinkQuery.isLoading && deepLinkQuery.fetchStatus === "fetching",
    deepLinkError: deepLinkQuery.isError,
    retryDeepLink: deepLinkQuery.refetch,
    portalConfig: portal.config,
    portalLoading: portal.isLoading,
    portalError: portal.isError,
    retryPortal: portal.refetch,
  };
}
