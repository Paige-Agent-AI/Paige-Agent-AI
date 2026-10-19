import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Clock, CheckCircle2, AlertTriangle, RotateCcw, ListChecks, type LucideIcon } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { useMyApprovals, type MyApprovalRow } from "@/hooks/useMyApprovals";

const STATUS_META: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  pending: { label: "Awaiting review", tone: "bg-amber-500/15 text-amber-700 border-amber-500/30", icon: Clock },
  approved: { label: "Approved", tone: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: CheckCircle2 },
  rejected: { label: "Rejected", tone: "bg-red-500/15 text-red-700 border-red-500/30", icon: AlertTriangle },
  changes_requested: { label: "Needs your input", tone: "bg-blue-500/15 text-blue-700 border-blue-500/30", icon: RotateCcw },
  escalated: { label: "Escalated to team lead", tone: "bg-orange-500/15 text-orange-700 border-orange-500/30", icon: AlertTriangle },
  skipped: { label: "Skipped", tone: "bg-muted text-muted-foreground border-border", icon: Shield },
  succeeded: { label: "Completed", tone: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: CheckCircle2 },
  failed: { label: "Failed", tone: "bg-red-500/15 text-red-700 border-red-500/30", icon: AlertTriangle },
};

const CATEGORY_LABEL: Record<string, string> = {
  ai_draft: "Outbound message",
  field_ingest: "Profile update",
  compliance: "Compliance review",
  legal: "Legal review",
  financial: "Financial action",
  dispute_letter: "Dispute letter",
  campaign: "Campaign",
  contract: "Contract",
  refund: "Refund",
  tier_change: "Plan change",
  workflow_action: "Automated action",
  other: "Action",
};

/** Plain-English next step for the client based on status + category. */
function nextStepFor(row: MyApprovalRow): string | null {
  if (row.status === "changes_requested") {
    return row.decision_rationale
      ? `Your team asked: "${row.decision_rationale}". Reply in Messages so we can finalize this.`
      : "Your team needs a quick reply before we can move forward. Check Messages.";
  }
  if (row.status === "pending") {
    if (row.category === "field_ingest") return "We're confirming the details we have on file. No action needed unless we reach out.";
    if (row.category === "ai_draft") return "A teammate is reviewing the message before it goes out.";
    if (row.category === "dispute_letter") return "Your dispute letter is in compliance review before being filed.";
    if (row.category === "financial") return "A licensed team member is reviewing this financial action.";
    return "A teammate is reviewing this. We'll notify you when it's resolved.";
  }
  if (row.status === "approved" || row.status === "succeeded") return "Approved. No further action needed on your side.";
  if (row.status === "rejected") return "We chose not to proceed. Reach out in Messages if you'd like to discuss.";
  if (row.status === "escalated") return "This was escalated to a senior team lead. You'll hear back shortly.";
  return null;
}

interface Props {
  /** White-label switch: name the team, not an assistant. (Sprint 211.b: BTF surface retired; prop preserved for future white-label reuse) */
  whiteLabel?: boolean;
  /** Overrides the agent's name. By default it is the customer's agent (Cura, or the business's name for it), never PAIGE. */
  brandedAgentName?: string;
  /** Optional stage line shown in the header card. */
  currentStage?: string | null;
}

export function ClientApprovalsView({
  whiteLabel = false,
  brandedAgentName,
  currentStage,
}: Props) {
  const { pending, resolved, loading } = useMyApprovals();
  const { agentName } = useCustomerIdentity();
  const agent = brandedAgentName ?? (whiteLabel ? "your coaching team" : agentName);

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading your approvals…</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="w-5 h-5" />
            Your approvals & action log
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>
            This is every request {agent} made on your behalf that needed a human teammate to review
            — outbound messages, dispute letters, profile changes, financial actions, and more.
            You'll see exactly what was requested, where it stands, and what (if anything) you need to do next.
          </p>
          {currentStage && (
            <div className="pt-1">
              <Badge variant="secondary" className="font-normal">
                Current stage · {currentStage}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Section title="Open" subtitle="Awaiting review or your input" items={pending} agent={agent} emptyText="Nothing waiting on review right now." />
      <Section title="Resolved" subtitle="Completed in the last 100 actions" items={resolved} agent={agent} emptyText="No resolved items yet." />
    </div>
  );
}

function Section({ title, subtitle, items, agent, emptyText }: {
  title: string; subtitle: string; items: MyApprovalRow[]; agent: string; emptyText: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{emptyText}</CardContent></Card>
      ) : (
        <div className="space-y-3">{items.map((it) => <ApprovalRow key={it.id} row={it} agent={agent} />)}</div>
      )}
    </div>
  );
}

function ApprovalRow({ row, agent }: { row: MyApprovalRow; agent: string }) {
  const status = STATUS_META[row.status] ?? STATUS_META.pending;
  const Icon = status.icon;
  const cat = (row.category || row.type || "other") as string;
  const nextStep = nextStepFor(row);
  const needsAction = row.status === "changes_requested";

  return (
    <Card className={needsAction ? "border-blue-500/40" : ""}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={status.tone}>
            <Icon className="w-3 h-3 mr-1" />
            {status.label}
          </Badge>
          <Badge variant="secondary" className="font-normal">{CATEGORY_LABEL[cat] ?? cat}</Badge>
          {row.risk_level && row.status === "pending" && (
            <Badge variant="outline" className="text-[10px] capitalize">{row.risk_level} risk</Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            Requested {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
            {row.sla_due_at && row.status === "pending" && (
              <> · review by {formatDistanceToNow(new Date(row.sla_due_at), { addSuffix: true })}</>
            )}
          </span>
        </div>

        <p className="text-sm font-medium leading-snug">
          {row.summary || `Request from ${agent}`}
        </p>

        {nextStep && (
          <div className={`rounded-md border p-3 text-xs ${needsAction ? "bg-blue-500/5 border-blue-500/30" : "bg-muted/40"}`}>
            <div className="font-medium mb-0.5">Next step</div>
            <div className="text-muted-foreground">{nextStep}</div>
          </div>
        )}

        {needsAction && (
          <div>
            <Button asChild size="sm" variant="outline">
              <Link to="/app/messages">Reply to your team</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
