/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   file (untyped Supabase reads, stale generated types). The E09 Customer Portal identity change
   (CURA, never PAIGE, on customer surfaces) only edited copy here and introduced ZERO new `any`s;
   retyping is tracked separately (#234). */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Building2, Upload, ExternalLink, Loader2, FileText, History, Info } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useBusinessContext, entityRoleLabel } from "@/contexts/BusinessContext";
import { useBuildScoreRefresh } from "@/hooks/useBuildScoreRefresh";
import { useAssistantName } from "@/lib/portal/customerIdentity";

type Bureau = "dnb" | "experian_business" | "equifax_sbfe";

interface BureauMeta {
  key: Bureau;
  name: string;
  scoreLabel: string;
  scoreField: "paydex_score" | "intelliscore" | "sbfe_score";
  scoreRange: string;
  goodCutoff: number;
  amberCutoff: number;
  greenCutoff: number;
  description: string;
  howToGet: { text: string; url?: string };
  anchorId: string;
}

const BUREAUS: BureauMeta[] = [
  {
    key: "dnb",
    name: "Dun & Bradstreet — Paydex Score",
    scoreLabel: "Paydex Score",
    scoreField: "paydex_score",
    scoreRange: "0–100",
    goodCutoff: 70,
    amberCutoff: 79,
    greenCutoff: 80,
    description:
      "80 is the gold standard — it means you pay all vendors exactly on time. Above 80 means you pay early. Below 70 signals payment risk to lenders.",
    howToGet: {
      text: "Get your free D&B report at dnb.com/duns-number — search for your business using your DUNS number or EIN.",
      url: "https://www.dnb.com/duns-number.html",
    },
    anchorId: "bureau-dnb",
  },
  {
    key: "experian_business",
    name: "Experian Business — Intelliscore Plus",
    scoreLabel: "Intelliscore Plus",
    scoreField: "intelliscore",
    scoreRange: "0–100",
    goodCutoff: 50,
    amberCutoff: 74,
    greenCutoff: 75,
    description:
      "Intelliscore Plus predicts the likelihood of serious delinquency in the next 12 months. Higher is better. Above 76 is considered low risk by most lenders.",
    howToGet: {
      text: "Access your Experian Business report at businesscreditfacts.com or through your lender.",
      url: "https://www.businesscreditfacts.com",
    },
    anchorId: "bureau-experian",
  },
  {
    key: "equifax_sbfe",
    name: "Equifax Small Business — SBFE Score",
    scoreLabel: "SBFE Score",
    scoreField: "sbfe_score",
    scoreRange: "Lender-reported",
    goodCutoff: 200,
    amberCutoff: 240,
    greenCutoff: 270,
    description:
      "The SBFE score is used primarily by SBA lenders and major banks. It is the hardest business credit score to access directly — most clients see it when a lender pulls it during a loan application.",
    howToGet: {
      text: "Your SBFE data is most commonly accessed through your lender. You can request a copy through Equifax Small Business at equifax.com/business.",
      url: "https://www.equifax.com/business/",
    },
    anchorId: "bureau-equifax",
  },
];

interface BusinessCreditReportRow {
  id: string;
  bureau: Bureau;
  report_date: string | null;
  paydex_score: number | null;
  intelliscore: number | null;
  sbfe_score: number | null;
  trade_line_count: number | null;
  derogatory_count: number | null;
  days_beyond_terms: number | null;
  payment_trend: string | null;
  extraction_status: string;
  created_at: string;
}

function scoreClass(meta: BureauMeta, value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (value >= meta.greenCutoff && value < meta.greenCutoff + 20) return "text-emerald-500";
  if (value >= meta.greenCutoff + 20) return "text-accent"; // gold
  if (value >= meta.goodCutoff) return "text-amber-500";
  return "text-destructive";
}

function progressValue(meta: BureauMeta, value: number | null): number {
  if (value == null) return 0;
  // Normalize SBFE roughly to 0-100 for the bar
  if (meta.key === "equifax_sbfe") return Math.min(100, Math.round((value / 300) * 100));
  return Math.min(100, value);
}

export function BusinessCreditTab() {
  const assistant = useAssistantName();
  const qc = useQueryClient();
  const { invalidate: invalidateBuildScore } = useBuildScoreRefresh();
  const { activeBusiness, businesses } = useBusinessContext();
  const activeBusinessId = activeBusiness?.id ?? null;
  const [uploading, setUploading] = useState<Bureau | null>(null);
  const fileInputRefs = useRef<Record<Bureau, HTMLInputElement | null>>({
    dnb: null,
    experian_business: null,
    equifax_sbfe: null,
  });

  // Scroll to the requested anchor when ?bureau=dnb|experian|equifax is in the URL or hash
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && hash.startsWith("bureau-")) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    }
  }, []);

  // Active business detail (bureau scores live on the businesses row)
  const { data: business } = useQuery({
    queryKey: ["business-for-credit", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async () => {
      const { data } = await supabase
        .from("businesses")
        .select(
          "id, legal_name, dnb_paydex_score, dnb_paydex, dnb_report_date, dnb_duns_number, experian_intelliscore_score, experian_intelliscore, experian_report_date, equifax_sbfe_score, equifax_payment_index_score, equifax_report_date, business_credit_last_updated"
        )
        .eq("id", activeBusinessId!)
        .maybeSingle();
      return data as any;
    },
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["business-credit-reports", activeBusinessId],
    enabled: !!activeBusinessId,
    queryFn: async (): Promise<BusinessCreditReportRow[]> => {
      const { data } = await supabase
        .from("business_credit_reports")
        .select(
          "id, bureau, report_date, paydex_score, intelliscore, sbfe_score, trade_line_count, derogatory_count, days_beyond_terms, payment_trend, extraction_status, created_at"
        )
        .eq("business_id", activeBusinessId!)
        .order("created_at", { ascending: false });
      return (data as BusinessCreditReportRow[]) || [];
    },
  });

  // Cross-entity portfolio summary (only when 2+ businesses exist)
  const { data: portfolioSummary = [] } = useQuery({
    queryKey: ["business-credit-portfolio-summary", businesses.map((b) => b.id).join(",")],
    enabled: businesses.length > 1,
    queryFn: async () => {
      const ids = businesses.map((b) => b.id);
      const { data } = await supabase
        .from("businesses")
        .select(
          "id, legal_name, entity_role, dnb_paydex, experian_intelliscore, equifax_payment_index"
        )
        .in("id", ids);
      return (data ?? []) as Array<{
        id: string;
        legal_name: string;
        entity_role: string | null;
        dnb_paydex: number | null;
        experian_intelliscore: number | null;
        equifax_payment_index: number | null;
      }>;
    },
  });

  const hasMultipleBusinesses = businesses.length > 1;

  const uploadMutation = useMutation({
    mutationFn: async ({ bureau, file }: { bureau: Bureau; file: File }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      if (!activeBusinessId) throw new Error("No active business selected");

      const form = new FormData();
      form.append("bureau", bureau);
      form.append("file", file);
      form.append("business_id", activeBusinessId);

      const res = await fetch(
        `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/extract-business-credit-report`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: form,
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Extraction failed");
      return json;
    },
    onSuccess: () => {
      toast.success("Report uploaded — scores extracted");
      qc.invalidateQueries({ queryKey: ["business-credit-reports", activeBusinessId] });
      qc.invalidateQueries({ queryKey: ["business-for-credit", activeBusinessId] });
      qc.invalidateQueries({ queryKey: ["business-credit-portfolio-summary"] });
      qc.invalidateQueries({ queryKey: ["three-fundability-inputs"] });
      // BUILD bureau-health sub-score reads the same `businesses` columns
      // the extractor just rewrote — refresh the ladder too.
      invalidateBuildScore();
      setUploading(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Upload failed");
      setUploading(null);
    },
  });

  const handlePick = (bureau: Bureau) => fileInputRefs.current[bureau]?.click();
  const handleFile = (bureau: Bureau, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeBusinessId) {
      toast.error("Select a business first");
      return;
    }
    setUploading(bureau);
    uploadMutation.mutate({ bureau, file });
    e.target.value = ""; // reset
  };

  return (
    <div className="space-y-6">
      {activeBusiness && (
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">
            Business Credit — {activeBusiness.legal_name}
          </h2>
          {activeBusiness.entity_role && (
            <Badge variant="outline">{entityRoleLabel(activeBusiness.entity_role)}</Badge>
          )}
        </div>
      )}

      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-accent mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Business credit report import</p>
            <p className="text-sm text-muted-foreground">
              Upload your D&B, Experian Business, or Equifax SBFE report PDF and {assistant} will read the
              scores into your file. These scores power your Commercial / EIN-Only fundability score.
            </p>
          </div>
        </CardContent>
      </Card>

      {hasMultipleBusinesses && portfolioSummary.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Portfolio credit summary</CardTitle>
            <CardDescription className="text-xs">
              Quick cross-entity view of your business credit scores.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">Business</th>
                    <th className="py-2 pr-4 font-medium">Paydex</th>
                    <th className="py-2 pr-4 font-medium">Intelliscore</th>
                    <th className="py-2 pr-4 font-medium">Equifax PI</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioSummary.map((row) => {
                    const isActive = row.id === activeBusinessId;
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-border/50 last:border-0 ${
                          isActive ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{row.legal_name}</span>
                            {row.entity_role && (
                              <Badge variant="outline" className="text-[10px]">
                                {entityRoleLabel(row.entity_role)}
                              </Badge>
                            )}
                            {isActive && (
                              <Badge variant="default" className="text-[10px]">
                                Active
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-4 font-semibold">
                          {row.dnb_paydex && row.dnb_paydex > 0 ? row.dnb_paydex : "—"}
                        </td>
                        <td className="py-2 pr-4 font-semibold">
                          {row.experian_intelliscore && row.experian_intelliscore > 0
                            ? row.experian_intelliscore
                            : "—"}
                        </td>
                        <td className="py-2 pr-4 font-semibold">
                          {row.equifax_payment_index && row.equifax_payment_index > 0
                            ? row.equifax_payment_index
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {BUREAUS.map((meta) => {
        const latest = reports.find((r) => r.bureau === meta.key);
        const history = reports.filter((r) => r.bureau === meta.key);
        const score: number | null = latest ? (latest[meta.scoreField] as number | null) : null;
        const reportDate = latest?.report_date || latest?.created_at || null;

        return (
          <Card key={meta.key} id={meta.anchorId} className="shadow-card scroll-mt-24">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{meta.name}</CardTitle>
                    <CardDescription>Range {meta.scoreRange}</CardDescription>
                  </div>
                </div>
                {score != null ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                    Synced
                  </Badge>
                ) : (
                  <Badge variant="outline">No data</Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <p className="text-xs text-muted-foreground">{meta.scoreLabel}</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-5xl font-bold ${scoreClass(meta, score)}`}>
                      {score ?? "—"}
                    </span>
                  </div>
                  <Progress value={progressValue(meta, score)} className="h-2 mt-2" />
                  {reportDate && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Last updated {format(new Date(reportDate), "MMM d, yyyy")}
                    </p>
                  )}
                </div>

                <div className="md:col-span-2 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">What this score means</p>
                    <p className="text-sm text-muted-foreground">{meta.description}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">How to get your report</p>
                    <p className="text-sm text-muted-foreground">{meta.howToGet.text}</p>
                    {meta.howToGet.url && (
                      <a
                        href={meta.howToGet.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-accent hover:underline mt-1"
                      >
                        Open bureau site <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {latest && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-md bg-muted/40">
                  <Stat label="Trade lines" value={latest.trade_line_count} />
                  <Stat label="Derogatory" value={latest.derogatory_count} />
                  <Stat label="Avg DBT" value={latest.days_beyond_terms} suffix=" days" />
                  <Stat label="Trend" value={latest.payment_trend ?? "—"} />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={(el) => (fileInputRefs.current[meta.key] = el)}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => handleFile(meta.key, e)}
                />
                <Button
                  onClick={() => handlePick(meta.key)}
                  disabled={uploading === meta.key}
                  className="gap-2"
                >
                  {uploading === meta.key ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Extracting…
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" /> Upload Report PDF
                    </>
                  )}
                </Button>
                {history.length > 1 && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <History className="w-3 h-3" /> {history.length} reports on file
                  </span>
                )}
              </div>

              {history.length > 1 && (
                <details className="rounded-md border border-border">
                  <summary className="px-3 py-2 cursor-pointer text-sm font-medium">
                    Score history
                  </summary>
                  <div className="px-3 pb-3 space-y-2">
                    {history.map((row) => {
                      const v = row[meta.scoreField] as number | null;
                      return (
                        <div
                          key={row.id}
                          className="flex items-center justify-between text-sm border-t border-border pt-2"
                        >
                          <span className="text-muted-foreground inline-flex items-center gap-2">
                            <FileText className="w-3 h-3" />
                            {row.report_date
                              ? format(new Date(row.report_date), "MMM d, yyyy")
                              : format(new Date(row.created_at), "MMM d, yyyy")}
                          </span>
                          <span className={`font-semibold ${scoreClass(meta, v)}`}>
                            {v ?? "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}

      {hasMultipleBusinesses && activeBusiness && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          Showing credit data for{" "}
          <span className="font-medium text-foreground">{activeBusiness.legal_name}</span>. Switch
          businesses above to view credit data for your other entities.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">
        {value == null || value === "" ? "—" : `${value}${suffix}`}
      </p>
    </div>
  );
}
