// src/components/legal/RequiredConsentsGate.tsx
// Mounted in AppShell. Checks the signed-in user's outstanding required
// consents and renders the blocking modal when any exist.

import { useEffect } from "react";
import { useOutstandingConsents } from "@/lib/legal/useLegalDocuments";
import { RequiredConsentsModal } from "./RequiredConsentsModal";

export function RequiredConsentsGate({ userId, onBlockingChange }: {
  userId: string | undefined;
  /** True while the wall is up or still being checked, so the shell opens no second dialog over it (D-QA2). */
  onBlockingChange?: (blocking: boolean) => void;
}) {
  const { outstanding, refresh, loading } = useOutstandingConsents(userId);

  // Refresh once on mount in case docs were bumped since last login.
  useEffect(() => { void refresh(); }, [refresh]);

  const blocking = !!userId && (loading || outstanding.length > 0);
  useEffect(() => { onBlockingChange?.(blocking); }, [blocking, onBlockingChange]);

  if (!userId || loading || outstanding.length === 0) return null;

  return (
    <RequiredConsentsModal
      userId={userId}
      outstanding={outstanding}
      onAccepted={() => { void refresh(); }}
    />
  );
}
