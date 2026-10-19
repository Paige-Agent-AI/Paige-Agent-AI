import { useState, useEffect } from "react";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, CheckCircle2, XCircle, Clock, Info, TrendingUp, TrendingDown, Minus, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FinancialDocsSectionProps {
  businessId: string;
  userId: string;
  onCompletionChange: (pct: number) => void;
}

interface DocType {
  key: string;
  label: string;
  insight: string;
}

const DOC_TYPES: DocType[] = [
  { key: "tax_returns_business", label: "Business Tax Returns (2 years)", insight: "SBA and traditional banks require two full years of business tax returns. Missing tax returns automatically disqualify you from most term loan products." },
  { key: "tax_returns_personal", label: "Personal Tax Returns (2 years)", insight: "All lenders pull personal returns for any product requiring a personal guarantee." },
  { key: "profit_and_loss", label: "Profit & Loss Statement (12 months)", insight: "Required for any LOC over $50,000 and all SBA products." },
  { key: "balance_sheet", label: "Balance Sheet (most recent)", insight: "Banks use this to calculate debt service coverage ratio. Required for SBA 7(a) and most bank term loans over $100K." },
  { key: "bank_statements", label: "Business Bank Statements (3 months)", insight: "Online lenders and revenue-based financing providers underwrite primarily from bank statement cash flow." },
  { key: "articles_of_organization", label: "Articles of Organization / Incorporation", insight: "Verifies the entity exists and matches public records. Required by every lender." },
  { key: "operating_agreement", label: "Operating Agreement", insight: "Required for multi-member entities. Verifies ownership structure for lenders." },
  { key: "business_licenses", label: "Business Licenses & Permits", insight: "Regulated industries require proof of licensing before any funding." },
];

interface DocRecord {
  id: string;
  doc_type: string;
  status: string;
  upload_date: string | null;
  document_id: string | null;
  notes: string | null;
}

export function FinancialDocsSection({ businessId, userId, onCompletionChange }: FinancialDocsSectionProps) {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const [docs, setDocs] = useState<Record<string, DocRecord>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [bankStatements, setBankStatements] = useState<{ month: string; uploaded: boolean; totalDeposits?: number; totalWithdrawals?: number; avgBalance?: number }[]>([]);
  const [aiInsight, setAiInsight] = useState("");
  const [loadingInsight, setLoadingInsight] = useState(false);

  useEffect(() => { fetchDocs(); }, [businessId]);

  // Initialize bank statement months
  useEffect(() => {
    const months: typeof bankStatements = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: d.toLocaleDateString("en-US", { year: "numeric", month: "long" }),
        uploaded: false,
      });
    }
    setBankStatements(months);
  }, []);

  const fetchDocs = async () => {
    const { data } = await supabase
      .from("business_financial_docs")
      .select("*")
      .eq("business_id", businessId);
    const map: Record<string, DocRecord> = {};
    (data || []).forEach((d: any) => { map[d.doc_type] = d; });
    setDocs(map);

    const uploaded = DOC_TYPES.filter(dt => {
      const doc = map[dt.key];
      if (!doc || doc.status === "missing") return false;
      if (doc.upload_date) {
        const uploadDate = new Date(doc.upload_date);
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        if (uploadDate < oneYearAgo) return false;
      }
      return true;
    }).length;
    onCompletionChange(Math.round((uploaded / DOC_TYPES.length) * 100));
  };

  const getStatus = (key: string): "uploaded" | "outdated" | "missing" => {
    const doc = docs[key];
    if (!doc || doc.status === "missing") return "missing";
    if (doc.upload_date) {
      const uploadDate = new Date(doc.upload_date);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (uploadDate < oneYearAgo) return "outdated";
    }
    return "uploaded";
  };

  const handleUpload = async (docType: DocType) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setUploading(docType.key);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const fileName = `${Date.now()}_${file.name}`;
        const filePath = `${user.id}/${businessId}/${docType.key}/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from("business-documents")
          .upload(filePath, file);
        if (uploadError) throw uploadError;

        const { data: docData, error: docErr } = await supabase.from("documents").insert({
          user_id: user.id,
          business_id: businessId,
          file_name: file.name,
          file_path: filePath,
          folder_path: `/${docType.key}/`,
          mime_type: file.type,
          file_size: file.size,
          bucket_name: "business-documents",
          document_type: docType.key,
        }).select("id").single();
        if (docErr) throw docErr;

        const existing = docs[docType.key];
        if (existing) {
          await supabase.from("business_financial_docs").update({
            status: "uploaded",
            document_id: docData.id,
            upload_date: new Date().toISOString(),
          } as any).eq("id", existing.id);
        } else {
          await supabase.from("business_financial_docs").insert({
            business_id: businessId,
            user_id: user.id,
            doc_type: docType.key,
            status: "uploaded",
            document_id: docData.id,
            upload_date: new Date().toISOString(),
          } as any);
        }

        // If bank statement, trigger analysis
        if (docType.key === "bank_statements" && file.type === "application/pdf") {
          supabase.functions.invoke("analyze-financial-document", {
            body: { documentId: docData.id, documentType: "bank_statement" },
          }).catch(console.error);
        }

        toast.success(`${docType.label} uploaded`);
        fetchDocs();
      } catch (err: any) {
        toast.error("Upload failed", { description: err.message });
      } finally {
        setUploading(null);
      }
    };
    input.click();
  };

  const generateInsight = async () => {
    setLoadingInsight(true);
    try {
      const docSummary = DOC_TYPES.map(dt => `${dt.label}: ${getStatus(dt.key)}`).join("\n");
      const { data, error } = await supabase.functions.invoke("paige-ai-chat", {
        body: {
          message: `Analyze this client's financial documentation status for funding readiness. In 3 sentences, identify the most critical missing document and explain what it blocks:\n\n${docSummary}`,
          sessionId: `fin-docs-insight-${businessId}`,
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

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "uploaded") return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
    if (status === "outdated") return <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    return <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
  };

  const uploadedCount = DOC_TYPES.filter(dt => getStatus(dt.key) === "uploaded").length;

  return (
    <div className="space-y-6">
      {/* Document Categories */}
      <div className="space-y-3">
        {DOC_TYPES.map(dt => {
          const status = getStatus(dt.key);
          const doc = docs[dt.key];
          return (
            <Card key={dt.key} className={`border ${status === "uploaded" ? "border-emerald-500/20" : status === "outdated" ? "border-amber-500/20" : "border-border"}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <StatusIcon status={status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{dt.label}</p>
                        {doc?.upload_date && (
                          <p className="text-xs text-muted-foreground">
                            Uploaded {new Date(doc.upload_date).toLocaleDateString()}
                            {status === "outdated" && <span className="text-amber-500 ml-1">— Outdated (over 12 months old)</span>}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={status === "uploaded" ? "default" : status === "outdated" ? "secondary" : "destructive"}
                          className={status === "uploaded" ? "bg-emerald-500/20 text-emerald-600 border-emerald-500/30 text-xs" : status === "outdated" ? "bg-amber-500/20 text-amber-600 border-amber-500/30 text-xs" : "text-xs"}>
                          {status === "uploaded" ? "Uploaded" : status === "outdated" ? "Outdated" : "Missing"}
                        </Badge>
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => handleUpload(dt)} disabled={uploading === dt.key}>
                          <Upload className="w-3 h-3 mr-1" />
                          {uploading === dt.key ? "..." : status === "uploaded" ? "Replace" : "Upload"}
                        </Button>
                      </div>
                    </div>
                    {status !== "uploaded" && (
                      <Alert className="mt-2 border-blue-500/20 bg-blue-500/5 py-2">
                        <Info className="w-3 h-3 text-blue-500" />
                        <AlertDescription className="text-xs">{dt.insight}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bank Statement Analysis */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Bank Statement Analysis
            </CardTitle>
            <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/30">
              QuickBooks Sync — Phase 2
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload individual monthly bank statements for detailed cash flow analysis. This replaces the need for live bank connections in Phase 1.
          </p>

          {/* Summary metrics from uploaded statements */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Monthly Revenue</p>
              <p className="text-lg font-bold text-foreground">—</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Monthly Balance</p>
              <p className="text-lg font-bold text-foreground">—</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cash Flow Trend</p>
              <p className="text-lg font-bold text-muted-foreground flex items-center justify-center gap-1">
                <Minus className="w-4 h-4" /> N/A
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Months on File</p>
              <p className="text-lg font-bold text-foreground">0</p>
            </div>
          </div>

          <Alert className="border-accent/20 bg-accent/5">
            <Info className="w-3 h-3 text-accent" />
            <AlertDescription className="text-xs">
              <strong>Phase 2 Preview:</strong> QuickBooks integration is planned — when connected, your P&L and transaction history will sync automatically without manual uploads.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Documentation insight from the customer's agent */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {agentName}'s documentation insight
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
            <p className="text-sm text-muted-foreground text-center py-3">
              {uploadedCount} of {DOC_TYPES.length} documents on file. Click "Generate Insight" for {agentName}'s assessment.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
