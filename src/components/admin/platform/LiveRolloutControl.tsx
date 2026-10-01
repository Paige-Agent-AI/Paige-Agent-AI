/**
 * Live rollout control — the operator can SEE the Live rollout and TURN it, from the product.
 *
 * WHY THIS EXISTS (§70/§10). Migration 20270422000000 reduced "who may speak today" to one setting
 * and gave `paige-voice-profile-admin` an action to change it. Neither had a surface: grepping
 * `src/` for `authorize-live-pilot`, `disable-live-pilot` or `paige-voice-profile-admin` returned
 * nothing. So the only way to open Live was a hand-written authenticated HTTP request — a setting
 * only an engineer can change is not a setting the owner has, and a capability reachable solely
 * from a terminal is the dead end §10 forbids.
 *
 * §9/§53 — operator-only on BOTH layers. This renders behind `isPlatformOwner` and every call it
 * makes is refused server-side for anyone else: `paige_live_rollout_status()` RAISES 42501 in its
 * body, and the edge function checks `is_platform_owner` before it will touch the writer.
 *
 * §13 — it states what is unresolved as prominently as what is on. Verified zero retention is
 * UNAVAILABLE and physical speaker identity is unenforced (#1417); an operator should not be able
 * to open this believing either is settled, so both are shown next to the switch rather than in a
 * document somewhere. It reports only counts — never who is admitted.
 */
import { useCallback, useEffect, useState } from "react";
import { AudioLines, RefreshCw, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SectionCard, StatePill } from "@/components/ui/page";

/** Mirrors the paige_live_rollout_status() payload (migration 20270423000000). */
interface RolloutStatus {
  readiness_present: boolean;
  pilot_enabled?: boolean;
  rollout_scope?: string;
  authorized_at?: string | null;
  retention_state?: string | null;
  zero_retention_state?: string | null;
  speaker_identity_enforced?: boolean;
  admitted_subjects?: number;
  workspaces_enabled_outright?: number;
  workspaces_switched_off?: number;
  solo_class_tenants?: number;
}

export default function LiveRolloutControl() {
  const [status, setStatus] = useState<RolloutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new RPC, not yet in generated types
    const { data, error: err } = await supabase.rpc("paige_live_rollout_status" as any);
    if (err) {
      // Say what happened. A control panel that silently shows nothing is worse than one that
      // admits it could not read (§13/§32).
      setError("Could not read the Live rollout state. Nothing was changed.");
      setStatus(null);
      return;
    }
    setStatus((data ?? { readiness_present: false }) as RolloutStatus);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setScope = async (scope: "off" | "solo_tier") => {
    setBusy(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) { setError("Your session expired. Sign in again."); return; }
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-voice-profile-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(scope === "off"
          ? { action: "set-live-rollout-scope", scope }
          // Widening restates the acceptance in the same request that widens it, because extending
          // it to people who are not the operator is a decision, not a toggle.
          : { action: "set-live-rollout-scope", scope, accept_default_provider_retention_for_scope: true }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { code?: string };
        setError(payload.code === "scope_retention_acceptance_required"
          ? "Opening Live needs the retention acceptance restated. Nothing was changed."
          : "The rollout scope was not changed.");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const open = status?.rollout_scope === "solo_tier";
  const envelopeOpen = status?.pilot_enabled === true;

  return (
    <SectionCard
      title="Live Conversation rollout"
      description="Who may speak with Paige today. This is one setting; it names no person, login or workspace."
      icon={AudioLines}
      actions={<Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden />Refresh</Button>}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {status && !status.readiness_present && (
        <p className="text-sm text-muted-foreground">
          No voice readiness record exists yet, so there is nothing to open. This is the honest state, not an error.
        </p>
      )}

      {status?.readiness_present && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatePill state={envelopeOpen ? "on" : "off"}>{envelopeOpen ? "Pilot envelope open" : "Pilot envelope shut"}</StatePill>
            <StatePill state={open ? "on" : "off"}>{open ? "Open to every Solo account" : "Open to nobody"}</StatePill>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Accounts admitted today</dt><dd className="tabular-nums font-medium">{status.admitted_subjects ?? 0}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Solo accounts the scope reaches</dt><dd className="tabular-nums font-medium">{status.solo_class_tenants ?? 0}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Workspaces switched on outright</dt><dd className="tabular-nums font-medium">{status.workspaces_enabled_outright ?? 0}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Workspaces switched off</dt><dd className="tabular-nums font-medium">{status.workspaces_switched_off ?? 0}</dd></div>
          </dl>

          {/* Stated next to the switch, not filed somewhere. Opening this extends an acceptance of
              the provider's DEFAULT audio retention to people who are not the operator. */}
          <div className="flex gap-2.5 rounded-lg border border-border bg-muted/50 p-3">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="grid gap-1 text-sm text-muted-foreground">
              <p>Two things are not settled, and opening this does not settle them.</p>
              <p><strong className="text-foreground">Retention:</strong> audio goes to the provider under their default retention. Verified zero retention is <strong className="text-foreground">{status.zero_retention_state ?? "UNAVAILABLE"}</strong>.</p>
              <p><strong className="text-foreground">Speaker identity:</strong> {status.speaker_identity_enforced ? "enforced" : "not enforced — the microphone is treated as one speaker, so anyone else in the room is heard as the account holder"}.</p>
            </div>
          </div>

          {!envelopeOpen && (
            <p className="text-sm text-muted-foreground">
              The pilot envelope is shut, so nobody can speak whatever this setting says. Opening it is a separate,
              evidence-backed action that contacts the speech provider — it is not exposed here.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {open
              ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void setScope("off")}>Close it to everyone</Button>
              : <Button variant="gold" size="sm" disabled={busy} onClick={() => void setScope("solo_tier")}>Open Live to every Solo account</Button>}
          </div>
          <p className="text-xs text-muted-foreground">
            Closing withdraws only the accounts this setting was carrying; a workspace switched on outright keeps its access.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
