import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEffectiveUserId } from "@/lib/scopedUser";
import { countUniqueNegativeAccounts } from "@/lib/deduplicateNegatives";
import { useAssistantName } from "@/lib/portal/customerIdentity";

export interface BusinessInfraData {
  // Foundation
  hasEntity: boolean;
  hasEIN: boolean;
  addressType: string | null;
  hasPhone411: boolean;
  hasBankAccount: boolean;
  // Business credit scores
  dnbPaydex: number | null;
  experianIntelliscore: number | null;
  equifaxPaymentIndex: number | null;
  ficoSbss: number | null;
  dnbLastVerified: string | null;
  experianLastVerified: string | null;
  equifaxLastVerified: string | null;
  ficoSbssLastVerified: string | null;
  // Public presence
  presenceComplete: number;
  presenceTotal: number;
  hasConsistencyIssues: boolean;
  // Financial docs
  hasTaxReturns: boolean;
  hasPnL: boolean;
  hasBankStatements: boolean;
  // BUILD
  buildScore: number | null;
}

export interface DemographicProfile {
  gender_identity: string | null;
  ethnicity: string[] | null;
  is_veteran: boolean | null;
  is_service_disabled_veteran: boolean | null;
  is_us_citizen: boolean | null;
  is_minority_owned: boolean | null;
  is_women_owned: boolean | null;
  is_veteran_owned: boolean | null;
  is_service_disabled_veteran_owned: boolean | null;
  is_hubzone_located: boolean | null;
  has_8a_certification: boolean | null;
  has_wosb_certification: boolean | null;
  has_vetcert_certification: boolean | null;
  /** True when client appears to be a startup (TIB < 24mo OR no business yet) */
  is_startup: boolean;
}

export interface FundingProfileData {
  // Bureau scores
  middleScore: number | null;
  scores: { tu: number | null; ex: number | null; eq: number | null };
  scoreModel: string;
  lastReportDate: string | null;

  // Negative items
  negativeItems: any[];
  activeChargeOffs: any[];
  chargeOffTotal: number;
  activeCollections: any[];
  derogWithin12mo: number;
  derogWithin24mo: number;
  totalActiveNegatives: number;

  // Credit accounts (tradelines)
  creditAccounts: any[];
  highestRevolvingLimit: number;
  revolvingLimitIsHistorical: boolean;
  highestInstallmentBalance: number;
  highestLOCLimit: number;
  openAccountCount: number;
  oldestAccountAgeMonths: number;

  // Business info
  businesses: any[];
  hasEntityStructure: boolean;
  timeInBusinessMonths: number | null;
  hasEIN: boolean;

  // Financial KPIs
  financialKpis: any | null;
  hasRevenueData: boolean;
  annualRevenue: number | null;
  monthlyCashFlow: number | null;

  // Banking
  connectedBanks: number;
  hasBankingRelationship: boolean;

  // Business credit
  buildScores: any | null;
  hasBusinessCreditScores: boolean;

  // Business infrastructure (NEW)
  businessInfra: BusinessInfraData;

  // Profile completeness
  completeness: number;
  missingItems: { label: string; weight: number; cta: string; unlocks: string }[];

  // Fraud/freeze flags
  hasFraudAlert: boolean;
  hasSecurityFreeze: boolean;

  // Funding goals
  fundingGoals: any | null;

  // Demographics & ownership flags (purely additive — used for "Matched for You" boosts)
  demographics: DemographicProfile;

  isLoading: boolean;
}

function getMiddleScore(scores: (number | null)[]): number | null {
  const valid = scores.filter((s): s is number => s != null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  if (valid.length === 2) return Math.min(...valid);
  const sorted = [...valid].sort((a, b) => a - b);
  return sorted[1];
}

const defaultInfra: BusinessInfraData = {
  hasEntity: false, hasEIN: false, addressType: null, hasPhone411: false, hasBankAccount: false,
  dnbPaydex: null, experianIntelliscore: null, equifaxPaymentIndex: null, ficoSbss: null,
  dnbLastVerified: null, experianLastVerified: null, equifaxLastVerified: null, ficoSbssLastVerified: null,
  presenceComplete: 0, presenceTotal: 7, hasConsistencyIssues: false,
  hasTaxReturns: false, hasPnL: false, hasBankStatements: false, buildScore: null,
};

const defaultDemographics: DemographicProfile = {
  gender_identity: null, ethnicity: null,
  is_veteran: null, is_service_disabled_veteran: null, is_us_citizen: null,
  is_minority_owned: null, is_women_owned: null, is_veteran_owned: null,
  is_service_disabled_veteran_owned: null, is_hubzone_located: null,
  has_8a_certification: null, has_wosb_certification: null, has_vetcert_certification: null,
  is_startup: false,
};

export function useFundingProfile(): FundingProfileData {
  const assistant = useAssistantName();
  const { data, isLoading } = useQuery({
    queryKey: ["funding-profile-complete"],
    queryFn: async () => {
      const __uid = await getEffectiveUserId();
      if (!__uid) throw new Error("Not authenticated");
      const user = { id: __uid } as { id: string };
      const uid = user.id;

      const [
        profileRes,
        negItemsRes,
        accountsRes,
        businessRes,
        kpisRes,
        banksRes,
        buildScoresRes,
        presenceRes,
        finDocsRes,
      ] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("credit_negative_items").select("*").eq("user_id", uid),
        supabase.from("credit_accounts").select("*").eq("user_id", uid),
        supabase.from("businesses").select("*").eq("owner_user_id", uid),
        supabase.from("financial_kpis").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("connected_bank_accounts").select("id").eq("user_id", uid).eq("is_active", true),
        supabase.from("build_scores").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("business_public_presence").select("*").eq("user_id", uid),
        supabase.from("business_financial_docs").select("*").eq("user_id", uid),
      ]);

      const profile = profileRes.data;
      const negItems = negItemsRes.data || [];
      const accounts = accountsRes.data || [];
      const businesses = businessRes.data || [];
      const kpis = kpisRes.data;
      const banks = banksRes.data || [];
      const buildScores = buildScoresRes.data;
      const presenceRows = presenceRes.data || [];
      const finDocs = finDocsRes.data || [];

      // Scores
      const tu = profile?.estimated_fico_tu ?? null;
      const ex = profile?.estimated_fico_ex ?? null;
      const eq = profile?.estimated_fico_eq ?? null;
      const middleScore = getMiddleScore([tu, ex, eq]);

      // Negative items analysis
      const now = new Date();
      const activeChargeOffs = negItems.filter((n: any) => n.item_type?.toLowerCase().includes("charge") && n.status !== "removed");
      const chargeOffTotal = activeChargeOffs.reduce((s: number, n: any) => s + (n.amount || 0), 0);
      const activeCollections = negItems.filter((n: any) => n.item_type?.toLowerCase().includes("collection") && n.status !== "removed");
      
      const derogWithin = (months: number) => negItems.filter((n: any) => {
        if (n.status === "removed") return false;
        const d = n.date_of_occurrence || n.date_reported;
        if (!d) return true;
        const diff = (now.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24 * 30);
        return diff <= months;
      }).length;

      // Credit accounts analysis
      const openAccounts = accounts.filter((a: any) => a.is_open !== false);
      const revolving = openAccounts.filter((a: any) => a.type === "revolving");
      const installment = openAccounts.filter((a: any) => a.type === "installment");
      const loc = openAccounts.filter((a: any) => a.type === "line_of_credit");

      const closedRevolvingGoodStanding = accounts.filter((a: any) => {
        if (a.is_open !== false) return false;
        if (a.type !== "revolving") return false;
        const status = (a.status || "").toLowerCase();
        if (status.includes("charge") || status.includes("collection") || status.includes("delinquent") || status.includes("default")) return false;
        return true;
      });

      const highestOpenRevolvingLimit = Math.max(0, ...revolving.map((a: any) => a.credit_limit || a.limit_amount || 0));
      const highestClosedRevolvingLimit = Math.max(0, ...closedRevolvingGoodStanding.map((a: any) => a.credit_limit || a.limit_amount || 0));
      const highestRevolvingLimit = Math.max(highestOpenRevolvingLimit, highestClosedRevolvingLimit);
      const revolvingLimitIsHistorical = highestClosedRevolvingLimit > highestOpenRevolvingLimit && highestClosedRevolvingLimit > 0;
      const highestInstallmentBalance = Math.max(0, ...installment.map((a: any) => a.balance || a.current_balance || 0));
      const highestLOCLimit = Math.max(0, ...loc.map((a: any) => a.credit_limit || a.limit_amount || 0));

      const oldestDate = openAccounts.reduce((oldest: Date | null, a: any) => {
        const d = a.account_open_date || a.opened_on;
        if (!d) return oldest;
        const dt = new Date(d);
        return !oldest || dt < oldest ? dt : oldest;
      }, null as Date | null);
      const oldestAccountAgeMonths = oldestDate
        ? Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
        : 0;

      // Business
      const primaryBiz = businesses[0] as any;
      const hasEntity = businesses.length > 0 && businesses.some((b: any) => b.entity_type);
      const hasEIN = businesses.some((b: any) => b.ein);
      const oldestBiz = businesses.reduce((oldest: Date | null, b: any) => {
        const d = b.formation_date || b.created_at;
        if (!d) return oldest;
        const dt = new Date(d);
        return !oldest || dt < oldest ? dt : oldest;
      }, null as Date | null);
      const timeInBusinessMonths = oldestBiz
        ? Math.floor((now.getTime() - oldestBiz.getTime()) / (1000 * 60 * 60 * 24 * 30))
        : null;

      // Revenue
      const monthlyInflow = kpis?.monthly_inflow || 0;
      const annualRevenue = monthlyInflow > 0 ? monthlyInflow * 12 : null;
      const monthlyCashFlow = kpis ? (kpis.monthly_inflow || 0) - (kpis.monthly_outflow || 0) : null;

      // --- Business Infrastructure Data ---
      const infra: BusinessInfraData = { ...defaultInfra };
      if (primaryBiz) {
        infra.hasEntity = !!primaryBiz.entity_type;
        infra.hasEIN = !!primaryBiz.ein;
        infra.addressType = primaryBiz.business_address_type || null;
        infra.hasPhone411 = !!primaryBiz.phone_411_listed;
        infra.hasBankAccount = !!primaryBiz.has_bank_account;
        infra.dnbPaydex = primaryBiz.dnb_paydex ?? null;
        infra.experianIntelliscore = primaryBiz.experian_intelliscore ?? null;
        infra.equifaxPaymentIndex = primaryBiz.equifax_payment_index ?? null;
        infra.ficoSbss = primaryBiz.fico_sbss ?? null;
        infra.dnbLastVerified = primaryBiz.dnb_last_verified ?? null;
        infra.experianLastVerified = primaryBiz.experian_last_verified ?? null;
        infra.equifaxLastVerified = primaryBiz.equifax_last_verified ?? null;
        infra.ficoSbssLastVerified = primaryBiz.fico_sbss_last_verified ?? null;
        infra.buildScore = primaryBiz.build_score ?? null;
      }

      // Public presence
      if (presenceRows.length > 0) {
        const p = presenceRows[0] as any;
        const listingFields = [
          { url: "website_url", n: "website_name_match", a: "website_address_match", ph: "website_phone_match" },
          { url: "google_business_url", n: "google_name_match", a: "google_address_match", ph: "google_phone_match" },
          { url: "yelp_url", n: "yelp_name_match", a: "yelp_address_match", ph: "yelp_phone_match" },
          { url: "linkedin_url", n: "linkedin_name_match", a: "linkedin_address_match", ph: "linkedin_phone_match" },
          { url: "facebook_url", n: "facebook_name_match", a: "facebook_address_match", ph: "facebook_phone_match" },
          { url: "other1_url", n: "other1_name_match", a: "other1_address_match", ph: "other1_phone_match" },
          { url: "other2_url", n: "other2_name_match", a: "other2_address_match", ph: "other2_phone_match" },
        ];
        let complete = 0;
        let hasInconsistency = false;
        for (const lf of listingFields) {
          if (p[lf.url]) {
            if (p[lf.n] && p[lf.a] && p[lf.ph]) {
              complete++;
            } else {
              hasInconsistency = true;
            }
          }
        }
        infra.presenceComplete = complete;
        infra.hasConsistencyIssues = hasInconsistency;
      }

      // Financial docs
      const docStatuses = finDocs.reduce((acc: Record<string, string>, d: any) => { acc[d.doc_type] = d.status; return acc; }, {} as Record<string, string>);
      infra.hasTaxReturns = docStatuses["tax_returns_business"] === "uploaded";
      infra.hasPnL = docStatuses["profit_and_loss"] === "uploaded";
      infra.hasBankStatements = docStatuses["bank_statements"] === "uploaded";

      // Completeness calculation — updated weights
      const completenessItems: { label: string; weight: number; present: boolean; cta: string; unlocks: string }[] = [
        { label: "Personal Bureau Scores", weight: 15, present: middleScore != null, cta: `Upload your credit report in your chat with ${assistant}`, unlocks: "score-based product matching" },
        { label: "Negative Items Analysis", weight: 10, present: negItems.length > 0 || (middleScore != null && middleScore >= 740), cta: "Upload a credit report to analyze derogatory items", unlocks: "accurate derogatory risk assessment" },
        { label: "Business Revenue", weight: 15, present: annualRevenue != null && annualRevenue > 0, cta: "Upload bank statements or enter revenue data", unlocks: "revenue-based funding products" },
        { label: "Entity & Formation", weight: 10, present: hasEntity && hasEIN, cta: "Complete Foundation tab in Business Profile", unlocks: "business credit products" },
        { label: "Time in Business", weight: 8, present: timeInBusinessMonths != null && timeInBusinessMonths > 0, cta: "Add formation date to your business profile", unlocks: "term loans and SBA products" },
        { label: "Banking Relationship", weight: 8, present: infra.hasBankAccount || banks.length > 0, cta: "Upload business bank statements as PDFs to document cash flow and unlock cash-flow based lending products", unlocks: "cash-flow based lending products" },
        { label: "Business Credit Scores", weight: 10, present: infra.dnbPaydex != null || infra.experianIntelliscore != null, cta: "Enter scores in the Business Credit tab", unlocks: "EIN-only business products" },
        { label: "Monthly Cash Flow", weight: 7, present: monthlyCashFlow != null && monthlyCashFlow !== 0, cta: "Upload bank statements to calculate cash flow", unlocks: "improved estimate accuracy" },
        { label: "Public Presence", weight: 7, present: infra.presenceComplete >= 4, cta: "Complete public listings in the Public Presence tab", unlocks: "identity verification for lenders" },
        { label: "Financial Documentation", weight: 10, present: infra.hasTaxReturns && infra.hasPnL, cta: "Upload tax returns and P&L in Financial Docs tab", unlocks: "SBA and traditional bank products" },
      ];

      const completeness = completenessItems.reduce((sum, item) => sum + (item.present ? item.weight : 0), 0);
      const missingItems = completenessItems.filter(i => !i.present).map(({ label, weight, cta, unlocks }) => ({ label, weight, cta, unlocks }));

      return {
        middleScore,
        scores: { tu, ex, eq },
        scoreModel: profile?.score_model || "Unknown",
        lastReportDate: profile?.last_report_analyzed_at || null,
        negativeItems: negItems,
        activeChargeOffs,
        chargeOffTotal,
        activeCollections,
        derogWithin12mo: derogWithin(12),
        derogWithin24mo: derogWithin(24),
        totalActiveNegatives: countUniqueNegativeAccounts(negItems.filter((n: any) => n.status !== "removed")),
        creditAccounts: accounts,
        highestRevolvingLimit,
        revolvingLimitIsHistorical,
        highestInstallmentBalance,
        highestLOCLimit,
        openAccountCount: openAccounts.length,
        oldestAccountAgeMonths,
        businesses,
        hasEntityStructure: hasEntity,
        timeInBusinessMonths,
        hasEIN,
        financialKpis: kpis,
        hasRevenueData: annualRevenue != null && annualRevenue > 0,
        annualRevenue,
        monthlyCashFlow,
        connectedBanks: banks.length,
        hasBankingRelationship: infra.hasBankAccount || banks.length > 0,
        buildScores,
        hasBusinessCreditScores: infra.dnbPaydex != null || infra.experianIntelliscore != null,
        businessInfra: infra,
        completeness,
        missingItems,
        hasFraudAlert: false,
        hasSecurityFreeze: false,
        fundingGoals: profile?.funding_goals || null,
        demographics: {
          gender_identity: (profile as any)?.gender_identity ?? null,
          ethnicity: (profile as any)?.ethnicity ?? null,
          is_veteran: (profile as any)?.is_veteran ?? null,
          is_service_disabled_veteran: (profile as any)?.is_service_disabled_veteran ?? null,
          is_us_citizen: (profile as any)?.is_us_citizen ?? null,
          is_minority_owned: (primaryBiz as any)?.is_minority_owned ?? null,
          is_women_owned: (primaryBiz as any)?.is_women_owned ?? null,
          is_veteran_owned: (primaryBiz as any)?.is_veteran_owned ?? null,
          is_service_disabled_veteran_owned: (primaryBiz as any)?.is_service_disabled_veteran_owned ?? null,
          is_hubzone_located: (primaryBiz as any)?.is_hubzone_located ?? null,
          has_8a_certification: (primaryBiz as any)?.has_8a_certification ?? null,
          has_wosb_certification: (primaryBiz as any)?.has_wosb_certification ?? null,
          has_vetcert_certification: (primaryBiz as any)?.has_vetcert_certification ?? null,
          is_startup: !primaryBiz || (timeInBusinessMonths != null && timeInBusinessMonths < 24),
        },
        isLoading: false,
      };
    },
  });

  if (isLoading || !data) {
    return {
      middleScore: null, scores: { tu: null, ex: null, eq: null }, scoreModel: "Unknown", lastReportDate: null,
      negativeItems: [], activeChargeOffs: [], chargeOffTotal: 0, activeCollections: [], derogWithin12mo: 0, derogWithin24mo: 0, totalActiveNegatives: 0,
      creditAccounts: [], highestRevolvingLimit: 0, revolvingLimitIsHistorical: false, highestInstallmentBalance: 0, highestLOCLimit: 0, openAccountCount: 0, oldestAccountAgeMonths: 0,
      businesses: [], hasEntityStructure: false, timeInBusinessMonths: null, hasEIN: false,
      financialKpis: null, hasRevenueData: false, annualRevenue: null, monthlyCashFlow: null,
      connectedBanks: 0, hasBankingRelationship: false,
      buildScores: null, hasBusinessCreditScores: false,
      businessInfra: { ...defaultInfra },
      completeness: 0, missingItems: [],
      hasFraudAlert: false, hasSecurityFreeze: false,
      fundingGoals: null,
      demographics: { ...defaultDemographics },
      isLoading: true,
    };
  }

  return { ...data, isLoading: false };
}
