import { useEffect } from "react";

let activeUnsavedWorkGuards = 0;

/** Read-only registry check used by explicit update reloads; it has no unload side effects. */
export function hasUnsavedWork(): boolean {
  return activeUnsavedWorkGuards > 0;
}

/** Register recoverable in-memory work with both native navigation and explicit update reloads. */
export function useBeforeUnloadGuard(active: boolean, explicitExit?: { readonly current: boolean }) {
  useEffect(() => {
    if (!active) return;
    activeUnsavedWorkGuards += 1;
    const prevent = (event: BeforeUnloadEvent | Event) => {
      // A visible leave decision applies only to this editor. Other registered
      // work retains its own independent warning and update-reload protection.
      if (explicitExit?.current) return;
      event.preventDefault();
      if ("returnValue" in event) event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => {
      activeUnsavedWorkGuards = Math.max(0, activeUnsavedWorkGuards - 1);
      window.removeEventListener("beforeunload", prevent);
    };
  }, [active, explicitExit]);
}
