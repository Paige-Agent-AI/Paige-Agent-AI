// Incoming contacts use the canonical connection binding and ONE database transaction.
// This adapter never selects a tenant, global owner or currently open workspace.
// Credentials are supplied by the account holder to their sender, never returned or logged.
type Db = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { code?: string; message?: string } | null;
  }>;
};
type Contact = {
  email: string; first_name?: string | null; last_name?: string | null; phone?: string | null;
  tier?: string | null; source?: string | null; assigned_to_email?: string | null;
};
export type ContactMirrorInput = {
  connectionId: string; credential: string; generation: number; eventId: string;
  externalId: string; sourceUpdatedAt: string; contact: Contact;
};
export type ContactMirrorResult = {
  client_id: string; action: "created" | "updated"; replayed: boolean; phone_not_saved?: string;
};
export type ContactMirrorOutcome =
  | { ok: true; data: ContactMirrorResult }
  | { ok: false; error: string; status: 401 | 409 | 503 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const conflicts = new Set([
  "MCP_CONTACT_EVENT_CONFLICT", "MCP_CONTACT_SOURCE_STALE", "MCP_CONTACT_SYNC_INVALID", "MCP_CONTACT_FIELDS_REFUSED",
]);

// Preserve the bridge's existing best-effort 600/minute IP bucket for both credential paths.
// This is an ingress cap, not tenant authority; a limiter outage does not prove permission.
export async function bridgeRateLimit(db: Db, request: Request): Promise<boolean> {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "0.0.0.0";
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip))).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map(value => value.toString(16).padStart(2, "0")).join("");
    const sentinel = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const { data } = await db.rpc("check_rate_limit", {
      _user_id: sentinel, _function_name: "paige-bridge", _max_requests: 600, _window_minutes: 1,
    });
    return data !== false;
  } catch { return true; }
}

export async function upsertContactMirror(db: Db, input: ContactMirrorInput): Promise<ContactMirrorOutcome> {
  try {
    const { data, error } = await db.rpc("sync_mcp_connection_contact", {
      _connection_id: input.connectionId, _secret: input.credential, _generation: input.generation,
      _event_id: input.eventId, _external_id: input.externalId, _source_updated_at: input.sourceUpdatedAt,
      _contact: input.contact,
    });
    if (error) {
      if (error.code === "42501") return { ok: false, status: 401, error: "contact_sync_not_authorized" };
      if (error.code === "22023" || error.code === "23505") return {
        ok: false, status: 409,
        error: conflicts.has(error.message ?? "") ? error.message! : "contact_sync_conflict",
      };
      return { ok: false, status: 503, error: "contact_sync_unavailable" };
    }
    // A missing/malformed commit acknowledgement is NOT a successful save. Retry the SAME
    // event ID; the durable receipt resolves a lost acknowledgement without a second write.
    if (!record(data) || typeof data.client_id !== "string" || !uuid.test(data.client_id)
      || !["created", "updated"].includes(String(data.action)) || typeof data.replayed !== "boolean")
      return { ok: false, status: 503, error: "contact_sync_outcome_unverified" };
    return { ok: true, data: {
      client_id: data.client_id, action: data.action as "created" | "updated", replayed: data.replayed,
      ...(data.phone_not_saved === "not a usable phone number" ? { phone_not_saved: data.phone_not_saved } : {}),
    } };
  } catch {
    return { ok: false, status: 503, error: "contact_sync_unavailable" };
  }
}

export async function handleContactSyncRequest(db: Db, request: Request, payload: unknown): Promise<Response> {
  const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify({
    verb: "upsert_contact_mirror", ...body,
  }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const credential = request.headers.get("Authorization")?.match(/^Bearer (\S{32,512})$/)?.[1];
  if (!credential) return response(401, { ok: false, error: "contact_sync_not_authorized" });
  if (!record(payload)) return response(400, { ok: false, error: "contact_sync_invalid_request" });
  const allowed = new Set(["connection_id", "generation", "event_id", "external_id", "source_updated_at",
    "email", "first_name", "last_name", "full_name", "phone", "tier", "source", "assigned_to_email", "ghl_contact_id"]);
  if (Object.keys(payload).some(key => !allowed.has(key))
    || typeof payload.connection_id !== "string" || !uuid.test(payload.connection_id)
    || typeof payload.event_id !== "string" || !uuid.test(payload.event_id)
    || !Number.isSafeInteger(payload.generation) || Number(payload.generation) < 1
    || typeof payload.source_updated_at !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(payload.source_updated_at)
    || !Number.isFinite(Date.parse(payload.source_updated_at))
    || typeof payload.email !== "string" || payload.email.length > 254)
    return response(400, { ok: false, error: "contact_sync_invalid_request" });
  // Compatibility is a field alias only, never vendor-specific authentication or routing.
  const externalId = payload.external_id ?? payload.ghl_contact_id;
  if (typeof externalId !== "string" || externalId.trim().length < 1 || externalId.length > 255)
    return response(400, { ok: false, error: "contact_sync_invalid_request" });
  const limits: Record<string, number> = { first_name: 100, last_name: 100, full_name: 200, phone: 50, tier: 20, source: 50, assigned_to_email: 254 };
  for (const [field, limit] of Object.entries(limits)) {
    const value = payload[field];
    if (value != null && (typeof value !== "string" || value.length > limit))
      return response(400, { ok: false, error: "contact_sync_invalid_request" });
  }
  const name = typeof payload.full_name === "string" ? payload.full_name.trim().split(/\s+/) : [];
  const contact: Contact = { email: payload.email };
  if (payload.first_name != null || name.length)
    contact.first_name = (payload.first_name ?? name[0]) as string;
  if (payload.last_name != null || name.length)
    contact.last_name = (payload.last_name ?? name.slice(1).join(" ")) as string;
  for (const field of ["phone", "tier", "source", "assigned_to_email"] as const)
    if (payload[field] !== undefined) contact[field] = payload[field] as string | null;
  if (!(await bridgeRateLimit(db, request)))
    return response(429, { ok: false, error: "contact_sync_rate_limited" });
  const result = await upsertContactMirror(db, {
    connectionId: payload.connection_id, credential, generation: Number(payload.generation), eventId: payload.event_id,
    externalId, sourceUpdatedAt: payload.source_updated_at, contact,
  });
  return result.ok === true ? response(200, result) : response(result.status, { ok: false, error: result.error });
}
