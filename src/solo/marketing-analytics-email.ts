// Marketing › Analytics' email row: the sent, opened and clicked counts for the chosen range, from the
// same read the Email tab uses (read_email_marketing_dashboard, owners and admins of the caller's own
// business). A member is told the figures are for owners and admins rather than shown a failure.
import React from "react";
import { supabase } from "@/integrations/supabase/client";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

export type EmailStats = { sent: number; tracked: number; opened: number; clicked: number };
export type EmailRead = { phase: "loading" | "ready" | "error" | "denied"; stats: EmailStats | null; retry: () => void };

/** The email row's own read. Owners and admins only; anyone else is told so rather than shown a failure. */
export function useEmailStats(tenantId: string | null, days: number): EmailRead {
  const [state, setState] = React.useState<{ key: string; phase: EmailRead["phase"]; stats: EmailStats | null }>({ key: "", phase: "loading", stats: null });
  const [attempt, setAttempt] = React.useState(0);
  const key = `${tenantId}:${days}`;
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState({ key, phase: "loading", stats: null });
    rpc("read_email_marketing_dashboard", { p_days: days, p_tz: zone() }).then(({ data, error }) => {
      if (!live) return;
      if (error) {
        const denied = error.code === "42501" && /not_permitted/.test(error.message ?? "");
        if (!denied) console.error("[marketing-analytics] email read failed", error);
        setState({ key, phase: denied ? "denied" : "error", stats: null });
        return;
      }
      const stats = (data as { stats?: Partial<EmailStats> } | null)?.stats;
      setState({ key, phase: "ready", stats: { sent: stats?.sent ?? 0, tracked: stats?.tracked ?? 0, opened: stats?.opened ?? 0, clicked: stats?.clicked ?? 0 } });
    }, (error) => {
      // A rejected request (offline, aborted) is a failed read, never a read stuck loading.
      console.error("[marketing-analytics] email read failed", error);
      if (live) setState({ key, phase: "error", stats: null });
    });
    return () => { live = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = state.key === key;
  return { phase: current ? state.phase : "loading", stats: current ? state.stats : null, retry: () => setAttempt((n) => n + 1) };
}
