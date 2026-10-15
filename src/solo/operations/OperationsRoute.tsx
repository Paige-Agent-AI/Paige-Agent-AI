import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { OperationsWorkspace } from "./OperationsWorkspace";

/** Mounted only by the canonical Solo route after shared navigation integration. */
export function OperationsRoute({ openPaige }: { openPaige: () => void }) {
  const [view, setView] = useSubtabRoute("solo", "operations", "overview");
  const location = useLocation();
  const navigate = useNavigate();
  const guard = useRef<(() => string | null) | null>(null);
  const accepted = useRef(location);
  const [current, setCurrent] = useState({ view, search: location.search, key: location.key });
  const registerGuard = useCallback((next: (() => string | null) | null) => { guard.current = next; }, []);
  // BrowserRouter has no data-router blocker. Keep the existing detail selection
  // through subtab/query Back transitions instead of replacing an unsaved draft.
  useLayoutEffect(() => {
    if (location.key === accepted.current.key && view === current.view) return;
    if (guard.current?.()) {
      const prior = accepted.current;
      if (location.pathname === prior.pathname && location.search === prior.search && location.hash === prior.hash) {
        accepted.current = location; return;
      }
      navigate(`${prior.pathname}${prior.search}${prior.hash}`, { replace: true });
      return;
    }
    accepted.current = location;
    setCurrent({ view, search: location.search, key: location.key });
  }, [location, view, current.view, navigate]);
  return <OperationsWorkspace openPaige={openPaige} view={current.view}
    weeklySourceSearch={current.search} weeklySourceKey={current.key} onNavigationGuardChange={registerGuard}
    onViewChange={next => { if (!guard.current?.()) setView(next); }}
    onWeeklySourceDismiss={() => {
      const query = new URLSearchParams(location.search); query.delete("weeklySource"); query.delete("item");
      navigate({ pathname: location.pathname, search: query.toString() ? `?${query}` : "", hash: location.hash }, { replace: true });
    }} />;
}
