import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";

export type SocialConnection = {
  id: string;
  requestedPlatform: string | null;
  label: string | null;
  status: "setup_required" | "authorizing" | "connected" | "needs_reauth" | "disconnected" | "error";
  authorizationExpiresAt: string | null;
  lastVerifiedAt: string | null;
  disconnectedAt: string | null;
  failureCode: string | null;
  accountCount: number;
  providedByPlatform: boolean;
};

export type SocialAccount = {
  id: string;
  connectionId: string;
  platform: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: "connected" | "needs_reauth" | "disconnected" | "revoked" | "error";
  selected: boolean;
  capabilities: string[];
  lastVerifiedAt: string | null;
};

type PendingAction = {
  capability: "social_connection_start" | "social_connection_disconnect" | "social_account_select" | "social_connection_adopt";
  fingerprint: string;
  summary: string;
  expiresAt: string | null;
  request: Record<string, unknown>;
};

type State = {
  scope: string | null;
  loading: boolean;
  busy: boolean;
  canManage: boolean;
  connections: SocialConnection[];
  accounts: SocialAccount[];
  pending: PendingAction | null;
  error: string | null;
  statusError: string | null;
  notice: string | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function date(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function connections(value: unknown): SocialConnection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = object(raw);
    if (!row || typeof row.id !== "string" || typeof row.status !== "string") return [];
    if (!["setup_required", "authorizing", "connected", "needs_reauth", "disconnected", "error"].includes(row.status)) return [];
    return [{
      id: row.id,
      requestedPlatform: typeof row.requested_platform === "string" ? row.requested_platform : null,
      label: typeof row.label === "string" ? row.label : null,
      status: row.status as SocialConnection["status"],
      authorizationExpiresAt: date(row.authorization_expires_at),
      lastVerifiedAt: date(row.last_verified_at),
      disconnectedAt: date(row.disconnected_at),
      failureCode: typeof row.failure_code === "string" ? row.failure_code : null,
      accountCount: typeof row.account_count === "number" ? row.account_count : Number(row.account_count) || 0,
      providedByPlatform: row.provided_by_platform === true,
    }];
  });
}

function accounts(value: unknown): SocialAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = object(raw);
    if (!row || typeof row.id !== "string" || typeof row.connection_id !== "string" || typeof row.platform !== "string" || typeof row.status !== "string") return [];
    if (!["connected", "needs_reauth", "disconnected", "revoked", "error"].includes(row.status)) return [];
    return [{
      id: row.id,
      connectionId: row.connection_id,
      platform: row.platform,
      handle: typeof row.handle === "string" ? row.handle : null,
      displayName: typeof row.display_name === "string" ? row.display_name : null,
      avatarUrl: typeof row.avatar_url === "string" && row.avatar_url.startsWith("https://") ? row.avatar_url : null,
      status: row.status as SocialAccount["status"],
      selected: row.selected === true,
      capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter((item): item is string => typeof item === "string").slice(0, 64) : [],
      lastVerifiedAt: date(row.last_verified_at),
    }];
  });
}
async function invocationPayload(data: unknown, error: unknown): Promise<Record<string, unknown> | null> {
  const direct = object(data);
  if (direct) return direct;
  const context = object(error)?.context;
  if (typeof Response !== "undefined" && context instanceof Response) {
    try {
      return object(await context.clone().json());
    } catch {
      return null;
    }
  }
  return null;
}


function messageFor(code: string | null): string {
  if (code === "ACTIVE_ACCOUNT_CHANGED") return "Your workspace changed. Reopen Social in the intended workspace.";
  if (code === "SOCIAL_ADMIN_REQUIRED" || code === "access_denied") return "Only a workspace owner or admin can change Social connections.";
  if (code === "SOCIAL_CALLBACK_INVALID_OR_USED") return "This connection return is expired, already used, or belongs to another workspace. Start a new connection.";
  if (code === "SOCIAL_READBACK_FAILED") return "The account connection returned, but Paige could not verify it yet. Try the verification again.";
  if (code === "SOCIAL_DISCONNECT_UNCONFIRMED") return "The provider did not confirm disconnection. Nothing was marked disconnected in Paige.";
  if (code === "SOCIAL_DISCONNECT_RECONCILIATION_REQUIRED") return "The provider revoked access, but Paige could not finish the local record. Support reconciliation is required.";
  if (code === "capability_unavailable" || code === "SOCIAL_UNAVAILABLE") return "Social connection setup is not configured for this environment.";
  if (code === "SOCIAL_PROVIDER_UNAVAILABLE") return "Social authorization could not start. No account was connected. Try again; if this continues, Social provider setup needs attention.";
  if (code === "provider_profile_limit") return "This workspace has reached the current Social account capacity. No account was connected.";
  if (code === "provider_rate_limited") return "Social authorization is temporarily rate-limited. No account was connected; try again shortly.";
  return "Social could not complete that request. Nothing else was changed.";
}

export function useSocialConnections() {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const scope = `${activeUserId ?? ""}:${activeTenantId ?? ""}`;
  const identity = useRef(scope); identity.current = scope;
  const mounted = useRef(false);
  const gate = useRef(createSettingsRequestGate());
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({
    scope: null, loading: true, busy: false, canManage: false,
    connections: [], accounts: [], pending: null, error: null, statusError: null, notice: null,
  });

  const reload = useCallback(async () => {
    if (!mounted.current || tenantLoading || !activeTenantId) return;
    const token = gate.current.begin();
    const opened = scope;
    setState((current) => ({ ...current, scope: null, loading: true, statusError: null }));
    const [rawConnectionRows, rawAccountRows, rawAuthority] = await Promise.all([
      // These SECURITY DEFINER projections derive the active tenant from the caller's JWT.
      supabase.rpc("social_connection_status"),
      supabase.rpc("social_account_status"),
      supabase.rpc("social_connection_access"),
    ]);
    if (!mounted.current || identity.current !== opened || !gate.current.isCurrent(token)) return;
    const connectionRows = rawConnectionRows ?? { data: null, error: { message: "unavailable" } };
    const accountRows = rawAccountRows ?? { data: null, error: { message: "unavailable" } };
    const authority = rawAuthority ?? { data: false, error: { message: "unavailable" } };
    const readError = connectionRows.error || accountRows.error;
    setState((current) => ({
      ...current,
      scope,
      loading: false,
      canManage: !authority.error && authority.data === true,
      connections: readError ? [] : connections(connectionRows.data),
      accounts: readError ? [] : accounts(accountRows.data),
      statusError: readError ? "Social connection status could not be read. No connection is assumed." : null,
      error: readError ? "Social connection status could not be read. No connection is assumed." : current.error,
    }));
  }, [activeTenantId, scope, tenantLoading]);

  useEffect(() => {
    mounted.current = true;
    if (!tenantLoading && activeTenantId) void reload();
    const requestGate = gate.current;
    return () => { mounted.current = false; requestGate.clear(); };
  }, [activeTenantId, reload, tenantLoading]);

  const invoke = useCallback(async (request: Record<string, unknown>) => {
    if (!activeTenantId) return null;
    const opened = scope;
    setState((current) => ({ ...current, busy: true, error: null, notice: null }));
    const result = await supabase.functions.invoke("paige-social", {
      body: { ...request, expected_tenant_id: activeTenantId },
    });
    if (!mounted.current || identity.current !== opened) return null;
    const payload = await invocationPayload(result.data, result.error);
    if (!payload) {
      setState((current) => ({ ...current, busy: false, error: messageFor(null) }));
      return null;
    }
    if (payload.state === "approval_required") {
      const approval = object(payload.approval);
      if (!approval || typeof approval.fingerprint !== "string" || typeof approval.summary !== "string") {
        setState((current) => ({ ...current, busy: false, error: messageFor(null) }));
        return null;
      }
      const fingerprint = approval.fingerprint;
      const summary = approval.summary;
      const capability = request.action === "start" ? "social_connection_start"
        : request.action === "adopt" ? "social_connection_adopt"
        : request.action === "disconnect" ? "social_connection_disconnect" : "social_account_select";
      setState((current) => ({ ...current, busy: false, pending: {
        capability,
        fingerprint,
        summary,
        expiresAt: date(approval.expires_at),
        request,
      } }));
      return payload;
    }
    if (payload.ok !== true) {
      setState((current) => ({ ...current, busy: false, error: messageFor(typeof payload.code === "string" ? payload.code : null) }));
      return payload;
    }
    if (payload.state === "authorization_required" && typeof payload.authorization_url === "string") {
      setState((current) => ({ ...current, busy: false, pending: null, notice: "Opening secure Social authorization…" }));
      window.location.assign(payload.authorization_url);
      return payload;
    }
    setState((current) => ({
      ...current, busy: false, pending: null,
      notice: payload.state === "verified" ? "Social accounts were verified. Choose the account Paige should use."
        : payload.state === "adopted" ? "Platform channels were adopted into this workspace. Nothing was published."
        : payload.state === "selected" ? "Social account selected. No content was published."
          : payload.state === "disconnected" ? "Social access was disconnected and future actions are blocked."
            : "Social was updated.",
    }));
    await reload();
    return payload;
  }, [activeTenantId, reload, scope]);

  useEffect(() => {
    if (tenantLoading || !activeTenantId) return;
    const params = new URLSearchParams(location.search);
    const callbackResult = params.get("social_result");
    const receipt = params.get("social_receipt");
    const reason = params.get("social_reason");
    if (!callbackResult) return;
    params.delete("social_result");
    params.delete("social_receipt");
    params.delete("social_reason");
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    if (callbackResult === "verified") {
      setState((current) => ({
        ...current,
        notice: receipt === "recorded"
          ? "Social accounts were verified. Choose the account Paige should use."
          : "Social accounts were verified, but receipt evidence is unavailable. No account was selected automatically.",
        error: null,
      }));
    } else {
      setState((current) => ({
        ...current,
        error: reason === "account_already_linked"
          ? "That exact Social account is already connected to another Social identity. Disconnect it there before reconnecting it here."
          : reason === "consent_cancelled" ? "Social authorization was canceled. No account was connected or selected."
            : reason === "platform_mismatch" ? "The provider returned a different platform than the one requested. Nothing was connected."
              : "Social authorization could not be verified. Reconnect to retry; no account was selected.",
      }));
    }
    void reload();
  }, [activeTenantId, location.pathname, location.search, navigate, reload, tenantLoading]);

  const start = useCallback((returnPath: string, platform: string, label?: string, connectionId?: string) =>
    invoke({ action: "start", return_path: returnPath, platform, label: label?.trim() || null, ...(connectionId ? { connection_id: connectionId } : {}) }), [invoke]);
  const select = useCallback((connectionId: string, accountId: string) =>
    invoke({ action: "select", connection_id: connectionId, account_id: accountId }), [invoke]);
  const disconnect = useCallback((connectionId: string) =>
    invoke({ action: "disconnect", connection_id: connectionId }), [invoke]);
  // Operator hub surface: reads adoptable channels, and adopts under one governed approval.
  // The approval card is issued by invoke() like every other Social mutation.
  const hubProfiles = useCallback(() => invoke({ action: "hub_profiles" }), [invoke]);
  const adopt = useCallback((profileId: string, platforms: string[]) =>
    invoke({ action: "adopt", profileId, platforms }), [invoke]);
  const approve = useCallback(() => state.pending
    ? invoke({ ...state.pending.request, approval_fingerprint: state.pending.fingerprint })
    : Promise.resolve(null), [invoke, state.pending]);
  const decline = useCallback(async () => {
    if (!state.pending || !activeTenantId) return;
    const pending = state.pending;
    const result = await supabase.functions.invoke("paige-social", { body: {
      action: "decline", expected_tenant_id: activeTenantId,
      capability: pending.capability, approval_fingerprint: pending.fingerprint,
    } });
    const payload = object(result.data);
    setState((current) => payload?.ok === true
      ? { ...current, pending: null, notice: "Canceled. No Social change was made.", error: null }
      : { ...current, error: "The cancellation could not be recorded. Reload before approving anything.", busy: false });
  }, [activeTenantId, state.pending]);

  return {
    ...state,
    loading: tenantLoading || state.loading || state.scope !== scope,
    reload,
    start,
    select,
    disconnect,
    hubProfiles,
    adopt,
    approve,
    decline,
  };
}
