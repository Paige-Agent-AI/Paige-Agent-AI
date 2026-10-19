import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Lock, HelpCircle, Loader2, ArrowRight, Building2, LayoutGrid, ShieldCheck, ShieldAlert, ShieldQuestion, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useThreeFundabilityScores } from "@/hooks/useThreeFundabilityScores";
import { useBusinessContext, entityRoleLabel } from "@/contexts/BusinessContext";
import { useFinancialDataAccuracy, type AccuracyLevel } from "@/hooks/useFinancialDataAccuracy";
import { supabase } from "@/integrations/supabase/client";
import { BusinessPortfolio } from "./BusinessPortfolio";
import type { FundabilityScoreResult, FundabilityBand, CreditBureau, BureauScoreEntry } from "@/lib/fundabilityScores";
import { useAssistantName } from "@/lib/portal/customerIdentity";

const BUREAU_LABEL: Record<CreditBureau, string> = {
  experian: "Experian",
  transunion: "TransUnion",
  equifax: "Equifax",
};
const BUREAU_ORDER: CreditBureau[] = ["experian", "transunion", "equifax"];

const SHORT_TITLES: Record<string, string> = {
  personal: "Personal",
  small_business: "Small Biz (PG)",
  commercial: "Commercial",
};

function bandColor(band: FundabilityBand | null): string {
  switch (band) {
    case "excellent":
    case "elite":
      return "text-fundability-excellent";
    case "very_good":
    case "established":
      return "text-fundability-good";
    case "good":
    case "emerging":
      return "text-fundability-good";
    case "fair":
    case "building":
      return "text-fundability-fair";
    default:
      return "text-fundability-poor";
  }
}

function bandBg(band: FundabilityBand | null): string {
  switch (band) {
    case "excellent":
    case "elite":
      return "bg-fundability-excellent";
    case "very_good":
    case "established":
    case "good":
    case "emerging":
      return "bg-fundability-good";
    case "fair":
    case "building":
      return "bg-fundability-fair";
    default:
      return "bg-fundability-poor";
  }
}

function AccuracyChip({
  level,
  label,
  description,
  size = "sm",
}: {
  level: AccuracyLevel;
  label: string;
  description: string;
  size?: "sm" | "xs";
}) {
  const Icon =
    level === "high" ? ShieldCheck : level === "medium" ? ShieldQuestion : ShieldAlert;
  const tone =
    level === "high"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : level === "medium"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-muted-foreground/30 bg-muted text-muted-foreground";
  const sizing =
    size === "xs"
      ? "text-[10px] px-1.5 py-0.5 gap-1"
      : "text-[11px] px-2 py-0.5 gap-1.5";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center rounded-full border font-medium ${tone} ${sizing}`}
          >
            <Icon className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs">{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BureauLens({ result }: { result: FundabilityScoreResult }) {
  const assistant = useAssistantName();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const bureauScores = result.bureauScores;
  if (!bureauScores) return null;

  const strongest = result.strongestBureau ?? null;
  const strongestScore = result.strongestBureauScore ?? null;
  const variance = result.bureauVariance ?? 0;

  // Determine bar color per bureau: green=highest, amber=middle, red=lowest
  const unlockedEntries = BUREAU_ORDER
    .map((b) => [b, bureauScores[b]] as [CreditBureau, BureauScoreEntry])
    .filter(([, e]) => !e.locked && typeof e.score === "number");
  const sorted = [...unlockedEntries].sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  const colorOf = (b: CreditBureau): string => {
    const idx = sorted.findIndex(([bb]) => bb === b);
    if (idx === -1) return "bg-muted";
    if (sorted.length === 1) return "bg-fundability-good";
    if (idx === 0) return "bg-fundability-excellent";
    if (idx === sorted.length - 1) return "bg-fundability-poor";
    return "bg-fundability-fair";
  };
  const textColorOf = (b: CreditBureau): string => {
    const idx = sorted.findIndex(([bb]) => bb === b);
    if (idx === -1) return "text-muted-foreground";
    if (sorted.length === 1) return "text-fundability-good";
    if (idx === 0) return "text-fundability-excellent";
    if (idx === sorted.length - 1) return "text-fundability-poor";
    return "text-fundability-fair";
  };

  const strongestEntry = strongest ? bureauScores[strongest] : null;
  const weakestEntry = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-1.5">
          <Eye className="w-3 h-3 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Bureau Lens
          </span>
        </div>
        <div className="flex items-center gap-2">
          {strongest && strongestScore != null ? (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
            >
              Strongest: {BUREAU_LABEL[strongest]} ({strongestScore})
            </Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground">No bureau scores yet</span>
          )}
          {open ? (
            <ChevronUp className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-2.5">
          {BUREAU_ORDER.map((bureau) => {
            const entry = bureauScores[bureau];
            const score = entry.score ?? 0;
            return (
              <div key={bureau} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-foreground">{BUREAU_LABEL[bureau]}</span>
                  {entry.locked ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Lock className="w-2.5 h-2.5" />
                      Upload {BUREAU_LABEL[bureau]} report
                    </span>
                  ) : (
                    <span className={`font-semibold ${textColorOf(bureau)}`}>
                      {score}/100 {entry.bandLabel ? `· ${entry.bandLabel}` : ""}
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  {!entry.locked && (
                    <div
                      className={`h-full ${colorOf(bureau)} transition-all duration-700`}
                      style={{ width: `${score}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Strategic insight */}
          {strongest && strongestEntry?.score != null && weakestEntry && (
            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
              Your <span className="font-medium text-foreground">{BUREAU_LABEL[strongest]}</span>{" "}
              score is your strongest bureau
              {sorted.length > 1 && weakestEntry[1].score != null && (
                <> — {(strongestEntry.score ?? 0) - (weakestEntry[1].score ?? 0)} points above your weakest</>
              )}
              . When applying for products that pull {BUREAU_LABEL[strongest]} you are in a significantly
              stronger position.
            </p>
          )}

          {/* Variance alerts */}
          {sorted.length === 3 && variance >= 30 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              ⚠ Your bureau scores vary significantly ({variance} points). This matters — apply to
              lenders that pull your strongest bureau first. Ask {assistant} which bureau each lender
              pulls before submitting any application.
            </div>
          )}
          {sorted.length === 3 && variance > 0 && variance < 10 && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-700 dark:text-emerald-400">
              Your scores are consistent across bureaus — you have flexibility in which lenders you
              approach.
            </div>
          )}

          {/* Locked-bureau CTA */}
          {sorted.length < 3 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-1 h-7 text-[11px]"
              onClick={() => navigate("/app/credit")}
            >
              Upload missing bureau reports
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  result,
  compact = false,
  accuracy,
}: {
  result: FundabilityScoreResult;
  compact?: boolean;
  accuracy?: { level: AccuracyLevel; label: string; description: string };
}) {
  const navigate = useNavigate();
  const typeLabel =
    result.type === "personal"
      ? "Personal credit products"
      : result.type === "small_business"
      ? "PG-required products"
      : "EIN-only products";
  const displayTitle = compact ? SHORT_TITLES[result.type] ?? result.title : result.title;

  if (result.locked) {
    if (compact) {
      return (
        <Card className="p-4 bg-card border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{displayTitle}</h3>
            <p className="text-xs text-muted-foreground line-clamp-1">{result.lockedReason}</p>
          </div>
          {result.lockedCta && (
            <Button
              size="sm"
              className="bg-gold text-primary hover:bg-gold/90 shrink-0"
              onClick={() => navigate(result.lockedCta!.route)}
            >
              {result.lockedCta.label}
            </Button>
          )}
        </Card>
      );
    }
    return (
      <Card className="p-5 bg-card border-border flex flex-col h-full">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{result.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{typeLabel}</p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground" aria-label="Inputs required">
                  <HelpCircle className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs font-semibold mb-1">Inputs required</p>
                <ul className="text-xs space-y-0.5 list-disc pl-4">
                  {result.inputsRequired.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex flex-col items-center justify-center flex-1 py-6 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4 px-2">{result.lockedReason}</p>
          {result.lockedCta && (
            <Button
              size="sm"
              className="bg-gold text-primary hover:bg-gold/90"
              onClick={() => navigate(result.lockedCta!.route)}
            >
              {result.lockedCta.label}
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          )}
        </div>
      </Card>
    );
  }

  const score = result.score ?? 0;
  const color = bandColor(result.band);
  const bg = bandBg(result.band);

  if (compact) {
    return (
      <Card className="p-4 bg-card border-border flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{displayTitle}</h3>
            {accuracy && (
              <AccuracyChip
                level={accuracy.level}
                label={accuracy.label}
                description={accuracy.description}
                size="xs"
              />
            )}
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mt-2">
            <div className={`h-full ${bg} transition-all duration-700`} style={{ width: `${score}%` }} />
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-2xl font-bold leading-none ${color}`}>{score}</span>
          {result.bandLabel && (
            <span className={`text-[10px] font-semibold uppercase tracking-wide mt-1 ${color}`}>
              {result.bandLabel}
            </span>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 bg-card border-border flex flex-col h-full">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{result.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{typeLabel}</p>
          {accuracy && (
            <div className="mt-2">
              <AccuracyChip
                level={accuracy.level}
                label={accuracy.label}
                description={accuracy.description}
              />
            </div>
          )}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground" aria-label="Inputs required">
                <HelpCircle className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs font-semibold mb-1">Inputs used</p>
              <ul className="text-xs space-y-0.5 list-disc pl-4">
                {result.inputsRequired.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-4xl font-bold ${color}`}>{score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        {result.bandLabel && (
          <Badge variant="outline" className={`ml-auto ${color} border-current`}>
            {result.bandLabel}
          </Badge>
        )}
      </div>

      <div className="h-2 w-full bg-muted rounded-full overflow-hidden mb-3">
        <div className={`h-full ${bg} transition-all duration-700`} style={{ width: `${score}%` }} />
      </div>

      <p className="text-xs text-foreground mb-3">{result.meaning}</p>

      {result.unlocks.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Unlocks</p>
          <ul className="text-xs text-foreground space-y-0.5">
            {result.unlocks.map((u) => (
              <li key={u}>• {u}</li>
            ))}
          </ul>
        </div>
      )}

      {result.improvements.length > 0 && (
        <div className="mt-auto">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            How to improve
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {result.improvements.map((i) => (
              <li key={i}>• {i}</li>
            ))}
          </ul>
        </div>
      )}

      {(result.type === "personal" || result.type === "small_business") && result.bureauScores && (
        <BureauLens result={result} />
      )}
    </Card>
  );
}

export function ThreeFundabilityScoresPanel({
  compactOnMobile = false,
}: { compactOnMobile?: boolean } = {}) {
  const { activeBusiness, businesses } = useBusinessContext();
  const { personal, small_business, commercial, isLoading } = useThreeFundabilityScores(
    activeBusiness?.id ?? null
  );
  const isMobile = useIsMobile();
  const useCompact = compactOnMobile && isMobile;
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUserId(data.user?.id ?? null);
    });
    return () => { mounted = false; };
  }, []);

  const { data: accuracyData } = useFinancialDataAccuracy(userId);
  const accuracy = accuracyData
    ? { level: accuracyData.level, label: accuracyData.label, description: accuracyData.description }
    : undefined;

  const hasMultipleBusinesses = businesses.length > 1;

  if (isLoading) {
    return (
      <Card className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Fundability Scores</h2>
          <p className="text-xs text-muted-foreground">
            Three distinct scores — each one tells you what you can fund right now and what's blocking the next tier.
          </p>
        </div>
        {hasMultipleBusinesses && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPortfolioOpen(true)}
            className="gap-1.5"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            View All Businesses
          </Button>
        )}
      </div>

      {hasMultipleBusinesses && activeBusiness && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Showing scores for:</span>
          <span className="font-medium text-foreground">{activeBusiness.legal_name}</span>
          {activeBusiness.entity_role && (
            <Badge variant="outline" className="text-[10px]">
              {entityRoleLabel(activeBusiness.entity_role)}
            </Badge>
          )}
        </div>
      )}

      <div className={useCompact ? "flex flex-col gap-3" : "grid grid-cols-1 md:grid-cols-3 gap-4"}>
        <ScoreCard result={personal} compact={useCompact} accuracy={accuracy} />
        <ScoreCard result={small_business} compact={useCompact} accuracy={accuracy} />
        <ScoreCard result={commercial} compact={useCompact} accuracy={accuracy} />
      </div>

      <BusinessPortfolio open={portfolioOpen} onOpenChange={setPortfolioOpen} />
    </div>
  );
}
