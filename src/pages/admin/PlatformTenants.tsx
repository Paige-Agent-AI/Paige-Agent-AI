/**
 * Platform → Fleet Console (Agency/God view)
 * Owner-only tenant control plane: every tenant with live health — plan, status,
 * trial countdown, seat/customer utilization, and an at-risk flag — sortable,
 * with a drill-in for lifecycle actions. Replaces the old read-only table.
 * Blueprint §02 · Phase 1 (no Stripe).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Building2, ShieldAlert, AlertTriangle, Clock, ArrowUpDown, Plus,
  CircleDollarSign, Gift, FlaskConical,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PageShell, PageHeader, StatRow, StatTile, SectionCard,
  DataTableShell, EmptyState, Toolbar, StatePill, type Column, type PillState,
} from "@/components/ui/page";
import { useTenantContext } from "@/hooks/useTenantContext";
import { PLATFORM } from "@/lib/platform/identity";
import {
  type TenantStatus, type HealthLevel, STATUS_META, tenantHealth, trialDaysLeft,
} from "@/lib/platform/tenantLifecycle";
import { TenantDetailSheet, type FleetTenant } from "@/components/admin/platform/TenantDetailSheet";
import { ProvisionTenantDialog } from "@/components/admin/platform/ProvisionTenantDialog";
import RevenueIntegrityAudit from "@/components/admin/platform/RevenueIntegrityAudit";
import LiveRolloutControl from "@/components/admin/platform/LiveRolloutControl";
import PlatformOverview from "./PlatformOverview";

// Status tone → state-pill state. Attention tones (warn/critical) collapse to the
// destructive pill; positive → success; trial → muted pending; canceled → off.
const STATUS_PILL: Record<string, PillState> = {
  positive: "success",
  notice: "pending",
  warn: "error",
  critical: "error",
  neutral: "off",
};
// Health dots use semantic status tokens (never raw text-*-400).
const HEALTH_DOT: Record<HealthLevel, string> = {
  healthy: "bg-[hsl(var(--success))]",
  watch: "bg-[hsl(var(--warning))]",
  critical: "bg-[hsl(var(--destructive))]",
};

type SortKey = "name" | "plan_offer" | "status" | "trial" | "seats" | "customers" | "health";
const HEALTH_RANK: Record<HealthLevel, number> = { healthy: 0, watch: 1, critical: 2 };

export default function PlatformTenants() {
  const { isPlatformOwner, isPlatformStaff, loading: ctxLoading } = useTenantContext();
  const [rows, setRows] = useState<FleetTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("health");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [query, setQuery] = useState("");
  // revenue_class per tenant (operator-internal #29 axis). RLS on
  // tenant_revenue_classification is is_platform_owner()-only, so a scoped staff
  // (non-owner) read returns 0 rows → every tile falls back to promotional, never
  // a leak of the operator-internal classification (§9).
  const [classMap, setClassMap] = useState<Map<string, string>>(new Map());

  const load = async () => {
    setLoading(true);
    // RLS lets the platform owner read all tenants + members + clients + revenue class.
    const [{ data: tenants }, { data: members }, { data: clients }, { data: revClasses }] =
      await Promise.all([
        supabase
          .from("tenants")
          .select("id, slug, name, status, plan_offer, seat_limit, customer_limit, trial_ends_at")
          .order("created_at", { ascending: true }),
        supabase.from("tenant_members").select("tenant_id").eq("status", "active"),
        supabase.from("clients").select("tenant_id"),
        // tenant_revenue_classification isn't in the generated Supabase types yet;
        // cast the table name (same idiom as useTenantContext). RLS is owner-only, so
        // a scoped-staff read returns 0 rows → tiles fall back to promotional (§9/§13).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("tenant_revenue_classification" as any).select("tenant_id, revenue_class"),
      ]);

    setClassMap(
      new Map(
        ((revClasses ?? []) as unknown as Array<{ tenant_id: string; revenue_class: string }>).map(
          (r) => [r.tenant_id, r.revenue_class],
        ),
      ),
    );

    const memberCounts = new Map<string, number>();
    (members ?? []).forEach((m) => memberCounts.set(m.tenant_id, (memberCounts.get(m.tenant_id) ?? 0) + 1));
    const customerCounts = new Map<string, number>();
    (clients ?? []).forEach((c) => {
      if (!c.tenant_id) return;
      customerCounts.set(c.tenant_id, (customerCounts.get(c.tenant_id) ?? 0) + 1);
    });

    setRows(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((tenants ?? []) as any[]).map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status as TenantStatus,
        plan_offer: t.plan_offer,
        seat_limit: t.seat_limit ?? 0,
        customer_limit: t.customer_limit ?? 0,
        trial_ends_at: t.trial_ends_at,
        member_count: memberCounts.get(t.id) ?? 0,
        customer_count: customerCounts.get(t.id) ?? 0,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    if (ctxLoading || !(isPlatformOwner || isPlatformStaff)) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxLoading, isPlatformOwner, isPlatformStaff]);

  const withHealth = useMemo(
    () => rows.map((t) => ({ t, health: tenantHealth(t), days: trialDaysLeft(t.trial_ends_at) })),
    [rows],
  );

  const totals = useMemo(() => {
    return withHealth.reduce(
      (acc, { t, health }) => ({
        tenants: acc.tenants + 1,
        active: acc.active + (t.status === "active" ? 1 : 0),
        trials: acc.trials + (t.status === "trial" ? 1 : 0),
        atRisk: acc.atRisk + (health.level !== "healthy" ? 1 : 0),
      }),
      { tenants: 0, active: 0, trials: 0, atRisk: 0 },
    );
  }, [withHealth]);

  // Revenue-class split (#29): the operator-honest breakdown of the fleet. An
  // unclassified tenant reads as promotional (the #29 baseline), matching the
  // switcher's default so the two surfaces never disagree.
  const revClass = useMemo(() => {
    return rows.reduce(
      (acc, t) => {
        const c = classMap.get(t.id) ?? "promotional";
        if (c === "paid") acc.paid += 1;
        else if (c === "internal_test") acc.internal += 1;
        else acc.promotional += 1;
        return acc;
      },
      { paid: 0, promotional: 0, internal: 0 },
    );
  }, [rows, classMap]);

  const sorted = useMemo(() => {
    const arr = [...withHealth];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "name": av = a.t.name.toLowerCase(); bv = b.t.name.toLowerCase(); break;
        case "plan_offer": av = a.t.plan_offer ?? ""; bv = b.t.plan_offer ?? ""; break;
        case "status": av = a.t.status; bv = b.t.status; break;
        case "trial":
          av = a.t.status === "trial" ? (a.days ?? Infinity) : Infinity;
          bv = b.t.status === "trial" ? (b.days ?? Infinity) : Infinity;
          break;
        case "seats": av = a.t.member_count; bv = b.t.member_count; break;
        case "customers": av = a.t.customer_count; bv = b.t.customer_count; break;
        case "health": av = HEALTH_RANK[a.health.level]; bv = HEALTH_RANK[b.health.level]; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [withHealth, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(({ t }) =>
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      t.status.includes(q) ||
      (t.plan_offer ?? "").toLowerCase().includes(q));
  }, [sorted, query]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" || k === "plan_offer" ? "asc" : "desc"); }
  };

  // Derive the open tenant from live rows (not a snapshot) so the drill-in
  // reflects a mutation the moment load() refetches after it.
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const openTenant = (t: FleetTenant) => { setSelectedId(t.id); setSheetOpen(true); };
  // The operator-overview "Reach out" act opens the same lifecycle drill-in as a
  // fleet-row click; `selected` derives from live rows, so the sheet fills in as
  // soon as the tenant is loaded.
  const reachOutTenant = (tenantId: string) => { setSelectedId(tenantId); setSheetOpen(true); };

  if (ctxLoading) {
    return (
      <PageShell width="wide">
        <div className="text-muted-foreground text-sm">Loading platform console…</div>
      </PageShell>
    );
  }

  if (!isPlatformOwner && !isPlatformStaff) {
    return (
      <PageShell width="narrow">
        <SectionCard title="Platform owner only" icon={ShieldAlert}>
          <p className="text-sm text-muted-foreground">
            This area is restricted to the platform owner. If you manage a tenant,
            head to <strong>Settings → Workspace</strong> instead.
          </p>
        </SectionCard>
      </PageShell>
    );
  }

  const columns: Column[] = [
    { key: "name", header: <SortButton label="Tenant" k="name" sortKey={sortKey} sortBy={sortBy} /> },
    { key: "plan", header: <SortButton label="Plan" k="plan_offer" sortKey={sortKey} sortBy={sortBy} /> },
    { key: "status", header: <SortButton label="Status" k="status" sortKey={sortKey} sortBy={sortBy} /> },
    { key: "trial", header: <SortButton label="Trial" k="trial" sortKey={sortKey} sortBy={sortBy} /> },
    { key: "seats", numeric: true, header: <SortButton label="Seats" k="seats" align="right" sortKey={sortKey} sortBy={sortBy} /> },
    { key: "customers", numeric: true, header: <SortButton label="Customers" k="customers" align="right" sortKey={sortKey} sortBy={sortBy} /> },
    { key: "health", header: <SortButton label="Health" k="health" sortKey={sortKey} sortBy={sortBy} /> },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        variant="plain"
        eyebrow="Platform · Fleet"
        title="Fleet Console"
        description={`Every workspace running on ${PLATFORM.name}. Click a tenant to manage its plan, limits, and lifecycle.`}
        actions={
          isPlatformOwner ? (
            // Provisioning CREATES a workspace — a real act, so a single gold
            // primary is the legitimate spend here (§11). Owner-only, matching
            // the invite/lifecycle gate.
            <Button variant="gold" onClick={() => setProvisionOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Provision tenant
            </Button>
          ) : undefined
        }
      />

      <PlatformOverview onReachOut={reachOutTenant} />

      <StatRow cols={4}>
        <StatTile label="Tenants" value={totals.tenants} icon={Building2} loading={loading} />
        <StatTile label="Active" value={totals.active} icon={Building2} loading={loading} />
        <StatTile label="On trial" value={totals.trials} icon={Clock} loading={loading} />
        <StatTile
          label="Needs attention"
          value={totals.atRisk}
          icon={AlertTriangle}
          intent={totals.atRisk > 0 ? "negative" : "neutral"}
          loading={loading}
        />
      </StatRow>

      {/* Revenue-class split (#29) — the operator-honest read: paying customers vs
          comped/promotional vs internal-test. A titled sub-section (not a bare second
          tile row) so the different axis reads as intentional, not an off-grid pile
          (§25 design-critic fix). OWNER-ONLY: tenant_revenue_classification is RLS-gated to
          is_platform_owner(), so a scoped staff-admin reads 0 rows and would see a FALSE
          "Paying: 0". Gate to the owner (who can read it) rather than show wrong numbers
          (§13/§39 Finding 4). Never tenant-visible. */}
      {isPlatformOwner && (
        <div className="space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Revenue mix
          </p>
          <StatRow cols={3}>
            <StatTile label="Paying" value={revClass.paid} icon={CircleDollarSign} loading={loading} />
            <StatTile label="Promotional" value={revClass.promotional} icon={Gift} loading={loading} />
            <StatTile label="Internal / test" value={revClass.internal} icon={FlaskConical} loading={loading} />
          </StatRow>
        </div>
      )}

      {/* Revenue integrity (#31) — the investor-grade three-gate proof + CSV export.
          Owner-only: operator_revenue_integrity_audit RAISES 42501 for a non-owner, and
          the DB trigger guarantees no tenant can rest at revenue_class='paid' without a
          signed agreement AND a live Stripe subscription. */}
      {isPlatformOwner && <RevenueIntegrityAudit />}

      {/* Live Conversation rollout (INT-104) — the one setting that decides who may speak today,
          and the state around it. Owner-only on both layers: this gate, and a server-side RAISE in
          paige_live_rollout_status() plus the edge function's own is_platform_owner check. */}
      {isPlatformOwner && <LiveRolloutControl />}

      <Toolbar>
        <h2 className="font-display text-base font-semibold text-foreground">All tenants</h2>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, slug, status…"
          className="max-w-[220px] h-9"
          aria-label="Search tenants"
        />
      </Toolbar>

      <TooltipProvider delayDuration={200}>
        <DataTableShell
          columns={columns}
          loading={loading}
          isEmpty={filtered.length === 0}
          empty={
            <EmptyState
              icon={Building2}
              title={rows.length === 0 ? "No workspaces yet" : "No tenants match your search"}
              description={
                rows.length === 0
                  ? "The moment a workspace signs on, it lands here with live health."
                  : "Clear the search to see the whole fleet."
              }
            />
          }
        >
          {filtered.map(({ t, health, days }) => {
            const meta = STATUS_META[t.status];
            return (
              <TableRow
                key={t.id}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                tabIndex={0}
                role="button"
                aria-label={`Manage ${t.name}`}
                onClick={() => openTenant(t)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTenant(t); }
                }}
              >
                <TableCell>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">/{t.slug}</div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{t.plan_offer ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <StatePill state={STATUS_PILL[meta.tone] ?? "off"}>{meta.label}</StatePill>
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {t.status === "trial" && days !== null
                    ? days >= 0
                      ? <span className={days <= 3 ? "text-[hsl(var(--warning))]" : ""}>{days}d</span>
                      : <span className="text-[hsl(var(--destructive))]">lapsed</span>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={t.seat_limit > 0 && t.member_count >= t.seat_limit ? "text-[hsl(var(--warning))]" : ""}>
                    {t.member_count}/{t.seat_limit || "∞"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span className={t.customer_limit > 0 && t.customer_count >= t.customer_limit ? "text-[hsl(var(--warning))]" : ""}>
                    {t.customer_count}/{t.customer_limit || "∞"}
                  </span>
                </TableCell>
                <TableCell>
                  {health.level === "healthy" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={`w-2 h-2 rounded-full ${HEALTH_DOT.healthy}`} /> Healthy
                    </span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[health.level]}`} />
                          {health.level === "critical" ? "Critical" : "Watch"}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{health.reasons.join(" · ")}</TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </DataTableShell>
      </TooltipProvider>

      <TenantDetailSheet
        tenant={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={load}
      />

      {isPlatformOwner && (
        <ProvisionTenantDialog
          open={provisionOpen}
          onOpenChange={setProvisionOpen}
          onProvisioned={(t) => { load(); openTenant({
            id: t.id, slug: t.slug, name: t.name,
            // Minimal shell so the drill-in opens immediately; load() refetches
            // the live row (status/limits/health) right behind it.
            status: "trial", plan_offer: null, seat_limit: 0, customer_limit: 0,
            trial_ends_at: null, member_count: 0, customer_count: 0,
          }); }}
        />
      )}
    </PageShell>
  );
}

function SortButton({
  label, k, sortKey, sortBy, align,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortBy: (k: SortKey) => void; align?: "right";
}) {
  return (
    <button
      type="button"
      onClick={() => sortBy(k)}
      className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${sortKey === k ? "text-foreground font-semibold" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {label}
      <ArrowUpDown className="w-3 h-3 opacity-50" />
    </button>
  );
}
