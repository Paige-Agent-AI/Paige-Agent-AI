import { supabase as shared } from "../settings-mount/supabase-paige-stub";
import { currentTenant } from "./tenant-context-stub";

// In-memory RPC-contract doubles. Never authenticated evidence or a provider implementation.
type Grant = { connection_id: string; tenant_id: string; enabled: boolean; configured_enabled: boolean;
  credential_configured: boolean; generation: number; granted_at: string | null; operation: string };
const mode = () => new URLSearchParams(location.search).get("data") ?? "incoming";
const grants = new Map<string, Grant>();
const labels = new Map<string, string>();
let nextId = 0;
function seed() {
  const tenant = currentTenant().id;
  const id = `${tenant}-connection`;
  if (!grants.has(id)) {
    grants.set(id, { connection_id: id, tenant_id: tenant, enabled: false, configured_enabled: false,
      credential_configured: false, generation: 0, granted_at: null, operation: "contacts.create_update" });
    labels.set(id, tenant.endsWith("-a") ? "Test contact source A" : "Test contact source B");
  }
}
const answer = (data: unknown) => Promise.resolve({ data, error: null });
const refusal = (message: string) => Promise.resolve({ data: null, error: { message } });
export const supabase = {
  ...shared,
  rpc(name: string, args: Record<string, unknown> = {}) {
    seed();
    const tenant = currentTenant().id;
    if (name === "is_current_user_tenant_admin") return answer(mode() !== "forbidden");
    if (name === "get_mcp_connections_v2") return answer([...grants.values()].filter(g => g.tenant_id === tenant).map(g => ({
      connection_id: g.connection_id, provider_key: "generic-remote", label: labels.get(g.connection_id),
      transport: "http", auth_kind: "none", configured: false, enabled: true, status: "pending_verification",
      health: "unknown", last_checked_at: null, granted_scopes: [], visibility: "tenant", server_url_host: null,
      tool_count: 0, approved_count: 0, address_configured: false, credentials_configured: false,
      custom_header_count: 0, config_generation: 0,
    })));
    if (!["get_mcp_contact_sync", "set_mcp_contact_sync", "create_mcp_inbound_connection"].includes(name))
      return shared.rpc(name, args);
    if (args._tenant_id !== tenant) return refusal("MCP_TENANT_MISMATCH");
    if (mode() === "forbidden") return refusal("MCP_FORBIDDEN");
    if (name === "create_mcp_inbound_connection") {
      if (mode() === "unknown") return Promise.reject(new Error("Synthetic lost creation reply"));
      const id = `${tenant}-created-${++nextId}`;
      const record = { connection_id: id, tenant_id: tenant, enabled: false, configured_enabled: false,
        credential_configured: false, generation: 0, granted_at: null, operation: "contacts.create_update" };
      grants.set(id, record); labels.set(id, String(args._label)); return answer({ ...record });
    }
    const record = grants.get(String(args._connection_id));
    if (!record || record.tenant_id !== tenant) return refusal("MCP_FORBIDDEN");
    if (name === "get_mcp_contact_sync") {
      if (mode() === "readfail") return refusal("MCP_CONTACT_READ_UNAVAILABLE");
      return answer({ ...record });
    }
    if (mode() === "unknown") return Promise.reject(new Error("Synthetic lost write reply"));
    if (args._expected_generation !== record.generation) return refusal("MCP_CONTACT_SYNC_STALE");
    const commit = () => {
      record.generation++; record.enabled = args._enabled === true;
      record.configured_enabled = record.enabled; record.credential_configured = record.enabled;
      record.granted_at = record.enabled ? "2026-09-30T12:00:00.000Z" : null;
      return { data: { ...record }, error: null };
    };
    // Capture the original bound record. A context change does not retarget an in-flight write.
    if (mode() === "late") return new Promise(resolve => setTimeout(() => resolve(commit()), 1200));
    return Promise.resolve(commit());
  },
};
export default { supabase };
