import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertCircle } from "lucide-react";
import { useEconomicRates, formatRatesAsOf } from "@/hooks/useEconomicRates";
import { useAssistantName } from "@/lib/portal/customerIdentity";

/**
 * Banner shown on Funding Intelligence page when Fed Funds Rate > 6%
 * (high-rate environment indicator).
 */
export function RateEnvironmentBanner() {
  const assistant = useAssistantName();
  const { data: rates, isLoading } = useEconomicRates();

  if (isLoading || !rates) return null;
  const fed = rates.FEDFUNDS;
  const prime = rates.PRIME;
  if (!fed) return null;

  const isHighRate = fed.value > 6;
  if (!isHighRate) return null;

  return (
    <Card className="p-4 bg-fundability-fair/5 border-fundability-fair/30">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-fundability-fair shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">
              Current Rate Environment
            </p>
            <Badge variant="outline" className="text-xs">
              Fed Funds {fed.value.toFixed(2)}%
            </Badge>
            {prime && (
              <Badge variant="outline" className="text-xs">
                Prime {prime.value.toFixed(2)}%
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The Fed Funds Rate is currently <strong>{fed.value.toFixed(2)}%</strong> — business loan rates are elevated relative to historical norms. DSCR and SBA fixed-rate products can lock in current rates before potential changes. Speak with {assistant} about timing strategy for your specific goal.
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            <TrendingUp className="inline w-3 h-3 mr-1" />
            Rates as of {formatRatesAsOf(fed)} · Source: Federal Reserve (FRED)
          </p>
        </div>
      </div>
    </Card>
  );
}
