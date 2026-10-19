import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, AlertTriangle, TrendingUp, TrendingDown, Calendar,
  Clock, CreditCard, Layers, Search, Sparkles, X, ArrowRight, Loader2,
} from "lucide-react";
import { useAssistantName } from "@/lib/portal/customerIdentity";

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

interface Prediction {
  id: string;
  prediction_type: PredictionType;
  title: string;
  description: string;
  impact_score: number | null;
  action_required: string | null;
  action_url: string | null;
  deadline_date: string | null;
  bureau: string | null;
  account_id: string | null;
  confidence: "high" | "medium" | "low";
  is_dismissed: boolean;
  is_acted_on: boolean;
  created_at: string;
  expires_at: string | null;
}

interface PredictionsPanelProps {
  userId: string | null | undefined;
  variant?: "full" | "compact";
  onNavigate?: (section: string) => void;
}

const TYPE_VISUAL: Record<
  PredictionType,
  { icon: typeof Zap; tone: "warning" | "opportunity" | "timing" }
> = {
  score_drop_warning: { icon: TrendingDown, tone: "warning" },
  score_increase_opportunity: { icon: TrendingUp, tone: "opportunity" },
  reporting_date_optimization: { icon: Calendar, tone: "timing" },
  account_age_risk: { icon: AlertTriangle, tone: "warning" },
  utilization_spike_warning: { icon: CreditCard, tone: "warning" },
  inquiry_strategy: { icon: Search, tone: "warning" },
  new_account_timing: { icon: Clock, tone: "timing" },
  payment_history_risk: { icon: AlertTriangle, tone: "warning" },
  credit_mix_opportunity: { icon: Layers, tone: "opportunity" },
  funding_window_alert: { icon: Sparkles, tone: "opportunity" },
};

const TONE_CLASSES: Record<"warning" | "opportunity" | "timing", string> = {
  warning: "border-destructive/40 bg-destructive/5",
  opportunity: "border-accent/40 bg-accent/5",
  timing: "border-primary/30 bg-primary/5",
};

const TONE_ICON: Record<"warning" | "opportunity" | "timing", string> = {
  warning: "text-destructive bg-destructive/10",
  opportunity: "text-accent-foreground bg-accent/20",
  timing: "text-primary bg-primary/10",
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function sortPredictions(items: Prediction[]): Prediction[] {
  return [...items].sort((a, b) => {
    const da = daysUntil(a.deadline_date);
    const db = daysUntil(b.deadline_date);
    // Urgent deadlines first
    if (da !== null && db !== null) {
      if (da !== db) return da - db;
    } else if (da !== null) {
      return -1;
    } else if (db !== null) {
      return 1;
    }
    // Then highest absolute impact
    const ia = Math.abs(a.impact_score ?? 0);
    const ib = Math.abs(b.impact_score ?? 0);
    if (ia !== ib) return ib - ia;
    // Then opportunities (positive impact) before warnings (negative impact)
    const sa = (a.impact_score ?? 0) >= 0 ? 0 : 1;
    const sb = (b.impact_score ?? 0) >= 0 ? 0 : 1;
    return sa - sb;
  });
}

export function PredictionsPanel({ userId, variant = "full", onNavigate }: PredictionsPanelProps) {
  const assistant = useAssistantName();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const limit = variant === "compact" ? 3 : 5;

  const { data: predictions = [], isLoading } = useQuery({
    queryKey: ["credit-predictions", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_predictions")
        .select("*")
        .eq("user_id", userId!)
        .eq("is_dismissed", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Prediction[];
    },
  });

  const visible = useMemo(() => sortPredictions(predictions).slice(0, limit), [predictions, limit]);

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("credit_predictions")
        .update({ is_dismissed: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-predictions", userId] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase.functions.invoke("generate-credit-predictions", {
        body: { user_id: userId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Predictions refreshed", description: `${assistant} re-scanned your file.` });
      queryClient.invalidateQueries({ queryKey: ["credit-predictions", userId] });
    },
    onError: (err: any) => {
      toast({
        title: "Could not refresh",
        description: err?.message || "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const handleAction = (p: Prediction) => {
    if (p.action_url && p.action_url !== "#") {
      if (p.action_url.startsWith("/app?section=") && onNavigate) {
        const section = p.action_url.split("section=")[1];
        if (section) {
          onNavigate(section);
          return;
        }
      }
      window.location.href = p.action_url;
      return;
    }
    // Default: route by type
    if (!onNavigate) return;
    if (p.prediction_type === "funding_window_alert") onNavigate("funding-marketplace");
    else if (p.prediction_type === "inquiry_strategy") onNavigate("personal");
    else onNavigate("personal");
  };

  if (!userId) return null;

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent" />
            {assistant}'s predictions
            {predictions.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {predictions.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="text-xs"
          >
            {refreshMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Refresh"
            )}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Proactive insights based on your current credit file.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            No active predictions right now. {assistant} will surface insights here as your file changes.
          </div>
        ) : (
          visible.map((p) => {
            const visual = TYPE_VISUAL[p.prediction_type] || TYPE_VISUAL.score_drop_warning;
            const Icon = visual.icon;
            const days = daysUntil(p.deadline_date);
            const impact = p.impact_score;
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-4 ${TONE_CLASSES[visual.tone]}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${TONE_ICON[visual.tone]}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="font-semibold text-sm leading-snug">{p.title}</h4>
                      <button
                        type="button"
                        onClick={() => dismissMutation.mutate(p.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        aria-label="Dismiss prediction"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {p.description}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {typeof impact === "number" && impact !== 0 && (
                        <Badge variant={impact > 0 ? "default" : "destructive"} className="text-xs">
                          {impact > 0 ? (
                            <TrendingUp className="w-3 h-3 mr-1" />
                          ) : (
                            <TrendingDown className="w-3 h-3 mr-1" />
                          )}
                          {impact > 0 ? "+" : ""}
                          {impact} pts
                        </Badge>
                      )}
                      {days !== null && days <= 30 && (
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {days <= 0 ? "Overdue" : `${days} day${days === 1 ? "" : "s"} left`}
                        </Badge>
                      )}
                      {p.bureau && p.bureau !== "all" && p.bureau !== "middle" && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {p.bureau}
                        </Badge>
                      )}
                      {p.bureau === "all" && (
                        <Badge variant="outline" className="text-xs">All bureaus</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => handleAction(p)}
                        className="h-8"
                      >
                        Take Action
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissMutation.mutate(p.id)}
                        className="h-8"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
