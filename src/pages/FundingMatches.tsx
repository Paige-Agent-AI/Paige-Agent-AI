import { useState, useMemo, useEffect } from "react";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFundingProfile } from "@/hooks/useFundingProfile";
import { scoreProduct, generateFundingSequence } from "@/lib/fundingMatchScoring";
import { ProfileCompletenessPanel } from "@/components/funding/ProfileCompletenessPanel";
import { FundingSequence } from "@/components/funding/FundingSequence";
import { RegionalLenderSearch } from "@/components/funding/RegionalLenderSearch";
import { ProductMatchCard } from "@/components/funding/ProductMatchCard";
import { CategoryTabs } from "@/components/funding/CategoryTabs";
import {
  FundingGoalIntake,
  FundingGoalBanner,
  getGoalRelevanceBoost,
  isPrerequisiteProduct,
  getTimelineUrgencySort,
  type FundingGoals,
} from "@/components/funding/FundingGoalIntake";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, Target } from "lucide-react";
import { CATEGORIES, type ProductCategoryKey } from "@/lib/lenderCategories";
import { SeparationAuditCard } from "@/components/dashboard/business-profile/SeparationAuditCard";
import { FundingWalkthrough } from "@/components/funding/FundingWalkthrough";
import { RateEnvironmentBanner } from "@/components/funding/RateEnvironmentBanner";
import { BusinessSelector } from "@/components/dashboard/BusinessSelector";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

function SeparationAuditFundingBanner({ onFix }: { onFix: () => void }) {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);
  if (!uid) return null;
  return <SeparationAuditCard userId={uid} variant="compact" onFix={onFix} />;
}

export default function FundingMatches() {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const profile = useFundingProfile();
  const navigate = useNavigate();
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategoryKey | "all">("all");

  // Parse funding goals
  const fundingGoals: FundingGoals | null = useMemo(() => {
    const fg = profile.fundingGoals;
    if (fg && typeof fg === "object" && "objective" in (fg as any)) return fg as unknown as FundingGoals;
    return null;
  }, [profile.fundingGoals]);

  const needsIntake = !profile.isLoading && !fundingGoals;
  const [autoOpened, setAutoOpened] = useState(false);
  const shouldAutoOpen = needsIntake && !autoOpened && !bannerDismissed;

  // Fetch all active lender products from unified table
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["lender-products-categorized"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lender_products")
        .select("*")
        .eq("is_active", true)
        .order("lender_name");
      if (error) throw error;
      return data || [];
    },
  });

  // Score & smart-sort all products
  const { scoredAll, categoryCounts, prerequisiteMatches } = useMemo(() => {
    if (!products || profile.isLoading) {
      return { scoredAll: [], categoryCounts: {} as Record<string, number>, prerequisiteMatches: [] };
    }

    const score = profile.middleScore || 0;
    const lowScore = score > 0 && score < 620;

    // Score every product
    let scored = products.map(p => ({ ...scoreProduct(p, profile), product: p }));

    // Apply funding-goal sort hints
    if (fundingGoals) {
      scored = scored.map(m => ({
        ...m,
        _relevance: getGoalRelevanceBoost(m.product.product_type, fundingGoals),
        _urgency: getTimelineUrgencySort(m.product.product_type, fundingGoals),
        _isPrereq: isPrerequisiteProduct(m.product.product_type, fundingGoals),
      } as any));
    }

    // Smart sort: low-score clients see CDFI/serves_bad_credit lenders first
    scored.sort((a: any, b: any) => {
      // Prereqs go to bottom
      if (fundingGoals) {
        if (a._isPrereq !== b._isPrereq) return a._isPrereq ? 1 : -1;
      }
      // Low-score clients: prioritize accessible lenders
      if (lowScore) {
        const aAccessible = a.product.serves_bad_credit || a.product.product_category === "cdfi_loan" ? 1 : 0;
        const bAccessible = b.product.serves_bad_credit || b.product.product_category === "cdfi_loan" ? 1 : 0;
        if (aAccessible !== bAccessible) return bAccessible - aAccessible;
      }
      // Goal relevance
      if (fundingGoals && a._relevance !== b._relevance) return b._relevance - a._relevance;
      if (fundingGoals && a._urgency !== b._urgency) return b._urgency - a._urgency;
      // Default: by match score
      return b.score - a.score;
    });

    const prereqs = fundingGoals ? scored.filter((m: any) => m._isPrereq) : [];
    const primary = fundingGoals ? scored.filter((m: any) => !m._isPrereq) : scored;

    // Build category counts (excluding prereqs)
    const counts: Record<string, number> = {};
    primary.forEach((m: any) => {
      const cat = m.product.product_category || m.product.product_type;
      if (cat) counts[cat] = (counts[cat] || 0) + 1;
    });

    return { scoredAll: primary, categoryCounts: counts, prerequisiteMatches: prereqs };
  }, [products, profile, fundingGoals]);

  // Filter by selected category
  const visibleMatches = useMemo(() => {
    if (selectedCategory === "all") return scoredAll;
    return scoredAll.filter((m: any) =>
      (m.product.product_category || m.product.product_type) === selectedCategory
    );
  }, [scoredAll, selectedCategory]);

  const fundingSequence = useMemo(() => generateFundingSequence(profile), [profile]);

  // Summary stats over ALL primary matches
  const allMatches = [...scoredAll, ...prerequisiteMatches];
  const eligible = allMatches.filter(m => m.category === "eligible");
  const nearEligible = allMatches.filter(m => m.category === "near_eligible");
  const totalEstimated = eligible.reduce((s, m) => s + (m.estimatedAmount || 0), 0);

  const isLoading = profile.isLoading || productsLoading;
  const isUrgent = fundingGoals?.timeline === "90_days";

  function handleAskPaige(product: any) {
    const lenderQuery = `Tell me about ${product.lender_name} ${product.product_subcategory || product.product_category} — am I a fit and what's the strategy to apply?`;
    sessionStorage.setItem("paige_prefill", lenderQuery);
    toast.info(`Opening ${agentName} with this lender pre-loaded…`);
    // Trigger floating chatbot to open if listening
    window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: lenderQuery } }));
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <FundingGoalIntake
        open={shouldAutoOpen || goalModalOpen}
        onOpenChange={open => {
          if (!open && shouldAutoOpen) setAutoOpened(true);
          setGoalModalOpen(open);
        }}
        existingGoals={fundingGoals}
        onSaved={() => setGoalModalOpen(false)}
      />

      {/* Title */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Funding Intelligence</h1>
        <p className="text-muted-foreground mt-1">
          Lenders matched to your real profile across {Object.keys(categoryCounts).length} product categories — every score explained by data, not thresholds.
        </p>
        {profile.middleScore && (
          <p className="text-xs text-muted-foreground mt-1">
            Matching against middle bureau score: {profile.middleScore}
          </p>
        )}
      </div>

      <FundingWalkthrough />

      <RateEnvironmentBanner />

      {/* Goal banner */}
      {fundingGoals ? (
        <FundingGoalBanner goals={fundingGoals} onEdit={() => setGoalModalOpen(true)} />
      ) : !bannerDismissed ? (
        <Card className="p-4 bg-accent/5 border-accent/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Target className="w-5 h-5 text-accent shrink-0" />
              <p className="text-sm text-foreground">
                <span className="font-medium">Add your funding goal to get personalized matches</span>
                <span className="text-muted-foreground"> — takes 60 seconds</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={() => setGoalModalOpen(true)} className="bg-gradient-gold hover:opacity-90 text-xs">
                Set Goal
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBannerDismissed(true)} className="text-muted-foreground text-xs px-2">
                ✕
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {isUrgent && (
        <Card className="p-4 bg-fundability-fair/5 border-fundability-fair/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-fundability-fair shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">90-Day Urgent Timeline Active</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fast-access products are prioritized. MCAs and revenue-based products are quick but high-cost — review factor rates carefully before applying.
              </p>
            </div>
          </div>
        </Card>
      )}

      <SeparationAuditFundingBanner onFix={() => navigate("/app/business")} />

      <BusinessSelector />

      <ProfileCompletenessPanel profile={profile} />

      {/* Stats */}
      {allMatches.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <Card className="p-3 sm:p-5 bg-card border-border text-center">
            <div className="text-xl sm:text-3xl font-bold text-fundability-excellent">{eligible.length}</div>
            <div className="text-[11px] sm:text-sm text-muted-foreground mt-1 leading-tight">Eligible</div>
          </Card>
          <Card className="p-3 sm:p-5 bg-card border-border text-center">
            <div className="text-xl sm:text-3xl font-bold text-fundability-fair">{nearEligible.length}</div>
            <div className="text-[11px] sm:text-sm text-muted-foreground mt-1 leading-tight">Near Eligible</div>
          </Card>
          <Card className="p-3 sm:p-5 bg-card border-border text-center">
            <div className="text-xl sm:text-3xl font-bold text-accent break-all">${totalEstimated.toLocaleString()}</div>
            <div className="text-[11px] sm:text-sm text-muted-foreground mt-1 leading-tight">Est. Total</div>
          </Card>
        </div>
      )}

      {/* Category Tabs + Matches */}
      {scoredAll.length > 0 && (
        <div className="space-y-4">
          <CategoryTabs
            selected={selectedCategory}
            onSelect={setSelectedCategory}
            counts={categoryCounts}
            totalCount={scoredAll.length}
          />

          {selectedCategory !== "all" && CATEGORIES[selectedCategory] && (
            <div className="px-1">
              <h2 className="text-lg font-semibold text-foreground">{CATEGORIES[selectedCategory].label}</h2>
              <p className="text-xs text-muted-foreground">{CATEGORIES[selectedCategory].description}</p>
            </div>
          )}

          <div className="space-y-3">
            {visibleMatches.map(match => (
              <ProductMatchCard key={match.product.id} match={match} onAskPaige={handleAskPaige} />
            ))}
          </div>

          {visibleMatches.length === 0 && (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No products in this category match your profile yet.</p>
            </Card>
          )}
        </div>
      )}

      {/* Prerequisite Section */}
      {prerequisiteMatches.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-muted-foreground">What Needs to Be Built First</h2>
            <Badge variant="outline" className="text-xs">{prerequisiteMatches.length} products</Badge>
          </div>
          <p className="text-sm text-muted-foreground -mt-1">
            These credit-building products establish the foundation needed for your primary funding goal.
          </p>
          <div className="space-y-3">
            {prerequisiteMatches.map(match => (
              <div key={match.product.id} className="opacity-80">
                <ProductMatchCard match={match} onAskPaige={handleAskPaige} />
              </div>
            ))}
          </div>
        </div>
      )}

      {allMatches.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">
            {profile.middleScore
              ? "No lender products are currently in the database. An admin can add products in the Lender Bureau Preferences section."
              : `Upload a credit report in your chat with ${agentName} first to see matched funding products.`}
          </p>
        </Card>
      )}

      <FundingSequence steps={fundingSequence} />

      <RegionalLenderSearch
        userState={profile.businesses[0]?.state_of_formation || undefined}
        userCity={undefined}
        bureauScores={profile.scores}
      />
    </div>
  );
}
