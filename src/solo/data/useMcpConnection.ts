/**
 * A workspace's own MCP connection, per provider.
 *
 * READS come from `get_tenant_mcp_connections`, which returns state only: whether a
 * connection exists, whether it is enabled, its status, its transport, and the last four
 * characters of the credential. It never returns the server URL or the credential, and it
 * never returns the provider's own error text — so there is no path by which any of that
 * can reach a browser, whatever this file does.
 *
 * WRITES go through the `tenant-mcp-connect` edge function rather than straight to the
 * setter RPC. That is deliberate: saving a row proves nothing, and the setter therefore
 * writes `pending_verification`. Only the edge function, which holds the service-role
 * probe writer, can make a real MCP request and move the row to `connected`. Calling the
 * RPC directly from here would leave every connection stuck unproven — and, worse, would
 * let the surface imply a working connection it had never tested.
 *
 * THE CREDENTIAL IS WRITE-ONLY. It is passed as an argument, sent, and dropped. It is
 * never held in this hook's state, never logged, never echoed into an error, and never
 * returned by any read.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";

export type McpProvider = "n8n" | "zapier";

export type McpConnection = {
  configured: boolean;
  enabled: boolean;
  label: string | null;
  /** Last four characters only. The credential itself is never returned by the seam. */
  last4: string | null;
  /** `unconfigured` | `pending_verification` | `connected` | `error`. */
  status: string | null;
  transport: string | null;
  authKind: string | null;
  /**
   * The HOST only. The seam never returns the full address on purpose: an n8n MCP
   * trigger URL carries a random path segment that is itself a capability, so showing
   * it back would put a secret on screen.
   */
  serverUrlHost: string | null;
  lastProbedAt: string | null;
  toolCount: number | null;
  approvedToolCount: number | null;
  pinnedCount: number | null;
};

export type McpState = McpConnection & {
  loading: boolean;
  /** The read failed. Distinct from "not configured" — nothing is claimed either way. */
  error: boolean;
  canWrite: boolean;
  saving: boolean;
  /** Owner-language only. Raw database or provider text is never surfaced. */
  writeError: string | null;
};

export type McpDraft = {
  serverUrl: string;
  credential: string;
  authKind: "bearer" | "header";
  headerName: string;
  transport: "http" | "sse";
  label: string;
};

const EMPTY: McpConnection = {
  configured: false, enabled: false, label: null, last4: null,
  status: null, transport: null, authKind: null, serverUrlHost: null, lastProbedAt: null,
  toolCount: null, approvedToolCount: null, pinnedCount: null,
};

function readConnection(value: unknown, provider: McpProvider): McpConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
  const row = (value as Record<string, unknown>)[provider];
  if (!row || typeof row !== "object" || Array.isArray(row)) return EMPTY;
  const r = row as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const approved = Array.isArray(r.approved_capabilities) && r.approved_capabilities.every((value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value))
    && new Set(r.approved_capabilities).size === r.approved_capabilities.length ? r.approved_capabilities.length : null;
  return {
    configured: r.configured === true,
    enabled: r.enabled === true,
    label: str(r.label),
    last4: str(r.auth_token_last4),
    status: str(r.status),
    transport: str(r.transport),
    authKind: str(r.auth_kind),
    serverUrlHost: str(r.server_url_host),
    lastProbedAt: str(r.last_probed_at),
    toolCount: count(r.tool_count),
    approvedToolCount: approved,
    pinnedCount: count(r.pinned_count),
  };
}

/**
 * Every failure the connect path can produce, in the product's own words.
 *
 * Two families arrive here and they mean different things, so they are kept apart. A
 * `MCP_*` code is the setter refusing to store what was typed — nothing was contacted. A
 * transport or protocol code is the probe having genuinely tried and failed, which means
 * something IS stored and is not working. Collapsing them would leave an admin unable to
 * tell "I typed it wrong" from "the server rejected my credential".
 */
export function mcpWriteMessage(code: unknown, kind: "write" | "probe" = "write"): string {
  const c = typeof code === "string" ? code : "";
  switch (c) {
    case "MCP_FORBIDDEN": return "Only a workspace admin can change this connection.";
    case "MCP_NO_URL": return "Add the address of your MCP server.";
    case "MCP_INSECURE_URL": return "The address has to start with https:// so the credential is never sent in the clear.";
    case "MCP_URL_CREDENTIALS": return "Remove the username and password from the address; the credential belongs in its own field.";
    case "MCP_NO_TOKEN": return "Add a credential.";
    case "MCP_NO_HEADER_NAME": return "Header authentication needs the name of the header to send.";
    case "MCP_BAD_TRANSPORT": return "That transport is not one this provider supports.";
    case "MCP_BAD_AUTH_KIND": return "That authentication method is not one this provider supports.";
    case "MCP_NO_TENANT": return "This workspace could not be identified, so nothing was changed.";
    // The probe reached the network and came back with an answer.
    case "url_must_be_https": return "The address has to start with https:// so the credential is never sent in the clear.";
    case "url_has_embedded_credentials": return "Remove the username and password from the address; the credential belongs in its own field.";
    case "url_host_not_allowed":
    case "url_resolves_to_private_address": return "That address points somewhere private, so it was not contacted.";
    case "url_host_unresolvable": return "That address could not be looked up.";
    case "url_redirect_refused": return "That address redirects somewhere else, which is not followed. Use the address it points at.";
    case "request_timed_out": return "The server did not answer in time. It is saved but not working.";
    case "mcp_http_error": return "The server rejected the credential. It is saved but not working.";
    case "http_rate_limited": return "The server is rate-limiting requests right now. It is saved; wait a moment and check again — reconnecting will not help.";
    case "mcp_malformed_response":
    case "mcp_protocol_error": return "That address answered, but not as an MCP server. It is saved but not working.";
    case "invalid_url": return "That address is not a valid URL.";
    default:
      return kind === "probe"
        ? "It was saved, but the server could not be reached, so it is not working yet."
        : "That did not save, and nothing was changed. Check the address and the credential, then try again.";
  }
}

export function useMcpConnection(provider: McpProvider) {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const gate = useRef(createSettingsRequestGate());
  const scope = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${provider}:${tenantLoading}`;
  const scopeRef = useRef(scope);
  const mounted = useRef(false);
  const mutation = useRef(0);
  const pendingMutation = useRef(false);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  // Mask and invalidate during render, before an effect can expose the old workspace.
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    gate.current.clear();
    mutation.current += 1;
    pendingMutation.current = false;
  }
  const [state, setState] = useState<McpState>({
    ...EMPTY, loading: true, error: false, canWrite: false, saving: false, writeError: null,
  });

  const load = useCallback(async () => {
    if (!mounted.current || scopeRef.current !== scope) return;
    const token = gate.current.begin();
    if (!activeTenantId || tenantLoading) {
      setState({ ...EMPTY, loading: false, error: false, canWrite: false, saving: false, writeError: null });
      return;
    }
    const [connections, admin] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("get_tenant_mcp_connections"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).rpc("is_current_user_tenant_admin"),
    ]).catch(() => [{ data: null, error: true }, { data: null, error: true }]);
    if (!mounted.current || scopeRef.current !== scope || !gate.current.isCurrent(token)) return;
    setLoadedScope(scope);
    if (connections.error) {
      setState({ ...EMPTY, loading: false, error: true, canWrite: false, saving: pendingMutation.current, writeError: null });
      return;
    }
    setState({
      ...readConnection(connections.data, provider),
      loading: false,
      error: false,
      canWrite: admin?.error ? false : admin?.data === true,
      saving: pendingMutation.current,
      writeError: null,
    });
  }, [activeTenantId, provider, scope, tenantLoading]);

  useEffect(() => {
    mounted.current = true;
    const activeGate = gate.current;
    if (!tenantLoading) void load();
    return () => { mounted.current = false; mutation.current += 1; pendingMutation.current = false; activeGate.clear(); };
  }, [load, tenantLoading]);

  const invoke = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    if (!activeTenantId || tenantLoading || !mounted.current || scopeRef.current !== scope || loadedScope !== scope || !state.canWrite || pendingMutation.current) return false;
    pendingMutation.current = true;
    const request = ++mutation.current;
    gate.current.clear();
    const current = () => mounted.current && scopeRef.current === scope && mutation.current === request;
    setState((prev) => ({ ...prev, saving: true, writeError: null }));
    try {
    // The workspace this request was STARTED for. The server resolves the tenant itself
    // and this grants nothing; it only lets the server refuse if the person switched
    // workspaces between clicking and the request landing, which would otherwise rebind
    // the whole mutation to whichever workspace happened to be active by then.
    const { data, error } = await supabase.functions.invoke("tenant-mcp-connect", {
      body: { provider, expected_tenant_id: activeTenantId, ...body },
    });
    // A failed request and a request that succeeded but could not save are the same
    // thing to an admin: nothing changed. A failed PROBE is not — the connection was
    // stored, it just does not work, and saying "nothing changed" there would be false.
    // The reason lives in the response BODY, and on a non-2xx that body is on the error
    // rather than on `data`. Reading only `data` left `code` undefined for every refusal
    // the RPC actually raises, so a permission failure and a malformed address produced
    // the same generic line.
    if (!current()) return false;
    const failure = await readFunctionErrorBody(error, data);
    if (!current()) return false;
    if (error || typeof failure?.error === "string") {
      const code = typeof failure?.code === "string" ? failure.code : undefined;
      setState((prev) => ({ ...prev, saving: false, writeError: mcpWriteMessage(code, "write") }));
      return false;
    }
    const result = data as { status?: string; code?: string };
    pendingMutation.current = false;
    await load();
    if (!current()) return false;
    if (result?.status === "error") {
      setState((prev) => ({ ...prev, writeError: mcpWriteMessage(result.code, "probe") }));
      return false;
    }
    return true;
    } catch {
      if (current()) setState((prev) => ({ ...prev, saving: false, writeError: mcpWriteMessage(null) }));
      return false;
    } finally {
      if (current()) { pendingMutation.current = false; setState((prev) => ({ ...prev, saving: false })); }
    }
  }, [activeTenantId, load, provider, tenantLoading, scope, loadedScope, state.canWrite]);

  /** The credential is an argument here and nowhere else. */
  const connect = useCallback((draft: McpDraft) => invoke({
    action: "connect",
    server_url: draft.serverUrl.trim(),
    auth_token: draft.credential,
    auth_kind: draft.authKind,
    header_name: draft.authKind === "header" ? draft.headerName.trim() : "",
    transport: draft.transport,
    label: draft.label.trim(),
  }), [invoke]);

  /** Re-runs the probe against what is already stored. Never re-sends a credential. */
  const verify = useCallback(() => invoke({ action: "verify" }), [invoke]);

  /**
   * Connect a provider whose ADDRESS is the credential.
   *
   * Deliberately not a variant of `connect` with empty strings for the other fields: a
   * blank token and a blank header name are indistinguishable from a form the person
   * failed to fill in, and the endpoint would have to guess which was meant. Sending only
   * what exists says the shape outright.
   */
  const connectByUrl = useCallback((serverUrl: string, label: string) => invoke({
    action: "connect",
    server_url: serverUrl.trim(),
    label: label.trim(),
  }), [invoke]);

  const disconnect = useCallback(() => invoke({ action: "disconnect" }), [invoke]);

  const dismissWriteError = useCallback(() => setState((prev) => ({ ...prev, writeError: null })), []);

  const visible = loadedScope === scope && !tenantLoading ? state : {
    ...EMPTY, loading: !!activeTenantId || tenantLoading, error: false,
    canWrite: false, saving: false, writeError: null,
  };
  return { ...visible, connect, connectByUrl, verify, disconnect, reload: load, dismissWriteError };
}
