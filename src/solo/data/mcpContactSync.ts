/** Safe projection of the canonical incoming-contact grant. Never retain an RPC payload. */
export type ContactSyncRecord = {
  connectionId: string;
  tenantId: string;
  enabled: boolean;
  configuredEnabled: boolean;
  credentialConfigured: boolean;
  generation: number;
  grantedAt: string | null;
  operation: "contacts.create_update";
};

export type ContactSyncResult = {
  ok: boolean;
  code: string | null;
  message: string | null;
  record: ContactSyncRecord | null;
};

export function readContactSyncRecord(value: unknown, tenant: string, id?: string): ContactSyncRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.connection_id !== "string" || !r.connection_id || (id && r.connection_id !== id)
    || r.tenant_id !== tenant || r.operation !== "contacts.create_update"
    || typeof r.enabled !== "boolean" || typeof r.configured_enabled !== "boolean"
    || typeof r.credential_configured !== "boolean" || typeof r.generation !== "number"
    || !Number.isSafeInteger(r.generation) || r.generation < 0
    || !(r.granted_at === null || (typeof r.granted_at === "string" && Number.isFinite(Date.parse(r.granted_at))))
    || (r.enabled && (!r.configured_enabled || !r.credential_configured))
    || (r.configured_enabled && (!r.credential_configured || r.granted_at === null))) return null;
  return {
    connectionId: r.connection_id, tenantId: tenant, enabled: r.enabled,
    configuredEnabled: r.configured_enabled, credentialConfigured: r.credential_configured,
    generation: r.generation, grantedAt: r.granted_at as string | null, operation: "contacts.create_update",
  };
}

export function contactSyncFailure(code: string | null): ContactSyncResult {
  const messages: Record<string, string> = {
    MCP_FORBIDDEN: "You don’t have permission to manage incoming contacts in this business.",
    MCP_TENANT_MISMATCH: "Your business changed. Reopen the connection in the intended business.",
    MCP_LEGACY_CONNECTION_READONLY: "This older connection cannot receive this permission. Add an incoming contacts connection before moving your sender.",
    MCP_CONTACT_SYNC_STALE: "These settings changed. Read the current settings before saving again.",
    MCP_CONTACT_SYNC_INVALID: "Check that this connection is enabled and enter a dedicated credential of 32–512 characters without spaces.",
    MCP_BAD_LABEL: "Enter a connection name of 1–120 characters.",
    MCP_CONTACT_OUTCOME_UNKNOWN: "Save not confirmed. The request may have committed. Read the current settings before attempting another change.",
    MCP_CONTACT_READ_UNAVAILABLE: "Incoming settings could not be read. No permission or configuration is assumed. Try reading again.",
  };
  return { ok: false, code, record: null, message: code === "MCP_STALE" || code === "MCP_BUSY" || code === "MCP_NOT_READY"
    ? null : messages[code ?? ""] ?? "Incoming settings are unavailable. Read the current settings before trying again." };
}
