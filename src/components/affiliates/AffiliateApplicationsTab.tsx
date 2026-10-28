// src/components/affiliates/AffiliateApplicationsTab.tsx
// Admin tab: review pending affiliate applications.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  approveAffiliateApplication,
  fetchAffiliateApplications,
  rejectAffiliateApplication,
  type AffiliateApplication,
  type AffiliateApplicationStatus,
  type RequestedTierKey,
} from "@/lib/affiliates/applications";
import { formatDate } from "@/lib/affiliates/format";
import { CheckCircle2, Globe, Loader2, Mail, Phone, XCircle } from "lucide-react";

const STATUS_OPTIONS: { value: AffiliateApplicationStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default function AffiliateApplicationsTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AffiliateApplicationStatus>("pending");
  const [apps, setApps] = useState<AffiliateApplication[] | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{
    app: AffiliateApplication;
    mode: "approve" | "reject";
  } | null>(null);
  const [tier, setTier] = useState<RequestedTierKey>("external");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setApps(null);
    try {
      const data = await fetchAffiliateApplications(status);
      setApps(data);
    } catch (e) {
      toast({
        title: "Failed to load applications",
        description: (e as Error).message,
        variant: "destructive",
      });
      setApps([]);
    }
  }, [status, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function openReview(app: AffiliateApplication, mode: "approve" | "reject") {
    setReviewing({ app, mode });
    setTier(app.requested_tier_key);
    setNotes("");
  }

  async function handleConfirm() {
    if (!reviewing) return;
    const { app, mode } = reviewing;
    setActioningId(app.id);
    try {
      if (mode === "approve") {
        await approveAffiliateApplication(app.id, tier, notes || undefined);
        toast({
          title: "Application approved",
          description: `${app.full_name} is now an active affiliate.`,
        });
      } else {
        await rejectAffiliateApplication(app.id, notes || undefined);
        toast({ title: "Application rejected" });
      }
      setReviewing(null);
      await load();
    } catch (e) {
      toast({
        title: mode === "approve" ? "Approval failed" : "Rejection failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setActioningId(null);
    }
  }

  return (
    <Card className="border-[#1a2840]/15">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-[#1a2840]">
            Affiliate applications
          </CardTitle>
          <p className="mt-1 text-xs text-[#1a2840]/60">
            Review and approve people requesting to join the program.
          </p>
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as AffiliateApplicationStatus)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {apps === null ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : apps.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#1a2840]/20 p-8 text-center text-sm text-[#1a2840]/60">
            No {status} applications.
          </p>
        ) : (
          <ul className="space-y-3">
            {apps.map((app) => (
              <li
                key={app.id}
                className="rounded-lg border border-[#1a2840]/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[#1a2840]">
                        {app.full_name}
                      </h3>
                      <Badge
                        variant="outline"
                        className="border-[#1a2840]/30 text-[#1a2840]/70"
                      >
                        {app.requested_tier_key}
                      </Badge>
                      <span className="text-xs text-[#1a2840]/50">
                        {formatDate(app.created_at)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#1a2840]/70">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {app.email}
                      </span>
                      {app.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {app.phone}
                        </span>
                      )}
                      {app.website_url && (
                        <a
                          href={app.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#d4a574] hover:underline"
                        >
                          <Globe className="h-3 w-3" /> Website
                        </a>
                      )}
                    </div>
                    {app.social_links && (
                      <p className="mt-2 text-xs text-[#1a2840]/70">
                        <span className="font-semibold">Social:</span>{" "}
                        {app.social_links}
                      </p>
                    )}
                    {app.audience_description && (
                      <p className="mt-2 text-sm text-[#1a2840]/80">
                        <span className="font-semibold">Audience:</span>{" "}
                        {app.audience_description}
                      </p>
                    )}
                    {app.why_join && (
                      <p className="mt-1 text-sm text-[#1a2840]/80">
                        <span className="font-semibold">Why:</span>{" "}
                        {app.why_join}
                      </p>
                    )}
                    {app.review_notes && (
                      <p className="mt-2 rounded bg-[#1a2840]/5 p-2 text-xs text-[#1a2840]/70">
                        <span className="font-semibold">Review notes:</span>{" "}
                        {app.review_notes}
                      </p>
                    )}
                  </div>

                  {status === "pending" && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-600"
                        disabled={actioningId === app.id}
                        onClick={() => openReview(app, "reject")}
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[#d4a574] text-[#1a2840] hover:bg-[#d4a574]/90"
                        disabled={actioningId === app.id}
                        onClick={() => openReview(app, "approve")}
                      >
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={!!reviewing}
        onOpenChange={(open) => !open && setReviewing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewing?.mode === "approve" ? "Approve" : "Reject"}{" "}
              {reviewing?.app.full_name}
            </DialogTitle>
          </DialogHeader>
          {reviewing?.mode === "approve" && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="tier-select">Commission tier</Label>
                <Select
                  value={tier}
                  onValueChange={(v) => setTier(v as RequestedTierKey)}
                >
                  <SelectTrigger id="tier-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external">
                      External Affiliate (25%)
                    </SelectItem>
                    <SelectItem value="coach">Coach (30%)</SelectItem>
                    <SelectItem value="admin">
                      Admin / Owner (40%)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                Approval requires the applicant to already have an account
                matching <strong>{reviewing.app.email}</strong>. If they don't,
                ask them to sign up first, then re-approve.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="notes">
              Notes {reviewing?.mode === "reject" && "(visible to applicant)"}
            </Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={actioningId !== null}
              className={
                reviewing?.mode === "approve"
                  ? "bg-[#d4a574] text-[#1a2840] hover:bg-[#d4a574]/90"
                  : "bg-red-600 text-white hover:bg-red-700"
              }
            >
              {actioningId !== null && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirm{" "}
              {reviewing?.mode === "approve" ? "approval" : "rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
