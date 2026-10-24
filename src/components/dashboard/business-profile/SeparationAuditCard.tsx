import { useNavigate } from "react-router-dom";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { useSeparationAudit } from "@/hooks/useSeparationAudit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert, ShieldCheck, ShieldQuestion, AlertTriangle, ChevronRight } from "lucide-react";
import type { SeparationResult, SeparationSeverity } from "@/lib/separationAudit";

interface Props {
  userId: string;
  businessId?: string;
  /** Compact = single-line banner used on Dashboard / Funding pages. */
  variant?: "full" | "compact";
  /** Where the "fix it" CTA should go. Default: business profile section. */
  onFix?: () => void;
}

const severityClass = (s: SeparationSeverity) => {
  if (s === "high") return "text-destructive border-destructive/40 bg-destructive/10";
  if (s === "medium") return "text-amber-600 border-amber-500/40 bg-amber-500/10";
  return "text-muted-foreground border-border bg-muted/30";
};

const statusBadge = (r: SeparationResult) => {
  if (r.status === "clean") return { label: "Separated", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", Icon: ShieldCheck };
  if (r.status === "minor") return { label: "Minor issues", cls: "bg-muted text-muted-foreground border-border", Icon: ShieldQuestion };
  if (r.status === "needs_work") return { label: "Needs work", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30", Icon: ShieldAlert };
  return { label: "Critical", cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: ShieldAlert };
};

export function SeparationAuditCard({ userId, businessId, variant = "full", onFix }: Props) {
  // The customer's agent (Cura, or the business's own name for it), never PAIGE, the owner's COO.
  const { agentName } = useCustomerIdentity();
  const navigate = useNavigate();
  const { data: result, isLoading } = useSeparationAudit(userId, businessId);

  if (isLoading || !result) return null;

  const goFix = () => (onFix ? onFix() : navigate("/app/build-program"));
  const badge = statusBadge(result);

  // ── Compact (Dashboard / Funding banner) ─────────────────────────────
  if (variant === "compact") {
    if (result.status === "clean") return null; // nothing to show
    const Icon = badge.Icon;
    return (
      <Alert className={result.status === "critical" ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}>
        <Icon className={`w-4 h-4 ${result.status === "critical" ? "text-destructive" : "text-amber-600"}`} />
        <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="font-semibold text-foreground">Personal/Business Separation: {badge.label}.</span>{" "}
            <span className="text-muted-foreground">
              {result.highCount > 0 && `${result.highCount} high-severity overlap${result.highCount === 1 ? "" : "s"} could hurt funding approvals.`}
              {result.highCount === 0 && result.mediumCount > 0 && `${result.mediumCount} item${result.mediumCount === 1 ? "" : "s"} to clean up before funding.`}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={goFix} className="text-xs">
            Fix it
            <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Full card (Business Profile page) ─────────────────────────────────
  const Icon = badge.Icon;
  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Icon className={`w-5 h-5 ${result.status === "critical" ? "text-destructive" : result.status === "needs_work" ? "text-amber-600" : result.status === "clean" ? "text-emerald-600" : "text-muted-foreground"}`} />
              Personal / Business Separation Audit
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Funders, LexisNexis, and the business bureaus penalize files where your personal and business identities overlap. {agentName} checks every field that should be different.
            </p>
          </div>
          <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Score bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Separation score</span>
            <span className="font-semibold text-foreground">{result.score}/100</span>
          </div>
          <Progress value={result.score} className="h-2" />
        </div>

        {/* Issues */}
        {result.issues.length === 0 ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-emerald-700">
              <ShieldCheck className="w-4 h-4" />
              No commingling detected.
            </div>
            <p className="text-muted-foreground mt-1 ml-6 text-xs">
              Your personal and business identities are properly separated. Make sure the same business identity is listed identically everywhere your business appears (Google, Yelp, LexisNexis, D&B, Equifax, Experian Business).
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {result.issues.map(issue => (
              <li
                key={issue.id}
                className={`rounded-md border p-3 ${severityClass(issue.severity)}`}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <div className="font-medium text-foreground">
                      {issue.field}
                      <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">
                        {issue.severity}
                      </Badge>
                    </div>
                    <div className="text-foreground/80 mt-0.5">{issue.detail}</div>
                    <div className="text-xs text-muted-foreground mt-1.5">
                      <span className="font-medium text-foreground">Fix:</span> {issue.fixHint}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Consistency reminder */}
        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          <span className="font-medium text-foreground">Consistency rule:</span>{" "}
          Once you fix any issue above, update that same value everywhere your business is listed — Google Business Profile, Yelp, LinkedIn, your website, LexisNexis, D&B, Equifax SBFE, and Experian Business. Mismatches across listings score worse than a missing listing.
        </div>
      </CardContent>
    </Card>
  );
}
