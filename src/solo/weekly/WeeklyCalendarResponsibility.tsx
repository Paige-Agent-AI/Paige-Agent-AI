import { useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { WeeklyCalendarSummary, WeeklyResponsibilityDialog } from "./WeeklyResponsibilityEntry";
import { useWeeklyOwnerAudience, useWeeklyResponsibility } from "./useWeeklyResponsibility";

export type WeeklyCalendarSlot = (controls: { closeViewOptions: () => void; returnFocus: () => void }) => ReactNode;
/** One browser read/dialog lifetime outside both responsive Calendar rail placements. No booking or execution authority. */
export function WeeklyCalendarResponsibility({ children }: { children: (slot: WeeklyCalendarSlot) => ReactNode }) {
  const audience = useWeeklyOwnerAudience();
  if (!audience.eligible) return children(() => null);
  return <ScopedCalendar key={audience.key}>{children}</ScopedCalendar>;
}
function ScopedCalendar({ children }: { children: (slot: WeeklyCalendarSlot) => ReactNode }) {
  const location = useLocation();
  const { read, refresh } = useWeeklyResponsibility();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
  const returnFocus = useRef<() => void>(() => {});
  const slot: WeeklyCalendarSlot = controls => <WeeklyCalendarSummary read={read} refresh={() => void refresh()} pathname={location.pathname}
    onInspect={event => {
      const opener = event.currentTarget;
      setTheme(opener.closest("[data-pg]")?.getAttribute("data-pg") ?? "dark");
      returnFocus.current = () => { if (opener.isConnected) opener.focus(); else controls.returnFocus(); };
      // The outer Calendar drawer releases its keyboard trap before the one weekly dialog opens.
      controls.closeViewOptions();
      setOpen(true);
    }} />;
  return <>{children(slot)}<WeeklyResponsibilityDialog open={open} onOpenChange={setOpen} theme={theme} read={read}
    refresh={() => void refresh()} pathname={location.pathname} onReturnFocus={() => returnFocus.current()} /></>;
}
