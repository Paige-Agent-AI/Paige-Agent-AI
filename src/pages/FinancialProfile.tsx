import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFundabilityRefresh } from "@/hooks/useFundabilityRefresh";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Landmark, Plus, Trash2, Info, Sparkles, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BusinessSelector } from "@/components/dashboard/BusinessSelector";
import { useBusinessContext } from "@/contexts/BusinessContext";

// ----------------------------- Static option lists -----------------------------

const COMMON_BANKS = [
  "Chase", "Bank of America", "Wells Fargo", "Citi", "US Bank", "Truist",
  "Capital One", "Ally", "Navy Federal", "American Express", "PNC", "TD Bank",
  "Local Credit Union", "Other",
];

const TENURE_OPTIONS: { value: string; label: string; months: number }[] = [
  { value: "under_6", label: "Under 6 months", months: 3 },
  { value: "6_12", label: "6–12 months", months: 9 },
  { value: "1_2_years", label: "1–2 years", months: 18 },
  { value: "2_5_years", label: "2–5 years", months: 42 },
  { value: "5_10_years", label: "5–10 years", months: 90 },
  { value: "10_plus", label: "10+ years", months: 144 },
];

const PERSONAL_BALANCE_OPTIONS = [
  { value: "under_1k", label: "Under $1,000", amount: 500 },
  { value: "1k_5k", label: "$1,000–$5,000", amount: 3000 },
  { value: "5k_10k", label: "$5,000–$10,000", amount: 7500 },
  { value: "10k_25k", label: "$10,000–$25,000", amount: 17500 },
  { value: "25k_50k", label: "$25,000–$50,000", amount: 37500 },
  { value: "50k_100k", label: "$50,000–$100,000", amount: 75000 },
  { value: "100k_plus", label: "$100,000+", amount: 150000 },
];

const BUSINESS_BALANCE_OPTIONS = [
  { value: "under_1k", label: "Under $1,000", amount: 500 },
  { value: "1k_5k", label: "$1,000–$5,000", amount: 3000 },
  { value: "5k_10k", label: "$5,000–$10,000", amount: 7500 },
  { value: "10k_25k", label: "$10,000–$25,000", amount: 17500 },
  { value: "25k_50k", label: "$25,000–$50,000", amount: 37500 },
  { value: "50k_100k", label: "$50,000–$100,000", amount: 75000 },
  { value: "100k_250k", label: "$100,000–$250,000", amount: 175000 },
  { value: "250k_plus", label: "$250,000+", amount: 350000 },
];

const PERSONAL_ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "money_market", label: "Money Market" },
  { value: "cd", label: "CD" },
  { value: "ira", label: "IRA" },
  { value: "mortgage", label: "Mortgage" },
  { value: "auto_loan", label: "Auto Loan" },
  { value: "credit_card", label: "Credit Card" },
  { value: "line_of_credit", label: "Line of Credit" },
];

const BUSINESS_ACCOUNT_TYPES = [
  { value: "business_checking", label: "Business Checking" },
  { value: "business_savings", label: "Business Savings" },
  { value: "business_money_market", label: "Business Money Market" },
  { value: "merchant_services", label: "Merchant Services" },
  { value: "business_cd", label: "Business CD" },
  { value: "business_line_of_credit", label: "Business Line of Credit" },
  { value: "business_credit_card", label: "Business Credit Card" },
];

const STANDING_OPTIONS = [
  { value: "good", label: "Good standing" },
  { value: "restricted", label: "Has had overdrafts in last 12 months" },
  { value: "negative", label: "Account restricted or negative" },
];

const NSF_OPTIONS = [
  { value: 0, label: "None" },
  { value: 1, label: "1–2" },
  { value: 4, label: "3–5" },
  { value: 6, label: "5+" },
];

const INVESTMENT_INSTITUTIONS = [
  "Fidelity", "Schwab", "Vanguard", "Merrill Lynch", "Morgan Stanley",
  "E*TRADE", "Robinhood", "TD Ameritrade", "Other",
];

// ----------------------------- Form types -----------------------------

interface PersonalBank {
  id: string;
  institution_name: string;
  tenure: string;
  balance: string;
  has_direct_deposit: boolean;
  account_types: string[];
  standing: string;
}

interface BusinessBank {
  business_id: string | null;
  institution_name: string;
  tenure: string;
  balance: string;
  account_types: string[];
  nsf_count: number;
}

const newPersonalBank = (): PersonalBank => ({
  id: crypto.randomUUID(),
  institution_name: "",
  tenure: "",
  balance: "",
  has_direct_deposit: false,
  account_types: [],
  standing: "good",
});

const emptyBusinessBank: BusinessBank = {
  business_id: null,
  institution_name: "",
  tenure: "",
  balance: "",
  account_types: [],
  nsf_count: 0,
};

// ----------------------------- Component -----------------------------

export default function FinancialProfile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refresh } = useFundabilityRefresh();
  const { activeBusinessId } = useBusinessContext();

  const [personalBanks, setPersonalBanks] = useState<PersonalBank[]>([newPersonalBank()]);
  const [businessBank, setBusinessBank] = useState<BusinessBank>({ ...emptyBusinessBank });

  // Asset / revenue snapshot fields (mirror profiles columns)
  const [hasInvestmentAccounts, setHasInvestmentAccounts] = useState(false);
  const [investmentInstitutions, setInvestmentInstitutions] = useState<string[]>([]);
  const [investmentRange, setInvestmentRange] = useState<string>("");
  const [hasRealEstateEquity, setHasRealEstateEquity] = useState(false);
  const [realEstateEquityRange, setRealEstateEquityRange] = useState<string>("");
  const [hasEquipmentAssets, setHasEquipmentAssets] = useState(false);
  const [equipmentValueRange, setEquipmentValueRange] = useState<string>("");
  const [hasInvoiceReceivables, setHasInvoiceReceivables] = useState(false);
  const [totalLiquidAssetsRange, setTotalLiquidAssetsRange] = useState<string>("");

  const [personalIncomeRange, setPersonalIncomeRange] = useState<string>("");
  const [incomeType, setIncomeType] = useState<string>("");
  const [monthlyRevenueRange, setMonthlyRevenueRange] = useState<string>("");
  const [revenueConsistency, setRevenueConsistency] = useState<string>("");

  const [saving, setSaving] = useState(false);

  // ----------------------------- Load existing data -----------------------------

  const { data: existing, isLoading } = useQuery({
    queryKey: ["financial-profile-data"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const [profileRes, banksRes, qbRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("primary_bank_name, primary_bank_months, primary_bank_average_balance, has_investment_accounts, investment_account_value_range, total_liquid_assets_range, has_real_estate_equity, real_estate_equity_range, has_equipment_assets, has_invoice_receivables, monthly_revenue_range")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("banking_relationships" as any)
          .select("*")
          .eq("user_id", user.id),
        supabase
          .from("quickbooks_connections")
          .select("qb_company_name, last_synced_at, is_active")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle(),
      ]);
      return {
        userId: user.id,
        profile: profileRes.data,
        banks: (banksRes.data ?? []) as any[],
        qb: qbRes.data,
      };
    },
  });

  // Hydrate state from existing rows once loaded
  useEffect(() => {
    if (!existing) return;
    const personal = (existing.banks ?? []).filter(
      (b: any) => b.relationship_type !== "business_checking" &&
        b.relationship_type !== "business_savings" &&
        b.relationship_type !== "business_money_market" &&
        b.relationship_type !== "merchant_services" &&
        b.relationship_type !== "business_cd" &&
        b.relationship_type !== "business_line_of_credit" &&
        b.relationship_type !== "business_credit_card",
    );
    const business = (existing.banks ?? []).filter(
      (b: any) => b.relationship_type === "business_checking" ||
        b.relationship_type === "business_savings" ||
        b.relationship_type === "business_money_market" ||
        b.relationship_type === "merchant_services" ||
        b.relationship_type === "business_cd" ||
        b.relationship_type === "business_line_of_credit" ||
        b.relationship_type === "business_credit_card",
    );

    // Group personal banks by institution_name
    if (personal.length > 0) {
      const grouped = new Map<string, any[]>();
      for (const row of personal) {
        const key = row.institution_name ?? "";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(row);
      }
      const banks: PersonalBank[] = [];
      for (const [name, rows] of grouped) {
        const first = rows[0];
        const tenureOpt = TENURE_OPTIONS.find(o => o.months === first.months_at_institution);
        const balOpt = PERSONAL_BALANCE_OPTIONS.find(o => o.amount === Number(first.average_monthly_balance ?? 0));
        banks.push({
          id: crypto.randomUUID(),
          institution_name: name,
          tenure: tenureOpt?.value ?? "",
          balance: balOpt?.value ?? "",
          has_direct_deposit: !!first.has_direct_deposit,
          account_types: rows.map(r => r.relationship_type).filter(Boolean),
          standing: (first.nsf_count_last_12_months ?? 0) > 2 ? "negative"
            : (first.nsf_count_last_12_months ?? 0) > 0 ? "restricted" : "good",
        });
      }
      if (banks.length > 0) setPersonalBanks(banks);
    }

    if (business.length > 0) {
      const first = business[0];
      const tenureOpt = TENURE_OPTIONS.find(o => o.months === first.months_at_institution);
      const balOpt = BUSINESS_BALANCE_OPTIONS.find(o => o.amount === Number(first.average_monthly_balance ?? 0));
      setBusinessBank({
        business_id: first.business_id ?? null,
        institution_name: first.institution_name ?? "",
        tenure: tenureOpt?.value ?? "",
        balance: balOpt?.value ?? "",
        account_types: business.map((b: any) => b.relationship_type).filter(Boolean),
        nsf_count: first.nsf_count_last_12_months ?? 0,
      });
    }

    const p = existing.profile;
    if (p) {
      setHasInvestmentAccounts(!!p.has_investment_accounts);
      setInvestmentRange(p.investment_account_value_range ?? "");
      setTotalLiquidAssetsRange(p.total_liquid_assets_range ?? "");
      setHasRealEstateEquity(!!p.has_real_estate_equity);
      setRealEstateEquityRange(p.real_estate_equity_range ?? "");
      setHasEquipmentAssets(!!p.has_equipment_assets);
      setHasInvoiceReceivables(!!p.has_invoice_receivables);
      setMonthlyRevenueRange(p.monthly_revenue_range ?? "");
    }
  }, [existing]);

  // ----------------------------- Completeness -----------------------------

  const completeness = useMemo(() => {
    let total = 14;
    let filled = 0;
    const firstBank = personalBanks[0];
    if (firstBank?.institution_name) filled++;
    if (firstBank?.tenure) filled++;
    if (firstBank?.balance) filled++;
    if (firstBank?.account_types.length) filled++;
    if (businessBank.institution_name) filled++;
    if (businessBank.tenure) filled++;
    if (businessBank.balance) filled++;
    if (businessBank.account_types.length) filled++;
    if (totalLiquidAssetsRange) filled++;
    if (hasRealEstateEquity ? realEstateEquityRange : true) filled++;
    if (hasInvestmentAccounts ? investmentRange : true) filled++;
    if (monthlyRevenueRange) filled++;
    if (personalIncomeRange) filled++;
    if (revenueConsistency) filled++;
    return Math.round((filled / total) * 100);
  }, [personalBanks, businessBank, totalLiquidAssetsRange, hasRealEstateEquity, realEstateEquityRange, hasInvestmentAccounts, investmentRange, monthlyRevenueRange, personalIncomeRange, revenueConsistency]);

  // ----------------------------- Save -----------------------------

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 1) Update profiles snapshot fields
      const firstBank = personalBanks[0];
      const tenureMonths = firstBank?.tenure
        ? TENURE_OPTIONS.find(o => o.value === firstBank.tenure)?.months ?? null
        : null;
      const avgBalance = firstBank?.balance
        ? PERSONAL_BALANCE_OPTIONS.find(o => o.value === firstBank.balance)?.amount ?? null
        : null;

      const profileUpdate: any = {
        primary_bank_name: firstBank?.institution_name || null,
        primary_bank_months: tenureMonths,
        primary_bank_average_balance: avgBalance,
        has_investment_accounts: hasInvestmentAccounts,
        investment_account_value_range: hasInvestmentAccounts ? (investmentRange || null) : null,
        total_liquid_assets_range: totalLiquidAssetsRange || null,
        has_real_estate_equity: hasRealEstateEquity,
        real_estate_equity_range: hasRealEstateEquity ? (realEstateEquityRange || null) : null,
        has_equipment_assets: hasEquipmentAssets,
        has_invoice_receivables: hasInvoiceReceivables,
        monthly_revenue_range: monthlyRevenueRange || null,
      };
      const { error: pErr } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("user_id", user.id);
      if (pErr) throw pErr;

      // 2) Wipe only MANUAL banking_relationships rows for this user.
      //    QuickBooks-imported rows (source='quickbooks') are preserved so
      //    the next QB sync stays consistent and we don't destroy verified data.
      await supabase
        .from("banking_relationships" as any)
        .delete()
        .eq("user_id", user.id)
        .eq("source", "manual");

      // 3) Insert personal bank rows — one row per (institution × account_type)
      const rows: any[] = [];
      for (let i = 0; i < personalBanks.length; i++) {
        const b = personalBanks[i];
        if (!b.institution_name) continue;
        const months = b.tenure
          ? TENURE_OPTIONS.find(o => o.value === b.tenure)?.months ?? null
          : null;
        const balance = b.balance
          ? PERSONAL_BALANCE_OPTIONS.find(o => o.value === b.balance)?.amount ?? null
          : null;
        const nsf = b.standing === "negative" ? 4 : b.standing === "restricted" ? 1 : 0;
        const standing = b.standing === "good" ? "good" : b.standing === "restricted" ? "restricted" : "negative";
        const types = b.account_types.length ? b.account_types : ["checking"];
        for (const t of types) {
          rows.push({
            user_id: user.id,
            institution_name: b.institution_name,
            institution_type: "bank",
            relationship_type: t,
            months_at_institution: months,
            average_monthly_balance: balance,
            is_primary_institution: i === 0,
            has_direct_deposit: b.has_direct_deposit,
            nsf_count_last_12_months: nsf,
            overdraft_count_last_12_months: nsf,
            account_standing: standing,
          });
        }
      }

      // 4) Insert business bank rows
      if (businessBank.institution_name) {
        const months = businessBank.tenure
          ? TENURE_OPTIONS.find(o => o.value === businessBank.tenure)?.months ?? null
          : null;
        const balance = businessBank.balance
          ? BUSINESS_BALANCE_OPTIONS.find(o => o.value === businessBank.balance)?.amount ?? null
          : null;
        const types = businessBank.account_types.length ? businessBank.account_types : ["business_checking"];
        for (const t of types) {
          rows.push({
            user_id: user.id,
            business_id: businessBank.business_id ?? activeBusinessId ?? null,
            institution_name: businessBank.institution_name,
            institution_type: "bank",
            relationship_type: t,
            months_at_institution: months,
            average_monthly_balance: balance,
            is_primary_institution: false,
            has_direct_deposit: false,
            nsf_count_last_12_months: businessBank.nsf_count,
            overdraft_count_last_12_months: businessBank.nsf_count,
            account_standing: businessBank.nsf_count > 2 ? "restricted" : "good",
          });
        }
      }

      if (rows.length > 0) {
        const { error: bErr } = await supabase
          .from("banking_relationships" as any)
          .insert(rows);
        if (bErr) throw bErr;
      }

      return { rowCount: rows.length };
    },
    onMutate: () => setSaving(true),
    onSettled: () => setSaving(false),
    onSuccess: async () => {
      toast.success(`Financial Profile saved — ${completeness}% complete`, {
        description: "Your fundability scores have been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["financial-profile-data"] });
      await refresh({ runFactorRecalc: false });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Could not save Financial Profile");
    },
  });

  // ----------------------------- Render -----------------------------

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const qbConnected = !!existing?.qb;

  return (
    <TooltipProvider>
      <div className="space-y-6 max-w-5xl mx-auto pb-12">
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-gold flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Financial Profile</h1>
              <p className="text-sm text-muted-foreground mt-1">
                The deeper data points lenders actually look at — beyond your credit score.
              </p>
            </div>
          </div>

          {/* Completeness */}
          <Card className="border-primary/20">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Profile completeness</span>
                <span className="text-muted-foreground tabular-nums">{completeness}%</span>
              </div>
              <Progress value={completeness} className="h-2" />
            </CardContent>
          </Card>

          {/* QB banner */}
          {qbConnected ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  Banking data auto-imported from QuickBooks
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last synced{" "}
                  {existing?.qb?.last_synced_at
                    ? new Date(existing.qb.last_synced_at).toLocaleString()
                    : "recently"}
                  . Add accounts QuickBooks does not cover below.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Connect QuickBooks to auto-import your banking data
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Verified bank data dramatically improves the accuracy of your fundability scores.
                  </p>
                </div>
              </div>
              <Button
                variant="gold"
                size="sm"
                onClick={() => navigate("/app/business-profile#connections")}
              >
                Connect QuickBooks
              </Button>
            </div>
          )}
        </div>

        {/* Privacy/usage notice */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Why we ask for this
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Banking relationship data, asset information, and income ranges help us calculate
              more accurate fundability scores and find better funding matches for you. This
              information is <strong>never shared</strong> with lenders, banks, or third parties.
              It stays within your account exclusively.
            </p>
          </div>
        </div>

        {/* SECTION 1 — Personal Banking */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Personal Banking
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button"><Info className="w-4 h-4 text-muted-foreground" /></button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Lenders look at how long you have banked somewhere, your average balance, and what products you hold — not just your credit score.
                    </TooltipContent>
                  </Tooltip>
                </CardTitle>
                <CardDescription>Your primary deposit relationship and any secondary banks.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {personalBanks.map((bank, idx) => (
              <PersonalBankCard
                key={bank.id}
                bank={bank}
                index={idx}
                canRemove={personalBanks.length > 1}
                onChange={(b) => setPersonalBanks(prev => prev.map((p, i) => i === idx ? b : p))}
                onRemove={() => setPersonalBanks(prev => prev.filter((_, i) => i !== idx))}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPersonalBanks(prev => [...prev, newPersonalBank()])}
              className="gap-2"
            >
              <Plus className="w-4 h-4" /> Add another bank
            </Button>
          </CardContent>
        </Card>

        {/* SECTION 2 — Business Banking */}
        <Card>
          <CardHeader>
            <CardTitle>Business Banking</CardTitle>
            <CardDescription>
              Business bank relationships are evaluated separately from personal for all business funding products.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Which business is this banking data for?</Label>
              <BusinessSelector compact />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Business bank name</Label>
                <BankNameInput
                  value={businessBank.institution_name}
                  onChange={(v) => setBusinessBank(b => ({ ...b, institution_name: v }))}
                />
              </div>
              <div>
                <Label>Time at this business bank</Label>
                <Select value={businessBank.tenure} onValueChange={(v) => setBusinessBank(b => ({ ...b, tenure: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select duration" /></SelectTrigger>
                  <SelectContent>
                    {TENURE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Average monthly business balance</Label>
                <Select value={businessBank.balance} onValueChange={(v) => setBusinessBank(b => ({ ...b, balance: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    {BUSINESS_BALANCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="flex items-center gap-1.5">
                  NSFs / overdrafts in last 12 months
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button"><Info className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Lenders review bank statements for NSF activity. Even 1-2 NSFs in 12 months can reduce approval odds by 30-40% for business lines of credit.
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Select
                  value={String(businessBank.nsf_count)}
                  onValueChange={(v) => setBusinessBank(b => ({ ...b, nsf_count: Number(v) }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {NSF_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Account types at this business bank</Label>
              <PillCheckboxes
                options={BUSINESS_ACCOUNT_TYPES}
                values={businessBank.account_types}
                onChange={(v) => setBusinessBank(b => ({ ...b, account_types: v }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* SECTION 3 — Assets / Reserves */}
        <Card>
          <CardHeader>
            <CardTitle>Assets and Reserves</CardTitle>
            <CardDescription>
              Lenders verify reserves for mortgages and large business lines. Document your liquid position now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Investment accounts */}
            <ToggleSection
              label="Do you have investment or brokerage accounts?"
              value={hasInvestmentAccounts}
              onChange={setHasInvestmentAccounts}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-2 block">Where? (multi-select)</Label>
                  <PillCheckboxes
                    options={INVESTMENT_INSTITUTIONS.map(i => ({ value: i, label: i }))}
                    values={investmentInstitutions}
                    onChange={setInvestmentInstitutions}
                  />
                </div>
                <div>
                  <Label>Estimated total investment value</Label>
                  <Select value={investmentRange} onValueChange={setInvestmentRange}>
                    <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="under_10k">Under $10K</SelectItem>
                      <SelectItem value="10k_50k">$10K–$50K</SelectItem>
                      <SelectItem value="50k_250k">$50K–$250K</SelectItem>
                      <SelectItem value="250k_plus">$250K+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </ToggleSection>

            {/* Real estate equity */}
            <ToggleSection
              label="Do you have real estate equity (primary home or investment)?"
              value={hasRealEstateEquity}
              onChange={setHasRealEstateEquity}
            >
              <div>
                <Label>Estimated equity range</Label>
                <Select value={realEstateEquityRange} onValueChange={setRealEstateEquityRange}>
                  <SelectTrigger className="max-w-md"><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_25k">Under $25K</SelectItem>
                    <SelectItem value="25k_100k">$25K–$100K</SelectItem>
                    <SelectItem value="100k_250k">$100K–$250K</SelectItem>
                    <SelectItem value="250k_plus">$250K+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </ToggleSection>

            {/* Equipment */}
            <ToggleSection
              label="Do you own business equipment outright?"
              value={hasEquipmentAssets}
              onChange={setHasEquipmentAssets}
            >
              <div>
                <Label>Estimated equipment value</Label>
                <Select value={equipmentValueRange} onValueChange={setEquipmentValueRange}>
                  <SelectTrigger className="max-w-md"><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_10k">Under $10K</SelectItem>
                    <SelectItem value="10k_50k">$10K–$50K</SelectItem>
                    <SelectItem value="50k_250k">$50K–$250K</SelectItem>
                    <SelectItem value="250k_plus">$250K+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </ToggleSection>

            {/* Receivables */}
            <ToggleSection
              label="Do you have outstanding invoices or receivables?"
              value={hasInvoiceReceivables}
              onChange={setHasInvoiceReceivables}
            />

            {/* Total liquid assets */}
            <div>
              <Label className="flex items-center gap-1.5">
                Estimated total liquid assets (checking + savings readily accessible)
              </Label>
              <Select value={totalLiquidAssetsRange} onValueChange={setTotalLiquidAssetsRange}>
                <SelectTrigger className="max-w-md"><SelectValue placeholder="Select range" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="under_5k">Under $5K</SelectItem>
                  <SelectItem value="5k_25k">$5K–$25K</SelectItem>
                  <SelectItem value="25k_100k">$25K–$100K</SelectItem>
                  <SelectItem value="100k_plus">$100K+</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* SECTION 4 — Revenue and Income */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue and Income</CardTitle>
            <CardDescription>
              Even for no-doc products lenders verify income patterns through bank statement deposits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Personal annual income range</Label>
                <Select value={personalIncomeRange} onValueChange={setPersonalIncomeRange}>
                  <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_30k">Under $30K</SelectItem>
                    <SelectItem value="30k_60k">$30K–$60K</SelectItem>
                    <SelectItem value="60k_100k">$60K–$100K</SelectItem>
                    <SelectItem value="100k_200k">$100K–$200K</SelectItem>
                    <SelectItem value="200k_500k">$200K–$500K</SelectItem>
                    <SelectItem value="500k_plus">$500K+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Income type</Label>
                <Select value={incomeType} onValueChange={setIncomeType}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="w2">W-2 Employee</SelectItem>
                    <SelectItem value="self_employed">Self-Employed / 1099</SelectItem>
                    <SelectItem value="business_owner_salary">Business Owner with Salary</SelectItem>
                    <SelectItem value="passive">Investment / Passive Income</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Monthly business revenue range</Label>
                <Select value={monthlyRevenueRange} onValueChange={setMonthlyRevenueRange}>
                  <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_5k">Under $5K</SelectItem>
                    <SelectItem value="5k_10k">$5K–$10K</SelectItem>
                    <SelectItem value="10k_25k">$10K–$25K</SelectItem>
                    <SelectItem value="25k_50k">$25K–$50K</SelectItem>
                    <SelectItem value="50k_100k">$50K–$100K</SelectItem>
                    <SelectItem value="100k_plus">$100K+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Revenue consistency</Label>
                <Select value={revenueConsistency} onValueChange={setRevenueConsistency}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consistent">Very consistent month to month</SelectItem>
                    <SelectItem value="variable">Somewhat variable</SelectItem>
                    <SelectItem value="seasonal">Highly seasonal or variable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {qbConnected && (
              <p className="text-xs text-muted-foreground italic">
                Note: Revenue data may also be imported from QuickBooks. Update manually if it does not reflect current revenue.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Save bar */}
        <div className="sticky bottom-0 left-0 right-0 -mx-4 sm:mx-0 bg-background/95 backdrop-blur border-t border-border p-4 sm:rounded-lg sm:border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">Profile {completeness}% complete</p>
            <p className="text-xs text-muted-foreground">Saving updates your fundability scores immediately.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/app/credit")}
              className="gap-1.5"
            >
              View scores <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="gold"
              size="lg"
              onClick={() => saveMutation.mutate()}
              disabled={saving}
              className="gap-2 flex-1 sm:flex-none"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {saving ? "Saving..." : "Save Financial Profile"}
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ----------------------------- Sub-components -----------------------------

function BankNameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Chase, Bank of America, local credit union"
        list="common-banks-list"
      />
      <datalist id="common-banks-list">
        {COMMON_BANKS.map(b => <option key={b} value={b} />)}
      </datalist>
    </div>
  );
}

function PillCheckboxes({
  options,
  values,
  onChange,
}: {
  options: { value: string; label: string }[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter(x => x !== v));
    else onChange([...values, v]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => {
        const selected = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition ${
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card hover:border-primary/40 text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleSection({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <Switch checked={value} onCheckedChange={onChange} />
      </div>
      {value && children && <div className="pl-1">{children}</div>}
    </div>
  );
}

function PersonalBankCard({
  bank,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  bank: PersonalBank;
  index: number;
  canRemove: boolean;
  onChange: (b: PersonalBank) => void;
  onRemove: () => void;
}) {
  const isBoA = /bank of america|boa\b/i.test(bank.institution_name);
  const isAmex = /american express|amex/i.test(bank.institution_name);

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-[10px]">
          {index === 0 ? "Primary bank" : `Bank ${index + 1}`}
        </Badge>
        {canRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} className="h-7 px-2 text-destructive hover:text-destructive">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Bank name</Label>
          <BankNameInput
            value={bank.institution_name}
            onChange={(v) => onChange({ ...bank, institution_name: v })}
          />
        </div>
        <div>
          <Label>Time at this bank</Label>
          <Select value={bank.tenure} onValueChange={(v) => onChange({ ...bank, tenure: v })}>
            <SelectTrigger><SelectValue placeholder="Select duration" /></SelectTrigger>
            <SelectContent>
              {TENURE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Average monthly balance</Label>
          <Select value={bank.balance} onValueChange={(v) => onChange({ ...bank, balance: v })}>
            <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
            <SelectContent>
              {PERSONAL_BALANCE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Account standing</Label>
          <Select value={bank.standing} onValueChange={(v) => onChange({ ...bank, standing: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STANDING_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
        <Label htmlFor={`dd-${bank.id}`} className="text-sm">Direct deposit set up here</Label>
        <Switch
          id={`dd-${bank.id}`}
          checked={bank.has_direct_deposit}
          onCheckedChange={(v) => onChange({ ...bank, has_direct_deposit: v })}
        />
      </div>

      <div>
        <Label className="mb-2 block">Account types at this bank</Label>
        <PillCheckboxes
          options={PERSONAL_ACCOUNT_TYPES}
          values={bank.account_types}
          onChange={(v) => onChange({ ...bank, account_types: v })}
        />
      </div>

      {/* Relationship intelligence callouts */}
      {isBoA && (
        <div className="rounded-lg border border-gold/40 bg-gradient-to-br from-gold/10 to-gold/5 p-3 text-sm">
          <p className="font-semibold text-gold mb-1 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" /> BoA Relationship Advantage
          </p>
          <p className="text-xs text-muted-foreground">
            Having a BoA deposit account allows up to <strong>7 new credit card applications in 12 months</strong> versus only 3 without one. This is one of the most valuable relationship banking advantages available.
          </p>
        </div>
      )}
      {isAmex && (
        <div className="rounded-lg border border-gold/40 bg-gradient-to-br from-gold/10 to-gold/5 p-3 text-sm">
          <p className="font-semibold text-gold mb-1 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" /> Amex Relationship Advantage
          </p>
          <p className="text-xs text-muted-foreground">
            Existing Amex cardholders with an Amex National Bank savings or checking account have stronger approval odds for premium Amex cards.
          </p>
        </div>
      )}
    </div>
  );
}
