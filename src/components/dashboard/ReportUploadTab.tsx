import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileText,
  Brain,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Trash2,
  FileWarning,
  TrendingDown,
  Shield,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface NegativeItem {
  category: string;
  creditor_name: string;
  account_number_masked: string | null;
  amount: number | null;
  date_reported: string | null;
  date_of_occurrence: string | null;
  bureau: string;
  status: string;
  estimated_score_impact: number;
  is_disputable: boolean;
  dispute_reason_suggestion: string;
  notes: string;
}

interface PositiveAccount {
  creditor: string;
  account_type: string;
  balance: number | null;
  credit_limit: number | null;
  utilization: number | null;
  payment_status: string;
  account_age_months: number | null;
  is_open: boolean;
  opened_date: string | null;
}

interface AnalysisResult {
  report_type: string;
  bureau_detected: string;
  profile_summary: string;
  estimated_total_score_impact: number;
  negative_items: NegativeItem[];
  positive_accounts: PositiveAccount[];
  payment_history_summary: {
    on_time_percentage: number | null;
    total_accounts: number;
    accounts_in_good_standing: number;
    accounts_with_issues: number;
  };
  hard_inquiries: Array<{ creditor_name: string; date: string; bureau: string }>;
  public_records: Array<{ type: string; filed_date: string | null; amount: number | null; status: string }>;
}

interface ReportUpload {
  id: string;
  user_id: string;
  uploaded_by: string;
  report_type: string;
  bureau_detected: string | null;
  file_name: string;
  file_path?: string;
  analysis_status: string;
  analysis_result: AnalysisResult | null;
  negative_items_extracted: NegativeItem[] | null;
  positive_accounts_extracted: PositiveAccount[] | null;
  profile_summary: string | null;
  estimated_score_impact: number | null;
  error_message: string | null;
  created_at: string;
}

interface ReportUploadTabProps {
  clientUserId?: string;
}

export function ReportUploadTab({ clientUserId }: ReportUploadTabProps) {
  const [uploads, setUploads] = useState<ReportUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<ReportUpload | null>(null);
  // [§194] generatingDispute state removed.
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);

  const fetchUploads = useCallback(async () => {
    const userId = clientUserId || (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('credit_report_uploads')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setUploads(data as unknown as ReportUpload[]);
      if (data.length > 0 && !selectedUpload) {
        setSelectedUpload(data[0] as unknown as ReportUpload);
      }
    }
  }, [clientUserId, selectedUpload]);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast.error('Please upload a PDF file');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('File size must be under 20MB');
      return;
    }

    setIsUploading(true);

    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) throw new Error('Not authenticated');

      const targetUserId = clientUserId || currentUser.id;
      const filePath = `${targetUserId}/${Date.now()}_${file.name}`;

      // The record comes first: staff reach a stored file only through the upload record whose path
      // it is, so the file is stored once that record exists.
      const { data: uploadRecord, error: insertError } = await supabase
        .from('credit_report_uploads')
        .insert({
          user_id: targetUserId,
          uploaded_by: currentUser.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          analysis_status: 'pending',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const { error: storageError } = await supabase.storage
        .from('credit-report-uploads')
        .upload(filePath, file);

      if (storageError) {
        // Withdraw the record where this user may; either way the failure is reported, not hidden.
        await supabase.from('credit_report_uploads').delete().eq('id', uploadRecord.id);
        throw storageError;
      }

      toast.success('Report uploaded successfully. Starting AI analysis...');
      await fetchUploads();

      // Trigger analysis
      if (uploadRecord) {
        await triggerAnalysis(uploadRecord.id);
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload report');
    } finally {
      setIsUploading(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const triggerAnalysis = async (uploadId: string) => {
    setIsAnalyzing(uploadId);
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      const session = (await supabase.auth.getSession()).data.session;
      if (!currentUser || !session) throw new Error('Not authenticated');

      const targetUserId = clientUserId || currentUser.id;

      const { data, error } = await supabase.functions.invoke('analyze-credit-report', {
        body: { uploadId },
      });

      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
      } else {
        toast.success('Credit report analysis complete! Syncing data...');

        // Sync extracted data to platform tables (scores, accounts, negatives, inquiries)
        const analysis = data?.analysis;
        if (analysis) {
          try {
            await supabase.functions.invoke('sync-credit-report-data', {
              body: {
                target_user_id: targetUserId,
                report_type: analysis.report_type || 'consumer',
                scores: analysis.scores,
                score_model: analysis.score_model,
                negative_items: (analysis.negative_items || []).map((item: any) => ({
                  creditor_name: item.creditor_name,
                  account_number: item.account_number || item.account_number_masked || null,
                  account_number_masked: item.account_number || item.account_number_masked || null,
                  bureau: item.bureau || item.bureaus_reporting?.[0] || 'unknown',
                  item_type: item.category || 'collection',
                  amount: item.amount,
                  original_amount: item.original_amount || null,
                  date_of_occurrence: item.date_of_occurrence,
                  date_reported: item.date_reported,
                  dispute_basis: item.dispute_reason_suggestion,
                  estimated_score_impact: item.estimated_score_impact,
                  status: item.status || 'active',
                })),
                hard_inquiries: analysis.hard_inquiries || [],
                positive_accounts: (analysis.positive_accounts || []).map((acct: any) => ({
                  creditor: acct.creditor,
                  account_number: acct.account_number || null,
                  account_type: acct.account_type,
                  balance: acct.balance,
                  credit_limit: acct.credit_limit,
                  original_amount: acct.original_amount || null,
                  utilization: acct.utilization,
                  payment_status: acct.payment_status,
                  payment_history_percentage: acct.payment_history_percentage || null,
                  account_open_date: acct.opened_date,
                  date_closed: acct.date_closed || null,
                  is_open: acct.is_open,
                  responsibility: acct.responsibility || null,
                })),
                discrepancies: analysis.cross_bureau_discrepancies || [],
                priority_disputes: [],
                report_upload_id: uploadId,
                fraud_alerts: analysis.fraud_alerts,
                security_freezes: analysis.security_freezes,
                validation_flags: data?.validation_flags || [],
              },
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            toast.success('All data synced across the platform!');
          } catch (syncErr) {
            console.error('Sync error:', syncErr);
            toast.error('Analysis complete but data sync failed. You can retry from the report.');
          }
        }
      }
      await fetchUploads();
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(null);
    }
  };

  // [§194] Dispute-letter generation removed — Paige is monitoring-only.

  const handleDeleteUpload = async (upload: ReportUpload) => {
    if (!confirm(`Delete "${upload.file_name}" and all extracted data? This cannot be undone.`)) return;
    
    setDeletingUpload(upload.id);
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) throw new Error('Not authenticated');

      // Call the database function to cascade-delete related data
      const { data, error } = await supabase.rpc('delete_credit_report_upload', {
        _upload_id: upload.id,
        _calling_user_id: currentUser.id,
      });

      if (error) throw error;
      const result = data as any;
      if (!result?.success) throw new Error(result?.message || 'Delete failed');

      // Also remove the file from storage
      if (result.file_path) {
        await supabase.storage.from('credit-report-uploads').remove([result.file_path]);
      }

      // Clear selection if this was the selected upload
      if (selectedUpload?.id === upload.id) {
        setSelectedUpload(null);
      }

      toast.success('Report and all related data deleted');
      await fetchUploads();
    } catch (err: any) {
      console.error('Delete error:', err);
      toast.error('Failed to delete report', { description: err.message });
    } finally {
      setDeletingUpload(null);
    }
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors: Record<string, string> = {
      late_payment: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      collection: 'bg-red-500/20 text-red-400 border-red-500/30',
      charge_off: 'bg-red-600/20 text-red-300 border-red-600/30',
      hard_inquiry: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      public_record: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      bankruptcy: 'bg-red-800/20 text-red-300 border-red-800/30',
      repossession: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      foreclosure: 'bg-red-700/20 text-red-300 border-red-700/30',
      tax_lien: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      judgment: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    };
    return colors[category] || 'bg-muted text-muted-foreground';
  };

  const formatCategory = (cat: string) =>
    cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <Card className="p-6 bg-card border-border">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Brain className="w-5 h-5 text-accent" />
              AI Credit Report Analysis
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Upload any consumer or business credit report PDF. Paige AI will extract and analyze every item.
            </p>
          </div>
          <div>
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              className="hidden"
              id="report-upload"
              disabled={isUploading}
            />
            <label htmlFor="report-upload">
              <Button asChild disabled={isUploading} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <span>
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  {isUploading ? 'Uploading...' : 'Upload PDF Report'}
                </span>
              </Button>
            </label>
          </div>
        </div>
      </Card>

      {/* Upload History */}
      {uploads.length > 0 && (
        <Card className="p-4 bg-card border-border">
          <h4 className="text-sm font-semibold text-foreground mb-3">Uploaded Reports</h4>
          <div className="space-y-2">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                onClick={() => upload.analysis_status === 'completed' && setSelectedUpload(upload)}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedUpload?.id === upload.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{upload.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(upload.created_at).toLocaleDateString()}
                      {upload.bureau_detected && ` • ${upload.bureau_detected}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {upload.analysis_status === 'pending' && (
                    <Badge variant="outline" className="text-xs">Pending</Badge>
                  )}
                  {upload.analysis_status === 'processing' && (
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Analyzing
                    </Badge>
                  )}
                  {upload.analysis_status === 'completed' && (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Complete
                    </Badge>
                  )}
                  {upload.analysis_status === 'failed' && (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Failed
                    </Badge>
                  )}
                  {upload.analysis_status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerAnalysis(upload.id);
                      }}
                      disabled={isAnalyzing === upload.id}
                    >
                      {isAnalyzing === upload.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Retry'
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteUpload(upload);
                    }}
                    disabled={deletingUpload === upload.id}
                  >
                    {deletingUpload === upload.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Analysis Results */}
      {selectedUpload?.analysis_status === 'completed' && selectedUpload.analysis_result && (
        <div className="space-y-6">
          {/* Summary Card */}
          <Card className="p-6 bg-card border-border">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">Analysis Summary</h3>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline">{selectedUpload.report_type === 'business' ? 'Business' : 'Consumer'}</Badge>
                  {selectedUpload.bureau_detected && (
                    <Badge className="bg-accent/20 text-accent border-accent/30">
                      {selectedUpload.bureau_detected}
                    </Badge>
                  )}
                </div>
              </div>
              {selectedUpload.estimated_score_impact !== null && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Est. Score Impact</p>
                  <p className="text-2xl font-bold text-red-400">
                    {selectedUpload.estimated_score_impact}
                  </p>
                </div>
              )}
            </div>
            {selectedUpload.profile_summary && (
              <p className="text-sm text-muted-foreground leading-relaxed bg-muted/30 p-4 rounded-lg">
                {selectedUpload.profile_summary}
              </p>
            )}

            {/* Quick Stats */}
            {selectedUpload.analysis_result.payment_history_summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {selectedUpload.analysis_result.payment_history_summary.total_accounts}
                  </p>
                  <p className="text-xs text-muted-foreground">Total Accounts</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-400">
                    {selectedUpload.analysis_result.payment_history_summary.accounts_in_good_standing}
                  </p>
                  <p className="text-xs text-muted-foreground">Good Standing</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {selectedUpload.analysis_result.payment_history_summary.accounts_with_issues}
                  </p>
                  <p className="text-xs text-muted-foreground">With Issues</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-2xl font-bold text-accent">
                    {selectedUpload.analysis_result.payment_history_summary.on_time_percentage !== null
                      ? `${selectedUpload.analysis_result.payment_history_summary.on_time_percentage}%`
                      : 'N/A'}
                  </p>
                  <p className="text-xs text-muted-foreground">On-Time</p>
                </div>
              </div>
            )}
          </Card>

          {/* Detailed Tabs */}
          <Tabs defaultValue="negative" className="w-full">
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="negative" className="text-xs sm:text-sm">
                <AlertTriangle className="w-3 h-3 mr-1 hidden sm:inline" />
                Negative ({selectedUpload.analysis_result.negative_items?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="positive" className="text-xs sm:text-sm">
                <CheckCircle className="w-3 h-3 mr-1 hidden sm:inline" />
                Positive ({selectedUpload.analysis_result.positive_accounts?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="inquiries" className="text-xs sm:text-sm">
                <FileWarning className="w-3 h-3 mr-1 hidden sm:inline" />
                Inquiries ({selectedUpload.analysis_result.hard_inquiries?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="records" className="text-xs sm:text-sm">
                <Shield className="w-3 h-3 mr-1 hidden sm:inline" />
                Public Records
              </TabsTrigger>
            </TabsList>

            {/* Negative Items Tab */}
            <TabsContent value="negative">
              <Card className="p-4 bg-card border-border">
                {selectedUpload.analysis_result.negative_items?.length > 0 ? (
                  <div className="space-y-3">
                    {selectedUpload.analysis_result.negative_items.map((item, idx) => (
                      <div key={idx} className="border border-border rounded-lg p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={getCategoryBadgeColor(item.category)}>
                                {formatCategory(item.category)}
                              </Badge>
                              <span className="text-sm font-semibold text-foreground">
                                {item.creditor_name}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {item.account_number_masked && <span>Acct: {item.account_number_masked}</span>}
                              {item.amount !== null && <span>${item.amount.toLocaleString()}</span>}
                              {item.date_reported && <span>Reported: {item.date_reported}</span>}
                              <span>Bureau: {item.bureau}</span>
                              <span>Status: {item.status}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-lg font-bold text-red-400">{item.estimated_score_impact}</p>
                            <p className="text-[10px] text-muted-foreground">score impact</p>
                          </div>
                        </div>
                        {item.notes && (
                          <p className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">{item.notes}</p>
                        )}
                        {item.is_disputable && item.dispute_reason_suggestion && (
                          <div className="border-t border-border pt-3">
                            <p className="text-xs text-muted-foreground">
                              💡 {item.dispute_reason_suggestion}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Paige tracks and reports — for filing disputes, use the CFPB's free self-help tools.
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                    <p>No negative items found — looking clean! 🎉</p>
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* Positive Accounts Tab */}
            <TabsContent value="positive">
              <Card className="p-4 bg-card border-border overflow-x-auto">
                {selectedUpload.analysis_result.positive_accounts?.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Creditor</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-right">Limit</TableHead>
                        <TableHead className="text-right">Utilization</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Age</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedUpload.analysis_result.positive_accounts.map((acct, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{acct.creditor}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {formatCategory(acct.account_type)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {acct.balance !== null ? `$${acct.balance.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {acct.credit_limit !== null ? `$${acct.credit_limit.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {acct.utilization !== null ? (
                              <span className={acct.utilization > 30 ? 'text-yellow-400' : 'text-green-400'}>
                                {acct.utilization}%
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs">{acct.payment_status}</span>
                          </TableCell>
                          <TableCell>
                            {acct.account_age_months !== null
                              ? `${Math.floor(acct.account_age_months / 12)}y ${acct.account_age_months % 12}m`
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center py-8 text-muted-foreground">No positive accounts extracted</p>
                )}
              </Card>
            </TabsContent>

            {/* Inquiries Tab */}
            <TabsContent value="inquiries">
              <Card className="p-4 bg-card border-border">
                {selectedUpload.analysis_result.hard_inquiries?.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Creditor</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Bureau</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedUpload.analysis_result.hard_inquiries.map((inq, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{inq.creditor_name}</TableCell>
                          <TableCell>{inq.date}</TableCell>
                          <TableCell>{inq.bureau}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center py-8 text-muted-foreground">No hard inquiries found</p>
                )}
              </Card>
            </TabsContent>

            {/* Public Records Tab */}
            <TabsContent value="records">
              <Card className="p-4 bg-card border-border">
                {selectedUpload.analysis_result.public_records?.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Filed Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedUpload.analysis_result.public_records.map((rec, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{rec.type}</TableCell>
                          <TableCell>{rec.filed_date || '—'}</TableCell>
                          <TableCell className="text-right">
                            {rec.amount !== null ? `$${rec.amount.toLocaleString()}` : '—'}
                          </TableCell>
                          <TableCell>{rec.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
                    <p>No public records found</p>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Empty State */}
      {uploads.length === 0 && (
        <Card className="p-12 bg-card border-border text-center">
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Reports Uploaded Yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            Upload a credit report PDF from any bureau — Equifax, Experian, TransUnion, D&B, or Experian Business. 
            Paige AI will analyze every item and help you build a dispute strategy.
          </p>
          <label htmlFor="report-upload">
            <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
              <span>
                <Upload className="w-4 h-4 mr-2" />
                Upload Your First Report
              </span>
            </Button>
          </label>
        </Card>
      )}
    </div>
  );
}
