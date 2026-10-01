import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, CheckCircle, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface QuickUploadReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ClientOption {
  user_id: string;
  full_name: string | null;
}

export function QuickUploadReportModal({ open, onOpenChange }: QuickUploadReportModalProps) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ bureau?: string; type?: string } | null>(null);

  useEffect(() => {
    if (open) {
      fetchClients();
      setUploadResult(null);
      setSelectedClient("");
    }
  }, [open]);

  const fetchClients = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .order("full_name");
    setClients((data || []) as ClientOption[]);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedClient) return;

    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file");
      return;
    }

    setIsUploading(true);
    setUploadResult(null);

    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      if (!currentUser) throw new Error("Not authenticated");

      const filePath = `${selectedClient}/${Date.now()}_${file.name}`;

      // The record comes first: staff reach a stored file only through the upload record whose path
      // it is, so the file is stored once that record exists.
      const { data: uploadRecord, error: insertError } = await supabase
        .from("credit_report_uploads")
        .insert({
          user_id: selectedClient,
          uploaded_by: currentUser.id,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          analysis_status: "pending",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const { error: storageError } = await supabase.storage
        .from("credit-report-uploads")
        .upload(filePath, file);
      if (storageError) {
        // Withdraw the record where this user may; either way the failure is reported, not hidden.
        await supabase.from("credit_report_uploads").delete().eq("id", uploadRecord.id);
        throw storageError;
      }

      toast.success("Report uploaded. Starting AI analysis...");

      // Trigger analysis
      const { data: analysisData } = await supabase.functions.invoke("analyze-credit-report", {
        body: { uploadId: uploadRecord.id },
      });

      // Fetch updated record for detection result
      const { data: updated } = await supabase
        .from("credit_report_uploads")
        .select("bureau_detected, report_type")
        .eq("id", uploadRecord.id)
        .single();

      if (updated) {
        setUploadResult({
          bureau: updated.bureau_detected || undefined,
          type: updated.report_type || undefined,
        });
      }

      toast.success("Analysis complete!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload report");
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-accent" />
            Upload Credit Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Client</label>
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a client..." />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.user_id} value={c.user_id}>
                    {c.full_name || c.user_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Upload PDF</label>
            <p className="text-xs text-muted-foreground mb-3">
              Accepts consumer (Equifax, Experian, TransUnion) and business (D&B, Experian Business, Equifax Business) credit reports.
            </p>
            <input
              type="file"
              accept=".pdf"
              onChange={handleUpload}
              className="hidden"
              id="quick-upload-report"
              disabled={isUploading || !selectedClient}
            />
            <label htmlFor="quick-upload-report">
              <Button
                asChild
                disabled={isUploading || !selectedClient}
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <span>
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  {isUploading ? "Uploading & Analyzing..." : "Choose PDF File"}
                </span>
              </Button>
            </label>
          </div>

          {uploadResult && (
            <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">Auto-Detection Result</span>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="capitalize">
                  {uploadResult.type || "consumer"} Report
                </Badge>
                {uploadResult.bureau && (
                  <Badge className="bg-accent/20 text-accent border-accent/30">
                    {uploadResult.bureau}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
