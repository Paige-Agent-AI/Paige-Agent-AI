import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Check, ExternalLink, Link2Off, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { useSocialConnections } from "./data/useSocialConnections";
import type { SocialPlatformDefinition } from "./social-platform-catalog";

type SocialState = ReturnType<typeof useSocialConnections>;

const OPTIONAL_CAPABILITIES: Readonly<Record<string, string>> = {
  comments: "Comments and replies",
  profile_analytics: "Profile analytics",
  trend_search: "Trend search",
  draft: "Platform drafts",
  music: "Music selection",
  location: "Location tagging",
  cover_image: "Custom cover image",
  cover_timestamp: "Cover-frame selection",
  video_privacy: "Video privacy controls",
  photo_privacy: "Photo privacy controls",
  inbox_fallback: "Inbox draft fallback",
};

function platformName(value: string) {
  return value.split("_").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

function checkedAt(value: string | null) {
  if (!value) return "Not verified yet";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Time unavailable";
}

function CapabilityList({ values }: { values: string[] }) {
  if (!values.length) {
    return <p className="ig-note">No optional capability detail was reported for this account. Paige will not infer unsupported actions.</p>;
  }
  return <ul className="social-ig-capabilities" aria-label="Provider-confirmed optional capabilities">
    {values.map((value) => <li key={value}>{OPTIONAL_CAPABILITIES[value] ?? platformName(value)}</li>)}
  </ul>;
}

export function SocialDrawer({ social, platform, onClose }: { social: SocialState; platform: SocialPlatformDefinition; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const { decline, pending } = social;

  const requestClose = useCallback(() => {
    if (!social.busy) onClose();
  }, [onClose, social.busy]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = panel.current;
      if (!root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (pending) void decline();
        else requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusRoot = root.querySelector<HTMLElement>('[role="alertdialog"]') ?? root;
      const items = Array.from(focusRoot.querySelectorAll<HTMLElement>('button,a[href],[tabindex="0"]'))
        .filter((item) => !item.hasAttribute("disabled") && item.offsetParent !== null);
      if (!items.length) return;
      if (!focusRoot.contains(document.activeElement)) { event.preventDefault(); items[0].focus(); }
      else if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decline, pending, requestClose]);

  const start = (connectionId?: string) => void social.start(location.pathname, platform.key, undefined, connectionId);
  const activeConnections = social.connections.filter((connection) =>
    connection.status !== "disconnected" && connection.requestedPlatform === platform.key
  );

  return <div className="ig-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <aside className="ig-panel social-ig-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="ig-social-title">
      <header>
        <span className="ss-provider-mark social-platform-mark" data-social-platform={platform.key} aria-hidden>{platform.mark}</span>
        <div><h2 id="ig-social-title">{platform.name}</h2><span>Social, workspace-owned accounts</span></div>
        <button ref={close} className="ig-close" type="button" aria-label={`Close ${platform.name}`} disabled={social.busy} onClick={requestClose}><X aria-hidden size={16} /></button>
      </header>

      <div className="ig-panel-body">
        {social.pending && <div className="ig-confirm-close social-ig-approval" role="alertdialog" aria-labelledby="social-approval-title">
          <div><strong id="social-approval-title">Confirm this Social change</strong><p>{social.pending.summary}</p></div>
          <div className="ig-actions">
            <button type="button" className="ig-btn" data-primary autoFocus disabled={social.busy} onClick={() => void social.approve()}><ShieldCheck aria-hidden size={14} />Approve once</button>
            <button type="button" className="ig-btn" disabled={social.busy} onClick={() => void social.decline()}>Cancel</button>
          </div>
        </div>}

        <div className="social-ig-intro">
          <div><span className="social-ig-kicker">OAuth connection</span><h3>Choose the {platform.name} identity this workspace may use.</h3></div>
          <p>Paige sends you to {platform.name} for consent, then verifies the account by readback. Nothing is selected automatically, and connecting never publishes content.</p>
        </div>

        {social.loading ? <p className="ig-state" role="status"><RefreshCw className="ig-spin" aria-hidden />Checking Social connections…</p> : <>
          {social.error && <div className="ig-state" role="alert"><span>{social.error}</span><button type="button" className="ig-btn" onClick={() => void social.reload()}>Try again</button></div>}
          {social.notice && <p className="social-ig-notice" role="status"><Check aria-hidden size={14} />{social.notice}</p>}
          {!social.canManage && <p className="ig-note">You can inspect Social connection state. Only a workspace owner or admin can change it.</p>}

          {!activeConnections.length && !social.error ? <section className="social-ig-empty" aria-labelledby="social-empty-title">
            <div><h3 id="social-empty-title">No {platform.name} accounts are connected</h3>
              <p>Start secure authorization and choose the exact account at {platform.name}. Paige reads it back before it can appear here.</p></div>
            <p className="ig-note">{platform.connectionNote}</p>
            {social.canManage && platform.oauthAvailable && <button type="button" className="ig-btn" data-primary disabled={social.busy} onClick={() => start()}><Plus aria-hidden size={14} />Connect {platform.name}</button>}
            {!platform.oauthAvailable && <p className="ig-note" role="status">Connection is unavailable. Paige will not open a non-working authorization flow.</p>}
          </section> : <div className="social-ig-connections">
            {activeConnections.map((connection) => {
              const linked = social.accounts.filter((account) => account.connectionId === connection.id && account.platform === platform.key && !["disconnected", "revoked"].includes(account.status));
              return <section className="social-ig-connection" key={connection.id} aria-labelledby={`social-connection-${connection.id}`}>
                <div className="social-ig-connection-head"><div><span className="social-ig-kicker">{platform.name} identity{connection.providedByPlatform ? " · platform connection" : ""}</span><h3 id={`social-connection-${connection.id}`}>{connection.label ?? (linked[0]?.displayName || linked[0]?.handle || `${platform.name} account`)}</h3></div>
                  <span className="ig-card-state" data-tone={connection.status === "connected" ? "ok" : connection.status === "needs_reauth" || connection.status === "error" ? "warn" : "neutral"}><i aria-hidden />{connection.status === "connected" ? "Verified" : connection.status === "needs_reauth" ? "Reconnect needed" : connection.status === "error" ? "Needs attention" : "Setup not finished"}</span></div>
                <dl className="ig-facts"><div><dt>Last verified</dt><dd>{checkedAt(connection.lastVerifiedAt)}</dd></div><div><dt>Accounts found</dt><dd>{linked.length}</dd></div></dl>

                {!linked.length ? <p className="ig-note">No platform account has been verified for this identity yet. Return to secure authorization and finish one connection.</p> : <ul className="social-ig-accounts">
                  {linked.map((account) => <li key={account.id} data-selected={account.selected || undefined}>
                    {account.avatarUrl ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="social-ig-avatar" aria-hidden>{platformName(account.platform).slice(0, 2)}</span>}
                    <div className="social-ig-account-main"><div><strong>{account.displayName || account.handle || `${platformName(account.platform)} account`}</strong><span>{platformName(account.platform)}{account.handle ? ` · ${account.handle}` : ""}</span></div>
                      <span className="ig-card-state" data-tone={account.status === "connected" ? "ok" : "warn"}><i aria-hidden />{account.status === "connected" ? account.selected ? "Selected" : "Verified" : "Reconnect needed"}</span>
                      <CapabilityList values={account.capabilities} />
                      <p className="ig-note">Connection identity is verified. Publishing and analytics stay unavailable until their own provider execution and readback proof is complete.</p>
                      {social.canManage && account.status === "connected" && !account.selected && <button type="button" className="ig-btn" disabled={social.busy} onClick={() => void social.select(connection.id, account.id)}>Select this account</button>}
                    </div>
                  </li>)}
                </ul>}

                <div className="ig-actions">
                  {social.canManage && <button type="button" className="ig-btn" disabled={social.busy} onClick={() => start(connection.id)}><ExternalLink aria-hidden size={14} />{connection.status === "connected" ? "Manage or reconnect" : "Continue setup"}</button>}
                  {social.canManage && <button type="button" className="ig-btn" disabled={social.busy} onClick={() => void social.disconnect(connection.id)}><Link2Off aria-hidden size={14} />Disconnect</button>}
                  <button type="button" className="ig-btn" disabled={social.busy} onClick={() => void social.reload()}><RefreshCw aria-hidden size={14} />Refresh Paige status</button>
                </div>
              </section>;
            })}
            {social.canManage && platform.oauthAvailable && <button type="button" className="ig-btn social-ig-add" disabled={social.busy} onClick={() => start()}><Plus aria-hidden size={14} />Add another {platform.name} account</button>}
          </div>}
        </>}

        <section className="social-ig-boundary" aria-label="Social connection boundaries">
          <h3>What connection enables</h3>
          <ul><li>Account identity and authorization health after provider readback</li><li>Explicit account selection within this workspace</li><li>Reconnect and disconnect with durable receipts</li></ul>
          <p>{platform.connectionNote} Available actions come from this account's provider readback; Paige does not infer them from the platform name.</p>
        </section>
      </div>
      <footer><span>No password, token, provider profile key, or raw provider payload is shown here.</span></footer>
    </aside>
  </div>;
}


type HubChannel = {
  platform: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  adoptable: boolean;
};
type HubProfile = { profileId: string; name: string | null; channels: HubChannel[] };

/**
 * The operator-side adoption surface: lists channels the platform hub's provider readback
 * already proves, and adopts the chosen ones through ONE governed social_connection_adopt
 * approval. Nothing here publishes; the approval card below is the same governed flow as
 * every other Social mutation.
 */
export function SocialHubPanel({ social }: { social: SocialState }) {
  const [hubs, setHubs] = useState<HubProfile[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [hubError, setHubError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setHubError(null);
    const payload = await social.hubProfiles();
    setLoading(false);
    const rows = payload && Array.isArray((payload as { hubs?: unknown }).hubs)
      ? (payload as { hubs: unknown[] }).hubs : null;
    if (!rows) { setHubError("Platform hub channels could not be read. Try again."); return; }
    const parsed: HubProfile[] = rows.flatMap((raw) => {
      const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
      if (!row || typeof row.profileId !== "string") return [];
      const channels = Array.isArray(row.channels) ? row.channels.flatMap((entry) => {
        const channel = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
        if (!channel || typeof channel.platform !== "string") return [];
        return [{
          platform: channel.platform,
          handle: typeof channel.handle === "string" ? channel.handle : null,
          displayName: typeof channel.displayName === "string" ? channel.displayName : null,
          status: typeof channel.status === "string" ? channel.status : "",
          adoptable: channel.adoptable === true,
        }];
      }) : [];
      return [{ profileId: row.profileId, name: typeof row.name === "string" ? row.name : null, channels }];
    });
    setHubs(parsed);
    setChosen({});
  }, [social]);

  const adoptable = hubs?.flatMap((hub) => hub.channels.filter((channel) => channel.adoptable)
    .map((channel) => ({ profileId: hub.profileId, ...channel }))) ?? [];
  const selected = adoptable.filter((channel) => chosen[channel.profileId + ":" + channel.platform]);
  const key = (profileId: string, platform: string) => profileId + ":" + platform;

  return <section className="social-ig-connections" aria-labelledby="social-hub-title">
    <div className="social-ig-connection-head">
      <div><span className="social-ig-kicker">Platform hub</span><h3 id="social-hub-title">Channels already connected in the PAIGE hub</h3></div>
      {social.canManage && <button type="button" className="ig-btn" disabled={social.busy || loading} onClick={() => void load()}>
        {hubs ? "Check again" : "Find hub channels"}
      </button>}
    </div>
    <p className="ig-note">Bring the platform's already-connected channels into this workspace with one approval. Each becomes its own labeled platform connection. Nothing is published.</p>
    {hubError && <div className="ig-state" role="alert"><span>{hubError}</span></div>}
    {social.error && <div className="ig-state" role="alert"><span>{social.error}</span></div>}
    {social.notice && <p className="social-ig-notice" role="status"><Check aria-hidden size={14} />{social.notice}</p>}
    {hubs && !adoptable.length && !hubError && <p className="ig-note">No adoptable hub channels were found in the provider readback.</p>}
    {adoptable.map((channel) => <label key={key(channel.profileId, channel.platform)} className="social-ig-account" data-selected={chosen[key(channel.profileId, channel.platform)] || undefined} style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
      <input type="checkbox" checked={Boolean(chosen[key(channel.profileId, channel.platform)])} onChange={(event) => setChosen((current) => ({ ...current, [key(channel.profileId, channel.platform)]: event.target.checked }))} />
      <span className="social-ig-account-main"><div><strong>{platformName(channel.platform)}</strong><span>{channel.handle ? channel.handle : "Provider-verified account"}</span></div></span>
    </label>)}
    {!!selected.length && social.canManage && <button type="button" className="ig-btn" data-primary disabled={social.busy} onClick={() => void social.adopt(selected[0].profileId, selected.map((channel) => channel.platform))}>
      Confirm this Social change · Approve once
    </button>}
    {social.pending && social.pending.capability === "social_connection_adopt" && <div className="ig-state" role="status">
      <span>{social.pending.summary}</span>
      <button type="button" className="ig-btn" data-primary disabled={social.busy} onClick={() => void social.approve()}>Approve once</button>
      <button type="button" className="ig-btn" disabled={social.busy} onClick={() => void social.decline()}>Decline</button>
    </div>}
  </section>;
}
