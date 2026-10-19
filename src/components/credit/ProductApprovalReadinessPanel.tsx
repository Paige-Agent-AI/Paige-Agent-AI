import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, XCircle, Sparkles, MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  getCompleteProductEligibility,
  type CompleteProductEligibility,
  type ProductEligibility,
  type EligibilityStatus,
} from "@/lib/fundabilityScores";
import { useThreeFundabilityScores } from "@/hooks/useThreeFundabilityScores";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCreditFactors } from "@/hooks/useCreditFactors";
import { useAssistantName } from "@/lib/portal/customerIdentity";

// ----------------- Static product → column mapping -----------------

type Column = "personal" | "business" | "commercial";

interface ProductOverride {
  key: string;
  name: string;
  column: Column;
  /** When true, derive eligibility from a hardcoded rule rather than fundabilityScores. */
  fallback?: (ctx: { fico: number | null; banking: number; liquid: number; hasBusiness: boolean; tibMonths: number }) => Partial<ProductEligibility> | null;
}

const COLUMN_PRODUCTS: Record<Column, ProductOverride[]> = {
  personal: [
    { key: "secured_credit_card", name: "Secured Credit Card", column: "personal" },
    {
      key: "basic_unsecured_card", name: "Basic Unsecured Card", column: "personal",
      fallback: ({ fico }) => ({
        productKey: "basic_unsecured_card",
        productName: "Basic Unsecured Card (640+ FICO)",
        category: "Credit Cards",
        tier: "tier_2_near_prime",
        status: fico != null && fico >= 640 ? "ready" : (fico != null && fico >= 600 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: fico != null && fico >= 640 ? 80 : (fico != null && fico >= 600 ? 50 : 20),
        blockers: fico != null && fico < 640 ? [`Need FICO 640+ (currently ${fico})`] : [],
        rateRangeEstimate: "21–28% APR",
        recommendedLenders: ["Capital One Quicksilver", "Discover it Cash Back", "Wells Fargo Active Cash"],
        unlocks: "First unsecured cards with no annual fee.",
        paigeInsight: "Crossing 640 opens the basic unsecured card tier. These graduate from secured cards naturally as your score improves.",
      }),
    },
    { key: "rewards_credit_cards", name: "Rewards Credit Card (660+ FICO)", column: "personal" },
    { key: "premium_credit_cards", name: "Premium Credit Card (700+ FICO)", column: "personal" },
    {
      key: "personal_auto_used", name: "Personal Auto Loan (Used)", column: "personal",
      fallback: ({ fico }) => ({
        productKey: "personal_auto_used",
        productName: "Personal Auto Loan (Used)",
        category: "Auto Financing",
        tier: "tier_2_near_prime",
        status: fico != null && fico >= 620 ? "ready" : (fico != null && fico >= 500 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: fico != null && fico >= 700 ? 90 : (fico != null && fico >= 620 ? 70 : 30),
        blockers: fico != null && fico < 620 ? ["Subprime tier — high APR"] : [],
        rateRangeEstimate: fico != null && fico >= 700 ? "6–10% APR" : (fico != null && fico >= 620 ? "8–15% APR" : "15–29% APR"),
        recommendedLenders: ["Capital One Auto Navigator", "Local credit unions", "PenFed", "LightStream"],
        unlocks: "Used vehicle financing — typically lower amounts than new auto.",
        paigeInsight: "Used auto loans use FICO Auto Score 8 — can vary 40-60 points from your standard FICO. Check actual auto score before shopping.",
      }),
    },
    {
      key: "personal_auto_new", name: "Personal Auto Loan (New)", column: "personal",
      fallback: ({ fico }) => ({
        productKey: "personal_auto_new",
        productName: "Personal Auto Loan (New)",
        category: "Auto Financing",
        tier: "tier_3_prime",
        status: fico != null && fico >= 660 ? "ready" : (fico != null && fico >= 620 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: fico != null && fico >= 720 ? 95 : (fico != null && fico >= 660 ? 75 : 30),
        blockers: fico != null && fico < 660 ? [`Need FICO 660+ for prime new-car rates`] : [],
        rateRangeEstimate: fico != null && fico >= 720 ? "5–8% APR" : "8–13% APR",
        recommendedLenders: ["Manufacturer captive financing", "Chase Auto", "Bank of America", "Local credit unions"],
        unlocks: "0% APR promotional financing often available at 720+.",
        paigeInsight: "Manufacturer captive financing (Toyota Financial, Ford Credit, etc.) often beats banks — especially with promotional 0% APR offers.",
      }),
    },
    { key: "fha_mortgage", name: "FHA Mortgage", column: "personal" },
    { key: "conventional_mortgage", name: "Conventional Mortgage", column: "personal" },
    { key: "personal_line_of_credit", name: "Personal Line of Credit", column: "personal" },
  ],
  business: [
    {
      key: "business_credit_card_pg", name: "Business Credit Card (PG)", column: "business",
      fallback: ({ fico, hasBusiness }) => ({
        productKey: "business_credit_card_pg",
        productName: "Business Credit Card (Personal Guarantee)",
        category: "Business Cards",
        tier: "tier_3_prime",
        status: hasBusiness && fico != null && fico >= 680 ? "ready" : (hasBusiness && fico != null && fico >= 640 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: fico != null && fico >= 680 ? 85 : (fico != null && fico >= 640 ? 55 : 20),
        blockers: !hasBusiness ? ["Need business entity"] : (fico != null && fico < 640 ? [`Need FICO 640+ (currently ${fico})`] : []),
        rateRangeEstimate: "18–26% APR",
        recommendedLenders: ["Chase Ink Business Cash", "Amex Blue Business", "Capital One Spark", "BoA Business Advantage"],
        unlocks: "Real business cards reporting to business bureaus + earning rewards. PG required.",
        paigeInsight: "Most business cards report to your personal credit only at default — keeping utilization off your personal report. Bank of America Business cards count toward your BoA 7-card limit.",
      }),
    },
    {
      key: "bloc_fintech", name: "Business LOC — Fintech", column: "business",
      fallback: ({ fico, hasBusiness, tibMonths }) => ({
        productKey: "bloc_fintech",
        productName: "Business Line of Credit — Fintech (BlueVine/Fundbox)",
        category: "Business Funding",
        tier: "tier_2_near_prime",
        status: hasBusiness && tibMonths >= 6 && fico != null && fico >= 600 ? "ready"
          : hasBusiness ? "almost_ready" : "not_qualified_credit_path",
        qualificationScore: hasBusiness && tibMonths >= 12 && fico != null && fico >= 650 ? 85 : 50,
        blockers: !hasBusiness ? ["Need business entity"]
          : tibMonths < 6 ? ["Need 6+ months in business"]
          : (fico != null && fico < 600 ? [`Need FICO 600+ (currently ${fico})`] : []),
        rateRangeEstimate: "15–35% APR (factor-rate or interest-rate)",
        recommendedLenders: ["BlueVine", "Fundbox", "OnDeck", "Kabbage", "Lendio marketplace"],
        unlocks: "$10K-$250K revolving credit. Decisions in days, not weeks.",
        paigeInsight: "Fintech BLOCs are easier to qualify for than bank BLOCs but cost more. Use as a bridge while building toward a bank LOC.",
      }),
    },
    {
      key: "bloc_bank", name: "Business LOC — Bank", column: "business",
      fallback: ({ fico, hasBusiness, tibMonths, banking }) => ({
        productKey: "bloc_bank",
        productName: "Business Line of Credit — Bank",
        category: "Business Funding",
        tier: "tier_3_prime",
        status: hasBusiness && tibMonths >= 24 && fico != null && fico >= 680 && banking >= 60 ? "ready"
          : (hasBusiness && tibMonths >= 12 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: hasBusiness && tibMonths >= 24 && fico != null && fico >= 700 ? 90 : 40,
        blockers: !hasBusiness ? ["Need business entity"]
          : tibMonths < 24 ? ["Need 2+ years in business"]
          : (fico != null && fico < 680 ? [`Need FICO 680+ (currently ${fico})`]
          : (banking < 60 ? ["Strengthen banking relationship at primary institution"] : [])),
        rateRangeEstimate: "Prime + 1-5%",
        recommendedLenders: ["Chase Business", "Bank of America Business", "Wells Fargo BusinessLine", "Local community banks"],
        unlocks: "$50K-$500K at the lowest business rates. Best with 2+ years banking history at the issuing institution.",
        paigeInsight: "Bank BLOCs reward existing banking relationships. Your primary business bank should always be your first stop — they already see your cash flow.",
      }),
    },
    {
      key: "sba_express", name: "SBA Express Loan", column: "business",
      fallback: ({ fico, hasBusiness, tibMonths }) => ({
        productKey: "sba_express",
        productName: "SBA Express Loan",
        category: "SBA",
        tier: "tier_3_prime",
        status: hasBusiness && tibMonths >= 24 && fico != null && fico >= 680 ? "ready"
          : (hasBusiness && tibMonths >= 12 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: hasBusiness && tibMonths >= 36 && fico != null && fico >= 720 ? 90 : 50,
        blockers: !hasBusiness ? ["Need business entity"]
          : tibMonths < 24 ? ["Need 2+ years in business"]
          : (fico != null && fico < 680 ? [`Need FICO 680+ (currently ${fico})`] : []),
        rateRangeEstimate: "Prime + 4.5-6.5%",
        recommendedLenders: ["Live Oak Bank", "Huntington Bank", "Wells Fargo SBA"],
        unlocks: "Up to $500K with faster turnaround than 7(a). 36-hour SBA decision.",
        paigeInsight: "SBA Express is the fastest SBA path — banks make the decision under SBA delegated authority. Best when you need speed and a SBA-preferred lender relationship.",
      }),
    },
    {
      key: "sba_7a", name: "SBA 7(a) Loan", column: "business",
      fallback: ({ fico, hasBusiness, tibMonths }) => ({
        productKey: "sba_7a",
        productName: "SBA 7(a) Loan",
        category: "SBA",
        tier: "tier_4_super_prime",
        status: hasBusiness && tibMonths >= 24 && fico != null && fico >= 680 ? "ready"
          : (hasBusiness && tibMonths >= 12 ? "almost_ready" : "not_qualified_credit_path"),
        qualificationScore: hasBusiness && tibMonths >= 36 && fico != null && fico >= 720 ? 95 : 50,
        blockers: !hasBusiness ? ["Need business entity"]
          : tibMonths < 24 ? ["Need 2+ years in business"]
          : (fico != null && fico < 680 ? [`Need FICO 680+ (currently ${fico})`] : []),
        rateRangeEstimate: "Prime + 2.75-4.75%",
        recommendedLenders: ["Live Oak Bank", "Newtek", "Celtic Bank", "Local SBA preferred lenders"],
        unlocks: "Up to $5M for working capital, equipment, real estate, debt refinancing.",
        paigeInsight: "SBA 7(a) is the most flexible SBA program — almost any business purpose qualifies. Long approval timeline (2-3 months) but best terms available for small business.",
      }),
    },
    { key: "dscr_loan", name: "DSCR Loan", column: "business" },
    { key: "equipment_financing", name: "Equipment Financing", column: "business" },
  ],
  commercial: [
    {
      key: "ramp_corporate", name: "Ramp Corporate Card", column: "commercial",
      fallback: ({ hasBusiness }) => ({
        productKey: "ramp_corporate",
        productName: "Ramp Corporate Card",
        category: "Commercial Cards",
        tier: "asset_backed",
        status: hasBusiness ? "ready" : "not_qualified_credit_path",
        qualificationScore: hasBusiness ? 80 : 0,
        blockers: !hasBusiness ? ["Need business entity"] : [],
        rateRangeEstimate: "Charge card — pay in full monthly",
        recommendedLenders: ["Ramp"],
        unlocks: "No PG required. Underwriting based on business bank balance + revenue, not credit score.",
        paigeInsight: "Ramp uses your business bank balance to set the limit (typically 30 days of expenses). No personal guarantee. Pure EIN-only product.",
      }),
    },
    {
      key: "brex_corporate", name: "Brex Corporate Card", column: "commercial",
      fallback: ({ hasBusiness }) => ({
        productKey: "brex_corporate",
        productName: "Brex Corporate Card",
        category: "Commercial Cards",
        tier: "asset_backed",
        status: hasBusiness ? "ready" : "not_qualified_credit_path",
        qualificationScore: hasBusiness ? 80 : 0,
        blockers: !hasBusiness ? ["Need business entity"] : ["Strongest fit for venture-backed or high-revenue businesses"],
        rateRangeEstimate: "Charge card — pay in full",
        recommendedLenders: ["Brex"],
        unlocks: "No PG required. Tailored for venture-backed, ecommerce, or high-revenue businesses.",
        paigeInsight: "Brex requires $50K+ in a US business bank account or VC backing. Best for tech startups and high-growth ecommerce.",
      }),
    },
    {
      key: "commercial_loc", name: "Commercial Line of Credit", column: "commercial",
      fallback: ({ hasBusiness, tibMonths }) => ({
        productKey: "commercial_loc",
        productName: "Commercial Line of Credit",
        category: "Commercial",
        tier: "tier_4_super_prime",
        status: hasBusiness && tibMonths >= 36 ? "almost_ready" : "not_qualified_credit_path",
        qualificationScore: hasBusiness && tibMonths >= 36 ? 60 : 20,
        blockers: !hasBusiness ? ["Need business entity"]
          : tibMonths < 36 ? ["Need 3+ years in business"]
          : ["Established business credit (Paydex 80+) required"],
        rateRangeEstimate: "Prime + 1-3%",
        recommendedLenders: ["Major commercial banks", "Regional bank commercial divisions"],
        unlocks: "$250K+ at the best commercial rates.",
        paigeInsight: "True commercial LOCs require established business credit AND a multi-year banking relationship. This is the destination for EIN-only credit building.",
      }),
    },
    {
      key: "cre_loan", name: "Commercial Real Estate Loan", column: "commercial",
      fallback: ({ hasBusiness, fico }) => ({
        productKey: "cre_loan",
        productName: "Commercial Real Estate Loan",
        category: "Commercial Real Estate",
        tier: "asset_backed",
        status: hasBusiness && fico != null && fico >= 660 ? "almost_ready" : "not_qualified_credit_path",
        qualificationScore: hasBusiness && fico != null && fico >= 720 ? 80 : 40,
        blockers: !hasBusiness ? ["Need business entity"]
          : (fico != null && fico < 660 ? [`Need FICO 660+ (currently ${fico})`] : ["Down payment 20-30% typically required"]),
        rateRangeEstimate: "Prime + 1-3% (longer amortization)",
        recommendedLenders: ["Live Oak", "Wells Fargo Commercial", "JP Morgan Commercial Banking", "Local commercial lenders"],
        unlocks: "Owner-occupied or investment commercial property financing.",
        paigeInsight: "CRE underwriting weights property cash flow heavily. SBA 504 is often the best path for owner-occupied property purchases — 10% down, fixed rates.",
      }),
    },
  ],
};

// ----------------- Status helpers -----------------

const STATUS_META: Record<EligibilityStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "Ready", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  almost_ready: { label: "Almost Ready", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", icon: AlertCircle },
  not_qualified_credit_path: { label: "Not Yet", color: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  asset_path_available: { label: "Asset Path", color: "bg-primary/15 text-primary border-primary/30", icon: Sparkles },
  always_available: { label: "Available", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
};

// ----------------- Component -----------------

export function ProductApprovalReadinessPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const { factors } = useCreditFactors();
  const { personal: personalScore } = useThreeFundabilityScores();

  // Derive strongest + weakest bureau from the personal fundability bureau breakdown.
  const { strongestBureau, weakestBureau } = useMemo(() => {
    const bureaus = personalScore?.bureauScores;
    if (!bureaus) return { strongestBureau: null as null | "experian" | "transunion" | "equifax", weakestBureau: null as null | "experian" | "transunion" | "equifax" };
    const entries = (Object.entries(bureaus) as Array<["experian" | "transunion" | "equifax", { score: number | null; locked: boolean }]>)
      .filter(([, v]) => !v.locked && typeof v.score === "number");
    if (entries.length === 0) return { strongestBureau: null, weakestBureau: null };
    const sorted = [...entries].sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
    return {
      strongestBureau: sorted[0][0],
      weakestBureau: sorted.length > 1 ? sorted[sorted.length - 1][0] : null,
    };
  }, [personalScore]);

  const { data: profileData } = useQuery({
    queryKey: ["product-readiness-inputs"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [profileRes, bizRes, banksRes, negRes, reportRes, accountsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("estimated_fico_eq, estimated_fico_ex, estimated_fico_tu, has_real_estate_equity, real_estate_equity_range, has_equipment_assets, has_invoice_receivables, has_investment_accounts, investment_account_value_range, total_liquid_assets_range, monthly_revenue_range, primary_bank_months, primary_bank_average_balance")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("businesses")
          .select("id, entity_type, formation_date, ein, has_bank_account, bank_account_opened_date, estimated_annual_revenue, dnb_paydex, experian_intelliscore, equifax_payment_index")
          .eq("owner_user_id", user.id)
          .order("display_order", { ascending: true, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("banking_relationships" as any)
          .select("*")
          .eq("user_id", user.id),
        supabase
          .from("credit_negative_items")
          .select("date_of_occurrence, date_reported, item_type, status")
          .eq("user_id", user.id),
        supabase
          .from("credit_report_personal_info")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("credit_accounts")
          .select("creditor, type, account_open_date, opened_on, account_close_date, status, is_authorized_user")
          .eq("user_id", user.id),
      ]);
      return {
        profile: profileRes.data,
        business: bizRes.data,
        banks: (banksRes.data ?? []) as any[],
        negatives: (negRes.data ?? []) as any[],
        reportCount: reportRes.count ?? 0,
        accounts: (accountsRes.data ?? []) as any[],
      };
    },
  });

  const eligibility: CompleteProductEligibility | null = useMemo(() => {
    if (!profileData) return null;
    const p = profileData.profile;
    const b = profileData.business;
    return getCompleteProductEligibility({
      ficoEq: p?.estimated_fico_eq ?? null,
      ficoEx: p?.estimated_fico_ex ?? null,
      ficoTu: p?.estimated_fico_tu ?? null,
      paymentHistoryScore: factors?.payment_history_score ?? null,
      utilizationScore: factors?.utilization_score ?? null,
      inquiryScore: factors?.inquiry_score ?? null,
      creditMixScore: factors?.credit_mix_score ?? null,
      activeNegatives: factors?.active_negatives ?? null,
      negativeAccounts: profileData.negatives.map((n: any) => ({
        date: n.date_of_occurrence ?? n.date_reported ?? null,
        itemType: n.item_type ?? null,
        isActive: (n.status ?? "active") !== "removed",
      })),
      hasPersonalCreditFile: profileData.reportCount > 0,
      hasBusiness: Boolean(b?.id),
      entityType: b?.entity_type ?? null,
      formationDate: b?.formation_date ?? null,
      ein: b?.ein ?? null,
      hasBusinessBankAccount: b?.has_bank_account ?? null,
      bankAccountOpenedDate: b?.bank_account_opened_date ?? null,
      estimatedAnnualRevenue: b?.estimated_annual_revenue ?? null,
      paydex: b?.dnb_paydex ?? null,
      intelliscore: b?.experian_intelliscore ?? null,
      hasBusinessCreditDataPoint: Boolean(b && (b.dnb_paydex || b.experian_intelliscore || b.equifax_payment_index)),
      bankingRelationships: profileData.banks.map((br: any) => ({
        institutionName: br.institution_name ?? null,
        institutionType: br.institution_type ?? null,
        relationshipType: br.relationship_type ?? null,
        monthsAtInstitution: br.months_at_institution ?? null,
        averageMonthlyBalance: br.average_monthly_balance ? Number(br.average_monthly_balance) : null,
        isPrimaryInstitution: br.is_primary_institution ?? false,
        hasDirectDeposit: br.has_direct_deposit ?? false,
        overdraftCount12mo: br.overdraft_count_last_12_months ?? 0,
        nsfCount12mo: br.nsf_count_last_12_months ?? 0,
        accountStanding: br.account_standing ?? "good",
      })),
      primaryBankMonths: p?.primary_bank_months ?? null,
      primaryBankAverageBalance: p?.primary_bank_average_balance ? Number(p.primary_bank_average_balance) : null,
      hasInvestmentAccounts: p?.has_investment_accounts ?? null,
      investmentRange: (p?.investment_account_value_range ?? null) as any,
      totalLiquidAssetsRange: (p?.total_liquid_assets_range ?? null) as any,
      hasRealEstateEquity: p?.has_real_estate_equity ?? null,
      realEstateEquityRange: (p?.real_estate_equity_range ?? null) as any,
      hasEquipmentAssets: p?.has_equipment_assets ?? null,
      hasInvoiceReceivables: p?.has_invoice_receivables ?? null,
      monthlyRevenueRange: (p?.monthly_revenue_range ?? null) as any,
      businessAverageMonthlyBalance: null,
      creditAccounts: (profileData.accounts ?? []).map((a: any) => ({
        creditor: a.creditor ?? null,
        type: a.type ?? null,
        openedOn: a.account_open_date ?? a.opened_on ?? null,
        closedOn: a.account_close_date ?? null,
        status: a.status ?? null,
        isAuthorizedUser: a.is_authorized_user ?? false,
      })),
      strongestBureau,
      weakestBureau,
    });
  }, [profileData, factors, strongestBureau, weakestBureau]);

  // Build column-organized list
  const columns = useMemo(() => {
    const fico = eligibility?.profileSummary.avgFico ?? null;
    const banking = eligibility?.profileSummary.bankingScore ?? 0;
    const liquid = eligibility?.profileSummary.liquidScore ?? 0;
    const hasBusiness = Boolean(profileData?.business?.id);
    const tibMonths = profileData?.business?.formation_date
      ? Math.floor((Date.now() - new Date(profileData.business.formation_date).getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 0;

    const ctx = { fico, banking, liquid, hasBusiness, tibMonths };

    const resolve = (override: ProductOverride): ProductEligibility => {
      const fromEngine = eligibility?.flatList.find(p => p.productKey === override.key);
      if (fromEngine) return fromEngine;
      const fb = override.fallback?.(ctx);
      return {
        productKey: override.key,
        productName: override.name,
        tier: fb?.tier ?? "tier_0_credit_building",
        category: fb?.category ?? "General",
        status: fb?.status ?? "not_qualified_credit_path",
        qualificationScore: fb?.qualificationScore ?? 0,
        blockers: fb?.blockers ?? ["Eligibility data unavailable"],
        rateRangeEstimate: fb?.rateRangeEstimate ?? null,
        recommendedLenders: fb?.recommendedLenders ?? [],
        unlocks: fb?.unlocks ?? "",
        paigeInsight: fb?.paigeInsight ?? "",
      };
    };

    return {
      personal: COLUMN_PRODUCTS.personal.map(resolve),
      business: COLUMN_PRODUCTS.business.map(resolve),
      commercial: COLUMN_PRODUCTS.commercial.map(resolve),
    };
  }, [eligibility, profileData]);

  const summary = useMemo(() => {
    const all = [...columns.personal, ...columns.business, ...columns.commercial];
    const ready = all.filter(p => p.status === "ready" || p.status === "always_available" || p.status === "asset_path_available").length;
    const almost = all.filter(p => p.status === "almost_ready").length;
    const notReady = all.filter(p => p.status === "not_qualified_credit_path").length;
    const boosted = all.filter(p => (p.comparableCredit?.modifierScore ?? 0) > 0).length;
    const flagged = all.filter(p => (p.comparableCredit?.modifierScore ?? 0) < 0).length;
    return { ready, almost, notReady, boosted, flagged, total: all.length };
  }, [columns]);

  const handleAskPaige = () => {
    sessionStorage.setItem(
      "paige_prefilled_message",
      "Based on my Product Approval Readiness, what is the single most impactful thing I can do this month to unlock more funding options?"
    );
    navigate("/app");
  };

  if (!profileData) return null;

  return (
    <Card className="border-primary/20">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-start gap-3 text-left min-w-0">
              <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-semibold text-base">Product Approval Readiness</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="text-emerald-600 font-medium">Ready for {summary.ready}</span>
                  <span className="mx-1.5">·</span>
                  <span className="text-emerald-600">{summary.boosted} boosted by comparable credit</span>
                  <span className="mx-1.5">·</span>
                  <span className="text-destructive">{summary.flagged} flagged for comparable credit risk</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                {summary.ready} ready
              </Badge>
              {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-2 border-t border-border">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleAskPaige} className="gap-1.5">
                <MessageCircle className="w-3.5 h-3.5" />
                What should I focus on?
              </Button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ProductColumn title="Personal" products={columns.personal} />
              <ProductColumn title="Business" products={columns.business} />
              <ProductColumn title="Commercial" products={columns.commercial} />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function ProductColumn({ title, products }: { title: string; products: ProductEligibility[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gold">{title}</h4>
      <div className="space-y-2">
        {products.map(p => <ProductCard key={p.productKey} product={p} />)}
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: ProductEligibility }) {
  const assistant = useAssistantName();
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[product.status];
  const Icon = meta.icon;
  const topBlocker = product.blockers[0] ?? "Ready to apply";
  const cc = product.comparableCredit;
  const adj = product.adjustedApprovalLikelihood ?? product.qualificationScore;

  const ccBadge = cc
    ? (cc.overallQuality === "excellent"
        ? { label: "Excellent Comparable Credit", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" }
        : cc.overallQuality === "good"
        ? { label: "Good Comparable Credit", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" }
        : cc.overallQuality === "mixed"
        ? { label: "Mixed Comparable Credit", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" }
        : cc.overallQuality === "negative"
        ? { label: "Negative Comparable Credit", cls: "bg-destructive/15 text-destructive border-destructive/30" }
        : { label: "Thin File for This Product", cls: "bg-muted text-muted-foreground border-border" })
    : null;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full p-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-sm font-medium leading-tight">{product.productName}</p>
          <Badge variant="outline" className={`text-[10px] gap-1 shrink-0 ${meta.color}`}>
            <Icon className="w-2.5 h-2.5" />
            {meta.label}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{product.category}</span>
          <span className="text-[11px] font-mono text-muted-foreground">{adj}%</span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{topBlocker}</p>
      </button>
      {expanded && (
        <div className="border-t border-border bg-muted/20 p-3 space-y-2 text-xs">
          {product.rateRangeEstimate && (
            <p><span className="font-medium">Rate:</span> {product.rateRangeEstimate}</p>
          )}
          {product.blockers.length > 0 && (
            <div>
              <p className="font-medium mb-1">Blockers:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                {product.blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          {product.recommendedLenders.length > 0 && (
            <div>
              <p className="font-medium mb-1">Recommended:</p>
              <p className="text-muted-foreground">{product.recommendedLenders.slice(0, 4).join(" · ")}</p>
            </div>
          )}
          {product.unlocks && (
            <p><span className="font-medium">Unlocks:</span> <span className="text-muted-foreground">{product.unlocks}</span></p>
          )}
          {cc && ccBadge && (
            <div className="rounded border border-border bg-background p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">Your Credit Story for This Product</p>
                <Badge variant="outline" className={`text-[10px] ${ccBadge.cls}`}>{ccBadge.label}</Badge>
              </div>
              <p className="text-muted-foreground">{cc.narrative}</p>
              <p className="text-[11px] text-muted-foreground/80 italic">{cc.lenderPerspective}</p>
              <p className={`text-[11px] font-medium ${
                cc.modifierScore > 0 ? "text-emerald-600"
                : cc.modifierScore < 0 ? "text-destructive"
                : "text-muted-foreground"
              }`}>
                {cc.modifierScore > 0
                  ? `+${cc.modifierScore}% from comparable credit history`
                  : cc.modifierScore < 0
                  ? `${cc.modifierScore}% from comparable credit concern`
                  : "No comparable history — neutral effect"}
              </p>
            </div>
          )}
          {product.bureauStrategy && product.bureauStrategy.hasAnyKnownPull && (
            <div className="rounded border border-border bg-background p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">Bureau Strategy</p>
                <Badge variant="outline" className="text-[10px] border-gold/40 text-gold">
                  Verified {product.bureauStrategy.verifiedOn}
                </Badge>
              </div>
              {product.bureauStrategy.matchingBureauLenders.length > 0 && (
                <p className="text-[11px]">
                  <span className="font-medium text-emerald-600">Best lenders for your bureau profile: </span>
                  <span className="text-muted-foreground">{product.bureauStrategy.matchingBureauLenders.slice(0, 4).join(" · ")}</span>
                </p>
              )}
              {product.bureauStrategy.weakBureauLenders.length > 0 && (
                <p className="text-[11px]">
                  <span className="font-medium text-destructive">Avoid leading with: </span>
                  <span className="text-muted-foreground">{product.bureauStrategy.weakBureauLenders.slice(0, 4).join(" · ")}</span>
                  <span className="text-muted-foreground"> — apply these after your stronger bureau applications.</span>
                </p>
              )}
              {product.bureauStrategy.neutralLenders.length > 0 && (
                <p className="text-[11px]">
                  <span className="font-medium">No personal pull: </span>
                  <span className="text-muted-foreground">{product.bureauStrategy.neutralLenders.slice(0, 4).join(" · ")}</span>
                </p>
              )}
              <p className="text-[11px] text-muted-foreground italic">{product.bureauStrategy.bureauAdvice}</p>
              <p className="text-[10px] text-muted-foreground/80">
                Bureau pull data verified {product.bureauStrategy.verifiedOn} — always confirm with lender before applying.
              </p>
            </div>
          )}
          {product.bureauStrategy && !product.bureauStrategy.hasAnyKnownPull && product.recommendedLenders.length > 0 && (
            <div className="rounded border border-border bg-background p-2 text-[11px] text-muted-foreground italic">
              Bureau pull: Verify before applying — ask {assistant} which bureau each lender pulls for your state.
            </div>
          )}
          {product.paigeInsight && (
            <div className="rounded bg-primary/5 border border-primary/15 p-2 text-muted-foreground italic">
              <span className="font-medium not-italic text-primary">{assistant}: </span>{product.paigeInsight}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
