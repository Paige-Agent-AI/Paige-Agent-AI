import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { refuseCustomerTier } from "../_shared/finance-entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Unauthorized");

    // E09 F1b: funding projections and matches are not a customer feature — a portal customer is
    // refused before any read. Staff of a business without the funding entitlement are not gated
    // here (owner question Q5 is open).
    const tier = await refuseCustomerTier(supabase, user.id);
    if (!tier.ok) {
      return new Response(JSON.stringify({ error: tier.error }), { status: tier.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { scenario_name, scenario_params } = await req.json();
    if (!scenario_name || !scenario_params) {
      throw new Error("scenario_name and scenario_params are required");
    }

    const userId = user.id;

    // Get current profile and factors
    const [profileRes, factorsRes, productsRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("credit_factor_scores").select("*").eq("user_id", userId).order("calculated_at", { ascending: false }).limit(1),
      supabase.from("lender_products").select("*").eq("is_active", true),
    ]);

    const profile = profileRes.data;
    const factors = factorsRes.data?.[0];
    const products = productsRes.data || [];

    const currentScore = profile?.estimated_fico_tu || profile?.estimated_fico_ex || 600;

    // Apply scenario adjustments
    let projectedScore = currentScore;
    const params = scenario_params;

    if (params.score_change) projectedScore += params.score_change;
    if (params.remove_collections) projectedScore += params.remove_collections * 15;
    if (params.reduce_utilization_to) {
      const currentUtil = factors?.aggregate_utilization || 50;
      const utilDrop = currentUtil - params.reduce_utilization_to;
      if (utilDrop > 0) projectedScore += Math.round(utilDrop * 0.5);
    }
    if (params.remove_inquiries) projectedScore += params.remove_inquiries * 5;

    projectedScore = Math.min(850, Math.max(300, projectedScore));

    // Calculate how many products would be available at the projected score
    const projectedNegatives = Math.max(
      0,
      (factors?.active_negatives || 0) - (params.remove_collections || 0)
    );
    const projectedUtilization = params.reduce_utilization_to ?? factors?.aggregate_utilization ?? 50;

    let projectedMatches = 0;
    let projectedFunding = 0;
    const newProducts: Array<{ name: string; type: string; estimated_amount: number }> = [];

    // Get current eligible product IDs
    const { data: currentMatches } = await supabase
      .from("user_funding_matches")
      .select("lender_product_id")
      .eq("user_id", userId)
      .eq("match_status", "eligible");

    const currentEligibleIds = new Set((currentMatches || []).map(m => m.lender_product_id));

    for (const product of products) {
      let wouldQualify = true;

      if (product.min_fico_score && projectedScore < product.min_fico_score) wouldQualify = false;
      if (product.max_derogatory_items !== null && projectedNegatives > (product.max_derogatory_items || 0)) wouldQualify = false;
      if (product.max_utilization_pct && projectedUtilization > Number(product.max_utilization_pct)) wouldQualify = false;

      if (wouldQualify) {
        projectedMatches++;
        const scoreRatio = Math.min(projectedScore, 800) / 800;
        const est = product.min_amount && product.max_amount
          ? Math.round(Number(product.min_amount) + (Number(product.max_amount) - Number(product.min_amount)) * scoreRatio)
          : 0;
        projectedFunding += est;

        if (!currentEligibleIds.has(product.id)) {
          newProducts.push({
            name: `${product.lender_name} ${product.product_name}`,
            type: product.product_type,
            estimated_amount: est,
          });
        }
      }
    }

    const projection = {
      user_id: userId,
      scenario_name,
      scenario_params: params,
      projected_score: projectedScore,
      projected_matches: projectedMatches,
      projected_total_funding: projectedFunding,
      new_products_unlocked: newProducts,
    };

    const { data, error } = await supabase
      .from("funding_projections")
      .insert(projection)
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, data, current_score: currentScore }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
