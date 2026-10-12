import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { createSettingsRequestGate } from "../settings-contract";

export type StripeMerchantState = "not_connected" | "setup_incomplete" | "restricted" | "ready" | "unverified" | "outcome_unknown";
export type StripeMerchantStatus = {
  tenantId: string; connected: boolean; canManage: boolean; environment: "test" | "live" | null;
  bindingVersion: number | null; chargesEnabled: boolean; payoutsEnabled: boolean;
  detailsSubmitted: boolean; paymentPermission: boolean; checkedAt: string | null; state: StripeMerchantState;
};
type MerchantApproval = {
  fingerprint: string; summary: string; expiresAt: string;
  preview: { action: "merchant.start_onboarding"; provider: "stripe"; environment: "test" | "live"; binding_version: number | null };
};
type SetupRequest = { expected_tenant_id: string; operation_id: string; command: { action: "merchant.start_onboarding"; provider: "stripe" } };
function readApproval(value: unknown, status: StripeMerchantStatus, request: SetupRequest): MerchantApproval | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>; const preview = r.preview as MerchantApproval["preview"] | undefined;
  if (r.outcome !== "approval_required" || r.tenant_id !== status.tenantId || r.operation_id !== request.operation_id || r.capability !== "sales_start_merchant_onboarding" || typeof r.fingerprint !== "string" ||
    !/^[a-f0-9]{16}$/.test(r.fingerprint) || typeof r.summary !== "string" || r.summary.length > 1000 ||
    typeof r.expires_at !== "string" || !(Date.parse(r.expires_at) > Date.now()) || !preview ||
    Object.keys(preview).sort().join(",") !== "action,binding_version,environment,provider" || preview.action !== "merchant.start_onboarding" || preview.provider !== "stripe" ||
    preview.environment !== status.environment || preview.binding_version !== status.bindingVersion) return null;
  return { fingerprint: r.fingerprint, summary: r.summary, expiresAt: r.expires_at,
    preview: { action: preview.action, provider: preview.provider, environment: preview.environment, binding_version: preview.binding_version } };
}
const STATES = new Set<StripeMerchantState>(["not_connected", "setup_incomplete", "restricted", "ready", "unverified", "outcome_unknown"]);
const empty = (tenantId = ""): StripeMerchantStatus => ({ tenantId, connected: false, canManage: false,
  environment: null, bindingVersion: null, chargesEnabled: false, payoutsEnabled: false,
  detailsSubmitted: false, paymentPermission: false, checkedAt: null, state: "unverified" });

/** Closed browser projection. A successful redirect is never readiness evidence. */
export function readStripeMerchantStatus(value: unknown, tenantId: string, now = Date.now()): StripeMerchantStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.tenant_id !== tenantId || !STATES.has(r.state as StripeMerchantState) ||
    typeof r.can_manage !== "boolean" || typeof r.connected !== "boolean" ||
    !["test", "live", null].includes(r.provider_environment as string | null) ||
    ["charges_enabled", "payouts_enabled", "details_submitted", "sales_payment_permission"].some(key => typeof r[key] !== "boolean")) return null;
  const version = Number.isSafeInteger(r.binding_version) && Number(r.binding_version) > 0 ? Number(r.binding_version) : null;
  if (r.connected && !version) return null;
  const checkedAt = typeof r.checked_at === "string" && Number.isFinite(Date.parse(r.checked_at)) ? r.checked_at : null;
  let state = r.state as StripeMerchantState;
  if (state === "ready" && (!r.connected || !r.provider_environment || r.charges_enabled !== true || r.sales_payment_permission !== true ||
    !checkedAt || Date.parse(checkedAt) > now || now - Date.parse(checkedAt) > 300_000)) state = "unverified";
  return { tenantId, connected: r.connected, canManage: r.can_manage,
    environment: r.provider_environment as StripeMerchantStatus["environment"], bindingVersion: version,
    chargesEnabled: r.charges_enabled === true, payoutsEnabled: r.payouts_enabled === true,
    detailsSubmitted: r.details_submitted === true, paymentPermission: r.sales_payment_permission === true,
    checkedAt, state };
}

export function stripeHostedSetupUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "connect.stripe.com" || url.hostname === "dashboard.stripe.com") ? url.href : null;
  } catch { return null; }
}

export const stripeMerchantWords: Record<StripeMerchantState, string> = {
  not_connected: "Not connected", setup_incomplete: "Setup incomplete", restricted: "Payments restricted",
  ready: "Ready for payment requests", unverified: "Status needs checking", outcome_unknown: "Setup needs reconciliation",
};

export function useStripeMerchant() {
  const { activeTenantId, activeUserId, loading: tenantLoading } = useTenantContext();
  const scope = `${activeUserId ?? ""}:${activeTenantId ?? ""}:${tenantLoading}`;
  const scopeRef = useRef(scope); const gate = useRef(createSettingsRequestGate());
  const mounted = useRef(false); const busyRef = useRef(false);
  const operation = useRef<SetupRequest | null>(null);
  const [approval, setApproval] = useState<MerchantApproval | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<StripeMerchantStatus>(empty());
  const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  if (scopeRef.current !== scope) { scopeRef.current = scope; gate.current.clear(); busyRef.current = false; operation.current = null; }

  const read = useCallback(async (action: "status" | "refresh_status") => {
    if (!mounted.current || scopeRef.current !== scope || tenantLoading || !activeTenantId || busyRef.current) return false;
    const token = gate.current.begin(); busyRef.current = true; setBusy(true); setMessage(null); setApproval(null);
    let parsed: StripeMerchantStatus | null = null;
    try {
      const result = await supabase.functions.invoke("tenant-stripe-connect", { body: { action, expected_tenant_id: activeTenantId } });
      if (!result.error) parsed = readStripeMerchantStatus(result.data, activeTenantId);
    } catch { /* Provider/transport text never crosses this boundary. */ }
    if (!mounted.current || scopeRef.current !== scope || !gate.current.isCurrent(token)) return false;
    busyRef.current = false; setBusy(false); setLoaded(scope); setLoading(false); setError(!parsed);
    setStatus(parsed ?? empty(activeTenantId));
    setMessage(parsed ? null : "Stripe status could not be confirmed. Refresh status before continuing.");
    return !!parsed;
  }, [activeTenantId, scope, tenantLoading]);

  useEffect(() => {
    mounted.current = true; busyRef.current = false; setLoading(true); setLoaded(null); setStatus(empty()); setApproval(null);
    if (!tenantLoading && activeTenantId) void read("status");
    else { setLoading(false); setLoaded(scope); }
    const currentGate = gate.current;
    return () => { mounted.current = false; currentGate.clear(); };
  }, [activeTenantId, read, scope, tenantLoading]);

  // Expire a displayed readiness claim even if the owner leaves the drawer open.
  useEffect(() => {
    if (status.state !== "ready" || !status.checkedAt) return;
    const timer = setTimeout(() => setStatus(current => ({ ...current, state: "unverified" })),
      Math.max(0, Date.parse(status.checkedAt) + 300_001 - Date.now()));
    return () => clearTimeout(timer);
  }, [status.state, status.checkedAt]);

  const submit = useCallback(async (approve = false) => {
    if (busyRef.current || !mounted.current || scopeRef.current !== scope || loaded !== scope || tenantLoading ||
      !activeTenantId || !status.canManage || !status.environment || status.state === "outcome_unknown" || error) return null;
    if (approve && (!approval || Date.parse(approval.expiresAt) <= Date.now() || !operation.current)) {
      setApproval(null); setMessage("This review expired. Request a fresh review before continuing."); return null;
    }
    const request = operation.current ?? { expected_tenant_id: activeTenantId, operation_id: crypto.randomUUID(), command: { action: "merchant.start_onboarding" as const, provider: "stripe" as const } };
    operation.current = request;
    const token = gate.current.begin(); busyRef.current = true; setBusy(true); setMessage(null);
    let url: string | null = null;
    let response: Record<string, unknown> | null = null;
    try {
      const result = await supabase.functions.invoke("tenant-stripe-connect", {
        body: { ...request, ...(approve && approval ? { approved_fingerprint: approval.fingerprint } : {}) },
      });
      let data = result.data;
      if (result.error && "context" in result.error && result.error.context instanceof Response) {
        try { data = await result.error.context.json(); } catch { data = null; }
      }
      if (data && typeof data === "object" && !Array.isArray(data) && data.tenant_id === activeTenantId && data.provider_environment === status.environment) {
        response = data; if (data.ok === true) url = stripeHostedSetupUrl(data.url);
      }
    } catch { /* An uncertain request is checked, never automatically repeated. */ }
    if (!mounted.current || scopeRef.current !== scope || !gate.current.isCurrent(token)) return null;
    busyRef.current = false; setBusy(false);
    const proposed = readApproval(response, status, request);
    if (proposed && !approve) { setApproval(proposed); return null; }
    setApproval(null);
    if (response?.outcome === "refused") {
      operation.current = null;
      const observed = readStripeMerchantStatus(response, activeTenantId);
      if (observed) setStatus(observed);
      setMessage(response.code === "PROVIDER_CONFIGURATION_REQUIRED" ? "Stripe setup needs platform configuration. Refresh status to check the existing attempt; another account will not be created." : "This setup action was not authorized or its reviewed connection changed. Refresh status before requesting a new review.");
      return null;
    }
    if (url) operation.current = null;
    if (!url) { setStatus(current => ({ ...current, state: "outcome_unknown" }));
      setMessage("Stripe setup could not be confirmed. Refresh status to check the existing attempt before trying again."); }
    return url;
  }, [activeTenantId, approval, error, loaded, scope, status, tenantLoading]);
  const current = loaded === scope && !tenantLoading;
  return { ...(current ? status : empty(activeTenantId ?? "")), loading: !current || loading,
    error: current && error, busy: current && busy, message: current ? message : null,
    approval: current ? approval : null,
    cancelReview: () => { if (!busyRef.current) { setApproval(null); operation.current = null; } },
    reload: () => read("status"), refresh: () => read("refresh_status"),
    begin: (_returnUrl?: string) => submit(false), approve: () => submit(true) };
}
