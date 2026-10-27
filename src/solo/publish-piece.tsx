// Marketing › Content › a piece's publish affordance (EXP07 row 10 — the door's customer surface).
//
// Everything here renders what the door ACTUALLY said, never a friendlier invention. The door
// (supabase/functions/social-publish-command) is the one governed way a saved piece ships to a
// connected channel, and it already speaks in finished sentences ("That channel isn't connected
// yet…", "The channel accepted the post but hasn't confirmed it. It may have posted…"). Those
// sentences are shown verbatim — rewriting them would throw away the truth they were written to
// carry (the same ruling as team-workspace's invitation refusals).
//
// The flow a customer sees:
//   open a piece → "Publish to a channel" → each network shows its REAL readiness from the same
//   presence read the Social tab uses (connected channels are pickable; the rest say what they
//   are and point at Settings → Integrations) → the words that will post, editable, prefilled
//   with the piece's own copy → "Prepare to publish" → THE DOOR'S OWN PREVIEW (what will post,
//   where, and that nothing is scheduled) with Approve / Not now → on approval the post goes out
//   once through the claimed args and the result is stated exactly: Published (with the link),
//   Partially published, Failed (nothing was published), or Outcome unknown (it may have posted —
//   check the channel; this door refuses a retry until it's reconciled).
//
// Reads are the existing governed ones only: get_social_presence_evidence (readiness) and
// content_publication_list (the receipts). The single write path is the door itself.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { classifyPresence, type SocialPresenceRow } from "./useSocialCommand";
import { SOCIAL_NETWORKS } from "./social-truth";
import type { ContentPiece } from "./marketing-content-model";
import { plainCopy } from "./marketing-content-model";

/** A pickable network with the readiness the presence read proved — never guessed from a handle. */
export type PublishNetwork = {
  key: string;
  label: string;
  /** connected = pickable. Every other value says why not, in one line. */
  readiness: "connected" | "needs_reauth" | "not_connected";
  note: string;
};

/** One publication receipt as the customer reads it (content_publication_list row). */
export type PublicationReceipt = {
  id: string;
  platform: string | null;
  status: string;
  url: string | null;
  createdAt: string;
};

/** The one sentence per receipt status — the door's own vocabulary, spelled for a person. */
export const PUBLICATION_STATUS_WORDS: Record<string, string> = {
  published: "Published",
  partial: "Partially published",
  failed: "Failed — nothing was posted",
  outcome_unknown: "Outcome being checked — it may have posted",
  refused: "Refused — nothing was posted",
  publishing: "Posting…",
  approved: "Approved — posting",
  registered: "Started",
};

/**
 * Build the picker's rows from the platform order and the presence read's connections.
 * PURE, exported, tested directly — a row's readiness must come from the lifecycle row alone;
 * an absent connection is "not connected", never "probably fine".
 */
export function classifyPublishNetworks(
  networks: ReadonlyArray<{ key: string; label: string }>,
  connections: ReadonlyArray<{ network: string; status: string }>,
): PublishNetwork[] {
  const byNetwork = new Map(connections.map((c) => [c.network, c.status]));
  return networks.map((network) => {
    const status = byNetwork.get(network.key);
    if (status === "connected") return { key: network.key, label: network.label, readiness: "connected", note: "Connected" };
    if (status === "needs_reauth") return { key: network.key, label: network.label, readiness: "needs_reauth", note: "Needs you to sign in again" };
    return { key: network.key, label: network.label, readiness: "not_connected", note: "Not connected" };
  });
}

/** Everything the panel can be showing, derived only from what the door or the reads said. */
export type PublishFace =
  | { face: "idle" }
  | { face: "calling"; sentence: string }
  | { face: "approval_required"; fingerprint: string; summary: string; expiresAt: string | null; pieceTitle: string; platform: string; channelLabel: string; caption: string }
  | { face: "declined" }
  | { face: "published"; url: string | null; publicationId: string }
  | { face: "partial"; url: string | null; publicationId: string }
  | { face: "outcome_unknown"; sentence: string; publicationId: string }
  | { face: "failed"; sentence: string }
  | { face: "refused"; sentence: string }
  | { face: "channel_blocked"; sentence: string }
  | { face: "not_configured"; sentence: string }
  | { face: "retry_blocked"; sentence: string }
  | { face: "signed_out"; sentence: string }
  | { face: "not_permitted"; sentence: string }
  | { face: "unreachable"; sentence: string };

const SENTENCE_FALLBACK = "Publishing couldn't be confirmed. Nothing was posted — reload the page and check the channel before trying again.";

/**
 * Map ONE door call's outcome to the panel's face. PURE, exported, tested directly.
 *
 * `supabase.functions.invoke` resolves 2xx onto `data` and turns every non-2xx into
 * `{ data: null, error }` with the honest body on `error.context` — `readFunctionErrorBody`
 * (§18, one home) lifts it back out. The door's states arrive in `state` (2xx) or `code`
 * (refusals); both are mapped, and anything unrecognised falls back to a sentence that claims
 * NOTHING rather than a reassuring guess.
 */
export function doorFace(data: Record<string, unknown> | null, errorBody: Record<string, unknown> | null): PublishFace {
  const body = data ?? errorBody;
  if (!body || typeof body !== "object") return { face: "unreachable", sentence: SENTENCE_FALLBACK };
  const state = typeof body.state === "string" ? body.state : "";
  const code = typeof body.code === "string" ? body.code : "";
  const sentence = typeof body.error === "string" && body.error.trim() && !/non-2xx status code/i.test(body.error)
    ? body.error.trim()
    : typeof body.message === "string" && body.message.trim() ? body.message.trim() : SENTENCE_FALLBACK;
  const url = typeof body.post_url === "string" && body.post_url ? body.post_url : null;
  const publicationId = typeof body.publication_id === "string" && body.publication_id ? body.publication_id : "";

  if (state === "approval_required") {
    const approval = body.approval as Record<string, unknown> | undefined;
    const preview = body.preview as Record<string, unknown> | undefined;
    const fingerprint = typeof approval?.fingerprint === "string" ? approval.fingerprint : "";
    const summary = typeof approval?.summary === "string" ? approval.summary : "";
    if (!fingerprint || !summary) return { face: "unreachable", sentence: SENTENCE_FALLBACK };
    return {
      face: "approval_required",
      fingerprint,
      summary,
      expiresAt: typeof approval?.expires_at === "string" ? approval.expires_at : null,
      pieceTitle: typeof preview?.piece_title === "string" ? preview.piece_title : "",
      platform: typeof preview?.platform === "string" ? preview.platform : "",
      channelLabel: typeof preview?.channel_label === "string" ? preview.channel_label : "",
      caption: typeof preview?.caption === "string" ? preview.caption : "",
    };
  }
  if (state === "published") return { face: "published", url, publicationId };
  if (state === "partial") return { face: "partial", url, publicationId };
  if (state === "outcome_unknown") return { face: "outcome_unknown", sentence, publicationId };
  if (state === "declined") return { face: "declined" };
  if (state === "failed") return { face: "failed", sentence };
  if (state === "refused") return code === "access_denied" ? { face: "not_permitted", sentence } : { face: "refused", sentence };
  // Refusal codes the door sends BEFORE any approval: the channel's own state, the account's
  // setup, the retry gate, and the caller's own authority. Each gets its own face so the panel
  // can offer the right next step (Settings, sign-in, or nothing but the truth).
  if (code === "NO_CONNECTION" || code === "NEEDS_REAUTH") return { face: "channel_blocked", sentence };
  if (code === "PUBLISHING_NOT_CONFIGURED") return { face: "not_configured", sentence };
  if (code === "RETRY_PENDING_RECONCILIATION") return { face: "retry_blocked", sentence };
  if (code === "NOT_AUTHENTICATED") return { face: "signed_out", sentence };
  if (code.startsWith("CALLER_") || code === "CONTENT_NOT_FOUND") return { face: "not_permitted", sentence };
  return { face: "unreachable", sentence };
}

type Reads = {
  networks: PublishNetwork[];
  networksPhase: "loading" | "ready" | "error";
  receipts: PublicationReceipt[];
};

/** The words that will post, prefilled from the piece itself: its copy if it has words, else its title. */
export function defaultCaption(piece: Pick<ContentPiece, "body" | "title">): string {
  const words = plainCopy(piece.body).trim();
  return (words || piece.title || "").slice(0, 2200);
}

export function PublishPiece({ piece, tenantId }: { piece: ContentPiece; tenantId: string | null }) {
  const [reads, setReads] = React.useState<Reads>({ networks: [], networksPhase: "loading", receipts: [] });
  const [face, setFace] = React.useState<PublishFace>({ face: "idle" });
  const [platform, setPlatform] = React.useState<string>("");
  const [caption, setCaption] = React.useState<string>(() => defaultCaption(piece));
  const [captionEdited, setCaptionEdited] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const pieceKindIsMedia = piece.kind === "image" || piece.kind === "video";

  const readAll = React.useCallback(async () => {
    if (!tenantId) return;
    const presence = await supabase.rpc("get_social_presence_evidence" as never, {} as never);
    const receipts = await supabase.rpc("content_publication_list" as never, { p_content_id: piece.id } as never);
    const presenceRows = Array.isArray(presence.data) ? (presence.data as unknown as SocialPresenceRow[]) : [];
    const connections = presence.error || !presenceRows.length ? [] : classifyPresence(presenceRows).connections;
    const receiptRows = Array.isArray(receipts.data) ? (receipts.data as unknown as Array<Record<string, unknown>>) : [];
    setReads({
      networks: classifyPublishNetworks(SOCIAL_NETWORKS, connections),
      networksPhase: presence.error ? "error" : "ready",
      receipts: receiptRows.slice(0, 5).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        platform: typeof row.platform === "string" ? row.platform : null,
        status: typeof row.status === "string" ? row.status : "",
        url: typeof row.provider_post_url === "string" && row.provider_post_url ? row.provider_post_url : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
      })).filter((row) => row.id),
    });
  }, [tenantId, piece.id]);

  React.useEffect(() => { void readAll(); }, [readAll]);

  const callDoor = async (body: Record<string, unknown>): Promise<PublishFace> => {
    const invoked = await supabase.functions.invoke("social-publish-command", { body });
    const errorBody = await readFunctionErrorBody(invoked.error, invoked.data);
    return doorFace(invoked.data as Record<string, unknown> | null, errorBody);
  };

  const connected = reads.networks.filter((n) => n.readiness === "connected");
  const chosen = reads.networks.find((n) => n.key === platform && n.readiness === "connected") ?? null;

  const prepare = async () => {
    if (!platform || busy) return;
    setBusy(true);
    setFace({ face: "calling", sentence: "Asking for the exact post to approve…" });
    const next = await callDoor({ action: "publish", expected_tenant_id: tenantId, content_id: piece.id, platform, caption: caption.trim() || null });
    setFace(next); setBusy(false); void readAll();
  };
  const approve = async () => {
    if (face.face !== "approval_required" || busy) return;
    setBusy(true);
    setFace({ face: "calling", sentence: "Publishing the approved post…" });
    const next = await callDoor({ action: "publish", expected_tenant_id: tenantId, approved_fingerprint: face.fingerprint });
    setFace(next); setBusy(false); void readAll();
  };
  const decline = async () => {
    if (face.face !== "approval_required" || busy) return;
    setBusy(true);
    setFace({ face: "calling", sentence: "Cancelling…" });
    const next = await callDoor({ action: "decline", expected_tenant_id: tenantId, fingerprint: face.fingerprint });
    setFace(next.face === "unreachable" && !next.sentence ? { face: "declined" } : next);
    setBusy(false); void readAll();
  };
  const reset = () => { setFace({ face: "idle" }); };

  return <section className="mct-pubdoor" aria-labelledby="mct-pubdoor-h">
    <h3 id="mct-pubdoor-h">Publish to a channel</h3>

    {face.face === "approval_required" ? <>
      <p className="mct-pubdoor-summary">{face.summary}</p>
      <div className="mct-pubdoor-preview">
        <span className="mct-pubdoor-chip">{face.channelLabel || face.platform}</span>
        <p>{face.caption}</p>
        {face.expiresAt && <small>Approval expires {new Date(face.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "numeric" })}.</small>}
      </div>
      <div className="mct-pubdoor-acts">
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => void approve()}>Approve and post once</button>
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => void decline()}>Not now</button>
      </div>
    </> : face.face === "calling" ? <p className="mct-pubdoor-state" role="status">{face.sentence}</p>
    : face.face === "published" ? <div className="mct-pubdoor-result mct-pubdoor-ok">
        <p>Published{face.url ? <> — <a href={face.url} target="_blank" rel="noreferrer">see the post</a></> : "."}</p>
        <button type="button" className="mov-lnk" onClick={reset}>Publish somewhere else</button>
      </div>
    : face.face === "partial" ? <div className="mct-pubdoor-result">
        <p>Partially published{face.url ? <> — <a href={face.url} target="_blank" rel="noreferrer">see what posted</a></> : "."} Check the channel to see what went out.</p>
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : face.face === "outcome_unknown" ? <div className="mct-pubdoor-result mct-pubdoor-warn">
        <p>{face.sentence}</p>
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : face.face === "declined" ? <div className="mct-pubdoor-result">
        <p>Nothing was published.</p>
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : face.face === "failed" || face.face === "refused" || face.face === "channel_blocked" || face.face === "not_configured" || face.face === "retry_blocked" || face.face === "signed_out" || face.face === "not_permitted" || face.face === "unreachable" ? <div className="mct-pubdoor-result">
        <p>{face.sentence}</p>
        {(face.face === "channel_blocked" || face.face === "not_configured") && <a className="mov-lnk" href="/solo/settings/integrations">Settings → Integrations</a>}
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : <>
      {reads.networksPhase === "loading" ? <p className="mct-pubdoor-state" role="status">Reading your connected channels…</p>
      : reads.networksPhase === "error" ? <p className="mct-pubdoor-state">Your connected channels couldn't be read. Nothing was posted.</p>
      : !connected.length ? <p className="mct-pubdoor-state">No channel is connected yet. Connect one in <a className="mov-lnk" href="/solo/settings/integrations">Settings → Integrations</a> and it appears here.</p>
      : <>
        <div className="mct-pubdoor-nets" role="group" aria-label="Channel">
          {reads.networks.map((network) => network.readiness === "connected"
            ? <button key={network.key} type="button" className="mct-pubdoor-net" aria-pressed={platform === network.key} onClick={() => setPlatform(network.key)}>
                {network.label}<small>{network.note}</small>
              </button>
            : <span key={network.key} className="mct-pubdoor-net mct-pubdoor-net-off" aria-disabled="true">
                {network.label}<small>{network.note} — <a className="mov-lnk" href="/solo/settings/integrations">Settings → Integrations</a></small>
              </span>)}
        </div>
        {chosen && <>
          <label className="mct-pubdoor-caption" htmlFor="mct-pubdoor-words">The words that will post</label>
          <textarea id="mct-pubdoor-words" value={captionEdited ? caption : caption} maxLength={2200} rows={Math.min(6, Math.ceil(caption.length / 60) + 1)}
            onChange={(event) => { setCaption(event.target.value); setCaptionEdited(true); }}/>
          {pieceKindIsMedia && <p className="mct-pubdoor-note">The channel post is these words only — the {piece.kind} file itself isn't attached to social posts yet.</p>}
          <div className="mct-pubdoor-acts">
            <button type="button" className="btn btn-s" disabled={busy || !caption.trim()} onClick={() => void prepare()}>Prepare to publish</button>
          </div>
        </>}
        <p className="mct-pubdoor-note">Nothing posts until you approve the exact post. Nothing is scheduled.</p>
      </>}
      {reads.receipts.length > 0 && <div className="mct-pubdoor-history">
        <h4>Recent attempts for this piece</h4>
        <ul>{reads.receipts.map((receipt) => <li key={receipt.id}>
          <span>{receipt.platform ?? "channel"}</span>
          <em className={receipt.status === "published" ? "mct-pubdoor-ok" : receipt.status === "outcome_unknown" || receipt.status === "publishing" || receipt.status === "approved" || receipt.status === "registered" ? "mct-pubdoor-warn" : ""}>
            {PUBLICATION_STATUS_WORDS[receipt.status] ?? receipt.status}
          </em>
          {receipt.url && <a href={receipt.url} target="_blank" rel="noreferrer">see the post</a>}
        </li>)}</ul>
      </div>}
    </>}
  </section>;
}
