import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  STATUS_OPTIONS, STATUS_LABELS, DENIAL_REASON_OPTIONS, DENIAL_REASON_LABELS,
  nextStepsForDenial,
  type FundingJourneyApplication, type FundingJourneyStatus, type DenialReasonCategory,
} from "@/lib/fundingJourney";
import { useAssistantName } from "@/lib/portal/customerIdentity";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  application: FundingJourneyApplication | null;
}

/**
 * Coach/admin dialog: update status + outcome for any client's application.
 * Also surfaced to clients themselves so they can mark approved / denied / funded.
 */
export function UpdateOutcomeDialog({ open, onOpenChange, application }: Props) {
  const assistant = useAssistantName();
  const qc = useQueryClient();
  const [status, setStatus] = useState<FundingJourneyStatus>("under_review");
  const [decisionDate, setDecisionDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [amountApproved, setAmountApproved] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [denialCategory, setDenialCategory] = useState<DenialReasonCategory | "">("");
  const [denialDetail, setDenialDetail] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!application) return;
    setStatus(application.status);
    setDecisionDate(application.decision_date || new Date().toISOString().split("T")[0]);
    setAmountApproved(application.amount_approved?.toString() || "");
    setInterestRate(application.interest_rate?.toString() || "");
    setTermMonths(application.term_months?.toString() || "");
    setDenialCategory((application.denial_reason_category as DenialReasonCategory) || "");
    setDenialDetail(application.denial_reason_detail || "");
    setNextSteps(application.next_steps || "");
  }, [application]);

  // Auto-populate next steps when denial category is selected
  useEffect(() => {
    if (status === "denied" && denialCategory && !nextSteps) {
      setNextSteps(nextStepsForDenial(denialCategory));
    }
  }, [denialCategory, status]);

  if (!application) return null;

  const isDenied = status === "denied";
  const isFunded = status === "funded" || status === "approved";

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        status,
        decision_date: decisionDate,
        next_steps: nextSteps.trim() || null,
      };
      if (isFunded) {
        payload.amount_approved = amountApproved ? parseInt(amountApproved, 10) : null;
        payload.interest_rate = interestRate ? parseFloat(interestRate) : null;
        payload.term_months = termMonths ? parseInt(termMonths, 10) : null;
      }
      if (isDenied) {
        payload.denial_reason_category = denialCategory || null;
        payload.denial_reason_detail = denialDetail.trim() || null;
      }

      const previousStatus = application.status;
      const { error } = await supabase
        .from("funding_journey_applications")
        .update(payload)
        .eq("id", application.id);
      if (error) throw error;

      // Auto-record funding milestone on first approval / first funded
      if (isFunded) {
        const milestoneType = status === "funded" ? "first_funding" : "first_approval";
        const { data: existing } = await supabase
          .from("funding_milestones")
          .select("id")
          .eq("user_id", application.user_id)
          .eq("milestone_type", milestoneType)
          .limit(1);
        if (!existing || existing.length === 0) {
          await supabase.from("funding_milestones").insert({
            user_id: application.user_id,
            milestone_type: milestoneType,
            amount: amountApproved ? parseInt(amountApproved, 10) : null,
            lender_name: application.lender_name,
          });
        }
      }

      // RAG ingestion: only on transition INTO funded/denied (not edits within same state)
      const becameFunded = status === "funded" && previousStatus !== "funded";
      const becameDenied = status === "denied" && previousStatus !== "denied";
      if (becameFunded || becameDenied) {
        // Fire-and-forget — never block the UX on knowledge-base ingestion
        supabase.functions
          .invoke("ingest-rag-outcome", {
            body: {
              trigger: becameFunded ? "funding_funded" : "funding_denied",
              user_id: application.user_id,
              application_id: application.id,
            },
          })
          .then(({ error: ingestErr }) => {
            if (ingestErr) {
              console.warn("ingest-rag-outcome failed:", ingestErr);
              return;
            }
            toast.message(`Outcome recorded — ${assistant}'s knowledge base updated`, {
              duration: 3500,
            });
          })
          .catch((e) => console.warn("ingest-rag-outcome threw:", e));
      }

      toast.success("Outcome updated");
      qc.invalidateQueries({ queryKey: ["funding-journey"] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update Application Outcome</DialogTitle>
          <p className="text-sm text-muted-foreground">{application.lender_name}{application.product_name ? ` — ${application.product_name}` : ""}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as FundingJourneyStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Decision Date</Label>
              <Input type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} />
            </div>
          </div>

          {isFunded && (
            <div className="space-y-4 p-4 rounded-md border border-accent/30 bg-accent/5">
              <h4 className="text-sm font-semibold text-accent">Funding Terms</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Amount Approved ($)</Label>
                  <Input type="number" value={amountApproved} onChange={(e) => setAmountApproved(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Interest Rate (%)</Label>
                  <Input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Term (months)</Label>
                  <Input type="number" value={termMonths} onChange={(e) => setTermMonths(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {isDenied && (
            <div className="space-y-4 p-4 rounded-md border border-destructive/30 bg-destructive/5">
              <h4 className="text-sm font-semibold text-destructive">Denial Details</h4>
              <div className="space-y-2">
                <Label>Reason Category</Label>
                <Select value={denialCategory} onValueChange={(v) => setDenialCategory(v as DenialReasonCategory)}>
                  <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                  <SelectContent>
                    {DENIAL_REASON_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{DENIAL_REASON_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reason Detail (free text from lender)</Label>
                <Textarea value={denialDetail} onChange={(e) => setDenialDetail(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Next Steps {isDenied && <span className="text-xs text-muted-foreground">(auto-filled from denial reason — edit freely)</span>}</Label>
            <Textarea value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} rows={4} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Outcome
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
