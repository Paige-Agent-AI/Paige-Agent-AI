import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isSubmitting?: boolean;
}

const POINTS = [
  "Your credit report is analyzed to calculate your Personal and Small Business Fundability Scores",
  // customer-identity-exempt: consent text naming the platform company; wording awaits legal review (owner/legal decision, round 2 list)
  "Paige uses your credit data to provide personalized coaching and funding recommendations",
  "Your credit data is encrypted with AES-256 and never shared with lenders or third parties",
  "You can delete your credit data at any time from your account settings",
  // customer-identity-exempt: consent text naming the platform company; wording awaits legal review (owner/legal decision, round 2 list)
  "This data is used only to provide your PaigeAgent services — never for employment, housing, or insurance decisions",
];

export function CreditReportConsentDialog({ open, onOpenChange, onConfirm, isSubmitting }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-accent" />
            Credit Report Data Usage
          </DialogTitle>
          <DialogDescription>
            {/* customer-identity-exempt: consent text naming the platform company; wording awaits legal review (owner/legal decision, round 2 list) */}
            Before you upload your credit report please confirm you understand how PaigeAgent
            uses this data:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-2">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-foreground/90">
              <span className="text-fundability-excellent mt-0.5">✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground border-t pt-3">
          By uploading your credit report you confirm you are providing it voluntarily for
          these purposes.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm()} disabled={isSubmitting} className="bg-gradient-gold hover:opacity-90">
            {isSubmitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            I Understand — Upload Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
