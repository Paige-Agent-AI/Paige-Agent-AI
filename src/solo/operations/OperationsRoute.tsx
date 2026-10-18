import { useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { UNSAFE_NavigationContext, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { OperationsWorkspace } from "./OperationsWorkspace";

/** Mounted only by the canonical Solo route after shared navigation integration. */
export function OperationsRoute({ openPaige }: { openPaige: () => void }) {
  const [view, setView] = useSubtabRoute("solo", "operations", "overview");
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  // Preserve the accepted history position (E05), never replace a popped entry.
  const memoryIndex = "index" in navigator ? navigator.index : null;
  const rawIndex = typeof memoryIndex === "number" ? memoryIndex : window.history.state?.idx;
  const index = typeof rawIndex === "number" && Number.isSafeInteger(rawIndex) ? rawIndex : null;
  const guard = useRef<(() => string | null) | null>(null);
  const accepted = useRef(location);
  const acceptedIndex = useRef(index);
  const restoring = useRef<string | null>(null);
  const [current, setCurrent] = useState({ view, search: location.search, key: location.key });
  const [historyNotice,setHistoryNotice]=useState("");
  const registerGuard = useCallback((next: (() => string | null) | null) => { guard.current = next; }, []);
  // BrowserRouter has no data-router blocker. Keep the existing detail selection
  // through subtab/query Back transitions instead of replacing an unsaved draft.
  useLayoutEffect(() => {
    if (location.key === accepted.current.key && view === current.view) return;
    if (guard.current?.()) {
      const prior = accepted.current;
      if (location.pathname === prior.pathname && location.search === prior.search && location.hash === prior.hash) {
        accepted.current = location; acceptedIndex.current = index; restoring.current = null; return;
      }
      if (restoring.current === location.key) return;
      restoring.current = location.key;
      if (index !== null && acceptedIndex.current !== null && index !== acceptedIndex.current) {
        navigate(acceptedIndex.current - index);
      } else if (navigationType === "REPLACE") {
        navigate(`${prior.pathname}${prior.search}${prior.hash}`, { replace: true });
      } else {
        // An unindexed POP has no safe direction to infer. Keep the draft and
        // make the unaccepted address explicit rather than destroy history.
        setHistoryNotice("The address changed, but this open inspection was retained because its history position could not be verified. Explicitly close it, then open the intended destination again.");
      }
      return;
    }
    accepted.current = location; acceptedIndex.current = index; restoring.current = null;
    setHistoryNotice("");
    setCurrent({ view, search: location.search, key: location.key });
  }, [location, view, current.view, navigate, index, navigationType]);
  return <>{historyNotice&&<p className="ops-inline-notice" role="status">{historyNotice}</p>}<OperationsWorkspace openPaige={openPaige} view={current.view}
    weeklySourceSearch={current.search} weeklySourceKey={current.key} onNavigationGuardChange={registerGuard}
    onViewChange={next => { if (!guard.current?.()) setView(next); }}
    onWeeklySourceDismiss={() => {
      if (guard.current?.()) return;
      const query = new URLSearchParams(location.search); query.delete("weeklySource"); query.delete("item");
      navigate({ pathname: location.pathname, search: query.toString() ? `?${query}` : "", hash: location.hash }, { replace: true });
    }}
    onTaskFocusDismiss={() => {
      const prior = accepted.current;
      const query = new URLSearchParams(prior.search); query.delete("task");
      navigate({ pathname: prior.pathname, search: query.toString() ? `?${query}` : "", hash: prior.hash }, { replace: true });
    }} /></>;
}
