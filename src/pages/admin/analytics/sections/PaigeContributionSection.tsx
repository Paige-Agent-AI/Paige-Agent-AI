// Paige Contribution (§F) — the differentiator (IA slice 1c-x). TENANT lens,
// RLS-tenant-scoped. Owning desk (§16): Executive Office (org-brain rollup) +
// Technology & Automation (cost-to-serve lens).
//
// HERO = NARRATIVE, real numbers only (build-brief d / §13). No fabricated
// outcome-dollar hero — "attributed outcome contribution" is not derivable
// without a deal link, so the hero speaks to work VOLUME and the honest scope is
// stated in copy. The human-vs-Paige split, per-department breakout, autonomy
// distribution, approval rate, cost-to-serve and influenced-pipeline are
// drill-downs BELOW the hero, each with a crafted EmptyState on zero rows.
import { useMemo, useState } from "react";
import { Sparkles, Cpu, Users2, ShieldCheck, Building2, Wallet } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { SectionCard, StatTile, StatRow, DataTableShell, EmptyState } from "@/components/ui/page";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useUserRoles } from "@/hooks/useUserRoles";
import { usePaigeContribution } from "@/hooks/analytics/usePaigeContribution";
import { detectPeriodOverPeriod } from "@/lib/analytics/anomaly";

const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtCentsUsd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function PaigeContributionSection({ start, end }: { start: string; end: string }) {
  const data = usePaigeContribution(start, end);
  const { roles, isAdmin } = useUserRoles();
  const { toast } = useToast();
  const [filing, setFiling] = useState(false);

  // file_action() requires admin/super_admin/coach (action_bus.sql). Only show
  // the callable-seam affordance to a role that can actually call it — other
  // reopened-route roles would just get a 42501.
  const canFileAction = isAdmin || roles.includes("super_admin");

  const anomaly = useMemo(
    // Total action-bus volume (Paige- AND human-filed) — labeled honestly as
    // "Action-bus volume", NOT "Paige action volume" (§13: the series is total
    // filed work, not Paige-attributed).
    () => detectPeriodOverPeriod("Action-bus volume", data.actionsByDay, 30),
    [data.actionsByDay],
  );

  const humanVsPaige = data.paigeCount + data.humanCount;
  const paigePct = humanVsPaige > 0 ? data.paigeCount / humanVsPaige : 0;

  async function flagAnomaly() {
    if (!anomaly) return;
    setFiling(true);
    try {
      // §8/§10 callable seam — the EXISTING file_action() RPC, seeded kind
      // 'owner.task' (record_only, auto lane, no approval). NO tenant param
      // (file_action derives tenant from the JWT).
      const sign = anomaly.direction === "up" ? "+" : "";
      const title = `Follow up: ${anomaly.metricLabel} moved ${sign}${anomaly.deltaPct.toFixed(0)}% period-over-period`;
      const summary = `Prior ${anomaly.windowDays}d: ${fmtInt(anomaly.priorSum)} → recent ${anomaly.windowDays}d: ${fmtInt(anomaly.currentSum)}. Filed from Analytics.`;
      const { data: res, error } = await supabase.rpc("file_action", {
        p_action_kind: "owner.task",
        p_title: title,
        p_summary: summary,
      });
      if (error) throw error;
      const ok = (res as { ok?: boolean } | null)?.ok;
      toast({
        title: ok ? "Filed for follow-up" : "Could not file",
        description: ok ? "Added to your team's internal task queue." : "No action was filed.",
      });
    } catch (e) {
      toast({
        title: "Could not file",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setFiling(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* HERO — narrative, real volume numbers only. */}
      <SectionCard
        icon={Sparkles}
        title="Paige contribution"
        description="Executive Office · Technology & Automation"
      >
        {data.loading ? (
          <div className="space-y-3">
            <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : data.totalActions === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No Paige activity yet for this period"
            description="Paige contribution data appears here once actions are filed for your practice. As her team works pipeline, follow-ups, and client experience, this fills in."
          />
        ) : (
          <div className="space-y-4">
            <p className="font-display text-xl md:text-2xl font-semibold leading-snug text-foreground text-balance">
              Paige orchestrated{" "}
              <span className="tabular-nums text-primary">{fmtInt(data.paigeCount)}</span> of the{" "}
              <span className="tabular-nums">{fmtInt(data.totalActions)}</span> pieces of work your team
              filed across <span className="tabular-nums">{fmtInt(data.departmentCount)}</span>{" "}
              {data.departmentCount === 1 ? "department" : "departments"} for your practice this period.
            </p>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Counts action-bus work only — a coach closing a deal directly, outside the bus, isn't
              captured. "Paige orchestrated" = work filed headlessly by Paige (not human-initiated).
            </p>
            <StatRow cols={3}>
              <StatTile
                label="Paige-orchestrated"
                value={fmtInt(data.paigeCount)}
                icon={Sparkles}
                hint={`${fmtPct(paigePct)} of orchestrated work`}
              />
              <StatTile label="Human-initiated" value={fmtInt(data.humanCount)} icon={Users2} />
              <StatTile
                label="Est. cost to serve"
                value={fmtUsd(data.estimatedCostUsd)}
                icon={Cpu}
                hint="AI usage estimate — list price, excludes caching"
              />
            </StatRow>
          </div>
        )}
      </SectionCard>

      {/* Anomaly note — plain period-over-period, NEVER "Paige noticed" (§13). */}
      {!data.loading && anomaly && (
        <SectionCard>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground">
              <span className="font-medium">Period-over-period change:</span> {anomaly.metricLabel} moved{" "}
              <span
                className={
                  anomaly.direction === "up"
                    ? "font-semibold tabular-nums text-[hsl(var(--success))]"
                    : "font-semibold tabular-nums text-[hsl(var(--destructive))]"
                }
              >
                {anomaly.direction === "up" ? "+" : ""}
                {anomaly.deltaPct.toFixed(0)}%
              </span>{" "}
              vs the prior {anomaly.windowDays} days. Simple arithmetic on real rows — not a reasoned
              signal.
            </p>
            {canFileAction && (
              <Button variant="outline" size="sm" onClick={flagAnomaly} disabled={filing}>
                {filing ? "Filing…" : "Flag for follow-up"}
              </Button>
            )}
          </div>
        </SectionCard>
      )}

      {/* Human-vs-Paige split */}
      <SectionCard title="Human vs Paige" description="Of Paige-orchestrated work" icon={Users2}>
        {data.loading ? (
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        ) : humanVsPaige === 0 ? (
          <EmptyState title="No orchestrated actions yet" description="Filed work will split here." />
        ) : (
          <div className="space-y-2">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="bg-primary"
                style={{ width: `${paigePct * 100}%` }}
                aria-label="Paige-orchestrated share"
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>Paige {fmtInt(data.paigeCount)} ({fmtPct(paigePct)})</span>
              <span>Human {fmtInt(data.humanCount)} ({fmtPct(1 - paigePct)})</span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Per-department breakout (§16) */}
      <SectionCard title="By department" description="Executive Office org-brain rollup" icon={Building2}>
        <DataTableShell
          columns={[
            { key: "dept", header: "Department" },
            { key: "count", header: "Actions", numeric: true },
          ]}
          loading={data.loading}
          isEmpty={!data.loading && data.deptBreakout.length === 0}
          empty={
            <EmptyState
              title="No department activity yet"
              description="As Paige files work, each desk's volume shows here."
            />
          }
        >
          {data.deptBreakout.map((d) => (
            <TableRow key={d.slug}>
              <TableCell>{d.name}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(d.count)}</TableCell>
            </TableRow>
          ))}
        </DataTableShell>
        {!data.loading && data.seededDeptCount <= 2 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Two departments are active today — the rest of the 10-department org activates as their
            action-kinds ship.
          </p>
        )}
      </SectionCard>

      {/* Autonomy-tier distribution over time */}
      <SectionCard
        title="Autonomy over time"
        description="Auto · drafted-for-approval · human-only, by day"
        icon={ShieldCheck}
      >
        {data.loading ? (
          <div className="h-56 w-full animate-pulse rounded bg-muted" />
        ) : data.autonomyByDay.length < 2 ? (
          <EmptyState
            title="Insufficient data"
            description="At least two days of filed actions are needed to chart the autonomy mix."
          />
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.autonomyByDay}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.5rem",
                      color: "hsl(var(--popover-foreground))",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                    cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  />
                  <Legend />
                  <Bar stackId="a" dataKey="auto" name="Auto" fill="hsl(var(--success))" />
                  <Bar stackId="a" dataKey="confirm" name="Drafted → approval" fill="hsl(var(--primary))" />
                  <Bar stackId="a" dataKey="off" name="Human-only" fill="hsl(var(--muted-foreground))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Lanes reflect each action-kind's default tier — the per-tenant autonomy policy engine
              isn't live yet.
            </p>
          </>
        )}
      </SectionCard>

      {/* Approval rate + cost-to-serve + influenced pipeline */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <StatTile
          label="Approval rate on Paige's drafts"
          value={data.loading ? "—" : data.approvalRate == null ? "—" : fmtPct(data.approvalRate)}
          icon={ShieldCheck}
          loading={data.loading}
          hint={
            data.approvalDecided > 0
              ? `${fmtInt(data.approvalDecided)} decided`
              : "No drafts decided yet"
          }
        />
        <StatTile
          label="Open pipeline Paige is working"
          value={data.loading ? "—" : fmtCentsUsd(data.influencedPipelineCents)}
          icon={Wallet}
          loading={data.loading}
          hint="Influenced (correlation), not attributed"
        />
        <StatTile
          label="Est. AI cost to serve"
          value={data.loading ? "—" : fmtUsd(data.estimatedCostUsd)}
          icon={Cpu}
          loading={data.loading}
          hint="Estimate, excl. caching"
        />
      </div>

      {/* Cost-to-serve breakdown */}
      <SectionCard
        title="Cost to serve"
        description="Estimated AI spend by provider · tier · job (per call, not per action)"
        icon={Cpu}
      >
        <DataTableShell
          columns={[
            { key: "provider", header: "Provider" },
            { key: "tier", header: "Tier" },
            { key: "job", header: "Job" },
            { key: "count", header: "Calls", numeric: true },
            { key: "cost", header: "Est. cost", numeric: true },
          ]}
          loading={data.loading}
          isEmpty={!data.loading && data.costBreakdown.length === 0}
          empty={
            <EmptyState
              title="No AI usage recorded"
              description="Paige's model calls and their estimated cost appear here once she runs work for your practice."
            />
          }
        >
          {data.costBreakdown.map((c) => (
            <TableRow key={c.key}>
              <TableCell>{c.provider}</TableCell>
              <TableCell>{c.tier}</TableCell>
              <TableCell>{c.jobKind}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtInt(c.count)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtUsd(c.costUsd)}</TableCell>
            </TableRow>
          ))}
        </DataTableShell>
        {!data.loading && data.costBreakdown.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Every figure is an estimate (public list price, in+out tokens, excludes caching).
          </p>
        )}
      </SectionCard>
    </div>
  );
}
