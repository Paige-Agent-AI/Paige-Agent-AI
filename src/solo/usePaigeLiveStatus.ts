import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** The caller's own current Live acknowledgement state, from the canonical row
 * (paige_live_terms_status — one home, dates only). This is PRESENTATION truth
 * for the capability row: "acknowledged" means the person turned Live on for
 * this account, never that audio was verified (that proof lives elsewhere). */
export type PaigeLiveStatusState = "loading" | "unauthenticated" | "not_acknowledged" | "acknowledged" | "revoked" | "expired" | "unknown";

export type PaigeLiveStatus = { state: PaigeLiveStatusState; revokedAt?: string; expiresAt?: string };

export function usePaigeLiveStatus(): PaigeLiveStatus {
  const [status, setStatus] = useState<PaigeLiveStatus>({ state: "loading" });
  useEffect(() => {
    let current = true;
    setStatus({ state: "loading" });
    void (async () => {
      try {
        const rpc = supabase.rpc as unknown as (name: string) => Promise<{ data: unknown; error: unknown }>;
        const read = await rpc("paige_live_terms_status");
        if (!current) return;
        const row = read.data as { state?: string; revokedAt?: string; expiresAt?: string } | null;
        if (read.error || !row || !["unauthenticated", "not_acknowledged", "acknowledged", "revoked", "expired"].includes(String(row.state))) {
          setStatus({ state: "unknown" });
          return;
        }
        setStatus({ state: row.state as PaigeLiveStatusState, revokedAt: row.revokedAt, expiresAt: row.expiresAt });
      } catch {
        if (current) setStatus({ state: "unknown" });
      }
    })();
    return () => { current = false; };
  }, []);
  return status;
}
