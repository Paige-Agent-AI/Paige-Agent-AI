// Predictive Credit Intelligence Engine
// Generates time-sensitive, file-aware predictions for a single user (or, when
// no user_id is provided and a service-role token is present, a full daily
// sweep across active users).
//
// All inserts are performed with the service role and bypass RLS. The matching
// SELECT/UPDATE policies in the credit_predictions table give the user, their
// business's owners and admins read access.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { resolveOperatorIdentity } from "../_shared/operator-identity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PredictionType =
  | "score_drop_warning"
  | "score_increase_opportunity"
  | "reporting_date_optimization"
  | "account_age_risk"
  | "utilization_spike_warning"
  | "inquiry_strategy"
  | "new_account_timing"
  | "payment_history_risk"
  | "credit_mix_opportunity"
  | "funding_window_alert";

interface PredictionDraft {
  user_id: string;
  prediction_type: PredictionType;
  title: string;
  description: string;
  impact_score?: number | null;
  action_required?: string | null;
  action_url?: string | null;
  deadline_date?: string | null;
  bureau?: string | null;
  account_id?: string | null;
  confidence?: "high" | "medium" | "low";
  expires_at?: string | null;
  metadata?: Record<string, unknown>;
}

const FUNDING_WINDOWS: Array<{
  threshold: number;
  title: string;
  description: string;
}> = [
  {
    threshold: 620,
    title: "Funding window opened — FHA mortgage eligibility unlocked",
    description:
      "You just crossed 620. FHA mortgage lenders, most credit-union auto loans, and several fintech business LOCs (BlueVine, OnDeck) become accessible at this score. Top 3 to research now: Rocket Mortgage (FHA), Navy Federal auto, BlueVine LOC.",
  },
  {
    threshold: 640,
    title: "Funding window opened — SBA + community-bank lending now in range",
    description:
      "You just crossed 640. Most SBA 7(a) lenders, community banks, and Tier-2 auto lenders are now accessible. Top 3 to contact: Live Oak Bank (SBA), your local credit union, Capital One Auto Navigator.",
  },
  {
    threshold: 680,
    title: "Funding window opened — prime rates and premium business cards available",
    description:
      "You just crossed 680. Prime auto rates, premium business credit cards (Amex Business, Chase Ink), and most fintech term loans are now in range. Top 3: Amex Business Gold, Chase Ink Preferred, OnDeck term loan.",
  },
  {
    threshold: 700,
    title: "Funding window opened — best business LOC and term-loan rates available",
    description:
      "You just crossed 700. Best rates on business lines of credit, SBA Express, and conventional mortgages are now within reach. Top 3: BlueVine LOC at best tier, SBA Express, Chase Business term loan.",
  },
  {
    threshold: 750,
    title: "Funding window opened — you now qualify at the best available rates everywhere",
    description:
      "You just crossed 750. You qualify for virtually every personal and business credit product at top-tier rates. Top 3: Amex Platinum Business, Chase Sapphire Reserve, your local relationship bank for a portfolio LOC.",
  },
];

function utilizationImpactPoints(beforePct: number, afterPct: number): number {
  // Rough FICO utilization band gain when moving from `beforePct` down to `afterPct`.
  // Bands are intentionally conservative.
  if (beforePct <= afterPct) return 0;
  let pts = 0;
  if (beforePct > 90 && afterPct <= 90) pts += 25;
  if (beforePct > 70 && afterPct <= 70) pts += 20;
  if (beforePct > 50 && afterPct <= 50) pts += 15;
  if (beforePct > 30 && afterPct <= 30) pts += 12;
  if (beforePct > 9 && afterPct <= 9) pts += 8;
  return Math.min(pts, 60);
}

async function generateForUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ inserted: number; replaced: number }> {
  // ===== Load inputs =====
  const [accountsRes, profileRes, inquiriesRes, prevPredictionsRes] = await Promise.all([
    supabase
      .from("credit_accounts")
      .select("id, creditor, type, current_balance, balance, credit_limit, limit_amount, utilization, account_open_date, opened_on, last_reported_date, is_open, status, is_authorized_user, is_disputed_ownership, bureau_source")
      .eq("user_id", userId)
      .or("is_disputed_ownership.is.null,is_disputed_ownership.eq.false"),
    supabase
      .from("profiles")
      .select("estimated_fico_eq, estimated_fico_ex, estimated_fico_tu")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_negative_items")
      .select("id, item_type, creditor_name, date_of_occurrence, bureau, status")
      .eq("user_id", userId),
    supabase
      .from("credit_predictions")
      .select("id, prediction_type, metadata, created_at, is_dismissed")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const accounts = (accountsRes.data || []) as any[];
  const negatives = (inquiriesRes.data || []) as any[];
  const profile = profileRes.data as any | null;
  const previousPredictions = (prevPredictionsRes.data || []) as any[];

  // §45: any credit-builder CTA is the TENANT'S OWN tenant-authored affiliate offer,
  // resolved present-only from the client's tenant — never a hardcoded operator affiliate
  // code (e.g. a "3ANTONIO94" referral link). When the tenant has authored no
  // credit-builder partner, the CTA is OMITTED entirely (no vendor named, no link).
  const { data: clientRow } = await supabase
    .from("clients")
    .select("tenant_id")
    .eq("linked_user_id", userId)
    .maybeSingle();
  const predictionTenantId =
    (clientRow as { tenant_id?: string | null } | null)?.tenant_id ?? null;
  const operator = await resolveOperatorIdentity(supabase, predictionTenantId);
  const creditBuilderPartner = ((operator.tradeline_partners ?? []) as Array<{
    tradeline_type?: string; label?: string; url?: string;
  }>).find((p) => p.tradeline_type === "credit_builder");

  // Hard inquiries: stored as negative items with item_type='inquiry' or in metadata; we look for date_reported within 12 months
  const hardInquiries = negatives.filter(
    (n) => (n.item_type || "").toLowerCase().includes("inquiry"),
  );

  const predictions: PredictionDraft[] = [];
  const nowMs = Date.now();

  // ===== Prediction 1: Reporting Date Optimization (per revolving card) =====
  const revolvers = accounts.filter((a) => {
    const t = (a.type || "").toLowerCase();
    const isRevolving = t === "revolving" || t === "credit_card" || t === "open";
    const limit = Number(a.credit_limit ?? a.limit_amount ?? 0);
    const bal = Number(a.current_balance ?? a.balance ?? 0);
    return isRevolving && limit > 0 && bal > 0 && a.is_open !== false && !a.is_authorized_user;
  });

  for (const card of revolvers) {
    const limit = Number(card.credit_limit ?? card.limit_amount ?? 0);
    const balance = Number(card.current_balance ?? card.balance ?? 0);
    const util = (balance / limit) * 100;
    if (util <= 9) continue;

    const targetBalance = Math.floor(limit * 0.09);
    const paydown = Math.max(0, balance - targetBalance);
    const points = utilizationImpactPoints(util, 9);
    if (points < 5) continue;

    // Estimated reporting date — most issuers report on or near statement close.
    // Without a known close date, approximate to 25th of current month.
    const today = new Date();
    const reportDay = 25;
    let reportDate = new Date(today.getFullYear(), today.getMonth(), reportDay);
    if (reportDate.getTime() < today.getTime()) {
      reportDate = new Date(today.getFullYear(), today.getMonth() + 1, reportDay);
    }
    const deadline = new Date(reportDate.getTime() - 5 * 24 * 60 * 60 * 1000);
    const deadlineStr = deadline.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });

    const bureau = (card.bureau_source || "all").toString();
    predictions.push({
      user_id: userId,
      prediction_type: "reporting_date_optimization",
      title: `Pay ${card.creditor} before ${deadlineStr} to boost your score`,
      description: `${card.creditor} typically reports your balance around the ${reportDay}th of each month. Your current balance of $${balance.toLocaleString()} on a $${limit.toLocaleString()} limit puts you at ${util.toFixed(0)}% utilization. Paying it down to about $${targetBalance.toLocaleString()} before ${deadlineStr} drops your reported utilization under 9% and could add roughly ${Math.round(points * 0.6)}–${points} points to your score.`,
      impact_score: points,
      action_required: `Pay ${card.creditor} down to $${targetBalance.toLocaleString()} or less before ${deadlineStr}.`,
      deadline_date: deadline.toISOString(),
      bureau,
      account_id: card.id,
      confidence: "high",
      expires_at: reportDate.toISOString(),
      metadata: { utilization: util, paydown_target: targetBalance, paydown_amount: paydown },
    });
  }

  // ===== Prediction 2: Account Age Risk =====
  const datedAccounts = accounts
    .map((a) => ({
      ...a,
      _opened: a.account_open_date || a.opened_on || null,
      _ageMonths: (() => {
        const d = a.account_open_date || a.opened_on;
        if (!d) return 0;
        const diff = Date.now() - new Date(d).getTime();
        return Math.floor(diff / (30.44 * 24 * 60 * 60 * 1000));
      })(),
    }))
    .filter((a) => a._ageMonths > 0)
    .sort((b, a) => a._ageMonths - b._ageMonths);

  const top3Oldest = datedAccounts.slice(0, 3);
  const avgAgeMonths = datedAccounts.length > 0
    ? Math.round(datedAccounts.reduce((s, a) => s + a._ageMonths, 0) / datedAccounts.length)
    : 0;

  for (const acct of top3Oldest) {
    const balance = Number(acct.current_balance ?? acct.balance ?? 0);
    const lastReported = acct.last_reported_date ? new Date(acct.last_reported_date) : null;
    const monthsSinceActivity = lastReported
      ? Math.floor((Date.now() - lastReported.getTime()) / (30.44 * 24 * 60 * 60 * 1000))
      : null;

    const isInactive =
      (acct.type || "").toLowerCase().includes("revolv") &&
      balance === 0 &&
      (monthsSinceActivity ?? 0) > 6;
    const isClosing = ["closed", "charged_off"].includes((acct.status || "").toLowerCase());
    if (!isInactive && !isClosing) continue;

    const ordinal = top3Oldest.indexOf(acct) === 0 ? "oldest" : top3Oldest.indexOf(acct) === 1 ? "2nd oldest" : "3rd oldest";
    const ageYears = (acct._ageMonths / 12).toFixed(1);
    const projectedAvg = datedAccounts.length > 1
      ? Math.round(
          (datedAccounts.reduce((s, a) => s + a._ageMonths, 0) - acct._ageMonths) /
            (datedAccounts.length - 1),
        )
      : 0;
    const ageImpact = Math.min(35, Math.max(8, Math.round((acct._ageMonths - projectedAvg) / 3)));

    predictions.push({
      user_id: userId,
      prediction_type: "account_age_risk",
      title: `Your ${ordinal} account may be at risk — could drop your score ${ageImpact} points`,
      description: `Your ${acct.creditor} account opened ${ageYears} years ago is your ${ordinal} account and anchors your average credit age at ${(avgAgeMonths / 12).toFixed(1)} years. If this account closes due to inactivity your average credit age would drop to ${(projectedAvg / 12).toFixed(1)} years which could reduce your score by ${Math.round(ageImpact * 0.5)}–${ageImpact} points across all three bureaus.`,
      impact_score: -ageImpact,
      action_required: "Make a small purchase on this account every 3–6 months to keep it active. Even a $5 transaction prevents inactivity closure.",
      bureau: "all",
      account_id: acct.id,
      confidence: "high",
      metadata: { age_months: acct._ageMonths, months_since_activity: monthsSinceActivity },
    });
  }

  // ===== Prediction 3: Utilization Spike Warning =====
  const totalLimit = revolvers.reduce((s, c) => s + Number(c.credit_limit ?? c.limit_amount ?? 0), 0);
  const totalBalance = revolvers.reduce((s, c) => s + Number(c.current_balance ?? c.balance ?? 0), 0);
  const overallUtil = totalLimit > 0 ? (totalBalance / totalLimit) * 100 : 0;

  const lastUtilPrediction = previousPredictions
    .filter((p) => p.prediction_type === "utilization_spike_warning" || p.prediction_type === "reporting_date_optimization")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const previousOverallUtil = (lastUtilPrediction?.metadata as any)?.overall_utilization as number | undefined;

  if (
    overallUtil > 30 &&
    (previousOverallUtil === undefined || overallUtil - previousOverallUtil >= 15)
  ) {
    const highest = [...revolvers]
      .map((c) => ({
        creditor: c.creditor,
        util: (Number(c.current_balance ?? c.balance ?? 0) / Number(c.credit_limit ?? c.limit_amount ?? 1)) * 100,
        id: c.id,
      }))
      .sort((a, b) => b.util - a.util)[0];

    predictions.push({
      user_id: userId,
      prediction_type: "utilization_spike_warning",
      title: `Your utilization is ${overallUtil.toFixed(0)}% — this is hurting your score`,
      description:
        previousOverallUtil !== undefined
          ? `Your overall credit-card utilization has climbed from ${previousOverallUtil.toFixed(0)}% to ${overallUtil.toFixed(0)}%. Utilization above 30% noticeably reduces your score across all three bureaus.`
          : `Your overall credit-card utilization is currently ${overallUtil.toFixed(0)}%. Anything above 30% creates downward pressure on your score across all three bureaus.`,
      impact_score: -Math.min(40, Math.round((overallUtil - 30) * 0.8)),
      action_required: highest
        ? `Pay down ${highest.creditor} first — it carries the highest balance-to-limit ratio at ${highest.util.toFixed(0)}%.`
        : "Pay down the card with the highest balance-to-limit ratio first.",
      bureau: "all",
      account_id: highest?.id ?? null,
      confidence: "high",
      metadata: { overall_utilization: overallUtil, previous_utilization: previousOverallUtil ?? null },
    });
  }

  // ===== Prediction 4: Funding Window Alert =====
  const scores: Array<{ bureau: string; score: number | null }> = [
    { bureau: "Equifax", score: profile?.estimated_fico_eq ?? null },
    { bureau: "Experian", score: profile?.estimated_fico_ex ?? null },
    { bureau: "TransUnion", score: profile?.estimated_fico_tu ?? null },
  ];
  const middleScore = scores
    .map((s) => s.score)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b)[1];

  if (typeof middleScore === "number") {
    for (const window of FUNDING_WINDOWS) {
      if (middleScore < window.threshold) continue;
      const alreadyFired = previousPredictions.some(
        (p) =>
          p.prediction_type === "funding_window_alert" &&
          (p.metadata as any)?.threshold === window.threshold,
      );
      if (alreadyFired) continue;

      predictions.push({
        user_id: userId,
        prediction_type: "funding_window_alert",
        title: window.title,
        description: window.description,
        impact_score: null,
        action_required: "Open the Funding Marketplace to review your top matched lenders.",
        action_url: "/app?section=funding-marketplace",
        bureau: "middle",
        confidence: "high",
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { threshold: window.threshold, middle_score: middleScore },
      });
    }
  }

  // ===== Prediction 5: Credit Mix Opportunity =====
  const hasInstallment = accounts.some((a) => {
    const t = (a.type || "").toLowerCase();
    return ["installment", "auto_loan", "mortgage", "student_loan"].includes(t);
  });
  const alreadyHasMixPrediction = previousPredictions.some(
    (p) => p.prediction_type === "credit_mix_opportunity" && !p.is_dismissed,
  );
  if (!hasInstallment && accounts.length > 0 && !alreadyHasMixPrediction) {
    // Present-only CTA: name/link the tenant's OWN credit-builder partner when authored;
    // otherwise keep only the generic educational guidance (no vendor named, no link).
    const actionRequired = creditBuilderPartner
      ? `${creditBuilderPartner.label ?? "A credit-builder account"} can add an installment tradeline to your file, often starting around $15/month.`
      : "A small credit-builder account is designed specifically to add an installment tradeline to your file, often starting around $15/month.";
    predictions.push({
      user_id: userId,
      prediction_type: "credit_mix_opportunity",
      title: "Adding one installment loan could add 15–25 points to your score",
      description:
        "Your file currently shows only revolving accounts (credit cards). FICO scoring rewards a healthy mix of revolving and installment credit. Adding one small installment account — a credit-builder loan, a personal loan, or an auto loan — can improve your score 15 to 25 points within 6 months.",
      impact_score: 20,
      action_required: actionRequired,
      action_url: creditBuilderPartner?.url ?? null,
      bureau: "all",
      confidence: "high",
      metadata: { vendor_suggestion: "credit_builder" },
    });
  }

  // ===== Prediction 6: Inquiry Strategy =====
  const recentInquiries = hardInquiries.filter((n) => {
    const d = n.date_of_occurrence ? new Date(n.date_of_occurrence).getTime() : null;
    return d !== null && d > nowMs - 365 * 24 * 60 * 60 * 1000;
  });
  if (recentInquiries.length >= 3) {
    const oldest = recentInquiries
      .slice()
      .sort((a, b) => new Date(a.date_of_occurrence).getTime() - new Date(b.date_of_occurrence).getTime())[0];
    const ageOffDate = new Date(new Date(oldest.date_of_occurrence).getTime() + 365 * 24 * 60 * 60 * 1000);
    const monthsToAgeOff = Math.max(
      0,
      Math.ceil((ageOffDate.getTime() - nowMs) / (30.44 * 24 * 60 * 60 * 1000)),
    );
    const lowImpact = recentInquiries.length * 2;
    const highImpact = Math.min(25, recentInquiries.length * 5);

    predictions.push({
      user_id: userId,
      prediction_type: "inquiry_strategy",
      title: `You have ${recentInquiries.length} hard inquiries — your score is being suppressed`,
      description: `Hard inquiries from credit applications affect your score for 12 months and stay on your report for 24. Your ${recentInquiries.length} recent inquiries are collectively suppressing your score by an estimated ${lowImpact}–${highImpact} points. The next inquiry to age off is ${oldest.creditor_name || "your oldest inquiry"} in roughly ${monthsToAgeOff} months.`,
      impact_score: -highImpact,
      action_required: "Pause new credit applications for 90 days to let your inquiry count naturally reduce.",
      bureau: "all",
      confidence: "high",
      metadata: { inquiry_count: recentInquiries.length, next_age_off: ageOffDate.toISOString() },
    });
  }

  // ===== Prediction 7: New Account Timing =====
  const newest = datedAccounts[datedAccounts.length - 1];
  if (newest && newest._ageMonths < 6) {
    const monthsToWait = 6 - newest._ageMonths;
    const okDate = new Date(Date.now() + monthsToWait * 30 * 24 * 60 * 60 * 1000);
    predictions.push({
      user_id: userId,
      prediction_type: "new_account_timing",
      title: `Your newest account is only ${newest._ageMonths} months old — timing matters for your next application`,
      description: `Your ${newest.creditor} account opened ${newest._ageMonths} month${newest._ageMonths === 1 ? "" : "s"} ago. Most lenders prefer to see at least 6 months of history on new accounts before approving additional credit. Applying now risks denial or a lower limit. Waiting until around ${okDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })} significantly improves your approval odds.`,
      impact_score: null,
      action_required: `Hold off on new credit applications until at least ${okDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
      bureau: "all",
      account_id: newest.id,
      confidence: "medium",
      metadata: { newest_account_age_months: newest._ageMonths, ok_date: okDate.toISOString() },
    });
  }

  // ===== Replace stale, non-dismissed predictions for the same type/account =====
  // We only delete predictions the user hasn't dismissed and that are older than
  // 24 hours, so dismissed insights stay dismissed and fresh ones aren't churned.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let replaced = 0;
  if (predictions.length > 0) {
    const types = Array.from(new Set(predictions.map((p) => p.prediction_type)));
    const { count } = await supabase
      .from("credit_predictions")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("is_dismissed", false)
      .in("prediction_type", types)
      .lt("created_at", cutoff);
    replaced = count ?? 0;

    const { error } = await supabase.from("credit_predictions").insert(predictions);
    if (error) {
      console.error("[generate-credit-predictions] insert error:", error);
      throw error;
    }
  }

  return { inserted: predictions.length, replaced };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    let userIds: string[] = [];

    if (body?.user_id) {
      // Authenticated single-user run. Allow service-role caller OR the user themselves.
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      const isService = token === serviceKey;

      if (!isService) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userRes } = await userClient.auth.getUser();
        if (!userRes?.user || userRes.user.id !== body.user_id) {
          // Allow admins
          const { data: roles } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userRes?.user?.id || "");
          const allowed = (roles || []).some((r: { role: string }) => r.role === "admin");
          if (!allowed) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }
      userIds = [body.user_id as string];
    } else {
      // Daily sweep — service role only.
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (token !== serviceKey) {
        return new Response(JSON.stringify({ error: "Service role required for sweep" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data } = await supabase
        .from("credit_accounts")
        .select("user_id")
        .limit(5000);
      userIds = Array.from(new Set((data || []).map((r: any) => r.user_id))).filter(Boolean);
    }

    const results: Array<{ user_id: string; inserted: number; replaced: number; error?: string }> = [];
    for (const uid of userIds) {
      try {
        const r = await generateForUser(supabase, uid);
        results.push({ user_id: uid, ...r });
      } catch (err: any) {
        results.push({ user_id: uid, inserted: 0, replaced: 0, error: err?.message || String(err) });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[generate-credit-predictions] fatal:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", message: err?.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
