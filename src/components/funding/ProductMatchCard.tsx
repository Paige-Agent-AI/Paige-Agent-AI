import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { ExternalLink, AlertTriangle, XCircle, Info, CheckCircle2, MinusCircle, Zap, Clock, DollarSign, TrendingUp } from "lucide-react";
import type { ProductMatch } from "@/lib/fundingMatchScoring";
import { getCategoryMeta, getSpeedClass } from "@/lib/lenderCategories";
import { LenderFlagBadges } from "./LenderFlagBadges";
import { trackEvent } from "@/hooks/useAnalytics";
import { useRef } from "react";
import { useAssistantName } from "@/lib/portal/customerIdentity";

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  eligible: { bg: "bg-fundability-excellent/10", text: "text-fundability-excellent", label: "Eligible" },
  near_eligible: { bg: "bg-fundability-fair/10", text: "text-fundability-fair", label: "Near Eligible" },
  needs_improvement: { bg: "bg-warning/10", text: "text-warning", label: "Needs Improvement" },
  not_qualified: { bg: "bg-destructive/10", text: "text-destructive", label: "Not Yet Qualified" },
};

const SEVERITY_ICON = {
  critical: <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-fundability-fair shrink-0" />,
  info: <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />,
};

const STATUS_ICON = {
  positive: <CheckCircle2 className="w-3.5 h-3.5 text-fundability-excellent shrink-0" />,
  negative: <MinusCircle className="w-3.5 h-3.5 text-destructive shrink-0" />,
  neutral: <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />,
};

const BUREAU_COLORS: Record<string, string> = {
  experian: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  transunion: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  equifax: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  all_three: "bg-muted text-muted-foreground",
  middle_score: "bg-muted text-muted-foreground",
  flexible: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function formatRequirement(label: string, value: string | number | null | undefined, icon: React.ReactNode) {
  if (value == null || value === "" || value === 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export function ProductMatchCard({ match, onAskPaige }: { match: ProductMatch; onAskPaige?: (product: any) => void }) {
  const assistant = useAssistantName();
  const { product, score, category, deductions, estimatedAmount, estimateExplanation, dataPoints, primaryBureau, bureauPullLabel, demographicBoosts } = match;
  const style = CATEGORY_STYLES[category];
  const categoryMeta = getCategoryMeta(product.product_category || product.product_type);
  const hasDemographicBoost = demographicBoosts && demographicBoosts.length > 0;
  const boostTooltip = hasDemographicBoost
    ? `This lender has programs specifically for ${demographicBoosts.map((b) => b.label).join(" / ")} businesses.`
    : "";

  const viewedRef = useRef(false);
  const handleView = () => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    void trackEvent("funding_match_viewed", "engagement", {
      lender_name: product.lender_name,
      product_type: product.product_type ?? product.product_category ?? null,
      score,
      category,
    });
  };

  return (
    <Card
      className="p-4 bg-card border-border hover:shadow-md transition-all"
      onClick={handleView}
      onMouseEnter={handleView}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{product.lender_name}</h3>
            {hasDemographicBoost && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className="text-[10px] bg-gradient-gold text-accent-foreground border-0 cursor-help font-semibold tracking-wide">
                      ★ Matched for You
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">{boostTooltip}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {product.product_subcategory && (
              <span className="text-sm text-muted-foreground">{product.product_subcategory.replace(/_/g, " ")}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge className={`text-xs border ${categoryMeta.badgeClass}`}>{categoryMeta.shortLabel}</Badge>
            <Badge className={`text-xs ${style.bg} ${style.text} border-0`}>{style.label}</Badge>
            <Badge variant="outline" className={`text-xs border-0 ${BUREAU_COLORS[primaryBureau] || BUREAU_COLORS.middle_score}`}>
              {bureauPullLabel}
            </Badge>
            {product.confidence_level === "verified" && (
              <Badge variant="outline" className="text-xs">Verified</Badge>
            )}
          </div>
          <div className="mt-2">
            <LenderFlagBadges product={product} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-foreground">{score}<span className="text-sm text-muted-foreground">/100</span></div>
          {estimatedAmount ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-sm font-semibold text-accent cursor-help">
                    Est. ${estimatedAmount.toLocaleString()}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs"><p className="text-xs">{estimateExplanation}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="text-xs text-muted-foreground italic">{estimateExplanation || "—"}</div>
          )}
        </div>
      </div>

      {/* Key requirements */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 bg-muted/30 rounded-lg p-3">
        {formatRequirement("Min Score", product.min_fico_score, <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />)}
        {formatRequirement("Min Revenue", product.min_annual_revenue ? `$${Number(product.min_annual_revenue).toLocaleString()}` : null, <DollarSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />)}
        {formatRequirement("Min TIB", product.min_business_age_months ? `${product.min_business_age_months} mo` : null, <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />)}
        {product.funding_speed && (
          <div className="flex items-center gap-1.5 text-xs">
            <Zap className={`w-3.5 h-3.5 shrink-0 ${getSpeedClass(product.funding_speed)}`} />
            <span className="text-muted-foreground">Speed:</span>
            <span className={`font-medium ${getSpeedClass(product.funding_speed)}`}>{product.funding_speed}</span>
          </div>
        )}
        {product.max_amount && (
          <div className="flex items-center gap-1.5 text-xs">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Up to:</span>
            <span className="font-medium text-foreground">${Number(product.max_amount).toLocaleString()}</span>
          </div>
        )}
        {product.interest_rate_range && (
          <div className="flex items-center gap-1.5 text-xs">
            <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Rate:</span>
            <span className="font-medium text-foreground">{product.interest_rate_range}</span>
          </div>
        )}
      </div>

      {/* Profile Data Points */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 bg-card border border-border rounded-lg p-3">
        {dataPoints.slice(0, 6).map((dp, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            {STATUS_ICON[dp.status]}
            <span className="text-muted-foreground">{dp.label}:</span>
            <span className="font-medium text-foreground">{dp.value}</span>
          </div>
        ))}
      </div>

      {/* Deductions */}
      {deductions.length > 0 && (
        <div className="mt-3 space-y-1">
          {deductions.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              {SEVERITY_ICON[d.severity]}
              <span className="text-foreground">{d.label}</span>
              {d.points > 0 && <span className="text-destructive font-semibold ml-auto shrink-0">-{d.points}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {product.notes && (
        <p className="mt-3 text-xs text-muted-foreground italic border-l-2 border-border pl-3">
          {product.notes}
        </p>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {category === "eligible" && product.application_url && (
          <Button size="sm" variant="outline" className="text-xs" asChild>
            <a href={product.affiliate_url || product.application_url} target="_blank" rel="noopener noreferrer">
              Apply <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </Button>
        )}
        {onAskPaige && (
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => onAskPaige(product)}>
            Ask {assistant} about this lender
          </Button>
        )}
      </div>
    </Card>
  );
}
