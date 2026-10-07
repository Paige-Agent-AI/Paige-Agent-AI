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
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<StripeMerchantStatus>(empty());
  const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  if (scopeRef.current !== scope) { scopeRef.current = scope; gate.current.clear(); busyRef.current = false; }

  const read = useCallback(async (action: "status" | "refresh_status") => {
    if (!mounted.current || scopeRef.current !== scope || tenantLoading || !activeTenantId || busyRef.current) return false;
    const token = gate.current.begin(); busyRef.current = true; setBusy(true); setMessage(null);
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
    mounted.current = true; busyRef.current = false; setLoading(true); setLoaded(null); setStatus(empty());
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

  const begin = useCallback(async (returnUrl: string) => {
    if (busyRef.current || !mounted.current || scopeRef.current !== scope || loaded !== scope || tenantLoading ||
      !activeTenantId || !status.canManage || !status.environment || status.state === "outcome_unknown" || error) return null;
    const token = gate.current.begin(); busyRef.current = true; setBusy(true); setMessage(null);
    let url: string | null = null;
    try {
      const result = await supabase.functions.invoke("tenant-stripe-connect", {
        body: { action: "start_onboarding", expected_tenant_id: activeTenantId, return_url: returnUrl, refresh_url: returnUrl },
      });
      if (!result.error && result.data?.tenant_id === activeTenantId && result.data?.provider_environment === status.environment)
        url = stripeHostedSetupUrl(result.data.url);
    } catch { /* An uncertain request is checked, never automatically repeated. */ }
    if (!mounted.current || scopeRef.current !== scope || !gate.current.isCurrent(token)) return null;
    busyRef.current = false; setBusy(false);
    if (!url) { setStatus(current => ({ ...current, state: "outcome_unknown" }));
      setMessage("Stripe setup could not be confirmed. Refresh status to check the existing attempt before trying again."); }
    return url;
  }, [activeTenantId, error, loaded, scope, status.canManage, status.environment, status.state, tenantLoading]);
  const current = loaded === scope && !tenantLoading;
  return { ...(current ? status : empty(activeTenantId ?? "")), loading: !current || loading,
    error: current && error, busy: current && busy, message: current ? message : null,
    reload: () => read("status"), refresh: () => read("refresh_status"), begin };
}
