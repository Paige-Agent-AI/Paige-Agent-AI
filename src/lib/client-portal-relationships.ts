import {supabase} from "@/integrations/supabase/client";

/** Presentation choices only. A saved choice never grants a frame or action. */
export type ClientPortalRelationshipChoice = Readonly<{
  clientId: string; tenantId: string; businessName: string;
  logoUrl: string | null; logoDarkUrl: string | null;
}>;
export type ClientPortalRelationshipPage = Readonly<{
  actorId: string; relationships: readonly ClientPortalRelationshipChoice[];
  hasMore: boolean; nextAfter: string | null;
}>;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const nullableText = (v: unknown): v is string | null => v === null || typeof v === "string";
const validPage = (limit: number, after: string | null) => Number.isInteger(limit) && limit >= 1 && limit <= 50 && (after === null || uuid(after));

/** Closed native v1 read; copy every field so late payload mutation cannot change a choice. */
export function readClientPortalRelationshipPage(
  value: unknown, actorId: string, limit = 20, after: string | null = null,
): ClientPortalRelationshipPage | null {
  if (!uuid(actorId) || !validPage(limit, after) || !record(value)
    || !exact(value, ["contract_version", "actor_id", "relationships", "has_more", "next_after"])
    || value.contract_version !== 1 || value.actor_id !== actorId || typeof value.has_more !== "boolean"
    || !Array.isArray(value.relationships) || value.relationships.length > limit) return null;
  const relationships: ClientPortalRelationshipChoice[] = [];
  const tenants = new Set<string>();
  let previous = after;
  for (const row of value.relationships) {
    if (!record(row) || !exact(row, ["client_id", "tenant_id", "business_name", "logo_url", "logo_dark_url"])
      || !uuid(row.client_id) || !uuid(row.tenant_id) || (previous !== null && row.client_id <= previous)
      || tenants.has(row.tenant_id) || typeof row.business_name !== "string" || !row.business_name.trim()
      || !nullableText(row.logo_url) || !nullableText(row.logo_dark_url)) return null;
    relationships.push({clientId: row.client_id, tenantId: row.tenant_id, businessName: row.business_name,
      logoUrl: row.logo_url, logoDarkUrl: row.logo_dark_url});
    tenants.add(row.tenant_id); previous = row.client_id;
  }
  if (value.has_more ? relationships.length !== limit || value.next_after !== previous : value.next_after !== null) return null;
  return {actorId, relationships, hasMore: value.has_more, nextAfter: value.has_more ? previous : null};
}

export class ClientPortalRelationshipReadError extends Error {
  constructor(readonly reason: "invalid" | "refused" | "unavailable" | "session_changed" | "canceled") {
    super("Customer businesses could not be checked");
    this.name = "ClientPortalRelationshipReadError";
  }
}

/** Reuse the original SDK/native read. The caller owns its existing deadline and generation. */
export async function fetchClientPortalRelationshipChoices(
  actorId: string, options: {signal: AbortSignal; limit?: number; after?: string | null},
): Promise<ClientPortalRelationshipPage> {
  const {signal, limit = 20, after = null} = options;
  const current = () => {if (signal.aborted) throw new ClientPortalRelationshipReadError("canceled");};
  if (!uuid(actorId) || !validPage(limit, after)) throw new ClientPortalRelationshipReadError("invalid");
  current();
  try {
  const {data, error} = await supabase.rpc("client_portal_relationship_choices" as never,
    {p_limit: limit, p_after: after} as never).abortSignal(signal);
  current();
  if (error) throw new ClientPortalRelationshipReadError(error.code === "42501" ? "refused" : "unavailable");
  const page = readClientPortalRelationshipPage(data, actorId, limit, after);
  if (!page) throw new ClientPortalRelationshipReadError("unavailable");
  const identity = await supabase.auth.getUser();
  current();
  if (identity.error || identity.data.user?.id !== actorId) throw new ClientPortalRelationshipReadError("session_changed");
  return page;
  } catch (error) {
    current();
    if (error instanceof ClientPortalRelationshipReadError) throw error;
    throw new ClientPortalRelationshipReadError("unavailable");
  }
}
