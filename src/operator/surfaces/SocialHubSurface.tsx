import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The Platform Operator (God Level) Social hub surface: lists the channels the platform's
 * Zernio hub already holds (provider readback only) and adopts the chosen ones into the
 * designated workspace through ONE governed social_connection_adopt approval — the same
 * governed door every Social mutation uses. The door resolves the designated workspace
 * server-side for the platform owner; nothing tenant-shaped is taken from this client.
 */
type HubChannel = {
  platform: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  adoptable: boolean;
};
type HubProfile = { profileId: string; name: string | null; channels: HubChannel[] };

function platformLabel(value: string) {
  return value.split("_").map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part)).join(" ");
}

function payloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export default function SocialHubSurface() {
  const [hubs, setHubs] = useState<HubProfile[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ summary: string; request: Record<string, unknown>; fingerprint: string } | null>(null);

  const invoke = useCallback(async (request: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await supabase.functions.invoke("paige-social", { body: request });
    setBusy(false);
    const payload = payloadObject(result.data);
    if (!payload) { setError("The Social platform could not be reached. Try again."); return null; }
    if (payload.state === "approval_required") {
      const approval = payloadObject(payload.approval);
      if (!approval || typeof approval.fingerprint !== "string" || typeof approval.summary !== "string") {
        setError("The approval card was malformed. Nothing was changed."); return null;
      }
      setPending({ summary: approval.summary, request, fingerprint: approval.fingerprint });
      return payload;
    }
    if (payload.ok !== true) {
      setError(payload.code === "capability_unavailable"
        ? "Social is not switched on for the platform yet — the provider key is not visible to the server."
        : "The request was refused. Nothing was changed.");
      return payload;
    }
    setPending(null);
    setNotice(payload.state === "adopted"
      ? "Channels adopted into the platform workspace. Nothing was published."
      : "The Social platform responded.");
    return payload;
  }, []);

  const load = useCallback(async () => {
    const payload = await invoke({ action: "hub_profiles" });
    const rows = payload && Array.isArray((payload as { hubs?: unknown }).hubs)
      ? (payload as { hubs: unknown[] }).hubs
      : null;
    if (!rows) { setError("Platform hub channels could not be read. Try again."); return; }
    const parsed: HubProfile[] = rows.flatMap((raw) => {
      const row = payloadObject(raw);
      if (!row || typeof row.profileId !== "string") return [];
      const channels = Array.isArray(row.channels)
        ? row.channels.flatMap((entry) => {
            const channel = payloadObject(entry);
            if (!channel || typeof channel.platform !== "string") return [];
            return [{
              platform: channel.platform,
              handle: typeof channel.handle === "string" ? channel.handle : null,
              displayName: typeof channel.displayName === "string" ? channel.displayName : null,
              status: typeof channel.status === "string" ? channel.status : "",
              adoptable: channel.adoptable === true,
            }];
          })
        : [];
      return [{ profileId: row.profileId, name: typeof row.name === "string" ? row.name : null, channels }];
    });
    setHubs(parsed);
    setChosen({});
  }, [invoke]);

  const adoptable = hubs?.flatMap((hub) => hub.channels.filter((c) => c.adoptable).map((c) => ({ profileId: hub.profileId, ...c }))) ?? [];
  const key = (profileId: string, platform: string) => profileId + ":" + platform;
  const selected = adoptable.filter((c) => chosen[key(c.profileId, c.platform)]);

  const approve = useCallback(() => {
    if (!pending) return;
    void invoke({ ...pending.request, approval_fingerprint: pending.fingerprint });
  }, [invoke, pending]);
  const decline = useCallback(() => { setPending(null); setNotice("Canceled. No Social change was made."); }, []);

  return (
    <section aria-labelledby="op-social-hub" className="mb-6 flex-none border border-[var(--pg-line)] bg-[var(--pg-raised)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[length:var(--pg-t-label)] font-semibold uppercase tracking-[0.14em] text-[var(--pg-faint)]">Social hub</p>
          <h2 id="op-social-hub" className="mt-1 text-[length:var(--pg-t-h3)] font-semibold text-[var(--pg-ink)]">
            Channels connected in the platform hub
          </h2>
          <p className="mt-1 max-w-[68ch] text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">
            Bring the platform&rsquo;s already-connected channels into the designated platform workspace with one governed approval. Each becomes its own labeled platform connection. Nothing is published.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="min-h-[30px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3.5 text-[length:var(--pg-t-body)] text-[var(--pg-ink)] disabled:opacity-50"
        >
          {hubs ? "Check again" : "Find hub channels"}
        </button>
      </div>

      {error && <p role="alert" className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-warning)]">{error}</p>}
      {notice && <p role="status" className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">{notice}</p>}
      {hubs && adoptable.length === 0 && !error && (
        <p className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">No adoptable hub channels were found in the provider readback.</p>
      )}

      {adoptable.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {adoptable.map((channel) => {
            const k = key(channel.profileId, channel.platform);
            return (
              <li key={k}>
                <label className="flex cursor-pointer items-center gap-2.5 text-[length:var(--pg-t-body)] text-[var(--pg-ink)]">
                  <input
                    type="checkbox"
                    checked={Boolean(chosen[k])}
                    onChange={(e) => setChosen((current) => ({ ...current, [k]: e.target.checked }))}
                    className="h-3.5 w-3.5 flex-none accent-[var(--pg-gold-core)]"
                  />
                  <span className="font-medium">{platformLabel(channel.platform)}</span>
                  <span className="text-[var(--pg-muted)]">{channel.handle ?? "Provider-verified account"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {selected.length > 0 && !pending && (
        <button
          type="button"
          onClick={() => void invoke({ action: "adopt", profileId: selected[0].profileId, platforms: selected.map((c) => c.platform) })}
          disabled={busy}
          className="mt-4 min-h-[32px] flex-none rounded-full bg-[var(--pg-gold-core)] px-4 text-[length:var(--pg-t-body)] font-semibold text-[var(--pg-ink)] disabled:opacity-50"
        >
          Confirm this Social change · Approve once
        </button>
      )}

      {pending && (
        <div role="status" className="mt-4 border-t border-[var(--pg-line-soft)] pt-3">
          <p className="text-[length:var(--pg-t-body)] text-[var(--pg-ink)]">{pending.summary}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={approve} disabled={busy} className="min-h-[30px] flex-none rounded-full bg-[var(--pg-gold-core)] px-3.5 text-[length:var(--pg-t-body)] font-semibold text-[var(--pg-ink)] disabled:opacity-50">
              Approve once
            </button>
            <button type="button" onClick={decline} disabled={busy} className="min-h-[30px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3.5 text-[length:var(--pg-t-body)] text-[var(--pg-ink)] disabled:opacity-50">
              Decline
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
