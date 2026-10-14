// The star row of the Live desk (cc-spec §1.2 group 1, closes B1). Inline
// Approve calls the execute-approval seam (§10): it APPROVES AND ACTS — email/SMS
// drafts get sent (send-message stamps the row approved+sent_at), and categories
// with no executor yet are acknowledged (marked approved) as before. This closes
// the old silent-drop where Approve flipped status but nothing ran. On success:
// gold check flash + the row collapses (motion #2) and the realtime subscription
// ticks the count down. On error: toast, keep the row.
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, Timer, User, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PaigeAttribution } from "@/components/ui/page";
import { cn } from "@/lib/utils";
import { resolveVpForActionKind } from "@/lib/paige/vpDepartments";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";

const SLA_LABEL: Record<string, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
  closed: "Closed",
  unscheduled: "No SLA",
};

// Left tick + chip color, never color-only (S4): the word rides along.
const TICK_COLOR: Record<string, string> = {
  overdue: "bg-destructive",
  due_soon: "bg-gradient-gold",
  on_track: "bg-muted-foreground/40",
  closed: "bg-muted-foreground/30",
  unscheduled: "bg-muted-foreground/30",
};

const CHIP_COLOR: Record<string, string> = {
  overdue: "border-destructive/40 text-destructive",
  due_soon: "border-accent/40 text-accent",
  on_track: "text-muted-foreground",
  closed: "text-muted-foreground",
  unscheduled: "text-muted-foreground",
};

function contactLabel(a: ApprovalQueueRow): string {
  if (a.contact_first_name || a.contact_last_name) {
    return `${a.contact_first_name ?? ""} ${a.contact_last_name ?? ""}`.trim();
  }
  return a.contact_email ?? "—";
}

export function ApprovalRow({
  a,
  showDecline = false,
  onResolved,
}: {
  a: ApprovalQueueRow;
  /** When true, render a ghost "Decline" control with a reason popover (1c-vii
   *  Drafts panel). Defaults off so existing Live-desk callers are unchanged (§18). */
  showDecline?: boolean;
  /** Fired after a successful approve or decline, so a parent list can refresh. */
  onResolved?: () => void;
}) {
  const location = useLocation();
  const leadReply = a.category === "owner.lead_followup";
  const routeRoot = tenantRoutePrefixForPath(location.pathname);
  const replyHref = a.contact_id && routeRoot ? `${routeRoot}/clients/conversations?contact=${encodeURIComponent(a.contact_id)}&approval=${encodeURIComponent(a.id)}` : null;
  const [busy, setBusy] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [approved, setApproved] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [rationale, setRationale] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  const decline = async () => {
    const reason = rationale.trim();
    if (!reason) { toast.error("Add a quick reason so Paige learns what to change."); return; }
    setRejectBusy(true);
    // Reject-with-reason: a decline is a decision write (not the execute transition), so it uses
    // this surviving surface's own tenant-scoped RLS-protected UPDATE directly (§18) —
    // permissive admin|coach + RESTRICTIVE tenant policy gate it server-side.
    const { error } = await supabase
      .from("paige_pending_approvals")
      .update({ status: "rejected", decision_rationale: reason, reviewed_at: new Date().toISOString() })
      .eq("id", a.id);
    setRejectBusy(false);
    if (error) { toast.error(error.message ?? "Couldn't decline that."); return; }
    setDeclining(false);
    setCollapsing(true);
    onResolved?.();
  };

  const dc = a.draft_content as Record<string, unknown> | string | null;
  const fallback =
    typeof dc === "object" && dc !== null
      ? String(dc.subject ?? dc.body ?? dc.preview ?? "")
      : String(dc ?? "");
  const summary = a.summary ?? fallback;
  const state = a.sla_state;
  // VP attribution (§243/#245): credit the department's owning VP from the action_kind
  // (`category`). Resolves to null for legacy categories that map to no department, so
  // <PaigeAttribution> renders nothing — never a fabricated credit (§13).
  const draftedVp = resolveVpForActionKind(a.category);

  const approve = async () => {
    if (leadReply) return; // This send kind must be reviewed in canonical Conversations.
    setBusy(true);
    // Approve AND act via the callable execute-approval seam (§10): email/SMS
    // drafts are sent (send-message flips the row to approved+sent_at); other
    // categories are acknowledged (marked approved) as before.
    try {
      const { data, error } = await supabase.functions.invoke("execute-approval", {
        body: { approval_id: a.id },
      });
      if (error || data?.ok !== true) {
        toast.error("Couldn't confirm that action completed. Check its status before trying again.");
        return;
      }
      // Success beat follows an explicit receipt, never a missing response.
      setApproved(true);
      setTimeout(() => setCollapsing(true), 240);
      onResolved?.();
    } catch {
      toast.error("Couldn't confirm that action completed. Check its status before trying again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("cc-collapse", collapsing && "cc-collapsing")}>
      <div>
        <div className="relative flex items-start gap-2.5 rounded-md border p-2.5 pl-3 hover:bg-muted/40 transition-colors">
          <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full", TICK_COLOR[state] ?? "bg-muted-foreground/30")} />
          {approved && (
            <span className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-accent/10">
              <Check className="h-6 w-6 text-accent" />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium line-clamp-2 min-w-0">{summary || "(no summary)"}</p>
              <Badge variant="outline" className={cn("shrink-0 text-[10px] tabular-nums", CHIP_COLOR[state] ?? "")}>
                <Timer className="mr-1 h-3 w-3" />
                {SLA_LABEL[state] ?? state}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {a.category && <span className="capitalize">{a.category.replace(/_/g, " ")}</span>}
              {a.contact_id && (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <User className="h-3 w-3 shrink-0" />
                  <span className="truncate">{contactLabel(a)}</span>
                </span>
              )}
            </div>
            {draftedVp && (
              <PaigeAttribution
                contributors={[{ vp: draftedVp }]}
                size="sm"
                showMark={false}
                leadIn="Drafted by your Paige team"
              />
            )}
            <div className="flex items-center justify-end gap-1.5 pt-0.5">
              {leadReply ? (replyHref ? <Button asChild size="sm" variant="outline" className="h-7"><Link to={replyHref}>Review reply</Link></Button> : <span className="text-xs text-muted-foreground">Open this lead in Conversations to review.</span>) : <Button
                size="sm"
                onClick={approve}
                disabled={busy || approved || rejectBusy}
                className="h-7 bg-gradient-gold text-accent-foreground hover:opacity-90"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
              </Button>}
              {/* Edit-then-approve routes to the full detail surface (§18 — no inline
                  duplicate editor); "Decline" is neutral/ghost (gold stays on Approve). */}
              {!leadReply && <Button asChild size="sm" variant="ghost" className="h-7">
                <Link to={"/choose-account"}>{showDecline ? "Edit" : "View"}</Link>
              </Button>}
              {showDecline && (
                <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => setDeclining((d) => !d)} disabled={busy || approved}>
                  Decline
                </Button>
              )}
            </div>
            {showDecline && declining && (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
                <Textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={2}
                  placeholder="What needs to change? Paige learns from this."
                  className="text-sm"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setDeclining(false)} disabled={rejectBusy}>Cancel</Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={decline} disabled={rejectBusy || !rationale.trim()}>
                    {rejectBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Decline draft"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
