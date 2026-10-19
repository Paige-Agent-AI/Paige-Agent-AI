import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { refuseCustomerTier } from "../_shared/finance-entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getMiddleScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return scores[0];
  if (scores.length === 2) return Math.min(...scores);
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[1]; // middle of 3
}

// Realistic max amounts by product type and score range
function getRealisticCap(productType: string, middleScore: number, hasChargeOffs: boolean): number {
  if (hasChargeOffs) {
    // Severely limit with active charge-offs
    if (productType.includes("sba")) return 0; // Disqualified
    if (productType.includes("unsecured") && productType.includes("line")) return 0; // Disqualified
    if (productType.includes("invoice") || productType.includes("factoring")) return 50000;
    if (productType.includes("revenue")) return 75000;
    if (productType.includes("secured")) return 25000;
    if (productType.includes("card")) return 5000;
    return 25000;
  }

  if (middleScore < 620) {
    if (productType.includes("card")) return 10000;
    if (productType.includes("line")) return 25000;
    if (productType.includes("term")) return 50000;
    if (productType.includes("sba")) return 0;
    if (productType.includes("invoice") || productType.includes("factoring")) return 100000;
    if (productType.includes("revenue")) return 150000;
    return 50000;
  }
  if (middleScore < 680) {
    if (productType.includes("card")) return 25000;
    if (productType.includes("line")) return 75000;
    if (productType.includes("term")) return 150000;
    if (productType.includes("sba")) return 100000;
    return 150000;
  }
  // 680+
  if (productType.includes("card")) return 50000;
  if (productType.includes("line")) return 250000;
  if (productType.includes("term")) return 500000;
  if (productType.includes("sba")) return 500000;
  return 500000;
}

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

    const userId = user.id;

    // Fetch all needed data in parallel
    const [profileRes, factorsRes, productsRes, accountsRes, inquiriesRes, negativesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("credit_factor_scores").select("*").eq("user_id", userId).order("calculated_at", { ascending: false }).limit(1),
      supabase.from("lender_products").select("*").eq("is_active", true),
      supabase.from("credit_accounts").select("*").eq("user_id", userId),
      supabase.from("credit_inquiries").select("*").eq("user_id", userId).eq("status", "active"),
      supabase.from("credit_negative_items").select("*").eq("user_id", userId).eq("status", "active"),
    ]);

    const profile = profileRes.data;
    const factors = factorsRes.data?.[0];
    const products = productsRes.data || [];
    const accounts = accountsRes.data || [];
    const inquiries = inquiriesRes.data || [];
    const negatives = negativesRes.data || [];

    // FIX 4: Use MIDDLE score from synced bureau scores
    const bureauScores = [
      profile?.estimated_fico_tu,
      profile?.estimated_fico_ex,
      profile?.estimated_fico_eq,
    ].filter(Boolean) as number[];
    
    const middleScore = bureauScores.length > 0 ? getMiddleScore(bureauScores) : 600;
    
    // FIX 5: Detect disqualifying conditions
    const activeChargeOffs = negatives.filter(n => 
      n.item_type?.toLowerCase().includes("charge") || n.item_type?.toLowerCase() === "charge-off"
    );
    const highBalanceChargeOffs = activeChargeOffs.filter(n => (n.amount || 0) > 5000);
    const hasHighChargeOffs = highBalanceChargeOffs.length > 0;
    const hasAnyChargeOffs = activeChargeOffs.length > 0;
    
    // Check for fraud alerts and security freezes from profile
    const hasFraudAlert = profile?.has_fraud_alert === true;
    const securityFreezes = profile?.security_freezes || [];
    
    // Check for revenue data
    const hasRevenueData = profile?.monthly_revenue != null && profile?.monthly_revenue > 0;

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const inquiries6mo = inquiries.filter(i => new Date(i.inquiry_date) >= sixMonthsAgo).length;
    const inquiries12mo = inquiries.filter(i => new Date(i.inquiry_date) >= twelveMonthsAgo).length;
    const openAccountCount = accounts.filter(a => a.is_open !== false).length;
    const derogatoryCount = negatives.length;
    const utilization = factors?.aggregate_utilization || 0;
    const avgAccountAge = factors?.average_account_age_months || 0;

    const matches = [];

    for (const product of products) {
      const blockingFactors: string[] = [];
      const warnings: string[] = [];
      let score = 100;
      const productType = (product.product_type || "").toLowerCase();

      // FIX 5: Auto-disqualify products based on charge-offs
      if (hasHighChargeOffs) {
        if (productType.includes("sba")) {
          blockingFactors.push(`Active charge-offs over $5,000 disqualify SBA products`);
          score = 0;
        }
        if (productType.includes("unsecured") && (productType.includes("line") || productType.includes("loc"))) {
          blockingFactors.push(`Active charge-offs over $5,000 disqualify unsecured lines of credit`);
          score = 0;
        }
      }

      // FIX 5: Fraud alert warning
      if (hasFraudAlert) {
        warnings.push(`Active fraud alert detected — must be addressed before applying`);
        score -= 10;
      }

      // FIX 5: Security freeze warning
      if (securityFreezes && securityFreezes.length > 0) {
        warnings.push(`Security freeze active — may block lender credit pulls`);
        score -= 10;
      }

      // FIX 5: Revenue-based products need revenue data
      if ((productType.includes("invoice") || productType.includes("factoring") || productType.includes("revenue")) && !hasRevenueData) {
        blockingFactors.push(`Revenue data required — upload bank statements or financial documents`);
        score -= 40;
      }

      // Check FICO score using middle score
      if (product.min_fico_score && middleScore < product.min_fico_score) {
        blockingFactors.push(`Need ${product.min_fico_score}+ FICO (your middle score is ${middleScore})`);
        score -= 30;
      }

      // Check inquiries
      if (product.max_inquiries_6mo && inquiries6mo > product.max_inquiries_6mo) {
        blockingFactors.push(`Max ${product.max_inquiries_6mo} inquiries in 6mo (you have ${inquiries6mo})`);
        score -= 20;
      }
      if (product.max_inquiries_12mo && inquiries12mo > product.max_inquiries_12mo) {
        blockingFactors.push(`Max ${product.max_inquiries_12mo} inquiries in 12mo (you have ${inquiries12mo})`);
        score -= 15;
      }

      // Check account age
      if (product.min_account_age_months && avgAccountAge < product.min_account_age_months) {
        blockingFactors.push(`Need ${product.min_account_age_months}+ month credit history (you have ${avgAccountAge})`);
        score -= 15;
      }

      // Check open accounts
      if (product.min_open_accounts && openAccountCount < product.min_open_accounts) {
        blockingFactors.push(`Need ${product.min_open_accounts}+ open accounts (you have ${openAccountCount})`);
        score -= 10;
      }

      // Check derogatory items
      if (product.max_derogatory_items !== null && derogatoryCount > (product.max_derogatory_items || 0)) {
        blockingFactors.push(`Max ${product.max_derogatory_items} derogatory items (you have ${derogatoryCount})`);
        score -= 25;
      }

      // Check utilization
      if (product.max_utilization_pct && utilization > Number(product.max_utilization_pct)) {
        blockingFactors.push(`Need under ${product.max_utilization_pct}% utilization (you have ${Math.round(utilization)}%)`);
        score -= 15;
      }

      score = Math.max(0, score);

      const matchStatus = score === 0
        ? "not_eligible"
        : blockingFactors.length === 0
          ? "eligible"
          : score >= 50
            ? "near_eligible"
            : "not_eligible";

      // FIX 5: Realistic estimated approval amounts
      let estimatedAmount: number | null = null;
      if (matchStatus === "eligible" && product.min_amount && product.max_amount) {
        const scoreRatio = Math.min(middleScore, 800) / 800;
        const rawEstimate = Math.round(
          Number(product.min_amount) + (Number(product.max_amount) - Number(product.min_amount)) * scoreRatio
        );
        const cap = getRealisticCap(productType, middleScore, hasAnyChargeOffs);
        estimatedAmount = Math.min(rawEstimate, cap);
        if (cap === 0) estimatedAmount = null; // Disqualified
      }

      // Build improvement path
      const improvementPath = blockingFactors.map(bf => {
        if (bf.includes("FICO")) return { action: "Improve credit score", impact: "high" };
        if (bf.includes("inquiries")) return { action: "Wait for inquiries to age", impact: "medium" };
        if (bf.includes("utilization")) return { action: "Pay down balances", impact: "high" };
        if (bf.includes("derogatory") || bf.includes("charge-off")) return { action: "Remove negative items", impact: "high" };
        if (bf.includes("account")) return { action: "Build credit history", impact: "medium" };
        if (bf.includes("Revenue")) return { action: "Upload financial documents", impact: "high" };
        return { action: "Improve profile", impact: "low" };
      });

      matches.push({
        user_id: userId,
        lender_product_id: product.id,
        match_score: score,
        estimated_approval_amount: estimatedAmount,
        match_status: matchStatus,
        blocking_factors: [...blockingFactors, ...warnings.map(w => `⚠️ ${w}`)],
        improvement_path: improvementPath,
        calculated_at: new Date().toISOString(),
      });
    }

    // Delete old matches and insert new ones
    await supabase.from("user_funding_matches").delete().eq("user_id", userId);

    if (matches.length > 0) {
      const { error } = await supabase.from("user_funding_matches").insert(matches);
      if (error) throw error;
    }

    const eligible = matches.filter(m => m.match_status === "eligible");
    const nearEligible = matches.filter(m => m.match_status === "near_eligible");
    const totalEstimated = eligible.reduce((sum, m) => sum + (m.estimated_approval_amount || 0), 0);

    return new Response(
      JSON.stringify({
        success: true,
        qualifying_score: middleScore,
        score_method: "middle_bureau",
        bureau_scores: { tu: profile?.estimated_fico_tu, ex: profile?.estimated_fico_ex, eq: profile?.estimated_fico_eq },
        risk_flags: {
          active_charge_offs: activeChargeOffs.length,
          high_balance_charge_offs: highBalanceChargeOffs.length,
          fraud_alert: hasFraudAlert,
          has_revenue_data: hasRevenueData,
        },
        summary: {
          total_products: matches.length,
          eligible: eligible.length,
          near_eligible: nearEligible.length,
          estimated_total_funding: totalEstimated,
        },
        matches: matches.sort((a, b) => b.match_score - a.match_score),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
