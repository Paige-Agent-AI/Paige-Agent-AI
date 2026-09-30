// Shared CRM contact helpers — lifecycle stages, sources, formatters.
// Note: product/offer catalogs are NOT defined here. Each tenant defines its
// own offers in Admin → Settings → Storefront. Use the `useTenantOffers` hook
// in React, or call `offerLabel` for legacy fallback rendering only.

export type LifecycleStage =
  | "new_lead" | "qualified" | "nurturing" | "hot_lead" | "negotiating"
  | "won" | "client_active" | "client_paused" | "client_churned" | "client_funded" | "client_alumni";

export const LIFECYCLE_STAGES: { value: LifecycleStage; label: string; color: string }[] = [
  { value: "new_lead",       label: "New Lead",       color: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  { value: "qualified",      label: "Qualified",      color: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { value: "nurturing",      label: "Nurturing",      color: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
  { value: "hot_lead",       label: "Hot Lead",       color: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  { value: "negotiating",    label: "Negotiating",    color: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  { value: "won",            label: "Won",            color: "bg-lime-500/15 text-lime-700 dark:text-lime-300" },
  { value: "client_active",  label: "Active Client",  color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  { value: "client_paused",  label: "Paused Client",  color: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  { value: "client_churned", label: "Churned Client", color: "bg-red-500/15 text-red-700 dark:text-red-300" },
  { value: "client_funded",  label: "Funded Client",  color: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  { value: "client_alumni",  label: "Alumni Client",  color: "bg-muted text-muted-foreground" },
];

export const CONTACT_SOURCES = [
  "manual", "referral", "website", "tenant_invite", "stripe", "paige", "import", "event", "partner",
];

// Pure helper for legacy/static rendering paths (e.g. rows where the React
// hook isn't readily available). For real UI pickers use `useTenantOffers`.
// Returns a humanized version of the raw stored value (id, slug, or label).
export function offerLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  // UUIDs (tenant_products.id) — display as-is; the hook-powered components
  // will replace this with the real product name once loaded.
  if (/^[0-9a-f-]{36}$/i.test(value)) return value;
  // Slug → Title Case
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function lifecycleMeta(stage: string | null | undefined) {
  return LIFECYCLE_STAGES.find((s) => s.value === stage) ||
    { value: stage || "new_lead", label: stage || "New Lead", color: "bg-muted text-muted-foreground" };
}

export function contactsToCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// Contact CRUD helpers (admin-side). Centralized so list, detail, and bulk
// flows all funnel through the same shape and the same realtime invalidation.
// -----------------------------------------------------------------------------

import { supabase } from "@/integrations/supabase/client";
import {
  CLIENT_CONTACT_METHODS_EMBED,
  contactMethodMatchKey,
  isContactMethodsStale,
  orderContactMethods,
  toContactMethodsPayload,
  toLoadedContactMethodsPayload,
  withPrimaryAddress,
  withPrimaryAddresses,
  type ContactMethod,
  type ContactMethodKind,
  type ContactMethodRow,
} from "@/lib/contact-methods";

// The generated types predate the contact-methods tables (#234), so their reads go through this
// narrow shim instead of `any`. Row security on `client_contact_methods` is the caller's own read
// access to the contact, so these reads see exactly the contacts the caller can see.
type UntypedQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  eq: (column: string, value: unknown) => UntypedQuery;
  neq: (column: string, value: unknown) => UntypedQuery;
  in: (column: string, values: readonly unknown[]) => UntypedQuery;
  ilike: (column: string, pattern: string) => UntypedQuery;
  limit: (count: number) => UntypedQuery;
};
export const clientContactMethodsTable = () =>
  (supabase.from as unknown as (table: string) => { select: (columns: string) => UntypedQuery })("client_contact_methods");

const userContactMethodsTable = () =>
  (supabase.from as unknown as (table: string) => { select: (columns: string) => UntypedQuery })("user_contact_methods");

const CONTACT_METHOD_COLUMNS = "id,kind,value,label,is_primary,position";

/**
 * A platform user's PRIMARY email or phone (`user_contact_methods`), or null when they hold none
 * or the caller may not read them (row security: yourself, or an owner/admin of your current
 * workspace reading one of its members).
 */
export async function readUserPrimaryAddress(userId: string, kind: ContactMethodKind): Promise<string | null> {
  const { data, error } = await userContactMethodsTable()
    .select("value")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("is_primary", true)
    .limit(1);
  if (error) {
    console.warn("[contacts] user contact methods read failed", error.message);
    return null;
  }
  return ((data ?? []) as { value: string }[])[0]?.value ?? null;
}

/** Addresses live in `client_contact_methods` (edited through `setContactPrimaryAddresses` or
 *  `upsert_contact`), so a direct row update carries no email or phone. */
export type ContactPatch = Partial<{
  first_name: string;
  last_name: string;
  entity_name: string | null;
  title: string | null;
  funding_goal: number | null;
  status: string;
  lifecycle_stage: LifecycleStage | string;
  source: string | null;
  tags: string[] | null;
  do_not_contact: boolean | null;
  current_notes: string | null;
  assigned_coach_user_id: string | null;
  primary_offer: string | null;
}>;

export async function updateContact(id: string, patch: ContactPatch) {
  const { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function bulkUpdateContacts(ids: string[], patch: ContactPatch) {
  if (!ids.length) return 0;
  const { error, count } = await supabase
    .from("clients")
    .update(patch, { count: "exact" })
    .in("id", ids);
  if (error) throw error;
  return count ?? ids.length;
}

/** Add a tag to many contacts (union, no duplicates). */
export async function bulkAddTag(ids: string[], tag: string) {
  if (!ids.length || !tag) return 0;
  const { data, error } = await supabase
    .from("clients")
    .select("id, tags")
    .in("id", ids);
  if (error) throw error;
  const updates = (data || []).map((r) => {
    const next = Array.from(new Set([...(r.tags || []), tag]));
    return supabase.from("clients").update({ tags: next }).eq("id", r.id);
  });
  await Promise.all(updates);
  return updates.length;
}

/** Remove a tag from many contacts. */
export async function bulkRemoveTag(ids: string[], tag: string) {
  if (!ids.length || !tag) return 0;
  const { data, error } = await supabase
    .from("clients")
    .select("id, tags")
    .in("id", ids);
  if (error) throw error;
  const updates = (data || []).map((r) => {
    const next = (r.tags || []).filter((t: string) => t !== tag);
    return supabase.from("clients").update({ tags: next }).eq("id", r.id);
  });
  await Promise.all(updates);
  return updates.length;
}

/** Admin-only hard delete via edge function (handles FK cleanup + audit). */
export async function deleteContact(id: string) {
  const { data, error } = await supabase.functions.invoke("delete-contact", {
    body: { contact_id: id },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "Delete failed");
  return data;
}

/** A contact's address rows as stored now, in no particular order. */
export async function readContactMethodRows(contactId: string): Promise<ContactMethodRow[]> {
  const { data, error } = await clientContactMethodsTable().select(CONTACT_METHOD_COLUMNS).eq("client_id", contactId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ContactMethodRow[];
}

/** A contact's addresses as stored now, primary first. */
export async function readContactMethods(contactId: string): Promise<ContactMethod[]> {
  return orderContactMethods(await readContactMethodRows(contactId));
}

/** The key the database matches an address on, or null for a value that identifies nobody
 *  (empty, or a phone of fewer than seven digits — the same floor `client_id_for_address` uses). */
function matchableKey(kind: ContactMethodKind, value: string | null | undefined): string | null {
  const key = value ? contactMethodMatchKey(kind, value) : "";
  if (!key || (kind === "phone" && key.length < 7)) return null;
  return key;
}

/**
 * The contacts holding an address — any of their addresses, not only the primary — matched the
 * way the database matches (email case-insensitively and trimmed, phone on its last ten digits).
 */
export async function contactIdsWithAddress(kind: ContactMethodKind, value: string, limit = 10): Promise<string[]> {
  const key = matchableKey(kind, value);
  if (!key) return [];
  const { data, error } = await clientContactMethodsTable().select("client_id").eq("kind", kind).eq("match_key", key).limit(limit);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as { client_id: string }[]).map((row) => row.client_id))];
}

/** One address in the list `upsert_contact` takes. */
export type ContactMethodPayload = { kind: ContactMethodKind; value: string; label: string | null; is_primary: boolean };

/** What a person reads when their save was refused because the list changed under them. */
export const CONTACT_METHODS_CHANGED_MESSAGE =
  "This contact's emails or phones changed since this page loaded, so nothing was saved. Reload to see the current list, then make your change again.";

/**
 * Replaces a contact's whole address list through `upsert_contact`, naming the list it was built on
 * (`expected`). The database locks the contact and refuses the write when the stored list is no
 * longer `expected`, so an address someone else added or removed meanwhile is never silently undone.
 * `tenantId` is the contact's workspace (a platform owner acting on another workspace needs it; for
 * anyone else it must be their current workspace). Returns the list as stored after the write.
 */
export async function replaceContactMethods(
  contactId: string,
  methods: readonly ContactMethodPayload[],
  { expected, tenantId = null }: { expected: readonly unknown[]; tenantId?: string | null },
): Promise<ContactMethodRow[]> {
  const { error } = await supabase.rpc("upsert_contact", {
    p_patch: { contact_methods: methods, expected_contact_methods: expected },
    p_contact_id: contactId,
    p_tenant_id: tenantId,
    p_channel: "manual",
  } as never);
  if (error) {
    const message = error.message || "Contact save failed";
    throw new Error(isContactMethodsStale(message) ? CONTACT_METHODS_CHANGED_MESSAGE : message);
  }
  return readContactMethodRows(contactId);
}

/**
 * Sets a contact's primary email and/or phone — only the kinds present in `next` — the way a
 * single Email / Phone field always behaved, keeping every other address.
 *
 * `loaded` is the list the page read and showed. The change is applied to it and the write names
 * it, so if the stored list changed since, the save is refused (CONTACT_METHODS_CHANGED_MESSAGE)
 * instead of overwriting the other change. Without `loaded` the list is read now and named.
 * Nothing is written when the primaries already match. Returns the list as stored.
 */
export async function setContactPrimaryAddresses(
  contactId: string,
  next: Partial<Record<ContactMethodKind, string | null>>,
  { tenantId = null, loaded }: { tenantId?: string | null; loaded?: readonly ContactMethodRow[] | null } = {},
): Promise<ContactMethodRow[]> {
  const rows = loaded ? [...loaded] : await readContactMethodRows(contactId);
  const current = orderContactMethods(rows);
  let methods = current;
  for (const kind of ["email", "phone"] as const) {
    if (kind in next) methods = withPrimaryAddress(methods, kind, next[kind]);
  }
  const payload = toContactMethodsPayload(methods);
  if (JSON.stringify(payload) === JSON.stringify(toContactMethodsPayload(current))) return rows;
  return replaceContactMethods(contactId, payload, { expected: toLoadedContactMethodsPayload(current), tenantId });
}

export type DuplicateContact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  lifecycle_stage: string | null;
  created_at: string;
  email: string | null;
  phone: string | null;
};

// Widened to string: the generated types do not know the contact-methods embed yet.
const DUPLICATE_SELECT: string = `id,first_name,last_name,entity_name,lifecycle_stage,created_at,${CLIENT_CONTACT_METHODS_EMBED}`;

/** Other contacts that share any email or phone with this one — any of either's addresses. */
export async function findDuplicates(contact: { id: string }): Promise<DuplicateContact[]> {
  const own = await readContactMethods(contact.id);
  const idsByKind = await Promise.all((["email", "phone"] as const).map(async (kind) => {
    const keys = [...new Set(own.filter((method) => method.kind === kind).map((method) => matchableKey(kind, method.value)).filter((key): key is string => Boolean(key)))];
    if (!keys.length) return [];
    const { data, error } = await clientContactMethodsTable()
      .select("client_id")
      .eq("kind", kind)
      .in("match_key", keys)
      .neq("client_id", contact.id)
      .limit(5);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { client_id: string }[]).map((row) => row.client_id);
  }));
  const ids = [...new Set(idsByKind.flat())].slice(0, 5);
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("clients")
    .select(DUPLICATE_SELECT)
    .in("id", ids)
    .limit(5);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Omit<DuplicateContact, "email" | "phone"> & { client_contact_methods: ContactMethodRow[] | null }>)
    .map((row) => {
      const { client_contact_methods: _methods, ...rest } = withPrimaryAddresses(row);
      return rest;
    });
}

export async function logQuickActivity(args: {
  user_id: string; // contact.linked_user_id required
  channel: "call" | "email" | "sms" | "meeting" | "note";
  subject?: string | null;
  preview?: string | null;
}) {
  const { error } = await supabase.from("communication_log").insert({
    user_id: args.user_id,
    channel: args.channel,
    message_type: args.channel === "note" ? "internal_note" : "manual_log",
    subject: args.subject ?? null,
    preview: args.preview ?? null,
    status: "logged",
  });
  if (error) throw error;
  await supabase.from("clients").update({
    last_contacted_at: new Date().toISOString(),
  }).eq("linked_user_id", args.user_id);
}

