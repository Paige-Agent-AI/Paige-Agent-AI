import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The Social tab's live panels for the Platform Operator (God Level) Integrations surface:
 * what is connected on the resolved workspace (`channels` read on the paige-social door,
 * which applies the platform-owner workspace fallback server-side), a fresh connect that
 * runs the SAME governed social_connection_start approval the Solo drawer uses (rendered
 * as a click-through authorization link — the operator console never hard-navigates), and
 * the Workspace grants block — which Solo workspaces may see which company channels.
 *
 * WHITE-LABEL RULE (owner, 2026-11-05): the social provider behind these connections is
 * never named in the UI. The brand hexes below are the owner-approved brand-tile pass
 * (mockup po-integrations-redesign.html): decorative marks only, never text.
 */

type ChannelRow = {
  platform: string;
  label: string | null;
  handle: string | null;
  status: string;
  providedByPlatform: boolean;
  accountCount: number;
  lastVerifiedAt: string | null;
};

type GrantWorkspace = { id: string; name: string; slug: string };
type GrantRow = { tenantId: string; tenantName: string; platform: string; granted: boolean };

/** The ten platforms the Social door can authorize, in customer vocabulary. */
const PLATFORMS: ReadonlyArray<{ key: string; label: string; hex: string; mark: string }> = [
  { key: "facebook", label: "Facebook", hex: "#1877F2", mark: "f" },
  { key: "instagram", label: "Instagram", hex: "#d6249f", mark: "IG" },
  { key: "tiktok", label: "TikTok", hex: "#010101", mark: "TT" },
  { key: "youtube", label: "YouTube", hex: "#FF0000", mark: "YT" },
  { key: "x", label: "X", hex: "#000000", mark: "X" },
  { key: "threads", label: "Threads", hex: "#000000", mark: "@" },
  { key: "linkedin", label: "LinkedIn", hex: "#0A66C2", mark: "in" },
  { key: "pinterest", label: "Pinterest", hex: "#E60023", mark: "P" },
  { key: "google_business", label: "Google Business", hex: "#34A853", mark: "G" },
  { key: "snapchat", label: "Snapchat", hex: "#FFFC00", mark: "S" },
];

/** Statuses that still hold the platform's connected authorization; anything else may reconnect. */
const HEALTHY = new Set(["connected", "authorizing", "needs_reauth"]);

function payloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function monogram(value: string) {
  return value.split("_").map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part)).join(" ");
}

/** The tile every platform renders on — brand-colored, decorative mark only. */
function BrandTile({ platform }: { platform: { hex: string; mark: string } }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] text-[length:var(--pg-t-body)] font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
      style={{ background: platform.hex, color: platform.hex === "#FFFC00" ? "#111" : undefined }}
    >
      {platform.mark}
    </span>
  );
}

export function SocialChannelsPanel() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
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
      setAuthorizationUrl(null);
      setPending({ summary: approval.summary, request, fingerprint: approval.fingerprint });
      return payload;
    }
    if (payload.ok !== true) {
      setError("The request was refused. Nothing was changed.");
      return payload;
    }
    if (payload.state === "authorization_required" && typeof payload.authorization_url === "string") {
      // The operator console never hard-navigates (scopeIsNotNavigation): the door's
      // authorization link renders for the operator to click; it expires with the attempt.
      setPending(null);
      setAuthorizationUrl(payload.authorization_url);
      setNotice("Approved. Continue below — the authorization link expires with this attempt.");
      return payload;
    }
    setPending(null);
    setAuthorizationUrl(null);
    setNotice("The Social platform responded.");
    return payload;
  }, []);

  const load = useCallback(async () => {
    const payload = await invoke({ action: "channels" });
    const channels = payload && Array.isArray((payload as { channels?: unknown }).channels)
      ? (payload as { channels: unknown[] }).channels
      : null;
    if (!channels) { setError("Company channels could not be read. Try again."); return; }
    const parsed: ChannelRow[] = channels.flatMap((raw) => {
      const row = payloadObject(raw);
      if (!row || typeof row.platform !== "string") return [];
      return [{
        platform: row.platform,
        label: typeof row.label === "string" ? row.label : null,
        handle: typeof row.handle === "string" ? row.handle : null,
        status: typeof row.status === "string" ? row.status : "",
        providedByPlatform: row.providedByPlatform === true,
        accountCount: typeof row.accountCount === "number" ? row.accountCount : 0,
        lastVerifiedAt: typeof row.lastVerifiedAt === "string" ? row.lastVerifiedAt : null,
      }];
    });
    setRows(parsed);
  }, [invoke]);

  // The connect door returns here with a social_result param once authorization completes.
  // Read it once and strip it (the Solo hook does the same); a verified return reloads the
  // real channel state instead of trusting the URL flag alone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("social_result");
    if (!result) return;
    params.delete("social_result");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
    if (result === "verified") setNotice("Social accounts were verified. The channels below now reflect what authorized.");
    else if (result === "error") setNotice("The authorization did not complete. Nothing was connected.");
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("social_result") === "verified") void load();
  }, [load]);

  const connected = useMemo(
    () => new Set((rows ?? []).filter((r) => HEALTHY.has(r.status)).map((r) => r.platform)),
    [rows],
  );
  const available = PLATFORMS.filter((p) => !connected.has(p.key));

  const connect = useCallback((platform: string) => {
    void invoke({ action: "start", platform, return_path: window.location.pathname });
  }, [invoke]);

  return (
    <section aria-labelledby="op-social-channels" className="mb-6 flex-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="op-social-channels" className="text-[length:var(--pg-t-h3)] font-semibold text-[var(--pg-ink)]">Company channels</h2>
          <p className="mt-1 max-w-[68ch] text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">
            The platform&rsquo;s social channels, connected once and managed here. Read-only until a plan is approved — a connection grants reach, never authority.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="min-h-[30px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3.5 text-[length:var(--pg-t-body)] text-[var(--pg-ink)] disabled:opacity-50"
        >
          {rows ? "Refresh verification" : "Load channels"}
        </button>
      </div>

      {error && <p role="alert" className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-warning)]">{error}</p>}
      {notice && <p role="status" className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">{notice}</p>}
      {rows && rows.length === 0 && !error && (
        <p className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">No company channels are connected yet. Find the platform&rsquo;s already-connected channels below, or connect a fresh one.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-3 grid gap-px bg-[var(--pg-line-soft)] [grid-template-columns:repeat(auto-fill,minmax(min(100%,225px),1fr))]">
          {rows.map((row) => {
            const meta = PLATFORMS.find((p) => p.key === row.platform);
            const label = meta?.label ?? monogram(row.platform);
            const chip = row.status === "connected"
              ? ["Connected", "var(--pg-positive)"]
              : row.status === "authorizing"
                ? ["Finishing setup", "var(--pg-warning)"]
                : ["Needs attention", "var(--pg-warning)"];
            return (
              <div key={row.platform} className="flex min-w-0 flex-col bg-[var(--pg-raised)] px-3 py-[11px]">
                <span className="flex min-w-0 items-center gap-[9px]">
                  {meta ? <BrandTile platform={meta} /> : (
                    <span aria-hidden="true" className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] bg-[var(--pg-surface)] text-[length:var(--pg-t-body)] font-bold text-[var(--pg-muted)] shadow-[inset_0_0_0_1px_var(--pg-line)]">
                      {label.charAt(0)}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col text-left">
                    <b className="truncate text-[length:var(--pg-t-body)] font-medium">{label}</b>
                    <small className="mt-px truncate text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                      {row.handle ?? row.label ?? "Provider-verified account"}
                      {row.providedByPlatform ? " · platform connection" : ""}
                    </small>
                  </span>
                </span>
                <span className="mt-[9px] flex items-center gap-[7px] border-t border-[var(--pg-line-soft)] pt-2">
                  <i aria-hidden="true" className="h-1.5 w-1.5 flex-none rotate-45" style={{ background: chip[1] }} />
                  <small className="min-w-0 truncate text-[length:var(--pg-t-label)] text-[var(--pg-muted)]">{chip[0]}</small>
                  <small className="ml-auto flex-none whitespace-nowrap text-[length:var(--pg-t-label)] font-medium text-[var(--pg-faint)]">
                    {row.lastVerifiedAt ? `Verified ${row.lastVerifiedAt.slice(0, 10)}` : row.accountCount > 0 ? `${row.accountCount} account${row.accountCount === 1 ? "" : "s"}` : ""}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {rows && available.length > 0 && (
        <div className="mt-[15px]">
          <b className="text-[length:var(--pg-t-body)] font-medium">Available to connect</b>
          <div className="mt-[11px] grid gap-px bg-[var(--pg-line-soft)] [grid-template-columns:repeat(auto-fill,minmax(min(100%,225px),1fr))]">
            {available.map((p) => (
              <div key={p.key} className="flex min-w-0 items-center gap-[9px] bg-[var(--pg-raised)] px-3 py-[11px]">
                <BrandTile platform={p} />
                <span className="flex min-w-0 flex-col text-left">
                  <b className="truncate text-[length:var(--pg-t-body)] font-medium">{p.label}</b>
                  <small className="mt-px truncate text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">Not switched on yet</small>
                </span>
                <button
                  type="button"
                  onClick={() => connect(p.key)}
                  disabled={busy}
                  className="ml-auto min-h-[26px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 text-[length:var(--pg-t-label)] text-[var(--pg-ink)] disabled:opacity-50"
                >
                  Connect
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <div role="status" className="mt-4 border-t border-[var(--pg-line-soft)] pt-3">
          <p className="text-[length:var(--pg-t-body)] text-[var(--pg-ink)]">{pending.summary}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void invoke({ ...pending.request, approval_fingerprint: pending.fingerprint })}
              disabled={busy}
              className="min-h-[30px] flex-none rounded-full bg-[var(--pg-gold-core)] px-3.5 text-[length:var(--pg-t-body)] font-semibold text-[var(--pg-ink)] disabled:opacity-50"
            >
              Approve once
            </button>
            <button
              type="button"
              onClick={() => { setPending(null); setNotice("Canceled. No Social change was made."); }}
              disabled={busy}
              className="min-h-[30px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3.5 text-[length:var(--pg-t-body)] text-[var(--pg-ink)] disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {authorizationUrl && (
        <div role="status" className="mt-4 border-t border-[var(--pg-line-soft)] pt-3">
          <a
            href={authorizationUrl}
            rel="noopener noreferrer"
            className="inline-flex min-h-[32px] flex-none items-center rounded-full bg-[var(--pg-gold-core)] px-4 text-[length:var(--pg-t-body)] font-semibold text-[var(--pg-ink)]"
          >
            Continue to secure Social authorization
          </a>
          <p className="mt-2 text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
            This link opens the provider&rsquo;s own sign-in and expires with this attempt.
          </p>
        </div>
      )}
    </section>
  );
}

export function SocialGrantsPanel() {
  const [workspaces, setWorkspaces] = useState<GrantWorkspace[] | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const [ws, gr] = await Promise.all([
      supabase.rpc("social_platform_grant_workspaces"),
      supabase.rpc("social_platform_grants_list"),
    ]);
    setBusy(false);
    if (ws.error || gr.error) {
      const code = String((gr.error ?? ws.error)?.message ?? "");
      setError(code.includes("SOCIAL_GRANTS_FORBIDDEN")
        ? "Workspace grants are not switched on yet. Nothing can be changed here."
        : "Workspace grants could not be read. Try again.");
      return;
    }
    const wsRows = Array.isArray(ws.data) ? ws.data : [];
    const grRows = Array.isArray(gr.data) ? gr.data : [];
    const parsedWorkspaces = wsRows.flatMap((raw) => {
      const row = payloadObject(raw);
      return row && typeof row.id === "string" && typeof row.name === "string"
        ? [{ id: row.id, name: row.name, slug: typeof row.slug === "string" ? row.slug : "" }]
        : [];
    });
    const parsedGrants = grRows.flatMap((raw) => {
      const row = payloadObject(raw);
      return row && typeof row.tenant_id === "string" && typeof row.platform === "string"
        ? [{ tenantId: row.tenant_id, tenantName: typeof row.tenant_name === "string" ? row.tenant_name : "", platform: row.platform, granted: row.granted !== false }]
        : [];
    });
    setWorkspaces(parsedWorkspaces);
    setGrants(parsedGrants);
    setChosen((current) => current || parsedWorkspaces[0]?.id || "");
  }, []);

  useEffect(() => {
    if (workspaces === null && !busy && !error) void load();
  }, [workspaces, busy, error, load]);

  const grantedFor = useCallback(
    (tenantId: string, platform: string) => grants.some((g) => g.tenantId === tenantId && g.platform === platform && g.granted),
    [grants],
  );

  const setGrant = useCallback(async (tenantId: string, platform: string, granted: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await supabase.rpc("social_platform_grant_set", { p_tenant: tenantId, p_platform: platform, p_granted: granted });
    setBusy(false);
    if (result.error) { setError("The grant was refused. Nothing was changed."); return; }
    setGrants((current) => {
      const rest = current.filter((g) => !(g.tenantId === tenantId && g.platform === platform));
      const workspace = workspaces?.find((w) => w.id === tenantId);
      return granted
        ? [...rest, { tenantId, tenantName: workspace?.name ?? "", platform, granted: true }]
        : rest;
    });
    setNotice(granted ? "Channel granted. The workspace sees this channel only — never the whole set." : "Channel revoked for that workspace.");
  }, [workspaces]);

  const selected = workspaces?.find((w) => w.id === chosen) ?? null;

  return (
    <section aria-labelledby="op-social-grants" className="mb-6 flex-none border border-[var(--pg-line)] bg-[var(--pg-raised)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="op-social-grants" className="text-[length:var(--pg-t-h3)] font-semibold text-[var(--pg-ink)]">
            Which workspaces may use which company channels
          </h2>
          <p className="mt-1 max-w-[68ch] text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">
            A grant is a governed act: approve once, the workspace sees that channel only — never the whole set. Revoke the same way. Solo accounts connect their own channels through the same door, fully isolated per workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="min-h-[30px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3.5 text-[length:var(--pg-t-body)] text-[var(--pg-ink)] disabled:opacity-50"
        >
          {workspaces ? "Check again" : "Load workspaces"}
        </button>
      </div>

      {error && <p role="alert" className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-warning)]">{error}</p>}
      {notice && <p role="status" className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">{notice}</p>}

      {workspaces && workspaces.length === 0 && !error && (
        <p className="mt-3 text-[length:var(--pg-t-body)] text-[var(--pg-muted)]">No workspaces exist yet to grant to.</p>
      )}

      {workspaces && workspaces.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-wrap items-center gap-2 text-[length:var(--pg-t-body)] text-[var(--pg-ink)]">
            <span className="text-[var(--pg-muted)]">Workspace</span>
            <select
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="min-h-[30px] rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 text-[length:var(--pg-t-body)] text-[var(--pg-ink)]"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name || w.slug}</option>
              ))}
            </select>
          </label>

          {selected && (
            <ul className="flex flex-col gap-1.5">
              {PLATFORMS.map((p) => {
                const on = grantedFor(selected.id, p.key);
                return (
                  <li key={p.key} className="flex items-center gap-2.5 rounded-[9px] border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 py-2 text-[length:var(--pg-t-body)] text-[var(--pg-ink)]">
                    <BrandTile platform={{ hex: p.hex, mark: p.mark }} />
                    <span className="font-medium">{p.label}</span>
                    <span
                      className="ml-1 rounded-full px-2.5 py-0.5 text-[length:var(--pg-t-label)] font-semibold"
                      style={{ color: on ? "var(--pg-gold-core)" : "var(--pg-faint)", background: on ? "rgba(212,167,86,0.1)" : "rgba(99,92,125,0.15)" }}
                    >
                      {on ? "Granted" : "Not granted"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void setGrant(selected.id, p.key, !on)}
                      disabled={busy}
                      className="ml-auto min-h-[26px] flex-none rounded-full border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 text-[length:var(--pg-t-label)] text-[var(--pg-ink)] disabled:opacity-50"
                    >
                      {on ? "Revoke" : "Grant"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
