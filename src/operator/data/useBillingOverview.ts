import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * EXP00 O-2 — the company's own billing overview, read through the ONE
 * platform-admin-gated RPC (`operator_billing_overview`). Trial subscriptions
 * are contracted intent, never collected cash; `collected_cash_cents` counts
 * PAID invoices only. No money action exists on this path.
 */
export interface BillingSubscription {
  tenant_id: string | null;
  tenant_name: string | null;
  plan_name: string | null;
  plan_slug: string | null;
  status: string;
  billing_period: string | null;
  monthly_cents: number | null;
  annual_cents: number | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_subscription_id: string | null;
  provider_mode: string | null;
  offer_code: string | null;
  is_paid: boolean;
}

export interface BillingInvoice {
  invoice_number: string | null;
  tenant_name: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  hosted_invoice_url: string | null;
}

export interface BillingAccount {
  tenant_id: string | null;
  tenant_name: string | null;
  stripe_customer_id: string | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  payment_method_exp_month: number | null;
  payment_method_exp_year: number | null;
  payment_method_connected_at: string | null;
}

export interface BillingSummary {
  subscriptions_total: number;
  trialing: number;
  active_paid: number;
  past_due: number;
  canceled: number;
  arr_cents: number;
  collected_cash_cents: number;
  open_receivables_cents: number;
  failed_or_open_invoices: number;
  upcoming_renewals_30d: number;
  billing_accounts: number;
}

export interface BillingOverviewData {
  summary: BillingSummary;
  subscriptions: BillingSubscription[];
  invoices: BillingInvoice[];
  billing_accounts: BillingAccount[];
}

export interface FunnelStep {
  step: string;
  count: number;
}

export function useBillingOverview() {
  const [data, setData] = useState<BillingOverviewData | null>(null);
  const [funnel, setFunnel] = useState<FunnelStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: result, error: rpcError } = await supabase.rpc("operator_billing_overview");
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }
      setData(result as unknown as BillingOverviewData);
      // The v1-era funnel RPC beside the book (existing, same operator gate).
      // It returns a FLAT OBJECT of named steps (signed_up … retained_30d).
      const { data: funnelResult, error: funnelError } = await supabase.rpc(
        "operator_signup_funnel",
        { p_window_days: 90 },
      );
      if (cancelled) return;
      if (funnelError || !funnelResult || typeof funnelResult !== "object") {
        // The overview stands on its own; a funnel miss degrades that one block.
        setFunnel(null);
      } else {
        const obj = funnelResult as Record<string, unknown>;
        setFunnel(
          Object.entries(obj)
            .filter(([, v]) => v != null)
            .map(([step, v]) => ({ step, count: Number(v) || 0 })),
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, funnel, error, loading };
}
