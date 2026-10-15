import { useRef, useState, type MouseEvent } from "react";
import { useLocation, Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { useWeeklyOwnerAudience, useWeeklyResponsibility } from "./useWeeklyResponsibility";
import { WeeklyResponsibilityPanel } from "./WeeklyResponsibilityPanel";
import { WEEKDAYS, weeklyInstantLabel, weeklyStateLabel } from "./weekly-responsibility";
import type { WeeklyOwnerRead } from "./weekly-owner-read";
import { WeeklyDraftComposer } from "./WeeklyDraftComposer";

/** Same owner review entry in PAIGE and Calendar; conversational tools stay unadmitted. */
export function WeeklyResponsibilityEntry({ hideEmpty = false }: { hideEmpty?: boolean }) {
  const audience = useWeeklyOwnerAudience();
  if (!audience.eligible) return null;
  return <ScopedEntry key={audience.key} hideEmpty={hideEmpty} />;
}
function ScopedEntry({ hideEmpty }: { hideEmpty: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
  const opener = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();
  const { read, refresh } = useWeeklyResponsibility(open || hideEmpty);
  const snapshot = read.status === "ready" ? read.snapshot : null;
  // First-run onboarding owns its conversation; no weekly prompt without a verified existing responsibility.
  if (hideEmpty && (!snapshot || snapshot.checks.length === 0)) return null;
  return <div className="e5-weekly-chat-entry">
    <button ref={opener} type="button" className="e5-weekly-open" aria-label="Weekly responsibility" title="Weekly responsibility" onClick={event => { setTheme(event.currentTarget.closest("[data-pg]")?.getAttribute("data-pg") ?? "dark"); setOpen(true); }}><CalendarDays size={15} aria-hidden /><span className="e5-weekly-open-label">Weekly responsibility</span></button>
    <WeeklyResponsibilityDialog open={open} onOpenChange={setOpen} theme={theme} read={read} refresh={refresh} pathname={location.pathname} onReturnFocus={() => opener.current?.focus()} />
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
export function WeeklyResponsibilityDialog({ open, onOpenChange, theme, read, refresh, pathname, onReturnFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; theme: string; read: WeeklyOwnerRead;
  refresh: () => void; pathname: string; onReturnFocus?: () => void;
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="e5-weekly-sheet paige-solo" data-pg={theme} data-theme={theme}
    onCloseAutoFocus={event => { if (onReturnFocus) { event.preventDefault(); onReturnFocus(); } }}>
      <SheetHeader><SheetTitle>Weekly responsibility</SheetTitle><SheetDescription>Current owner scope, canonical schedules and verified results.</SheetDescription></SheetHeader>
      <WeeklyResponsibilityPanel read={read} refresh={refresh} pathname={pathname} draftComposer={open ? <WeeklyDraftComposer
        businessZone={read.status === "ready" && read.snapshot.business_time_zone.state === "configured" ? read.snapshot.business_time_zone.zone : null}
        onSaved={refresh} /> : undefined} />
    </SheetContent></Sheet>;
}
