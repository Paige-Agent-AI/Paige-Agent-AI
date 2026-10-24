import { useContext, useLayoutEffect, useRef } from "react";
import { UNSAFE_NavigationContext, useLocation } from "react-router-dom";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";

/** A mounted form's exit guard around the incumbent router, never route/identity authority. */
export function useClientAccountExit(active: boolean, busy: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const intent = useRef({ active, busy });
  intent.current = { active, busy };

  useLayoutEffect(() => {
    let live = true;
    const allow = () => !live || !intent.current.active || (!intent.current.busy && window.confirm(
      "Leave this page and discard unsaved edits? An unconfirmed save may still have reached your business.",
    ));
    const originalPush = navigator.push;
    const guardedPush: typeof originalPush = (...args) => {
      if (allow()) originalPush.apply(navigator, args);
    };
    navigator.push = guardedPush;
    // Forced Auth/privacy replacements remain unblocked. They retire the draft.
    const removeSwitchGuard = registerAccountSwitchGuard(() => allow());

    const openedUrl = window.location.href;
    const openedState = window.history.state;
    let restoring: { returnDelta: number } | null = null;
    let approvedPop = false;
    const pop = (event: PopStateEvent) => {
      if (!live) return;
      if (approvedPop) { approvedPop = false; return; }
      if (restoring) {
        event.stopImmediatePropagation();
        const pending = restoring; restoring = null;
        if (allow()) { approvedPop = true; window.history.go(pending.returnDelta); }
        return;
      }
      if (!intent.current.active) return;
      const delta = typeof openedState?.idx === "number" && typeof event.state?.idx === "number"
        ? openedState.idx - event.state.idx : 0;
      if (delta) {
        // Restore the real entry before asking; the Router never sees a rejected traversal.
        event.stopImmediatePropagation(); restoring = { returnDelta: -delta }; window.history.go(delta);
      } else if (!allow()) {
        // Same-document histories without Router indices retain the real captured state.
        event.stopImmediatePropagation(); window.history.pushState(openedState, "", openedUrl);
      }
    };
    const realBrowserEntry = window.location.pathname + window.location.search === location.pathname + location.search;
    if (realBrowserEntry) window.addEventListener("popstate", pop, true);
    return () => {
      live = false; restoring = null;
      if (navigator.push === guardedPush) navigator.push = originalPush;
      removeSwitchGuard(); window.removeEventListener("popstate", pop, true);
    };
  }, [navigator, location.key, location.pathname, location.search]);
}
