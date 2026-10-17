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
  // The incumbent router's history index is navigation bookkeeping, never authority.
  // MemoryHistory exposes index; BrowserHistory stores the same index in state.idx.
  const memoryIndex = "index" in navigator ? navigator.index : null;
  const browserIndex = typeof window !== "undefined" ? window.history.state?.idx : null;
  const rawIndex = typeof memoryIndex === "number" ? memoryIndex : browserIndex;
  const index = typeof rawIndex === "number" && Number.isSafeInteger(rawIndex) ? rawIndex : null;
  const guard = useRef<(() => string | null) | null>(null);
  const accepted = useRef(location);
  const acceptedIndex = useRef(index);
  const restoring = useRef<string | null>(null);
  const [current, setCurrent] = useState({ view, search: location.search, key: location.key });
  const registerGuard = useCallback((next: (() => string | null) | null) => { guard.current = next; }, []);
  // Return to the accepted history position without replacing the popped destination.
  // The existing editor guard keeps detail selection while that return is pending.
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
        // Restore an overwritten current entry only; never overwrite a POP destination.
        navigate(`${prior.pathname}${prior.search}${prior.hash}`, { replace: true });
      }
      // Without a trustworthy index, preserve the guarded detail and history rather
      // than guessing a direction or destroying an entry. The guard displays its reason.
      return;
    }
    accepted.current = location; acceptedIndex.current = index; restoring.current = null;
    setCurrent({ view, search: location.search, key: location.key });
  }, [location, view, current.view, navigate, index, navigationType]);
  return <OperationsWorkspace openPaige={openPaige} view={current.view}
    weeklySourceSearch={current.search} weeklySourceKey={current.key} onNavigationGuardChange={registerGuard}
    onViewChange={next => { if (!guard.current?.()) setView(next); }}
    onWeeklySourceDismiss={() => {
      if (guard.current?.()) return;
      const query = new URLSearchParams(location.search); query.delete("weeklySource"); query.delete("item");
      navigate({ pathname: location.pathname, search: query.toString() ? `?${query}` : "", hash: location.hash }, { replace: true });
    }} />;
}
