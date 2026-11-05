import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { IntegrationLogo } from "../../solo/integration-logos";
import type { SocialPlatformDefinition } from "../../solo/social-platform-catalog";

/**
 * The Platform Operator's Social door — the machinery behind the Social cards on
 * Settings → Integrations (owner ruling 2026-11-05: the platform's channels are
 * connected ONCE, here, by the God Level account; no workspace approvals exist).
 *
 * The card wall reads two admin-gated truths from the paige-social door on every
 * load: `channels` (the resolved workspace's own connections — including channels
 * adopted from the platform hub, `providedByPlatform`) and `hub_profiles` (what the
 * platform hub already holds). A platform whose channel lives only in the hub is
 * offered as ONE governed adopt inside its drawer — never a separate hub card. The
 * hub read degrades to "unknown" when the capability is not configured; the cards
 * never guess.
 *
 * Every mutation — connect, reconnect, adopt, disconnect — travels the same
 * governed wrapper: an approval card first, the provider's authorization link
 * second (rendered as a click-through ANCHOR — the operator console never
 * hard-navigates), nothing changed on decline, and the decline itself is sent to
 * the door so the pending confirmation is consumed and recorded. A completed
 * adopt or disconnect reloads the real channel state immediately — the cards never
 * keep a state the server has already left. The `social_result` return is read
 * once and stripped; the door's mount-time channel read carries the post-return
 * state (the provider round trip is a full page navigation).
 *
 * WHITE-LABEL RULE (owner, 2026-11-05): the social provider behind the platform's
 * channels is never named in the UI.
 */

/** One row of the `channels` read — the workspace's own connection for a platform. */
export type OperatorChannelRow = {
  id: string;
  platform: string;
  label: string | null;
  status: string;
  providedByPlatform: boolean;
  accountCount: number;
  lastVerifiedAt: string | null;
};

/** One adoptable channel the platform hub holds (provider readback only). */
type HubChannel = { profileId: string; platform: string; handle: string | null; status: string; adoptable: boolean };

/** Statuses that still hold a working authorization; anything else may reconnect. */
const HEALTHY = new Set(["connected", "authorizing", "needs_reauth"]);

/** The decline action consumes a pending confirmation by its capability name. */
const CAPABILITY_OF_ACTION: Record<string, string> = {
  start: "social_connection_start",
  adopt: "social_connection_adopt",
  disconnect: "social_connection_disconnect",
};

function payloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The words a card foot and a drawer fact row use for a channel's state. */
function channelWords(row: OperatorChannelRow): { account: string; tone: "ok" | "warn" } {
  if (row.status === "connected") return { account: row.label ? `Connected · ${row.label}` : "Connected", tone: "ok" };
  if (row.status === "authorizing") return { account: "Finishing setup", tone: "warn" };
  return { account: "Needs attention", tone: "warn" };
}

/** What a completed act says — and the one thing every completed act does: reload. */
function completionNotice(state: unknown): string | null {
  if (state === "adopted") return "Platform channel brought in. The cards now reflect it.";
  if (state === "disconnected") return "Channel disconnected. The cards now reflect it.";
  if (state === "declined") return "Canceled. No Social change was made.";
  return null;
}

export function useOperatorSocialDoor() {
  const [channels, setChannels] = useState<OperatorChannelRow[] | null>(null);
  const [hub, setHub] = useState<HubChannel[] | null>(null);
  // busy starts true: the first paint says "Checking connection…" on every Social
  // card — an unread state asserts nothing, and "Status unavailable" is reserved
  // for a read that actually came back refused.
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<{ summary: string; request: Record<string, unknown>; fingerprint: string; capability: string } | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const loadRef = useRef<(() => Promise<void>) | null>(null);

  /** One governed invoke for EVERY mutation: approval card → (for connects) the
   *  provider's authorization link as a click-through anchor. Reads pass through. */
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
      const capability = CAPABILITY_OF_ACTION[String(request.action)] ?? "";
      setAuthorizationUrl(null);
      setPending({ summary: approval.summary, request, fingerprint: approval.fingerprint, capability });
      return payload;
    }
    if (payload.ok !== true) {
      setError("The request was refused. Nothing was changed.");
      return payload;
    }
    if (payload.state === "authorization_required" && typeof payload.authorization_url === "string") {
      setPending(null);
      setAuthorizationUrl(payload.authorization_url);
      setNotice("Approved. Continue below — the authorization link expires with this attempt.");
      return payload;
    }
    setPending(null);
    setAuthorizationUrl(null);
    // A completed adopt or disconnect changes what the cards must say; reload the
    // real state now rather than leaving the wall one act behind.
    const done = completionNotice(payload.state);
    if (done) setNotice(done);
    if (payload.state === "adopted" || payload.state === "disconnected") void loadRef.current?.();
    return payload;
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const [channelsResult, hubResult] = await Promise.all([
      supabase.functions.invoke("paige-social", { body: { action: "channels" } }),
      supabase.functions.invoke("paige-social", { body: { action: "hub_profiles" } }),
    ]);
    setBusy(false);
    if (!mounted.current) return;
    const channelsPayload = payloadObject(channelsResult.data);
    if (!channelsPayload || channelsPayload.ok !== true || !Array.isArray(channelsPayload.channels)) {
      setChannels(null);
      setError("The platform's channels could not be read. Try again.");
      return;
    }
    const parsed: OperatorChannelRow[] = channelsPayload.channels.flatMap((raw) => {
      const row = payloadObject(raw);
      if (!row || typeof row.platform !== "string" || typeof row.id !== "string") return [];
      return [{
        id: row.id,
        platform: row.platform,
        label: typeof row.label === "string" ? row.label : null,
        status: typeof row.status === "string" ? row.status : "",
        providedByPlatform: row.providedByPlatform === true,
        accountCount: typeof row.accountCount === "number" ? row.accountCount : 0,
        lastVerifiedAt: typeof row.lastVerifiedAt === "string" ? row.lastVerifiedAt : null,
      }];
    });
    setChannels(parsed);
    // The hub read is a capability, not a guarantee: when Social connection setup is
    // not configured the drawer simply offers no adopt, and the cards claim nothing.
    const hubPayload = payloadObject(hubResult.data);
    if (hubPayload && hubPayload.ok === true && Array.isArray(hubPayload.hubs)) {
      const rows: HubChannel[] = hubPayload.hubs.flatMap((rawHub) => {
        const profile = payloadObject(rawHub);
        if (!profile || typeof profile.profileId !== "string" || !Array.isArray(profile.channels)) return [];
        // Narrowed here, named once: element-access narrowing does not cross the
        // closure below, and the row's profileId must arrive as string, not unknown.
        const profileId: string = profile.profileId;
        return profile.channels.flatMap((rawChannel) => {
          const channel = payloadObject(rawChannel);
          return channel && typeof channel.platform === "string"
            ? [{
              profileId,
              platform: channel.platform,
              handle: typeof channel.handle === "string" ? channel.handle : null,
              status: typeof channel.status === "string" ? channel.status : "",
              adoptable: channel.adoptable === true,
            }]
            : [];
        });
      });
      setHub(rows);
    } else {
      setHub(null);
    }
  }, []);
  loadRef.current = load;

  useEffect(() => { void load(); }, [load]);

  // The door returns here with a social_result param once the provider round trip
  // completes. Read it once and strip it; the mount-time load above is what carries
  // the post-return state, because the round trip is a full page navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("social_result");
    if (!result) return;
    params.delete("social_result");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
    if (result === "verified") setNotice("Social accounts were verified. The cards now reflect what authorized.");
    else if (result === "error") setNotice("The authorization did not complete. Nothing was connected.");
  }, []);

  const connect = useCallback((platform: string) => {
    void invoke({ action: "start", platform, return_path: window.location.pathname });
  }, [invoke]);

  const reconnect = useCallback((platform: string, connectionId: string) => {
    void invoke({ action: "start", platform, connection_id: connectionId, return_path: window.location.pathname });
  }, [invoke]);

  /** Bring ONE platform's already-held hub channel into the workspace — the governed
   *  adopt the retired hub card performed, offered per platform inside its drawer. */
  const adopt = useCallback((platform: string) => {
    const held = hub?.find((channel) => channel.platform === platform && channel.adoptable);
    if (!held) { setError("The platform does not hold a channel for that platform yet."); return; }
    void invoke({ action: "adopt", profileId: held.profileId, platforms: [platform] });
  }, [hub, invoke]);

  const disconnect = useCallback((connectionId: string) => {
    void invoke({ action: "disconnect", connection_id: connectionId });
  }, [invoke]);

  /** Decline THROUGH the door, so the pending confirmation is consumed and recorded
   *  rather than silently abandoned client-side. */
  const decline = useCallback((fingerprint: string, capability: string) => {
    void invoke({ action: "decline", approval_fingerprint: fingerprint, capability });
  }, [invoke]);

  /** Transient door state (an approval card, an authorization link, a notice)
   *  belongs to the drawer that produced it; closing the drawer clears it so one
   *  platform's authorization link can never surface inside another's drawer. */
  const clearTransient = useCallback(() => {
    setPending(null);
    setAuthorizationUrl(null);
    setNotice(null);
  }, []);

  const channelFor = useCallback(
    (platform: string) => (channels ?? []).find((row) => row.platform === platform && HEALTHY.has(row.status)) ?? null,
    [channels],
  );

  /** The honest foot a Social card renders: unread states assert nothing. */
  const cardState = useCallback((platform: string): { account: string; tone: "ok" | "warn" | "neutral" } => {
    if (channels === null) return busy ? { account: "Checking connection…", tone: "neutral" } : { account: "Status unavailable", tone: "neutral" };
    const row = (channels ?? []).find((candidate) => candidate.platform === platform);
    if (!row) return { account: "Setup required", tone: "neutral" };
    if (!HEALTHY.has(row.status)) return { account: "Needs attention", tone: "warn" };
    return channelWords(row);
  }, [busy, channels]);

  const hubHoldFor = useCallback(
    (platform: string) => hub?.find((channel) => channel.platform === platform && channel.adoptable) ?? null,
    [hub],
  );

  return {
    channels, hub, busy, error, notice, authorizationUrl, pending,
    setNotice, load, invoke, connect, reconnect, adopt, disconnect, decline, clearTransient,
    channelFor, cardState, hubHoldFor,
  };
}

export type OperatorSocialDoor = ReturnType<typeof useOperatorSocialDoor>;

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

/** The one drawer every Social card opens: the platform's own channel for that
 *  platform — its proven state, and every act (connect, reconnect, adopt,
 *  disconnect) behind the governed approval. Chrome mirrors the surface family's
 *  drawers: focus lands on close, Tab stays inside, Escape closes, focus returns
 *  to the opener card, and closing clears the door's transient state. */
export function OperatorSocialDrawer({ platform, door, onClose }: { platform: SocialPlatformDefinition; door: OperatorSocialDoor; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const handleClose = useCallback(() => { door.clearTransient(); onClose(); }, [door, onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { if (opener && document.contains(opener)) opener.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); handleClose(); return; }
      if (event.key !== "Tab") return;
      const root = panel.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'))
        .filter((item) => !item.hasAttribute("disabled") && item.tabIndex !== -1 && item.offsetParent !== null);
      if (!items.length) return;
      if (!root.contains(document.activeElement)) { event.preventDefault(); items[0].focus(); }
      else if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const row = door.channelFor(platform.key);
  const held = door.hubHoldFor(platform.key);
  const canOAuth = platform.oauthAvailable;
  const facts = row
    ? <dl className="ig-facts">
        <Fact label="Channel" value={channelWords(row).account} />
        <Fact label="Account" value={row.label ?? "Provider-verified account"} />
        <Fact label="Held by" value={row.providedByPlatform ? "The platform (adopted)" : "Connected by you"} />
        <Fact label="Accounts on this connection" value={String(row.accountCount)} />
        {row.lastVerifiedAt && <Fact label="Verified" value={row.lastVerifiedAt.slice(0, 10)} />}
      </dl>
    : <dl className="ig-facts">
        <Fact label="Channel" value={door.channels === null ? "Reading…" : "Not connected"} />
        {held && <Fact label="The platform already holds" value={held.handle ?? "an account for this platform"} />}
      </dl>;

  return (
    <div className="ig-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <aside className="ig-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="op-social-drawer-title">
        <header>
          <IntegrationLogo id={platform.key} fallback={platform.mark} />
          <div>
            <h2 id="op-social-drawer-title">{platform.name}</h2>
            <span>Platform channel</span>
          </div>
          <button ref={close} className="ig-close" type="button" aria-label={`Close ${platform.name}`} onClick={handleClose}><X aria-hidden size={16} /></button>
        </header>
        <div className="ig-panel-body">
          {door.error && <p className="ig-error" role="alert">{door.error}</p>}
          {door.notice && <p className="ig-note" role="status">{door.notice}</p>}
          {facts}
          {canOAuth && <p className="ig-lede">{platform.connectionNote}</p>}

          {door.pending && (
            <div className="ig-caps" role="status">
              <h4>One governed approval</h4>
              <p className="ig-note">{door.pending.summary}</p>
              <div className="ig-actions">
                <button type="button" className="ig-btn" data-primary disabled={door.busy}
                  onClick={() => void door.invoke({ ...door.pending!.request, approval_fingerprint: door.pending!.fingerprint })}>
                  Approve once
                </button>
                <button type="button" className="ig-btn" disabled={door.busy}
                  onClick={() => door.decline(door.pending!.fingerprint, door.pending!.capability)}>
                  Decline
                </button>
              </div>
            </div>
          )}

          {door.authorizationUrl && (
            <div className="ig-caps" role="status">
              <h4>Continue at the provider</h4>
              <div className="ig-actions">
                <a className="ig-btn" data-primary href={door.authorizationUrl} rel="noopener noreferrer">
                  Continue to secure {platform.name} authorization
                </a>
              </div>
              <p className="ig-note">This link opens the provider&rsquo;s own sign-in and expires with this attempt.</p>
            </div>
          )}

          <div className="ig-actions">
            {!row && canOAuth && (
              <button type="button" className="ig-btn" data-primary disabled={door.busy} onClick={() => door.connect(platform.key)}>
                Connect {platform.name}
              </button>
            )}
            {row && row.status !== "connected" && (
              <button type="button" className="ig-btn" data-primary disabled={door.busy} onClick={() => door.reconnect(platform.key, row.id)}>
                Reconnect {platform.name}
              </button>
            )}
            {!row && held && (
              <button type="button" className="ig-btn" disabled={door.busy} onClick={() => door.adopt(platform.key)}>
                Bring the platform&rsquo;s {platform.name} channel in
              </button>
            )}
            {row && (
              <button type="button" className="ig-btn" disabled={door.busy} onClick={() => door.disconnect(row.id)}>
                Disconnect this channel
              </button>
            )}
            <button type="button" className="ig-btn" disabled={door.busy} onClick={() => void door.load()}>Check again</button>
          </div>
          {!canOAuth && <p className="ig-note">{platform.connectionNote}</p>}
        </div>
        <footer><span>A connection grants reach, never authority. Every account in Paige gets the same fixed options — nothing is approved from here.</span></footer>
      </aside>
    </div>
  );
}
