import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, ShieldOff, Bell, FileText, Loader2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { downloadMyUserData } from "@/lib/downloadMyUserData";
import { toast } from "sonner";
import { SecurityBadge } from "@/components/security/SecurityBadge";
import { Link } from "react-router-dom";
import { useClientPortalBrandState } from "@/hooks/useClientPortalBrand";
import { useTenantFeature } from "@/hooks/useTenantFeature";

/**
 * Who is looking decides what this panel may say (§2, §13, E09 Slice 6 D6).
 *
 * - A business's CUSTOMER (one business or several) never sees the credit-data control or credit,
 *   fundability or financial wording: nothing tells this panel the business chose a funding offer for
 *   them, so the fail-safe is hidden (reviewer Minor 1). Their messaging choices live on Your account.
 * - STAFF see the credit-data control only when their workspace turned the funding_readiness feature
 *   on — a chosen preset, never a platform default.
 * - While it is unknown who is looking (still resolving, or the resolve failed), nothing funding-
 *   flavoured renders.
 *
 * No processor deletes a Paige login on a timer (settings-security-data.tsx records it), so the
 * deletion row promises no timeframe: it says who to ask, and for a customer, that the business holds
 * its own records about them.
 */
export function DataPrivacyPanel() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeletingCredit, setIsDeletingCredit] = useState(false);
  const { brand, loading: brandLoading, error: brandError, multipleBusinesses } = useClientPortalBrandState();
  const funding = useTenantFeature("funding_readiness");
  const known = !brandLoading && !brandError;
  const customer = known && (!!brand?.tenant_id || multipleBusinesses);
  const customerOfOne = customer && !!brand?.tenant_id;
  const business = brand?.tenant_name?.trim() || "your business";
  const showCredit = known && !customer && !funding.loading && funding.enabled;

  const handleDownloadData = async () => {
    setIsDownloading(true);
    try {
      // The ONE user-scoped export implementation (shared with the Solo
      // Security & Data surface since PR-C — same capability, one seam).
      await downloadMyUserData();
      toast.success("Your data export has been downloaded.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to download data");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDeleteCreditData = async () => {
    setIsDeletingCredit(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const { data, error } = await supabase.functions.invoke("factory-credit-reset", {
        body: { source: "settings_data_privacy" },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      if (!data?.success) throw new Error("Reset did not complete");

      // Reset consent flag so the user re-confirms before any future upload
      await supabase
        .from("profiles")
        .update({
          credit_report_consent: false,
          credit_report_consent_timestamp: null,
        })
        .eq("user_id", session.user.id);

      toast.success("Credit data deleted. Fundability scores have been reset.");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to delete credit data");
    } finally {
      setIsDeletingCredit(false);
    }
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ShieldOff className="w-5 h-5 text-muted-foreground" />
            Data &amp; Privacy
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your data, exercise your privacy rights, and review how PaigeAgent protects you.
          </p>
        </div>
        {/* The shared badge spends gold at 1.8:1 in light; here it reads in ink (§11, AA). */}
        <SecurityBadge className="!min-h-[44px] !border-border !bg-transparent !text-foreground hover:!bg-muted" />
      </div>

      <div className="grid gap-4">
        {/* Download */}
        <div className="rounded-lg border border-border p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-muted-foreground" />
              <p className="font-medium">Download My Data</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {showCredit
                ? "Export all data PaigeAgent holds about you as JSON — credit scores, fundability scores, account data, Paige session summaries, and financial profile."
                : customer
                  ? `Download a JSON file of what your Paige login holds: your profile, your contact details, recent Paige chats and anything else tied to your login. It doesn't include the records ${business} keeps about you. Message ${business} for a copy of those.`
                  : "Download a JSON file of what your Paige login holds: your profile, your contact details, businesses you own, recent Paige chats and anything else tied to your login. Your workspace's client records aren't included."}
            </p>
          </div>
          <Button onClick={handleDownloadData} disabled={isDownloading} variant="outline" size="sm" className="min-h-[44px]">
            {isDownloading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            Download JSON
          </Button>
        </div>

        {/* Delete Credit Data — funding preset only (§2). */}
        {showCredit && <div className="rounded-lg border border-border p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-warning" />
              <p className="font-medium">Delete Credit Data</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Removes all extracted credit report data and resets your fundability scores to a
              locked state. Your account stays active. This cannot be undone without re-uploading.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="min-h-[44px] text-foreground">
                <Trash2 className="w-4 h-4 mr-1" /> Delete Credit Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all credit data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes extracted credit accounts, scores, and analysis. Your
                  account stays active but fundability scores reset until you re-upload a report.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteCreditData}
                  disabled={isDeletingCredit}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeletingCredit && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Delete Credit Data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>}

        {/* Delete Account */}
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              <p className="font-medium">Delete Account</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {customer
                ? `Email privacy@paigeagent.ai to close your Paige login. To delete what ${business} holds about you, message ${business}.`
                : "Email privacy@paigeagent.ai to ask us to close your Paige login and delete the data tied to it. We reply to confirm each step. Nothing is deleted automatically."}
            </p>
          </div>
          <Button asChild variant="destructive" size="sm" className="min-h-[44px]">
            <a href="mailto:privacy@paigeagent.ai?subject=Account%20Deletion%20Request">
              Email us
            </a>
          </Button>
        </div>

        {/* Communication preferences — a customer's own choices for their business, on Your account. */}
        {customerOfOne && <div className="rounded-lg border border-border p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <p className="font-medium">Communication Preferences</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Choose whether {business} can email or text you, and whether you get their updates and offers.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="min-h-[44px]">
            <Link to="/app/settings?view=client-account#preferences">Manage</Link>
          </Button>
        </div>}

        {/* Privacy Policy */}
        <div className="rounded-lg border border-border p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <p className="font-medium">Privacy Policy</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {customer
                ? `Read how Paige collects, uses and protects your data. ${business} may have its own policy too.`
                : "Read how Paige collects, uses and protects your data."}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="min-h-[44px]">
            <Link to="/privacy" target="_blank" rel="noreferrer">
              View Policy <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
