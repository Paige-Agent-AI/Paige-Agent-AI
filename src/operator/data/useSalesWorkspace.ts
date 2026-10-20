import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SalesPipeline {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_default: boolean;
  lifecycle_status: string;
  short_ref: string | null;
}

export interface SalesStage {
  id: string;
  pipeline_id: string;
  label: string;
  color: string | null;
  order_index: number;
  probability: number | null;
  stage_type: string;
  move_policy: string | null;
}

export interface SalesDeal {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  value_cents: number;
  currency: string;
  status: string;
  expected_close_date: string | null;
  actual_close_date: string | null;
  lost_reason: string | null;
  source: string | null;
  tags: string[] | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesSummary {
  open_deals: number;
  open_value_cents: number;
  won_deals: number;
  won_value_cents: number;
  lost_deals: number;
  pipelines: number;
}

export interface SalesWorkspaceData {
  summary: SalesSummary;
  pipelines: SalesPipeline[];
  stages: SalesStage[];
  deals: SalesDeal[];
}

export function useSalesWorkspace() {
  const [data, setData] = useState<SalesWorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data: result, error: rpcError } = await supabase.rpc("operator_sales_workspace");
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setData(result as unknown as SalesWorkspaceData);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createDeal = useCallback(async (deal: {
    title: string;
    pipeline_id: string;
    stage_id?: string;
    value_cents?: number;
    expected_close_date?: string;
    source?: string;
    notes?: string;
  }) => {
    const { data: result, error: rpcError } = await supabase.rpc("operator_sales_deal_create", {
      p_title: deal.title,
      p_pipeline_id: deal.pipeline_id,
      p_stage_id: deal.stage_id ?? null,
      p_value_cents: deal.value_cents ?? 0,
      p_expected_close_date: deal.expected_close_date ?? null,
      p_source: deal.source ?? null,
      p_notes: deal.notes ?? null,
    });
    if (rpcError) throw new Error(rpcError.message);
    await refresh();
    return result;
  }, [refresh]);

  const moveDeal = useCallback(async (dealId: string, toStageId: string) => {
    const { data: result, error: rpcError } = await supabase.rpc("operator_sales_deal_move", {
      p_deal_id: dealId,
      p_to_stage_id: toStageId,
    });
    if (rpcError) throw new Error(rpcError.message);
    await refresh();
    return result;
  }, [refresh]);

  return { data, error, loading, refresh, createDeal, moveDeal };
}
