import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  DollarSign,
  Wallet,
  TrendingUp,
  AlertTriangle,
  Clock,
  CalendarClock,
  CheckSquare,
  UserPlus,
  ArrowRight,
  Sparkles,
  Inbox,
  PenLine,
  MailQuestion,
  AlarmClock,
  Send,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  PageShell,
  PageHeader,
  StatRow,
  StatTile,
  SectionCard,
  EmptyState,
  StatePill,
  GlyphPlate,
} from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { ExportClientsButton } from "@/components/dashboard/admin/ExportClientsButton";
import { CommandCenterViewToggle } from "@/components/dashboard/admin/CommandCenterViewToggle";
import { DraftsAwaitingPanel } from "@/components/dashboard/DraftsAwaitingPanel";
import { PaigeDepartmentStatus } from "@/components/paige/PaigeDepartmentStatus";
import { SystemsCheckTile } from "@/components/systems-check/SystemsCheckTile";
import { OwnerWelcome, type OnboardingState } from "@/components/onboarding/OwnerWelcome";
import { usePracticeDashboard, type PracticeMetrics } from "@/hooks/usePracticeDashboard";
import { useCommsSummary } from "@/hooks/useCommsSummary";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useUserRoles } from "@/hooks/useUserRoles";
import { useCommandCenterView } from "@/hooks/useCommandCenterView";
import {
  PERSONAS,
  resolvePersona,
  TEAM_VIEW_ENABLED,
  type KpiKey,
  type RailKey,
  type CommandCenterView,
} from "@/lib/roleViews/commandCenterRegistry";
import { supabase } from "@/integrations/supabase/client";

const usd = (cents: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));

const num = (n: number) => n.toLocaleString();

/** One row in the "Needs You Today" rail — a neutral, linked count. Gold is
 *  reserved for the single act moment (approvals), never these resting rows. */
function AttentionItem({
  icon,
  label,
  count,
  href,
  emphasize,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  href: string;
  emphasize?: boolean;
}) {
  return (
    <Link
      to={href}
      className="group flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4 shadow-card transition-shadow duration-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      <GlyphPlate icon={icon} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="font-display text-2xl font-semibold tabular-nums text-foreground">
          {num(count)}
        </div>
        <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      </div>
      {emphasize && count > 0 ? (
        <StatePill state="warning">Review</StatePill>
      ) : (
        <ArrowRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      )}
    </Link>
  );
}

/** KPI tiles keyed by KpiKey. Explicit per-key access (no dynamic metrics[k] index)
 *  keeps the whole-repo tsc ratchet clean, and each `present` preserves the §13
 *  "render only when the real key exists" guard — no fabricated zero ever ships. */
const KPI_META: Record<
  KpiKey,
  { present: (m?: PracticeMetrics) => boolean; render: (m: PracticeMetrics | undefined, loading: boolean) => JSX.Element }
> = {
  active_clients: {
    present: (m) => m?.active_clients !== undefined,
    render: (m, loading) => (
      <StatTile
        label="Active clients"
        value={num(m?.active_clients ?? 0)}
        icon={Users}
        loading={loading}
        hint={m?.new_clients !== undefined && m.new_clients > 0 ? `${num(m.new_clients)} new this period` : undefined}
      />
    ),
  },
  won_value_cents: {
    present: (m) => m?.won_value_cents !== undefined,
    render: (m, loading) => (
      <StatTile
        label="Revenue this period"
        value={usd(m?.won_value_cents ?? 0)}
        icon={DollarSign}
        loading={loading}
      />
    ),
  },
  active_retainers: {
    present: (m) => m?.active_retainers !== undefined,
    render: (m, loading) => (
      <StatTile label="Active retainers" value={num(m?.active_retainers ?? 0)} icon={Wallet} loading={loading} />
    ),
  },
  pipeline_value_cents: {
    present: (m) => m?.pipeline_value_cents !== undefined,
    render: (m, loading) => (
      <StatTile label="Pipeline value" value={usd(m?.pipeline_value_cents ?? 0)} icon={TrendingUp} loading={loading} />
    ),
  },
};

const RAIL_META: Record<RailKey, { icon: LucideIcon; label: string; href: string; value: (a?: import("@/hooks/usePracticeDashboard").PracticeAttention) => number | undefined }> = {
  at_risk_clients: { icon: AlertTriangle, label: "At-risk clients", href: "/choose-account", value: (a) => a?.at_risk_clients },
  follow_ups_due: { icon: Clock, label: "Follow-ups due", href: "/choose-account", value: (a) => a?.follow_ups_due },
  upcoming_sessions_7d: { icon: CalendarClock, label: "Sessions next 7 days", href: "/choose-account", value: (a) => a?.upcoming_sessions_7d },
  tasks_due: { icon: CheckSquare, label: "Tasks due", href: "/choose-account", value: (a) => a?.tasks_due },
  onboarding_in_progress: { icon: UserPlus, label: "Onboarding in progress", href: "/choose-account", value: (a) => a?.onboarding_in_progress },
};

export function PracticeOverview({ children }: { children?: ReactNode }) {
  const { metrics, attention, loading } = usePracticeDashboard();
  const { summary: comms, loading: commsLoading } = useCommsSummary();
  const { roles, userId } = useUserRoles();
  const { activeTenantId, activeTenant, isPlatformOwner } = useTenantContext();

  // Presentation-only persona resolution — NEVER gates a data read (§9). isOwner is
  // the tenant-owner flag; resolvePersona returns the highest-authority ACTIVE persona.
  const isOwner = !!userId && activeTenant?.owner_user_id === userId;
  const persona = resolvePersona(roles, isOwner);
  const availableViews = useMemo<CommandCenterView[]>(
    () => persona.views.filter((v) => v !== "team" || TEAM_VIEW_ENABLED),
    [persona.views],
  );
  const { view, setView, canSwitch } = useCommandCenterView(availableViews, persona.defaultView);
  // "Whole business" renders the owner composition; content otherwise = the persona.
  const contentConfig = view === "business" ? PERSONAS.owner : persona;

  // Approvals scope. Business view sees the whole tenant's queue — BUT never for a
  // platform owner, whose RLS would return every tenant's rows (§9). So a platform
  // owner falls back to "mine". Non-approver personas simply don't mount the panel.
  const approvalScope: "all" | "mine" = view === "business" && !isPlatformOwner ? "all" : "mine";
  const { items: approvals, refresh: refreshApprovals } = usePendingApprovals({ scope: approvalScope });
  const approvalsCount = approvals.length;

  // First-run welcome (§9/§10). Completion is authoritative in the tenants row via the
  // Paige-callable RPC — never localStorage.
  const [welcome, setWelcome] = useState<OnboardingState | null>(null);
  const [welcomeHidden, setWelcomeHidden] = useState(false);

  useEffect(() => {
    let on = true;
    setWelcome(null);
    setWelcomeHidden(false);
    if (!activeTenantId) return;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc("get_owner_onboarding_state" as any, {
        p_tenant_id: activeTenantId,
      });
      if (!on || error) return;
      setWelcome((data ?? {}) as OnboardingState);
    })();
    return () => { on = false; };
  }, [activeTenantId]);

  const showWelcome = !welcomeHidden && welcome !== null && !welcome.dismissed && !welcome.completed_at;

  // KPI tiles for this persona/view — explicit per-key, present-guarded (§13).
  const kpis = contentConfig.kpis
    .filter((k) => KPI_META[k].present(metrics) || loading)
    .map((k) => ({ key: k, node: KPI_META[k].render(metrics, loading) }));

  const railItems = contentConfig.rail
    .map((k) => ({ key: k, ...RAIL_META[k], value: RAIL_META[k].value(attention) }))
    .filter((i) => i.value !== undefined) as Array<{ key: RailKey; icon: LucideIcon; label: string; href: string; value: number }>;

  const attentionTotal = railItems.reduce((sum, i) => sum + i.value, 0);
  const emptyBook =
    !loading &&
    (metrics?.active_clients ?? 0) === 0 &&
    attentionTotal === 0 &&
    approvalsCount === 0;

  const stages = metrics?.deals_by_stage ?? [];
  const activeStages = stages.filter((s) => s.count > 0 || s.value_cents > 0);

  const showKpis = contentConfig.panels.includes("kpis") && kpis.length > 0;
  const showNeeds = contentConfig.panels.includes("needs_today");
  const showPipeline = contentConfig.panels.includes("open_pipeline") && metrics?.deals_by_stage !== undefined;

  return (
    <PageShell width="wide">
      {/* Lean compact header (§11 banner rule) — converted from the prior hero per the
          owner's explicit 1c-p instruction, which unfreezes this exact surface (§28).
          The personalization is the body; the view toggle + Export ride in the actions
          slot with their conditional guards intact. */}
      <PageHeader
        variant="plain"
        icon={LayoutDashboard}
        eyebrow="Overview"
        title="Your practice at a glance"
        description="The people you serve, the revenue in motion, and exactly what's waiting on you today."
        actions={
          <div className="flex items-center gap-2">
            {canSwitch && <CommandCenterViewToggle views={availableViews} value={view} onChange={setView} />}
            {contentConfig.showExport && <ExportClientsButton />}
          </div>
        }
      />

      {showWelcome && activeTenantId && (
        <OwnerWelcome
          tenantId={activeTenantId}
          accountType={activeTenant?.account_type ?? "standalone"}
          initialState={welcome ?? {}}
          onClose={() => setWelcomeHidden(true)}
        />
      )}

      {/* Systems Check (Wave S3 L3) — renders for EVERY tenant tier (God-tenant-context,
          solo, sub-account, agency-as-tenant) regardless of book state, ABOVE the
          empty/non-empty split: a fresh account with no clients needs the "is your
          business set up to run?" check the MOST (§51 tier-parity, §36 proactive
          surfacing). Paige surfaces the single highest-severity gap with her drafted fix
          + one-click approve (§9 tenant-scoped; §11 gold budget owned by the tile). */}
      <SystemsCheckTile scope="tenant" />

      {/* "See them work" (Task #245, §7 3-layer VP framework) — the ambient live read of
          what each of Paige's ten departments is doing. Hoisted ABOVE the empty/non-empty
          split (like SystemsCheckTile) so it renders for EVERY tenant of this tier
          regardless of book state (§60 same-tier feature parity — a fresh sub-account with
          an empty book still gets the department orchestration surface every other
          same-tier tenant sees; it must not "poke out" of one account and vanish on
          another). Was previously nested in the non-empty branch, so it only appeared once
          a tenant had clients/attention/approvals — a same-tier parity gap, not a tier
          feature difference. Proactive surfacing (§36), tenant-scoped (§9), gold-free (§11). */}
      <PaigeDepartmentStatus scope="tenant" />

      {emptyBook ? (
        <SectionCard>
          <EmptyState
            icon={Sparkles}
            tone="brand"
            title="Your book is a blank canvas"
            description="Add your first client and Paige starts working both sides — onboarding them and surfacing your next move here."
            action={
              <Button asChild variant="gold">
                <Link to="/choose-account">Add your first client</Link>
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <>
          {/* Drafts marquee LEADS for approver personas — the live act out-ranks the
              static KPI context (the one gold approval surface on the page). */}
          {contentConfig.showApprovalsAct && (
            <DraftsAwaitingPanel items={approvals} refresh={refreshApprovals} />
          )}

          {/* Comms inbox at-a-glance — proactive surfacing (§36): what's waiting on
              the coach, one click into the filtered inbox. All tiles NEUTRAL — gold
              stays reserved for the Approve act in DraftsAwaitingPanel (§11). */}
          <SectionCard
            title="Your inbox"
            description="What's waiting on you across every conversation, live."
            icon={Inbox}
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/choose-account">
                  Open inbox <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            }
          >
            <StatRow cols={4}>
              {[
                {
                  key: "drafts",
                  label: "Drafts awaiting you",
                  value: comms.draftsAwaiting,
                  icon: PenLine,
                  href: "/choose-account",
                  hint: "ready for a one-click send",
                },
                {
                  key: "awaiting-reply",
                  label: "No reply in 3+ days",
                  value: comms.awaitingClientReply,
                  icon: MailQuestion,
                  href: "/choose-account",
                  hint: "you spoke last — time for a nudge",
                },
                {
                  key: "waking-today",
                  label: "Waking today",
                  value: comms.wakingToday,
                  icon: AlarmClock,
                  href: "/choose-account",
                  hint: "snoozed threads coming back",
                },
                {
                  key: "scheduled",
                  label: "Scheduled to send",
                  value: comms.scheduledSends,
                  icon: Send,
                  href: "/choose-account",
                  hint: "queued to go out later",
                },
              ].map((t) => (
                <Link
                  key={t.key}
                  to={t.href}
                  className="block rounded-[var(--radius)] transition-shadow duration-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <StatTile
                    label={t.label}
                    value={num(t.value)}
                    icon={t.icon}
                    loading={commsLoading}
                    hint={t.value > 0 ? t.hint : undefined}
                  />
                </Link>
              ))}
            </StatRow>
          </SectionCard>

          {showKpis && (
            <StatRow cols={Math.max(2, Math.min(kpis.length, 4)) as 2 | 3 | 4}>
              {kpis.map((k) => <div key={k.key}>{k.node}</div>)}
            </StatRow>
          )}

          {showNeeds && (
            <SectionCard
              title="Needs you today"
              description="What Paige has teed up for your attention, live."
              icon={Sparkles}
              actions={railItems.length === 0 ? <StatePill state="success">All clear</StatePill> : undefined}
            >
              {railItems.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="Nothing needs you right now"
                  description="Paige will raise at-risk clients, due follow-ups, and upcoming sessions here as they come up."
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {railItems.map((i) => (
                    <AttentionItem
                      key={i.key}
                      icon={i.icon}
                      label={i.label}
                      count={i.value}
                      href={i.href}
                      emphasize={i.key === contentConfig.railEmphasis}
                    />
                  ))}
                </div>
              )}
            </SectionCard>
          )}

          {showPipeline && (
            <SectionCard
              title="Open pipeline by stage"
              description="Where your active deals sit right now."
              icon={TrendingUp}
              actions={
                <Button asChild variant="ghost" size="sm">
                  <Link to="/choose-account">
                    Open pipeline <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              }
            >
              {activeStages.length === 0 ? (
                <EmptyState
                  icon={TrendingUp}
                  title="No open deals yet"
                  description="As you move deals through your pipeline, the value in each stage shows up here."
                />
              ) : (
                <ul className="divide-y divide-border/60">
                  {activeStages.map((s) => (
                    <li
                      key={s.stage_label}
                      className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-medium text-foreground">{s.stage_label}</span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                          {num(s.count)}
                        </span>
                      </div>
                      <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-foreground">
                        {usd(s.value_cents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
        </>
      )}

      {children}
    </PageShell>
  );
}
