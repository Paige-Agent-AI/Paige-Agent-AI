import { useEffect, useSyncExternalStore } from "react";

let activeUnsavedWorkGuards = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  listeners.forEach((listener) => listener());
}

const serverSnapshot = () => false;

/** Read-only registry check used by explicit update reloads; it has no unload side effects. */
export function hasUnsavedWork(): boolean {
  return activeUnsavedWorkGuards > 0;
}

/** Observe the same registry without adding another unload guard or work store. */
export function useHasUnsavedWork(): boolean {
  return useSyncExternalStore(subscribe, hasUnsavedWork, serverSnapshot);
}

/** Register recoverable in-memory work with both native navigation and explicit update reloads. */
export function useBeforeUnloadGuard(active: boolean, explicitExit?: { readonly current: boolean }) {
  useEffect(() => {
    if (!active) return;
    activeUnsavedWorkGuards += 1;
    notify();
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
      notify();
      window.removeEventListener("beforeunload", prevent);
    };
  }, [active, explicitExit]);
}
