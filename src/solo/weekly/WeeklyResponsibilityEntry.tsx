import { useId, useRef, useState, type MouseEvent } from "react";
import { useLocation, Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { useWeeklyOwnerAudience, useWeeklyResponsibility } from "./useWeeklyResponsibility";
import { WeeklyResponsibilityPanel } from "./WeeklyResponsibilityPanel";
import { WEEKDAYS, weeklyInstantLabel, weeklyStateLabel } from "./weekly-responsibility";
import type { WeeklyFutureControl, WeeklyOwnerRead } from "./weekly-owner-read";
import { WeeklyDraftComposer } from "./WeeklyDraftComposer";

/** Same owner review entry in PAIGE and Calendar; conversational tools stay unadmitted. */
export function WeeklyResponsibilityEntry({ hideEmpty = false, showOutcome = false }: { hideEmpty?: boolean; showOutcome?: boolean }) {
  const audience = useWeeklyOwnerAudience();
  if (!audience.eligible) return null;
  return <ScopedEntry key={audience.key} hideEmpty={hideEmpty} showOutcome={showOutcome} />;
}
/** Original receipt projection only; a latest attempt never becomes proof of completion. */
function entryOutcome(read: WeeklyOwnerRead): { text: string; title: string } | null {
  if (read.status !== "ready") return {
    text: read.status === "loading" ? "Checking weekly status…" : read.status === "refused" ? "Owner access needed" : "Status unverified",
    title: "Open the original weekly inspection to check current access and status.",
  };
  const { checks, has_more: more, business_time_zone: businessZone, read_at: readAt } = read.snapshot;
  if (!checks.length && !more) return null;
  const zone = businessZone.state === "configured" ? businessZone.zone : null;
  const verified = checks.flatMap(check => check.last_verified_run ? [check.last_verified_run] : [])
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
  const needsReview = checks.some(check => check.last_run?.status === "unknown" || check.last_run?.status === "failed");
  const earlierVerified = checks.some(check => (check.last_run?.status === "unknown" || check.last_run?.status === "failed")
    && check.last_verified_run && Date.parse(check.last_verified_run.scheduled_for) < Date.parse(check.last_run.scheduled_for));
  const text = needsReview ? `Needs review${earlierVerified ? " · Earlier result verified" : ""}`
    : verified ? "Verified result available" : "No verified result";
  return {
    text: `${more ? "Shown checks · " : ""}${text}`,
    title: [verified ? `Last verified: ${weeklyInstantLabel(verified.observed_at, zone)}.` : "No receipt-verified result in the checks shown.",
      `Status read: ${weeklyInstantLabel(readAt, zone)}.`, !zone ? "Business time zone is not configured; times shown in UTC." : "",
      more ? "Other responsibilities may not be shown." : ""].filter(Boolean).join(" "),
  };
}
function ScopedEntry({ hideEmpty, showOutcome }: { hideEmpty: boolean; showOutcome: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
  const opener = useRef<HTMLButtonElement | null>(null);
  const outcomeId = useId();
  const location = useLocation();
  const { read, refresh, control, controlBusy } = useWeeklyResponsibility(open || hideEmpty || showOutcome);
  const snapshot = read.status === "ready" ? read.snapshot : null;
  const outcome = showOutcome ? entryOutcome(read) : null;
  // First-run onboarding owns its conversation; no weekly prompt without a verified existing responsibility.
  if (hideEmpty && (!snapshot || snapshot.checks.length === 0)) return null;
  return <div className="e5-weekly-chat-entry" data-weekly-outcome={showOutcome || undefined}>
    <button ref={opener} type="button" className="e5-weekly-open" aria-label="Weekly responsibility" aria-describedby={outcome ? outcomeId : undefined} title="Weekly responsibility" onClick={event => { setTheme(event.currentTarget.closest("[data-pg]")?.getAttribute("data-pg") ?? "dark"); if (showOutcome) void refresh(); setOpen(true); }}><CalendarDays size={15} aria-hidden /><span className="e5-weekly-open-label">Weekly responsibility</span></button>
    {outcome && <span id={outcomeId} className="e5-weekly-entry-outcome" data-weekly-entry-outcome role="status" title={outcome.title}>{outcome.text}</span>}
    <WeeklyResponsibilityDialog open={open} onOpenChange={setOpen} theme={theme} read={read} refresh={refresh} control={control} controlBusy={controlBusy} pathname={location.pathname} onReturnFocus={() => opener.current?.focus()} />
  </div>;
}
export function WeeklyCalendarSummary({ read, refresh, pathname, onInspect }: {
  read: WeeklyOwnerRead; refresh: () => void; pathname: string; onInspect: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const snapshot = read.status === "ready" ? read.snapshot : null;
  const zone = snapshot?.business_time_zone.state === "configured" ? snapshot.business_time_zone.zone : null;
  const root = tenantRoutePrefixForPath(pathname);
  return <div className="e5-weekly-calendar-entry">
    <button type="button" className="e5-weekly-open" onClick={onInspect}><CalendarDays size={15} aria-hidden />Weekly responsibility</button>
      {read.status === "loading" && <p role="status">Reading weekly schedules…</p>}
      {read.status === "unavailable" && <p>Weekly status unavailable. <button type="button" onClick={refresh}>Retry</button></p>}
      {read.status === "refused" && <p>Weekly schedules require current owner access.</p>}
      {snapshot && (snapshot.checks.length ? <ul>{snapshot.checks.map(check => <li key={check.automation_id}><button type="button" onClick={onInspect}>
        <strong>{check.name}</strong><span>{weeklyStateLabel(check.schedule_status === "scheduled" && check.execution_availability === "held" ? "held" : check.schedule_status)}</span>
        <span>Every {WEEKDAYS[check.schedule.weekday - 1]} at {check.schedule.local_time} · {check.schedule.timezone}</span>
        <span>{check.next_run_at ? `Next: ${weeklyInstantLabel(check.next_run_at, zone)}` : "No executable next run"}</span>
        {check.last_run?.status === "unknown" && <span>Latest attempt needs attention</span>}
        <span>{check.last_verified_run ? `Last verified: ${weeklyInstantLabel(check.last_verified_run.observed_at, zone)}` : "No verified result"}</span>
      </button></li>)}</ul> : <p>No weekly responsibility is registered.</p>)}
      {root && <Link to={`${root}/paige/chat`}>Review with PAIGE</Link>}
  </div>;
}
export function WeeklyResponsibilityDialog({ open, onOpenChange, theme, read, refresh, pathname, onReturnFocus, control, controlBusy }: {
  open: boolean; onOpenChange: (open: boolean) => void; theme: string; read: WeeklyOwnerRead;
  refresh: () => void; pathname: string; onReturnFocus?: () => void;
  control?: WeeklyFutureControl; controlBusy?: boolean;
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="e5-weekly-sheet paige-solo" data-pg={theme} data-theme={theme}
    onEscapeKeyDown={event => {
      // Radix handles Escape in capture before the inner review's React handler.
      // Let that review dismiss itself without also closing its owning sheet.
      if (event.target instanceof Element && event.target.closest('.e5-weekly-panel [aria-label="Review future checks"]')) event.preventDefault();
    }}
    onCloseAutoFocus={event => { if (onReturnFocus) { event.preventDefault(); onReturnFocus(); } }}>
      <SheetHeader><SheetTitle>Weekly responsibility</SheetTitle><SheetDescription>Current owner scope, canonical schedules and verified results.</SheetDescription></SheetHeader>
      <WeeklyResponsibilityPanel read={read} refresh={refresh} control={control} controlBusy={controlBusy} pathname={pathname} draftComposer={open ? <WeeklyDraftComposer
        businessZone={read.status === "ready" && read.snapshot.business_time_zone.state === "configured" ? read.snapshot.business_time_zone.zone : null}
        onSaved={refresh} /> : undefined} />
    </SheetContent></Sheet>;
}
