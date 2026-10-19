/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   file (untyped Supabase reads, stale generated types). The E09 Customer Portal identity change
   (CURA, never PAIGE, on customer surfaces) only edited copy here and introduced ZERO new `any`s;
   retyping is tracked separately (#234). */
import { useState, useEffect, useCallback } from "react";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Upload, CalendarIcon, Save, TrendingUp, Sparkles, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBuildScoreRefresh } from "@/hooks/useBuildScoreRefresh";

interface Props {
  businessId: string;
  userId: string;
  onCompletionChange: (pct: number) => void;
}

interface BureauMetric {
  key: string;
  label: string;
  min: number;
  max: number;
  target: number;
  targetLabel: string;
}

interface BureauConfig {
  id: string;
  name: string;
  metrics: BureauMetric[];
  dunsField?: boolean;
  verifiedKey: string;
  note?: string;
}

const BUREAUS: BureauConfig[] = [
  {
    id: "dnb",
    name: "Dun & Bradstreet",
    verifiedKey: "dnb_last_verified",
    dunsField: true,
    metrics: [
      { key: "dnb_paydex", label: "PAYDEX", min: 1, max: 100, target: 80, targetLabel: "80+" },
      { key: "dnb_delinquency_predictor", label: "Delinquency Predictor", min: 1, max: 5, target: 1, targetLabel: "1" },
      { key: "dnb_failure_score", label: "Failure Score", min: 1, max: 5, target: 1, targetLabel: "1" },
    ],
  },
  {
    id: "experian",
    name: "Experian Business",
    verifiedKey: "experian_last_verified",
    metrics: [
      { key: "experian_intelliscore", label: "Intelliscore Plus", min: 1, max: 100, target: 70, targetLabel: "70+" },
    ],
  },
  {
    id: "equifax",
    name: "Equifax Business",
    verifiedKey: "equifax_last_verified",
    metrics: [
      { key: "equifax_payment_index", label: "Payment Index", min: 0, max: 100, target: 80, targetLabel: "80+" },
      { key: "equifax_credit_risk", label: "Credit Risk Score", min: 101, max: 992, target: 650, targetLabel: "650+" },
      { key: "equifax_failure_score", label: "Business Failure Score", min: 1000, max: 1880, target: 1600, targetLabel: "1,600+" },
    ],
  },
  {
    id: "fico",
    name: "FICO SBSS",
    verifiedKey: "fico_sbss_last_verified",
    note: "FICO SBSS is the SBA's gateway score. A minimum of 165 is required for SBA 7(a) Small Loan eligibility. This score is adaptive — it pulls from D&B, Experian, Equifax, and your personal FICO simultaneously, which is why building your personal credit through the ACCEL phase before or alongside the BUILD phase is critical.",
    metrics: [
      { key: "fico_sbss", label: "Composite Score", min: 0, max: 300, target: 165, targetLabel: "165+" },
    ],
  },
];

type ScoreData = Record<string, string>;

export function BusinessCreditSection({ businessId, userId, onCompletionChange }: Props) {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const { invalidate: invalidateBuildScore } = useBuildScoreRefresh();
  const [scores, setScores] = useState<ScoreData>({});
  const [dates, setDates] = useState<Record<string, Date | undefined>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState("");
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(async () => {
    if (!businessId) return;
    const { data: biz } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .maybeSingle();

    if (biz) {
      const s: ScoreData = {};
      const d: Record<string, Date | undefined> = {};
      for (const bureau of BUREAUS) {
        for (const m of bureau.metrics) {
          const val = (biz as any)[m.key];
          if (val != null) s[m.key] = String(val);
        }
        if (bureau.dunsField) {
          const duns = (biz as any)["dnb_duns"];
          if (duns) s["dnb_duns"] = duns;
        }
        const vd = (biz as any)[bureau.verifiedKey];
        if (vd) d[bureau.verifiedKey] = new Date(vd);
      }
      setScores(s);
      setDates(d);
    }

    const { data: hist } = await supabase
      .from("business_credit_history")
      .select("*")
      .eq("business_id", businessId)
      .order("recorded_at", { ascending: false })
      .limit(100);

    if (hist) setHistory(hist);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Calculate completion
  useEffect(() => {
    if (!loaded) return;
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    let active = 0;
    for (const bureau of BUREAUS) {
      const hasScore = bureau.metrics.some(m => scores[m.key] && Number(scores[m.key]) > 0);
      const vd = dates[bureau.verifiedKey];
      const isRecent = vd && (now - vd.getTime()) < ninetyDays;
      if (hasScore && isRecent) active++;
    }
    onCompletionChange(Math.round((active / 4) * 100));
  }, [scores, dates, loaded, onCompletionChange]);

  const getStatus = (bureau: BureauConfig): "active" | "stale" | "none" => {
    const hasScore = bureau.metrics.some(m => scores[m.key] && Number(scores[m.key]) > 0);
    if (!hasScore) return "none";
    const vd = dates[bureau.verifiedKey];
    if (!vd) return "none";
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    return (Date.now() - vd.getTime()) < ninetyDays ? "active" : "stale";
  };

  const statusBadge = (status: "active" | "stale" | "none") => {
    if (status === "active") return <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30">Active</Badge>;
    if (status === "stale") return <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30">Stale</Badge>;
    return <Badge variant="secondary">Not Established</Badge>;
  };

  const getScoreColor = (val: number, metric: BureauMetric) => {
    // For delinquency/failure where lower is better
    if (metric.target <= 2) {
      return val <= metric.target ? "text-emerald-500" : val <= metric.target + 1 ? "text-amber-500" : "text-destructive";
    }
    if (val >= metric.target) return "text-emerald-500";
    if (val >= metric.target * 0.85) return "text-amber-500";
    return "text-destructive";
  };

  const handleSave = async (bureau: BureauConfig) => {
    setSaving(bureau.id);
    try {
      const updateObj: any = {};
      for (const m of bureau.metrics) {
        const v = scores[m.key];
        updateObj[m.key] = v ? parseInt(v) : null;
      }
      if (bureau.dunsField) updateObj["dnb_duns"] = scores["dnb_duns"] || null;
      const vd = dates[bureau.verifiedKey];
      updateObj[bureau.verifiedKey] = vd ? vd.toISOString() : null;

      const { error } = await supabase
        .from("businesses")
        .update(updateObj)
        .eq("id", businessId);

      if (error) throw error;

      // Record history for each metric with a value
      for (const m of bureau.metrics) {
        const v = scores[m.key];
        if (v && Number(v) > 0) {
          await supabase.from("business_credit_history").insert({
            business_id: businessId,
            user_id: userId,
            bureau: bureau.id,
            metric_name: m.key,
            score_value: parseInt(v),
            recorded_at: (vd || new Date()).toISOString(),
          });
        }
      }

      await fetchData();
      // Bureau scores feed both the BUILD bureau-health sub-score and the
      // tier ladder (Paydex >= 80 unlocks Tier L, etc.) — refresh now.
      invalidateBuildScore();
      toast.success(`${bureau.name} scores saved`);
    } catch (err: any) {
      toast.error("Save failed", { description: err.message });
    } finally {
      setSaving(null);
    }
  };

  const handleUpload = async (bureau: BureauConfig) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploading(bureau.id);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const fileName = `${Date.now()}_${file.name}`;
        const filePath = `${user.id}/${fileName}`;
        const { error: upErr } = await supabase.storage.from("credit-report-uploads").upload(filePath, file);
        if (upErr) throw upErr;

        const { error: dbErr } = await supabase.from("credit_report_uploads").insert({
          user_id: user.id,
          uploaded_by: user.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          report_type: "business",
          analysis_status: "pending",
        });
        if (dbErr) throw dbErr;

        const { data: upload } = await supabase
          .from("credit_report_uploads")
          .select("id")
          .eq("file_path", filePath)
          .maybeSingle();

        if (upload?.id) {
          supabase.functions.invoke("analyze-credit-report", {
            body: { reportId: upload.id, reportType: "business" },
          }).catch(console.error);
        }

        toast.success(`${bureau.name} report uploaded — analysis starting`);
      } catch (err: any) {
        toast.error("Upload failed", { description: err.message });
      } finally {
        setUploading(null);
      }
    };
    input.click();
  };

  const getHistoryForMetric = (metricKey: string) => {
    return history
      .filter(h => h.metric_name === metricKey)
      .slice(0, 3)
      .reverse();
  };

  const generateInsight = async () => {
    setLoadingInsight(true);
    try {
      const scoresSummary = BUREAUS.map(b => {
        const vals = b.metrics.map(m => {
          const v = scores[m.key];
          return `${m.label}: ${v || "Not on file"} (Target: ${m.targetLabel})`;
        }).join(", ");
        const status = getStatus(b);
        return `${b.name} [${status}]: ${vals}`;
      }).join("\n");

      const { data, error } = await supabase.functions.invoke("paige-ai-chat", {
        body: {
          message: `Analyze this client's business credit bureau status and provide a 3-sentence coaching assessment. Identify the weakest bureau, compare scores to targets, and recommend the single most impactful action:\n\n${scoresSummary}`,
          sessionId: `biz-credit-insight-${businessId}`,
        },
      });
      if (error) throw error;
      setAiInsight(data?.reply || data?.response || "Unable to generate insight.");
    } catch {
      setAiInsight("Unable to generate insight at this time.");
    } finally {
      setLoadingInsight(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Bureau Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {BUREAUS.map(bureau => {
          const status = getStatus(bureau);
          return (
            <Card key={bureau.id} className="border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{bureau.name}</CardTitle>
                  {statusBadge(status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* D-U-N-S number field */}
                {bureau.dunsField && (
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">D-U-N-S Number</label>
                    <Input
                      placeholder="e.g. 12-345-6789"
                      value={scores["dnb_duns"] || ""}
                      onChange={e => setScores(p => ({ ...p, dnb_duns: e.target.value }))}
                      className="h-8 text-sm mt-1"
                    />
                  </div>
                )}

                {/* Score inputs */}
                {bureau.metrics.map(m => {
                  const val = scores[m.key] ? Number(scores[m.key]) : null;
                  return (
                    <div key={m.key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-muted-foreground font-medium">{m.label}</label>
                        <span className="text-[10px] text-muted-foreground">Target: {m.targetLabel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={m.min}
                          max={m.max}
                          placeholder={`${m.min}–${m.max}`}
                          value={scores[m.key] || ""}
                          onChange={e => setScores(p => ({ ...p, [m.key]: e.target.value }))}
                          className="h-8 text-sm flex-1"
                        />
                        {val != null && val > 0 && (
                          <span className={`text-lg font-bold ${getScoreColor(val, m)}`}>{val}</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Last verified date */}
                <div>
                  <label className="text-xs text-muted-foreground font-medium">Last Verified</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("w-full justify-start text-left text-xs mt-1 h-8", !dates[bureau.verifiedKey] && "text-muted-foreground")}>
                        <CalendarIcon className="w-3 h-3 mr-1" />
                        {dates[bureau.verifiedKey] ? format(dates[bureau.verifiedKey]!, "PPP") : "Select date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dates[bureau.verifiedKey]}
                        onSelect={d => setDates(p => ({ ...p, [bureau.verifiedKey]: d }))}
                        disabled={d => d > new Date()}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Bureau note */}
                {bureau.note && (
                  <Alert className="border-accent/30 bg-accent/5">
                    <Info className="w-3 h-3 text-accent" />
                    <AlertDescription className="text-[11px]">{bureau.note}</AlertDescription>
                  </Alert>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => handleSave(bureau)}
                    disabled={saving === bureau.id}
                  >
                    {saving === bureau.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={() => handleUpload(bureau)}
                    disabled={uploading === bureau.id}
                  >
                    {uploading === bureau.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
                    Upload Report
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Credit Trajectory Panel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Business Credit Trajectory
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No score history yet. Save scores above to begin tracking your trajectory.</p>
          ) : (
            <div className="space-y-4">
              {BUREAUS.map(bureau => {
                const bureauHistory = bureau.metrics.map(m => ({
                  metric: m,
                  entries: getHistoryForMetric(m.key),
                })).filter(h => h.entries.length > 0);

                if (bureauHistory.length === 0) return null;

                return (
                  <div key={bureau.id}>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{bureau.name}</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-1 pr-4 text-muted-foreground font-medium">Metric</th>
                            {[0, 1, 2].map(i => (
                              <th key={i} className="text-center py-1 px-2 text-muted-foreground font-medium min-w-[80px]">
                                {i === 2 ? "Latest" : i === 1 ? "Previous" : "Oldest"}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bureauHistory.map(({ metric, entries }) => (
                            <tr key={metric.key} className="border-b border-border/50">
                              <td className="py-1.5 pr-4 font-medium">{metric.label}</td>
                              {[0, 1, 2].map(i => {
                                const entry = entries[i];
                                if (!entry) return <td key={i} className="text-center py-1.5 px-2 text-muted-foreground">—</td>;
                                return (
                                  <td key={i} className="text-center py-1.5 px-2">
                                    <span className={`font-bold ${getScoreColor(entry.score_value, metric)}`}>{entry.score_value}</span>
                                    <div className="text-[10px] text-muted-foreground">{format(new Date(entry.recorded_at), "MMM d, yy")}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Business credit insight from the customer's agent */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {agentName}'s business credit insight
            </CardTitle>
            <Button size="sm" variant="outline" className="text-xs" onClick={generateInsight} disabled={loadingInsight}>
              {loadingInsight ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              {aiInsight ? "Refresh" : "Generate"} Insight
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {aiInsight ? (
            <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{aiInsight}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-3">Click "Generate Insight" for {agentName}'s assessment of your business credit status.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
