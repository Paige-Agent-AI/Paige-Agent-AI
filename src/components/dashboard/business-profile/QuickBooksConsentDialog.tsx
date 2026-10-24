import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId?: string | null;
}

const COMMITMENTS = [
  "Modify your QuickBooks data",
  "Share it with lenders, advertisers, or third parties",
  "Use it for any purpose other than your PaigeAgent services", // customer-identity-exempt: platform legal entity in a data-access consent; wording pending legal review
];

export function QuickBooksConsentDialog({ open, onOpenChange, businessId }: Props) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("quickbooks-oauth-initiate", {
        body: { businessId, environment: "sandbox" },
      });
      if (error || !data?.authUrl) throw new Error(error?.message || "Failed to start QuickBooks connection");
      window.location.href = data.authUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start connection");
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#0a1628] text-white border-[#d4a574]/30">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#d4a574]">
            QuickBooks Connection — What We Access
          </DialogTitle>
          <DialogDescription className="text-white/80 text-base leading-relaxed pt-2">
            {/* customer-identity-exempt: platform legal entity in a data-access consent; wording pending legal review */}
            PaigeAgent requests <span className="font-semibold text-white">read-only access</span> to your
            QuickBooks data including bank account balances, revenue data, and expense categories. This data
            is used exclusively to improve your fundability score accuracy and funding recommendations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <h3 className="font-semibold text-[#d4a574] mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> We do not:
            </h3>
            <ul className="space-y-2">
              {COMMITMENTS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-white/90">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-sm text-white/80 leading-relaxed">
              You can disconnect QuickBooks at any time from your Connections settings.
            </p>
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#d4a574] hover:underline mt-3"
            >
              Privacy Policy <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={() => onOpenChange(false)}
              disabled={connecting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="flex-1 bg-[#d4a574] text-[#0a1628] hover:bg-[#d4a574]/90 font-semibold"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting...
                </>
              ) : (
                "Confirm and Connect"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
