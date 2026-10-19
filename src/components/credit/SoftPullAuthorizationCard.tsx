import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldCheck, Loader2, Sparkles, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DISCLOSURE_VERSION = "isoftpull_v1.0";
// Set to true once ISOFTPULL_API_KEY + ISOFTPULL_ENABLED=true are configured server-side.
// The server is the source of truth — this flag only changes UI copy.
const ISOFTPULL_ENABLED_CLIENT = false;

export function SoftPullAuthorizationCard() {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleAuthorize = async () => {
    if (!acknowledged) {
      toast.error("Please check the authorization box to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("isoftpull-initiate", {
        body: {
          consent_confirmed: true,
          disclosure_version: DISCLOSURE_VERSION,
        },
      });
      if (error) throw error;

      const status = (data as { status?: string } | null)?.status;
      if (status === "pending_credentials") {
        toast.success(
          "Your authorization has been recorded. Instant credit pull is coming soon — in the meantime please upload your credit report PDF below.",
          { duration: 8000 },
        );
      } else {
        toast.success("Soft pull initiated. Your report will appear shortly.");
        // TODO: when live, redirect / open embed using data.redirect_url or data.embed_token
      }

      setOpen(false);
      setAcknowledged(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authorization failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card className="border-primary/30 bg-gradient-to-br from-card via-card to-primary/5">
        <CardContent className="py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3 flex-1 min-w-[260px]">
              <div className="w-11 h-11 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-foreground">
                    Get Your Credit Report Instantly
                  </h3>
                  {!ISOFTPULL_ENABLED_CLIENT && (
                    <Badge
                      variant="outline"
                      className="bg-primary/10 text-primary border-primary/40 text-[10px] gap-1"
                    >
                      <Sparkles className="w-3 h-3" /> Coming Soon
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  No hard inquiry — no impact to your credit score
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                  Pull your credit report directly without uploading a PDF. Takes 30 seconds and
                  uses a soft inquiry that does not affect your score.
                </p>
              </div>
            </div>
            <Button
              onClick={() => setOpen(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              Pull My Credit Report
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Authorize Credit Report Access</DialogTitle>
            <DialogDescription className="text-foreground/80 leading-relaxed pt-2">
              {/* customer-identity-exempt: consent text naming the platform company; wording awaits legal review (owner/legal decision, round 2 list) */}
              By clicking Authorize you consent to PaigeAgent pulling your credit report via a
              soft inquiry. This will not impact your credit score. Your report will be used only
              to provide personalized funding and credit coaching.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2.5 pt-2 pb-1">
            <Checkbox
              id="soft-pull-consent"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              className="mt-0.5"
            />
            <label
              htmlFor="soft-pull-consent"
              className="text-sm text-foreground leading-snug cursor-pointer"
            >
              {/* customer-identity-exempt: consent text naming the platform company; wording awaits legal review (owner/legal decision, round 2 list) */}
              I authorize PaigeAgent to perform a soft credit inquiry on my behalf.
            </label>
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            FCRA §604 compliant · Disclosure {DISCLOSURE_VERSION} · You may revoke this
            authorization at any time by contacting support.
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleAuthorize}
              disabled={!acknowledged || submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Authorize and Pull Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
