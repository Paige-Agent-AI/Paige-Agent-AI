import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DENIAL_REASON_LABELS,
  nextStepsForDenial,
  reapplicationWindowMonths,
  type FundingJourneyApplication,
} from "@/lib/fundingJourney";
import { useAssistantName } from "@/lib/portal/customerIdentity";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  application: FundingJourneyApplication | null;
}

export function NextStepsDrawer({ open, onOpenChange, application }: Props) {
  const assistant = useAssistantName();
  const navigate = useNavigate();
  if (!application) return null;

  const guidance = application.next_steps || nextStepsForDenial(application.denial_reason_category);
  const window = reapplicationWindowMonths(application.denial_reason_category);
  const reapplyDate = application.decision_date
    ? new Date(new Date(application.decision_date).getTime() + window * 30 * 24 * 60 * 60 * 1000)
    : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-xl">Next Steps</DrawerTitle>
          <DrawerDescription>
            {application.lender_name}
            {application.product_name ? ` — ${application.product_name}` : ""}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-5 overflow-y-auto">
          {application.denial_reason_category && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Denial Reason
              </h4>
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                {DENIAL_REASON_LABELS[application.denial_reason_category]}
              </Badge>
              {application.denial_reason_detail && (
                <p className="text-sm text-muted-foreground mt-2 italic">
                  "{application.denial_reason_detail}"
                </p>
              )}
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Recommended Path Forward
            </h4>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
              {guidance}
            </p>
          </div>

          {application.status === "denied" && reapplyDate && (
            <div className="p-4 rounded-md border border-accent/30 bg-accent/5">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-accent" />
                <h4 className="text-sm font-semibold text-accent">Re-apply Window</h4>
              </div>
              <p className="text-sm text-foreground">
                Earliest recommended re-application: <strong>{reapplyDate.toLocaleDateString()}</strong>{" "}
                ({window} {window === 1 ? "month" : "months"} after decision)
              </p>
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button onClick={() => { navigate("/app"); onOpenChange(false); }} className="flex-1">
              Discuss with {assistant}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button variant="outline" onClick={() => { navigate("/app/funding"); onOpenChange(false); }} className="flex-1">
              Browse Alternative Lenders
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
