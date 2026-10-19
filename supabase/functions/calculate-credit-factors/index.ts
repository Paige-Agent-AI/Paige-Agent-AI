import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { contactAccessible, refuseCustomerTier } from "../_shared/finance-entitlement.ts";

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

    const userId = user.id;
    const refuse = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // E09 F1b: credit scoring is not a customer feature — a portal customer is refused before any read.
    const tier = await refuseCustomerTier(supabase, userId);
    if (!tier.ok) return refuse(tier.status, tier.error);

    // Check for optional client_id in request body
    let clientId: string | null = null;
    try {
      const body = await req.json();
      clientId = body?.client_id || null;
    } catch {
      // No body or invalid JSON — calculate for user's own data
    }

    // E09 F1b: a client_id from the body must be a contact the caller may act on in their own business
    // (can_access_contact). This client was the service role, so before this any signed-in user could
    // read and score any business's client by naming its id. `client_id` on credit_accounts,
    // credit_negative_items and credit_factor_scores is a foreign key to clients(id) (read on
    // production 2026-10-19), so the contact id is the right key for can_access_contact.
    if (clientId) {
      const access = await contactAccessible(supabase, userId, clientId);
      if (!access.ok) return refuse(access.status, access.error);
    }

    // Build query filter: use client_id if provided, otherwise user_id
    const buildFilter = (query: any) => {
      if (clientId) return query.eq("client_id", clientId);
      return query.eq("user_id", userId);
    };

    // Fetch all credit data in parallel
    const [accountsRes, negativesRes, inquiriesRes] = await Promise.all([
      buildFilter(supabase.from("credit_accounts").select("*")),
      buildFilter(supabase.from("credit_negative_items").select("*")),
      supabase.from("credit_inquiries").select("*").eq("user_id", userId),
    ]);

    const accounts = accountsRes.data || [];
    const negatives = negativesRes.data || [];
    const inquiries = inquiriesRes.data || [];

    // === Deduplication helper: group by creditor+account for scoring ===
    function deduplicateForScoring(items: any[]): any[] {
      const groups = new Map<string, any>();
      for (const item of items) {
        const key = `${(item.creditor_name || "").toLowerCase().trim()}::${(item.account_number_masked || "").toLowerCase().trim()}`;
        if (!groups.has(key)) groups.set(key, item);
      }
      return Array.from(groups.values());
    }

    // === PAYMENT HISTORY (35%) ===
    // Deduplicate for scoring — same account on multiple bureaus counts once
    const uniqueNegatives = deduplicateForScoring(negatives);
    const uniqueActive = uniqueNegatives.filter((n: any) => n.status === "active" || n.status !== "removed");

    const chargeOffs = uniqueNegatives.filter((n: any) => {
      const t = (n.item_type || "").toLowerCase();
      return t.includes("charge") || t === "charge_off";
    });
    const collections = uniqueNegatives.filter((n: any) => (n.item_type || "").toLowerCase().includes("collection"));
    const latePayments = uniqueNegatives.filter((n: any) => (n.item_type || "").toLowerCase().includes("late"));
    const activeNegatives = uniqueNegatives.filter((n: any) => n.status === "active");
    const removedNegatives = negatives.filter((n: any) => n.status === "removed");

    let paymentHistoryScore = 100;
    // Charge-offs: -15 each, max -75
    paymentHistoryScore -= Math.min(chargeOffs.filter((n: any) => n.status === "active").length * 15, 75);
    // Collections: -12 each, max -60
    paymentHistoryScore -= Math.min(collections.filter((n: any) => n.status === "active").length * 12, 60);
    // Late payments: -5 each, max -25
    paymentHistoryScore -= Math.min(latePayments.filter((n: any) => n.status === "active").length * 5, 25);
    // High-balance negatives (>$1000): -3 each, max -15
    const highBalanceNegs = activeNegatives.filter((n: any) => (n.amount || 0) > 1000);
    paymentHistoryScore -= Math.min(highBalanceNegs.length * 3, 15);
    paymentHistoryScore = Math.max(0, paymentHistoryScore);

    const totalNegatives = uniqueNegatives.length;
    const oldestNegativeDate = negatives.length > 0
      ? negatives.reduce((oldest: string | null, n: any) => {
          const d = n.date_of_occurrence || n.date_reported;
          return d && (!oldest || d < oldest) ? d : oldest;
        }, null as string | null)
      : null;

    // === UTILIZATION (30%) ===
    const revolvingAccounts = accounts.filter(
      (a: any) => a.type === "revolving" || a.type === "credit_card"
    );
    const totalLimit = revolvingAccounts.reduce(
      (sum: number, a: any) => sum + (Number(a.credit_limit) || Number(a.limit_amount) || 0), 0
    );
    const totalBalance = revolvingAccounts.reduce(
      (sum: number, a: any) => sum + (Number(a.current_balance) || Number(a.balance) || 0), 0
    );
    const aggregateUtilization = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;

    const cardsOver30 = revolvingAccounts.filter((a: any) => {
      const limit = Number(a.credit_limit) || Number(a.limit_amount) || 0;
      const bal = Number(a.current_balance) || Number(a.balance) || 0;
      return limit > 0 && (bal / limit) * 100 > 30;
    }).length;
    const cardsOver50 = revolvingAccounts.filter((a: any) => {
      const limit = Number(a.credit_limit) || Number(a.limit_amount) || 0;
      const bal = Number(a.current_balance) || Number(a.balance) || 0;
      return limit > 0 && (bal / limit) * 100 > 50;
    }).length;
    const cardsOver70 = revolvingAccounts.filter((a: any) => {
      const limit = Number(a.credit_limit) || Number(a.limit_amount) || 0;
      const bal = Number(a.current_balance) || Number(a.balance) || 0;
      return limit > 0 && (bal / limit) * 100 > 70;
    }).length;

    let utilizationScore = 100;
    if (aggregateUtilization > 70) utilizationScore = 15;
    else if (aggregateUtilization > 50) utilizationScore = 35;
    else if (aggregateUtilization > 30) utilizationScore = 55;
    else if (aggregateUtilization > 10) utilizationScore = 80;
    utilizationScore -= Math.min(cardsOver70 * 10, 30);
    utilizationScore = Math.max(0, utilizationScore);

    // === CREDIT AGE (15%) ===
    const now = new Date();
    const openAccounts = accounts.filter((a: any) => a.is_open !== false);
    const accountAges = openAccounts
      .map((a: any) => {
        const opened = a.account_open_date || a.opened_on;
        if (!opened) return null;
        const months = Math.floor(
          (now.getTime() - new Date(opened).getTime()) / (1000 * 60 * 60 * 24 * 30)
        );
        return months;
      })
      .filter((a: any): a is number => a !== null);

    const avgAge = accountAges.length > 0
      ? Math.round(accountAges.reduce((s: number, a: number) => s + a, 0) / accountAges.length)
      : 0;
    const oldestAge = accountAges.length > 0 ? Math.max(...accountAges) : 0;
    const newestAge = accountAges.length > 0 ? Math.min(...accountAges) : 0;

    let creditAgeScore = 0;
    if (avgAge >= 84) creditAgeScore = 100;
    else if (avgAge >= 60) creditAgeScore = 80;
    else if (avgAge >= 36) creditAgeScore = 60;
    else if (avgAge >= 24) creditAgeScore = 45;
    else if (avgAge >= 12) creditAgeScore = 30;
    else creditAgeScore = 15;

    // === CREDIT MIX (10%) ===
    const revolvingCount = accounts.filter(
      (a: any) => a.type === "revolving" || a.type === "credit_card"
    ).length;
    const installmentCount = accounts.filter((a: any) =>
      ["installment", "personal_loan", "auto_loan", "student_loan"].includes(a.type)
    ).length;
    const mortgageCount = accounts.filter((a: any) => a.type === "mortgage").length;

    const typesPresent = [revolvingCount > 0, installmentCount > 0, mortgageCount > 0].filter(Boolean).length;
    let creditMixScore = typesPresent >= 3 ? 100 : typesPresent === 2 ? 70 : typesPresent === 1 ? 40 : 10;
    if (accounts.length >= 10) creditMixScore = Math.min(100, creditMixScore + 10);

    // === INQUIRIES (10%) ===
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const activeInquiries = inquiries.filter((i: any) => i.status === "active");
    const tuInquiries = activeInquiries.filter((i: any) => (i.bureau || "").toLowerCase().includes("trans")).length;
    const exInquiries = activeInquiries.filter((i: any) => (i.bureau || "").toLowerCase().includes("exper")).length;
    const eqInquiries = activeInquiries.filter((i: any) => (i.bureau || "").toLowerCase().includes("equi")).length;

    const recentInquiries = activeInquiries.filter(
      (i: any) => new Date(i.inquiry_date) >= sixMonthsAgo
    ).length;

    let inquiryScore = 100;
    if (recentInquiries >= 6) inquiryScore = 20;
    else if (recentInquiries >= 4) inquiryScore = 40;
    else if (recentInquiries >= 3) inquiryScore = 55;
    else if (recentInquiries >= 2) inquiryScore = 70;
    else if (recentInquiries >= 1) inquiryScore = 85;

    const inquiryBudget = Math.max(0, 2 - recentInquiries);

    // === OVERALL FUNDABILITY ===
    const overallScore = Math.round(
      paymentHistoryScore * 0.35 +
      utilizationScore * 0.30 +
      creditAgeScore * 0.15 +
      creditMixScore * 0.10 +
      inquiryScore * 0.10
    );

    // Upsert the factor scores
    const factorData: Record<string, any> = {
      user_id: userId,
      calculated_at: new Date().toISOString(),
      payment_history_score: paymentHistoryScore,
      total_negatives: totalNegatives,
      active_negatives: activeNegatives.length,
      removed_negatives: removedNegatives.length,
      oldest_negative_date: oldestNegativeDate,
      utilization_score: utilizationScore,
      aggregate_utilization: Math.round(aggregateUtilization * 100) / 100,
      total_credit_limit: totalLimit,
      total_balance: totalBalance,
      cards_over_30_pct: cardsOver30,
      cards_over_50_pct: cardsOver50,
      cards_over_70_pct: cardsOver70,
      credit_age_score: creditAgeScore,
      average_account_age_months: avgAge,
      oldest_account_age_months: oldestAge,
      newest_account_age_months: newestAge,
      credit_mix_score: creditMixScore,
      revolving_count: revolvingCount,
      installment_count: installmentCount,
      mortgage_count: mortgageCount,
      inquiry_score: inquiryScore,
      total_inquiries_tu: tuInquiries,
      total_inquiries_ex: exInquiries,
      total_inquiries_eq: eqInquiries,
      inquiry_budget_remaining: inquiryBudget,
      overall_fundability_score: overallScore,
      data_sources: {
        accounts_count: accounts.length,
        negatives_count: negatives.length,
        inquiries_count: inquiries.length,
      },
    };

    if (clientId) factorData.client_id = clientId;

    const { data, error } = await supabase
      .from("credit_factor_scores")
      .insert(factorData)
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
