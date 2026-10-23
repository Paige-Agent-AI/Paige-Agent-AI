import {supabase} from "@/integrations/supabase/client";

/** Routing metadata only. The existing native customer gate still owns admission. */
export type ClientPortalSavedEntry = Readonly<{
  actorId: string; businessId: string; businessSlug: string; state: "open" | "paused" | "ended";
}>;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = ["contract_version", "actor_id", "tenant_id", "tenant_slug", "state"];

/** Closed native v1 result: validate the actual actor and original public-reader slug semantics. */
export function readClientPortalSavedEntry(value: unknown, actorId: string, slug: string): ClientPortalSavedEntry | null {
  if (!uuid(actorId) || !slug.trim() || !record(value)
    || Object.keys(value).length !== keys.length || !Object.keys(value).every(k => keys.includes(k))
    || value.contract_version !== 1 || value.actor_id !== actorId || !uuid(value.tenant_id)
    || typeof value.tenant_slug !== "string" || value.tenant_slug.trim().toLowerCase() !== slug.trim().toLowerCase()
    || (value.state !== "open" && value.state !== "paused" && value.state !== "ended")) return null;
  return {actorId, businessId: value.tenant_id, businessSlug: value.tenant_slug, state: value.state};
}

export class ClientPortalReturnReadError extends Error {
  constructor(readonly reason: "invalid" | "refused" | "unavailable" | "session_changed" | "canceled") {
    super("Your portal could not be verified. Try again.");
    this.name = "ClientPortalReturnReadError";
  }
}

/** Original SDK read. The caller retains its existing deadline and attempt lifetime. */
export async function fetchClientPortalSavedEntry(actorId: string, slug: string, {signal}: {signal: AbortSignal}): Promise<ClientPortalSavedEntry | null> {
  const current = () => {if (signal.aborted) throw new ClientPortalReturnReadError("canceled");};
  current();
  if (!uuid(actorId) || !slug.trim()) throw new ClientPortalReturnReadError("invalid");
  try {
    const {data, error} = await supabase.rpc("client_portal_entry_for_slug" as never, {p_slug: slug} as never).abortSignal(signal);
    current();
    if (error) throw new ClientPortalReturnReadError(error.code === "42501" ? "refused" : "unavailable");
    const entry = data === null ? null : readClientPortalSavedEntry(data, actorId, slug);
    if (data !== null && !entry) throw new ClientPortalReturnReadError("unavailable");
    const identity = await supabase.auth.getUser();
    current();
    if (identity.error || identity.data.user?.id !== actorId) throw new ClientPortalReturnReadError("session_changed");
    return entry;
  } catch (error) {
    current();
    if (error instanceof ClientPortalReturnReadError) throw error;
    throw new ClientPortalReturnReadError("unavailable");
  }
}
