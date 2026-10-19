import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { CalendarClock, Sparkles, Bell, CheckSquare, Flag, Map, ListChecks, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  PageShell, PageHeader, SectionCard, StatRow, StatTile, EmptyState, Toolbar, FilterChip, StatePill,
} from "@/components/ui/page";
import { usePlanList, type PlanScope, type PlanItem, type PlanItemType } from "@/hooks/usePlanList";
import { bucketOf, isClosed, type TimeBucket } from "@/lib/planning";
import { PlanItemRow } from "./PlanItemRow";
import { QuickAddDialog } from "./QuickAddDialog";
import { useAssistantName } from "@/lib/portal/customerIdentity";

const BUCKET_ORDER: { key: TimeBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "none", label: "No date" },
];

const TYPE_CHIPS: { key: PlanItemType | "all"; label: string; icon: typeof Bell }[] = [
  { key: "all", label: "All", icon: ListChecks },
  { key: "reminder", label: "Reminders", icon: Bell },
  { key: "task", label: "Tasks", icon: CheckSquare },
  { key: "milestone", label: "Milestones", icon: Flag },
];

const BUCKET_CAP = 12; // keep any single bucket from becoming a scroll-wall (§11/§67)

const byWhen = (a: PlanItem, b: PlanItem) => {
  const av = a.due_at ?? a.remind_at ?? "9999";
  const bv = b.due_at ?? b.remind_at ?? "9999";
  return av < bv ? -1 : av > bv ? 1 : 0;
};

export function PlanningHub({ staff = false, paigeHref = "/app" }: { staff?: boolean; paigeHref?: string }) {
  const assistant = useAssistantName();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const focusItem = params.get("item");
  const [scope, setScope] = useState<PlanScope>("mine");
  const [typeFilter, setTypeFilter] = useState<PlanItemType | "all">("all");
  const [showDone, setShowDone] = useState(false);
  const lastFocused = useRef<string | null>(null);

  const { plans, looseItems, allItems, loading, error, forbidden, userId, refresh } = usePlanList({ scope });
  const reload = useCallback(() => refresh({ silent: true }), [refresh]);

  useEffect(() => { if (!staff && scope !== "mine") setScope("mine"); }, [staff, scope]);

  const matchesType = useCallback(
    (i: PlanItem) => typeFilter === "all" || i.item_type === typeFilter, [typeFilter],
  );

  // Standalone items (Paige's loose reminders/tasks) fill the time buckets;
  // plan-attached items live under their Plan card — each renders exactly ONCE.
  const bucketPool = useMemo(
    () => looseItems.filter((i) => !isClosed(i) && matchesType(i)), [looseItems, matchesType],
  );
  const byBucket = useMemo(() => {
    const map: Record<TimeBucket, PlanItem[]> = { overdue: [], today: [], week: [], later: [], none: [] };
    for (const it of bucketPool) map[bucketOf(it)].push(it);
    (Object.keys(map) as TimeBucket[]).forEach((k) => map[k].sort(byWhen));
    return map;
  }, [bucketPool]);

  // Done group + stats span everything visible (loose + plan) so the numbers
  // reflect the real workload even though plan items render under plans.
  const openAll = allItems.filter((i) => !isClosed(i) && matchesType(i));
  const doneItems = allItems.filter((i) => i.status === "done" && matchesType(i));
  const overdueCount = openAll.filter((i) => bucketOf(i) === "overdue").length;
  const todayCount = openAll.filter((i) => bucketOf(i) === "today").length;
  const upcomingCount = openAll.filter((i) => bucketOf(i) === "week").length;

  // Deep-link: scroll to + focus + ring the fired reminder's row, ONCE per id.
  useEffect(() => {
    if (!focusItem || loading || lastFocused.current === focusItem) return;
    let el: HTMLElement | null = null;
    try { el = document.querySelector<HTMLElement>(`[data-plan-item="${CSS.escape(focusItem)}"]`); } catch { el = null; }
    lastFocused.current = focusItem;
    if (el) {
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      el.classList.add("ring-2", "ring-ring", "ring-offset-2", "ring-offset-background");
      const t = setTimeout(() => el?.classList.remove("ring-2", "ring-ring", "ring-offset-2", "ring-offset-background"), 2400);
      navigate({ search: "" }, { replace: true });
      return () => clearTimeout(t);
    }
    // The linked item isn't on this person's board (completed, removed, or a
    // team item they can't see) — say so plainly instead of a silent no-op.
    toast("That reminder isn't on your board", { description: "It may have been completed, removed, or belongs to the team." });
    navigate({ search: "" }, { replace: true });
  }, [focusItem, loading, reduce, navigate]);

  const heroActions = (
    <div className="flex items-center gap-2">
      <QuickAddDialog userId={userId} onCreated={reload} />
      <Button variant="gold" onClick={() => navigate(paigeHref)}>
        <Sparkles className="mr-1.5 h-4 w-4" /> Plan with {assistant}
      </Button>
    </div>
  );

  const nothing = !loading && openAll.length === 0 && doneItems.length === 0;

  return (
    <PageShell width="wide">
      <PageHeader
        variant="hero"
        icon={CalendarClock}
        title="Planning"
        description={`Everything you and ${assistant} are tracking — reminders, tasks, milestones, and plans, in one place.`}
        actions={heroActions}
      />

      {forbidden ? (
        <SectionCard>
          <EmptyState icon={CalendarClock} title="Planning isn't available on this account"
            description="Reminders and tasks live with your team's workspace. If you think you should have access, reach out to your team." />
        </SectionCard>
      ) : (
        <>
          <StatRow cols={4}>
            <StatTile label="Overdue" value={overdueCount} intent={overdueCount > 0 ? "negative" : "neutral"} loading={loading} />
            <StatTile label="Due today" value={todayCount} loading={loading} />
            <StatTile label="Next 7 days" value={upcomingCount} loading={loading} />
            <StatTile label="Done" value={doneItems.length} intent={doneItems.length > 0 ? "positive" : "neutral"} loading={loading} />
          </StatRow>

          <Toolbar>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip active={scope === "mine"} onClick={() => setScope("mine")}>Assigned to me</FilterChip>
              {staff && <FilterChip active={scope === "by_me"} onClick={() => setScope("by_me")}>Assigned by me</FilterChip>}
              {staff && <FilterChip active={scope === "team"} onClick={() => setScope("team")}>Team</FilterChip>}
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              {TYPE_CHIPS.map((t) => (
                <FilterChip key={t.key} active={typeFilter === t.key} onClick={() => setTypeFilter(t.key)}>
                  <t.icon className="h-3 w-3" /> {t.label}
                </FilterChip>
              ))}
            </div>
          </Toolbar>

          {error && !forbidden && (
            <SectionCard><p className="text-sm text-destructive">{error}</p></SectionCard>
          )}

          {nothing ? (
            <SectionCard>
              <EmptyState
                icon={CalendarClock}
                tone="brand"
                title="Nothing on the board yet"
                description={`Add a reminder or a task, or ask ${assistant} to map out your week — it'll show up here.`}
                action={heroActions}
              />
            </SectionCard>
          ) : (
            <>
              {BUCKET_ORDER.map(({ key, label }) => {
                const rows = byBucket[key];
                if (rows.length === 0) return null;
                const shown = rows.slice(0, BUCKET_CAP);
                return (
                  <SectionCard
                    key={key}
                    title={label}
                    actions={key === "overdue"
                      ? <StatePill state="error">{rows.length} overdue</StatePill>
                      : <span className="text-xs text-muted-foreground">{rows.length}</span>}
                  >
                    <div className="space-y-2">
                      {shown.map((it) => <PlanItemRow key={it.id} item={it} onChanged={reload} />)}
                    </div>
                    {rows.length > shown.length && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        +{rows.length - shown.length} more — filter to narrow the list.
                      </p>
                    )}
                  </SectionCard>
                );
              })}

              {plans.map((p) => {
                const total = p.items.length;
                const done = p.items.filter((i) => i.status === "done").length;
                const openInPlan = p.items.filter((i) => !isClosed(i) && matchesType(i)).sort(byWhen);
                if (openInPlan.length === 0) return null;
                return (
                  <SectionCard
                    key={p.id}
                    icon={Map}
                    title={p.title}
                    description={p.summary || undefined}
                    actions={<span className="text-xs text-muted-foreground tabular-nums">{done}/{total} done</span>}
                  >
                    <div className="space-y-2">
                      {openInPlan.map((it) => <PlanItemRow key={it.id} item={it} onChanged={reload} />)}
                    </div>
                  </SectionCard>
                );
              })}

              {doneItems.length > 0 && (
                <SectionCard>
                  <button
                    type="button"
                    onClick={() => setShowDone((s) => !s)}
                    className="flex w-full items-center justify-between rounded text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={showDone}
                  >
                    <span>Done ({doneItems.length})</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", showDone && "rotate-180")} />
                  </button>
                  {showDone && (
                    <div className="mt-3 space-y-2">
                      {doneItems.slice(0, BUCKET_CAP).map((it) => <PlanItemRow key={it.id} item={it} onChanged={reload} />)}
                    </div>
                  )}
                </SectionCard>
              )}
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
