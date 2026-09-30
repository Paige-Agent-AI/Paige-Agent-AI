import { useEffect, useRef, useState, useCallback } from "react";
import { performSignOut } from "@/lib/auth/signOut";

const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const WARNING_BEFORE = 2 * 60 * 1000; // Show warning 2 min before

export const useSessionTimeout = () => {
  const [showWarning, setShowWarning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const warningRef = useRef<ReturnType<typeof setTimeout>>();

  const resetTimers = useCallback(() => {
    setShowWarning(false);
    clearTimeout(timeoutRef.current);
    clearTimeout(warningRef.current);

    warningRef.current = setTimeout(() => {
      setShowWarning(true);
    }, IDLE_TIMEOUT - WARNING_BEFORE);

    timeoutRef.current = setTimeout(async () => {
      // A security sign-out: end an open act-as if possible, but never hold the sign-out for it.
      await performSignOut({ redirectTo: "/auth", actAs: "attempt" });
    }, IDLE_TIMEOUT);
  }, []);

  const staySignedIn = useCallback(() => {
    resetTimers();
  }, [resetTimers]);

  useEffect(() => {
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    const handler = () => {
      if (!showWarning) resetTimers();
    };

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetTimers();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearTimeout(timeoutRef.current);
      clearTimeout(warningRef.current);
    };
  }, [resetTimers, showWarning]);

  return { showWarning, staySignedIn };
};
