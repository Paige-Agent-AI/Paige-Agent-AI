// "Drafts awaiting you" — the Command Center marquee (IA slice 1c-vii). Reuse-and-
// assemble over §9-safe seams: it renders the already-tenant-scoped pending approvals
// (from usePendingApprovals) as ranked ApprovalRow cards with inline approve / edit /
// decline. No new backend. Gold stays on the per-row Approve act only (§11).
import { useState } from "react";
import { Link } from "react-router-dom";
import { Inbox, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SectionCard, EmptyState, StatePill } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ApprovalRow } from "@/components/paige/ApprovalRow";
import type { ApprovalQueueRow } from "@/hooks/usePendingApprovals";

// Rank by real columns only (§13 — the view has NO deal-value column, so no "$ impact"):
// overdue first, then priority (1=highest), then risk, then soonest-due / oldest.
const SLA_RANK: Record<string, number> = { overdue: 0, due_soon: 1, on_track: 2, unscheduled: 3, closed: 4 };
const RISK_RANK: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3 };

function rank(a: ApprovalQueueRow, b: ApprovalQueueRow): number {
  const sa = SLA_RANK[a.sla_state] ?? 9, sb = SLA_RANK[b.sla_state] ?? 9;
  if (sa !== sb) return sa - sb;
  const pa = a.priority ?? 99, pb = b.priority ?? 99;
  if (pa !== pb) return pa - pb;
  const ra = RISK_RANK[a.risk_level ?? ""] ?? 9, rb = RISK_RANK[b.risk_level ?? ""] ?? 9;
  if (ra !== rb) return ra - rb;
  const da = a.sla_due_at ? Date.parse(a.sla_due_at) : Infinity;
  const db = b.sla_due_at ? Date.parse(b.sla_due_at) : Infinity;
  if (da !== db) return da - db;
  return (b.age_seconds ?? 0) - (a.age_seconds ?? 0);
}

export function DraftsAwaitingPanel({
  items,
  refresh,
  cap = 5,
}: {
  items: ApprovalQueueRow[];
  refresh: () => void;
  cap?: number;
}) {
  const [batchBusy, setBatchBusy] = useState(false);
  const ranked = [...items].sort(rank);
  const visible = ranked.slice(0, cap);
  const overflow = ranked.length - visible.length;

  // Batch approve — sequential client loop (execute-approval is single-id; no batch
  // RPC). Each call is per-row idempotent (server claim lock, §163). Report the REAL
  // per-row outcome, never a blanket "all approved" (§13).
  const approveAll = async () => {
    setBatchBusy(true);
    let acted = 0, ackd = 0, failed = 0;
    // An email campaign goes to many people at once; it is approved one at a time, never in a batch.
    for (const a of visible.filter((row) => row.type !== "campaign_send")) {
      try {
        const { data, error } = await supabase.functions.invoke("execute-approval", { body: { approval_id: a.id } });
        if (error || (data && data.ok === false)) { failed++; continue; }
        if (data?.executed) acted++; else ackd++;
      } catch { failed++; }
    }
    setBatchBusy(false);
    refresh();
    const parts: string[] = [];
    if (acted) parts.push(`${acted} sent`);
    if (ackd) parts.push(`${ackd} approved`);
    if (failed) parts.push(`${failed} need a second look`);
    toast[failed ? "warning" : "success"](parts.join(" · ") || "Nothing to approve.");
  };

  return (
    <SectionCard
      title="Drafts awaiting you"
      description="What Paige has drafted and teed up for your sign-off."
      icon={Inbox}
      actions={
        items.length === 0 ? (
          <StatePill state="success">All clear</StatePill>
        ) : visible.length > 1 ? (
          <Button size="sm" variant="secondary" onClick={approveAll} disabled={batchBusy}>
            {batchBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Approve all ({visible.length})
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing's waiting on you"
          description="Paige will surface drafts here the moment one needs your sign-off."
        />
      ) : (
        <div className="space-y-2">
          {visible.map((a) => (
            <ApprovalRow key={a.id} a={a} showDecline onResolved={refresh} />
          ))}
          {overflow > 0 && (
            <Button asChild variant="ghost" size="sm" className="w-full justify-center">
              <Link to="/choose-account">
                Open all {ranked.length} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
