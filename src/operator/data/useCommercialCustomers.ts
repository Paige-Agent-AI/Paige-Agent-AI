import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The O-1 Customers desk read for the Platform Operator — L1 commercial
 * records only (enrollment, subscription, workspace, welcome). No L2 tenant
 * business data crosses this boundary. The RPC is platform-admin gated and
 * projects existing canonical tables; this hook is one more caller, not a
 * new data path.
 *
 * Truth rules (§13): collected cash is 0 until Stripe confirms a real
 * collection; a trialing subscription is intent, not revenue; the surface
 * must render "—" for anything the platform cannot substantiate.
 */
export type CommercialCustomer = {
  user_id: string;
  business_name: string | null;
  account_number: number | null;
  tenant_id: string | null;
  enrollment_state: string;
  enrolled_at: string | null;
  reference_id: string | null;
  subscription_status: string | null;
  provider_mode: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  offer_code: string | null;
  welcome_state: string | null;
  welcome_attempts: number | null;
  welcome_last_error: string | null;
  workspace_provisioned: boolean;
  owner_membership_active: boolean;
  last_event_state: string | null;
  last_event_error: string | null;
};

export type CommercialSummary = {
  total_enrollments: number;
  fulfilled: number;
  pending: number;
  active_trials: number;
  active_paid: number;
  welcomes_sent: number;
  welcomes_needing_attention: number;
  welcomes_retrying: number;
  collected_cents: number;
};

export type CommercialCustomersData = {
  customers: CommercialCustomer[];
  summary: CommercialSummary;
  generated_at: string;
};

export function useCommercialCustomers() {
  const [data, setData] = useState<CommercialCustomersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: result, error: rpcError } = await supabase.rpc(
        "operator_commercial_customers",
      );
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }
      setData(result as CommercialCustomersData);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, error, loading };
}

export type CustomerHistory = {
  user_id: string;
  enrollment: {
    state: string;
    reference_id: string;
    checkout_session: string | null;
    stripe_subscription: string | null;
    stripe_customer: string | null;
    tenant_id: string | null;
    enrolled_at: string | null;
  } | null;
  intake: {
    business_name: string | null;
    industry: string | null;
    team_size: string | null;
    plan_slug: string | null;
    agreement_version: number | null;
    terms_accepted_at: string | null;
  } | null;
  subscription: {
    status: string;
    provider_mode: string;
    trial_started_at: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    stripe_subscription_id: string;
  } | null;
  workspace: {
    account_number: number;
    name: string;
    account_type: string;
    status: string;
    beta_entitled: boolean;
  } | null;
  welcome: {
    state: string;
    attempts: number;
    last_error: string | null;
    provider_message_id: string | null;
    first_attempt_at: string | null;
  } | null;
  webhook_events: Array<{
    type: string;
    state: string;
    attempts: number;
    error: string | null;
    received_at: string;
    completed_at: string | null;
  }>;
  fulfillment_receipts: Array<{
    event_id: string;
    outcome: string;
    reference_id: string;
  }>;
};

export function useCustomerHistory(userId: string | null) {
  const [data, setData] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: result, error: rpcError } = await supabase.rpc(
        "operator_customer_history",
        { p_user_id: userId },
      );
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setLoading(false);
        return;
      }
      setData(result as CustomerHistory);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { data, error, loading };
}
