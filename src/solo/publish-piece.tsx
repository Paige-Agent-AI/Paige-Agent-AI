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
//   where, and the exact immediate/future instruction) with Approve / Not now. The original
//   claimed call returns Published, Scheduled at provider, a verified stopped schedule,
//   Partially published, Failed (nothing was published), or Outcome unknown (it may have posted —
//   check the channel; this door refuses a retry until it's reconciled).
//
// Reads are the existing governed ones only: get_social_presence_evidence (readiness) and
// content_publication_list (the receipts). The single write path is the door itself.
import React from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { classifyPresence, type SocialPresenceRow } from "./useSocialCommand";
import { SOCIAL_NETWORKS } from "./social-truth";
import type { ContentPiece } from "./marketing-content-model";
import { plainCopy } from "./marketing-content-model";
import { safeSocialUrl, type SocialMediaPreview } from "./social-publishing-model";
import { SocialScheduleFields, readSocialSchedule, socialScheduleLabel, type SocialSchedule } from "./social-schedule-fields";
import { storedSocialSchedule } from "../../supabase/functions/_shared/social-publish-command/schedule";

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
  destination: string | null;
  status: string;
  url: string | null;
  createdAt: string;
  providerProcessing: boolean;
  schedule?: SocialSchedule;
  scheduleVersion?: number;
};

const canCheckAttempt = (status: string) => ["approved", "publishing", "outcome_unknown", "scheduled", "schedule_changing", "cancelled"].includes(status);
const sameSchedule = (expected: SocialSchedule | null | undefined, actual: SocialSchedule | null | undefined) =>
  JSON.stringify(expected ?? null) === JSON.stringify(actual ?? null);

export function prioritizePublicationReceipts(receipts: PublicationReceipt[]): PublicationReceipt[] {
  const active = (receipt:PublicationReceipt) => canCheckAttempt(receipt.status) && receipt.status !== "cancelled";
  const unresolved = receipts.filter(active);
  return [...unresolved, ...receipts.filter((receipt) => !active(receipt)).slice(0, Math.max(0, 5 - unresolved.length))];
}

/** The one sentence per receipt status — the door's own vocabulary, spelled for a person. */
export const PUBLICATION_STATUS_WORDS: Record<string, string> = {
  published: "Published",
  partial: "Partially published",
  failed: "Failed — nothing was posted",
  outcome_unknown: "Outcome being checked — it may have posted",
  refused: "Refused — nothing was posted",
  publishing: "Posting…",
  approved: "Approved — waiting to post",
  registered: "Started",
  scheduled: "Scheduled at provider",
  schedule_changing: "Schedule change needs a check",
  cancelled: "Schedule stopped at provider",
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
  | { face: "approval_required"; fingerprint: string; summary: string; expiresAt: string | null; pieceTitle: string; platform: string; channelLabel: string; caption: string; media?: SocialMediaPreview[]; schedule?: SocialSchedule; operation?: "reschedule" | "cancel_schedule"; publicationId?: string; publicationVersion?: number; contentRevision?: string }
  | { face: "declined" }
  | { face: "published"; url: string | null; publicationId: string; notice?:string }
  | { face: "scheduled" | "cancelled"; publicationId: string; schedule: SocialSchedule }
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

const SENTENCE_FALLBACK = "Publishing couldn't be confirmed. Check recent attempts before trying again.";

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
      ...(readSocialSchedule(preview?.schedule) ? {schedule:readSocialSchedule(preview?.schedule)!} : {}),
      ...(["reschedule","cancel_schedule"].includes(String(preview?.operation)) ? {operation:preview!.operation as "reschedule"|"cancel_schedule",publicationId:String(preview!.publication_id),publicationVersion:Number(preview!.publication_version)} : {}),
      ...(typeof preview?.content_revision === "string" ? {contentRevision:preview.content_revision} : {}),
      ...(Array.isArray(preview?.media) && preview.media.length ? { media: preview.media.flatMap((item: Record<string, unknown>) => {
        const url = safeSocialUrl(item?.url);
        return url && ["image", "video"].includes(String(item?.type)) ? [{ contentId: String(item.content_id), type: item.type as "image" | "video", url, alt: typeof item.alt_text === "string" ? item.alt_text : "Saved post media" }] : [];
      }) } : {}),
    };
  }
  if (state === "published") return { face: "published", url, publicationId,...(body.schedule_change_applied===false?{notice:sentence}:{}) };
  if ((state === "scheduled" || state === "cancelled") && publicationId && readSocialSchedule(body.schedule)) return {face:state,publicationId,schedule:readSocialSchedule(body.schedule)!};
  if (state === "partial") return { face: "partial", url, publicationId };
  if (state === "outcome_unknown") return { face: "outcome_unknown", sentence, publicationId };
  if (state === "declined") return { face: "declined" };
  if (state === "failed") return { face: "failed", sentence };
  if (state === "refused") return code === "access_denied" ? { face: "not_permitted", sentence } : { face: "refused", sentence };
  // Refusal codes the door sends BEFORE any approval: the channel's own state, the account's
  // setup, the retry gate, and the caller's own authority. Each gets its own face so the panel
  // can offer the right next step (Settings, sign-in, or nothing but the truth).
  if (["NO_CONNECTION", "NEEDS_REAUTH", "DESTINATION_AMBIGUOUS", "DESTINATION_UNVERIFIED"].includes(code)) return { face: "channel_blocked", sentence };
  if (code === "PUBLISHING_NOT_CONFIGURED") return { face: "not_configured", sentence };
  if (code === "RETRY_PENDING_RECONCILIATION") return { face: "retry_blocked", sentence };
  if (code === "DESTINATION_SELECTION_UNAVAILABLE") return { face: "refused", sentence };
  if (code === "NOT_AUTHENTICATED") return { face: "signed_out", sentence };
  if (code.startsWith("CALLER_") || code === "CONTENT_NOT_FOUND") return { face: "not_permitted", sentence };
  return { face: "unreachable", sentence };
}

type Reads = {
  networks: PublishNetwork[];
  networksPhase: "loading" | "ready" | "error";
  receipts: PublicationReceipt[];
  receiptsError: boolean;
};

/** The words that will post, prefilled from the piece itself: its copy if it has words, else its title. */
export function defaultCaption(piece: Pick<ContentPiece, "body" | "title">): string {
  const words = plainCopy(piece.body).trim();
  return (words || piece.title || "").slice(0, 2200);
}

type PublishPieceProps = { tenantId: string | null; captionReadOnly?: boolean; onPublicationRecorded?: (publicationId: string) => void } &
  ({ piece: ContentPiece; originalAttempt?: never; onlyPublicationId?: string | null } | { piece?: never; originalAttempt: { contentId: string; publicationId: string }; onlyPublicationId?: never });
export function PublishPiece(props:PublishPieceProps) {
  const {activeUserId,activeTenantId,activeTenant,loading,accountContextLoading}=useTenantContext();
  if(loading||accountContextLoading||!activeUserId||!activeTenantId||props.tenantId!==activeTenantId)return <p role="status">Resolving the publishing workspace…</p>;
  const number=String(activeTenant?.account_number??""),connectionsHref=/^\d{1,20}$/.test(number)?`/solo/${number}/settings/integrations`:"/choose-account";
  return <PublishPieceWorkspace key={`${activeUserId}:${props.tenantId}:${props.piece?.id??props.originalAttempt?.contentId}:${props.onlyPublicationId??props.originalAttempt?.publicationId??""}`} {...props} connectionsHref={connectionsHref}/>;
}
function PublishPieceWorkspace({ piece, originalAttempt, tenantId, captionReadOnly = false, onlyPublicationId: requestedOnlyPublicationId = null, onPublicationRecorded, connectionsHref }: PublishPieceProps & {connectionsHref:string}) {
  const contentId = piece?.id ?? originalAttempt?.contentId ?? "";
  const onlyPublicationId = originalAttempt?.publicationId ?? requestedOnlyPublicationId;
  const [reads, setReads] = React.useState<Reads>({ networks: [], networksPhase: "loading", receipts: [], receiptsError: false });
  const [face, setFace] = React.useState<PublishFace>({ face: "idle" });
  const [platform, setPlatform] = React.useState<string>("");
  const [caption, setCaption] = React.useState<string>(() => piece ? captionReadOnly && piece.channel === "social_post" ? piece.body ?? "" : defaultCaption(piece) : "");
  const [captionEdited, setCaptionEdited] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [timing, setTiming] = React.useState<"now"|"later">("now"), [schedule, setSchedule] = React.useState<SocialSchedule|null>(null);
  const [moving, setMoving] = React.useState(false);
  const scope = `${tenantId}:${contentId}:${onlyPublicationId ?? ""}`, currentScope = React.useRef(scope), live = React.useRef(true);
  const readSequence = React.useRef(0);
  currentScope.current = scope;
  React.useEffect(() => { live.current=true; return () => { live.current=false; }; }, []);

  const pieceKindIsMedia = piece?.kind === "image" || piece?.kind === "video" || (Array.isArray(piece?.meta?.media_content_ids) && piece.meta.media_content_ids.length > 0);

  const readAll = React.useCallback(async () => {
    if (!tenantId || !contentId) return;
    const sequence=++readSequence.current;
    try {
    const [presence, receipts] = await Promise.all([
      supabase.rpc("get_social_presence_evidence" as never, {} as never),
      supabase.rpc("content_publication_list" as never, { p_content_id: contentId, p_tenant_id: tenantId } as never),
    ]);
    const presenceRows = Array.isArray(presence.data)
      ? (presence.data as unknown as SocialPresenceRow[]).filter((row) => row.tenant_id === tenantId)
      : [];
    const connections = presence.error || !presenceRows.length ? [] : classifyPresence(presenceRows).connections;
    const receiptRows = Array.isArray(receipts.data) ? (receipts.data as unknown as Array<Record<string, unknown>>) : [];
    if (!live.current || currentScope.current !== scope || sequence!==readSequence.current) return;
    setReads({
      networks: classifyPublishNetworks(SOCIAL_NETWORKS, connections),
      networksPhase: presence.error ? "error" : "ready",
      receiptsError: Boolean(receipts.error),
      receipts: prioritizePublicationReceipts(receiptRows.filter(row=>!onlyPublicationId||row.id===onlyPublicationId).map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        platform: typeof row.platform === "string" ? row.platform : null,
        destination: typeof (row.request_args as Record<string, unknown> | null)?.channel_label === "string"
          ? (row.request_args as { channel_label: string }).channel_label : null,
        status: typeof row.status === "string" ? row.status : "",
        url: typeof row.provider_post_url === "string" && row.provider_post_url ? row.provider_post_url : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
        providerProcessing: row.error_code === "provider_processing",
        schedule: readSocialSchedule((row.provider_response as {schedule?:{current?:unknown}}|null)?.schedule?.current) ?? storedSocialSchedule((row.request_args as Record<string,unknown>|null)?.schedule) ?? undefined,
        scheduleVersion: Number((row.provider_response as {schedule?:{version?:unknown}}|null)?.schedule?.version) || undefined,
      })).filter((row) => row.id)),
    });
    } catch {if(live.current&&currentScope.current===scope&&sequence===readSequence.current)setReads(previous=>({...previous,networksPhase:"error",receiptsError:true}));}
  }, [tenantId, contentId, scope]);

  React.useEffect(() => { void readAll(); }, [readAll]);

  const callDoor = async (body: Record<string, unknown>): Promise<PublishFace> => {
    try { const invoked = await supabase.functions.invoke("social-publish-command", { body });
      const errorBody = await readFunctionErrorBody(invoked.error, invoked.data);
      return doorFace(invoked.data as Record<string, unknown> | null, errorBody);
    } catch { return typeof body.publication_id === "string" ? {face:"outcome_unknown",publicationId:body.publication_id,sentence:SENTENCE_FALLBACK} : {face:"unreachable",sentence:SENTENCE_FALLBACK}; }
  };
  const accept = (next: PublishFace) => {
    if (!live.current || currentScope.current !== scope) return;
    setFace(next);setBusy(false);void readAll();
    if (["published","outcome_unknown","scheduled","cancelled"].includes(next.face) && "publicationId" in next) onPublicationRecorded?.(next.publicationId);
  };

  const connected = reads.networks.filter((n) => n.readiness === "connected");
  const chosen = reads.networks.find((n) => n.key === platform && n.readiness === "connected") ?? null;

  const prepare = async () => {
    if (!piece || !platform || busy || onlyPublicationId) return;
    const requestedSchedule = timing === "later" ? readSocialSchedule(schedule, Date.now()) : null;
    if (timing === "later" && !requestedSchedule) {setFace({face:"refused",sentence:"Choose a valid time more than two minutes ahead, then review the schedule."});return;}
    setBusy(true);
    setFace({ face: "calling", sentence: "Asking for the exact post to approve…" });
    const next = await callDoor({ action: "publish", expected_tenant_id: tenantId, content_id: piece.id,
      expected_content_revision: piece.updated_at, platform, caption: caption.trim() || null, ...(requestedSchedule ? {schedule:requestedSchedule} : {}) });
    accept(next.face === "approval_required" && (next.operation || !sameSchedule(requestedSchedule, next.schedule))
      ? {face:"refused",sentence:"That approval did not match the requested publishing time. Review the post again."} : next);
  };
  const approve = async () => {
    if (face.face !== "approval_required" || busy || (!face.operation && (!piece || onlyPublicationId))) return;
    setBusy(true);
    setFace({ face: "calling", sentence: face.operation === "cancel_schedule" ? "Checking the approved schedule cancellation…" : face.schedule ? "Committing the approved schedule…" : "Publishing the approved post…" });
    // The door requires the piece and channel on EVERY publish action (it re-validates them
    // against the claimed args before executing) — an approve body naming nothing is refused 400.
    const next = await callDoor({ action: face.operation ?? "publish", expected_tenant_id: tenantId, content_id: contentId,
      expected_content_revision: face.contentRevision ?? piece?.updated_at, platform: face.platform, caption: face.caption, approved_fingerprint: face.fingerprint,
      ...(face.schedule ? {schedule:face.schedule} : {}),...(face.operation ? {publication_id:face.publicationId,publication_version:face.publicationVersion} : {}) });
    accept(next);
  };
  const decline = async () => {
    if (face.face !== "approval_required" || busy) return;
    setBusy(true);
    setFace({ face: "calling", sentence: "Cancelling…" });
    const next = await callDoor({ action: "decline", expected_tenant_id: tenantId, fingerprint: face.fingerprint });
    // The door answers decline with { ok: true, state: "declined" }; a refusal to record the
    // decline is the door's own failure sentence, never a silent success.
    accept(next);
  };
  const reconcile = async (publicationId: string) => {
    if (busy) return;
    setBusy(true);
    setFace({ face: "calling", sentence: "Checking the original publication attempt…" });
    const next = await callDoor({ action: "reconcile", expected_tenant_id: tenantId, content_id: contentId, publication_id: publicationId });
    accept(next);
  };
  const changeSchedule = async (receipt: PublicationReceipt, operation: "reschedule"|"cancel_schedule") => {
    if (busy || !receipt.scheduleVersion) return;
    const requestedSchedule = operation === "reschedule" ? readSocialSchedule(schedule, Date.now()) : readSocialSchedule(receipt.schedule);
    if (!requestedSchedule) {setFace({face:"refused",sentence:"The scheduled time could not be verified. Check the original attempt, then review the change again."});return;}
    setBusy(true);setFace({face:"calling",sentence:"Preparing the exact schedule change to approve…"});
    const next = await callDoor({action:operation,expected_tenant_id:tenantId,content_id:contentId,publication_id:receipt.id,publication_version:receipt.scheduleVersion,
      ...(operation === "reschedule" ? {schedule:requestedSchedule} : {})});
    accept(next.face === "approval_required" && (next.operation !== operation || next.publicationId !== receipt.id
      || next.publicationVersion !== receipt.scheduleVersion || !sameSchedule(requestedSchedule, next.schedule))
      ? {face:"refused",sentence:"That approval did not match this original schedule change. Check the same original receipt and review again."} : next);
  };
  const reset = () => { setFace({ face: "idle" }); };

  return <section className="mct-pubdoor" aria-labelledby="mct-pubdoor-h">
    <h3 id="mct-pubdoor-h">Publish to a channel</h3>

    {face.face === "approval_required" ? <>
      <p className="mct-pubdoor-summary">{face.summary}</p>
      <div className="mct-pubdoor-preview">
        <span className="mct-pubdoor-chip">{face.channelLabel || face.platform}</span>
        {face.media?.map((media) => media.type === "video"
          ? <video key={media.contentId} src={media.url} controls preload="metadata" aria-label={media.alt}/>
          : <img key={media.contentId} src={media.url} alt={media.alt}/>)}
        <p>{face.caption}</p>
        {face.schedule && <p>{face.operation === "cancel_schedule" ? "Stop schedule: " : "Scheduled time: "}{socialScheduleLabel(face.schedule)}</p>}
        {face.expiresAt && <small>Approval expires {new Date(face.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "numeric" })}.</small>}
      </div>
      <div className="mct-pubdoor-acts">
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => void approve()}>{face.operation === "cancel_schedule" ? "Approve stopping this schedule" : face.schedule ? "Approve this schedule once" : "Approve and post once"}</button>
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => void decline()}>Not now</button>
      </div>
    </> : face.face === "calling" ? <p className="mct-pubdoor-state" role="status">{face.sentence}</p>
    : face.face === "published" ? <div className="mct-pubdoor-result mct-pubdoor-ok">
        {face.notice&&<p>{face.notice}</p>}
        <p>Published{face.url ? <> — <a href={face.url} target="_blank" rel="noreferrer">see the post</a></> : "."}</p>
        <button type="button" className="mov-lnk" onClick={reset}>Back to channels</button>
      </div>
    : face.face === "scheduled" || face.face === "cancelled" ? <div className="mct-pubdoor-result mct-pubdoor-ok">
        <p>{face.face === "scheduled" ? "Scheduled at provider. Publication has not been confirmed." : "The provider returned this post to draft. This does not remove a post that was already live."}</p>
        <p>{socialScheduleLabel(face.schedule)}</p><button type="button" className="mov-lnk" onClick={reset}>Back to original receipt</button>
      </div>
    : face.face === "partial" ? <div className="mct-pubdoor-result">
        <p>Partially published{face.url ? <> — <a href={face.url} target="_blank" rel="noreferrer">see what posted</a></> : "."} Check the channel to see what went out.</p>
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : face.face === "outcome_unknown" ? <div className="mct-pubdoor-result mct-pubdoor-warn">
        <p role="status">{face.sentence}</p>
        {face.publicationId && <button type="button" className="btn btn-s" disabled={busy} onClick={() => void reconcile(face.publicationId)}>Check this attempt</button>}
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : face.face === "declined" ? <div className="mct-pubdoor-result">
        <p>This proposal was declined. Existing provider schedules remain unchanged.</p>
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : face.face === "failed" || face.face === "refused" || face.face === "channel_blocked" || face.face === "not_configured" || face.face === "retry_blocked" || face.face === "signed_out" || face.face === "not_permitted" || face.face === "unreachable" ? <div className="mct-pubdoor-result">
        <p>{face.sentence}</p>
        {(face.face === "channel_blocked" || face.face === "not_configured") && <a className="mov-lnk" href={connectionsHref}>Settings → Integrations</a>}
        <button type="button" className="mov-lnk" onClick={reset}>Back</button>
      </div>
    : <>
      {onlyPublicationId ? <p className="mct-pubdoor-state">Check the original attempt below. This view cannot create another post.</p>
      : reads.networksPhase === "loading" ? <p className="mct-pubdoor-state" role="status">Reading your connected channels…</p>
      : reads.networksPhase === "error" ? <p className="mct-pubdoor-state">Your connected channels couldn't be read. Nothing was posted.</p>
      : !connected.length ? <p className="mct-pubdoor-state">No channel is connected yet. Connect one in <a className="mov-lnk" href={connectionsHref}>Settings → Integrations</a> and it appears here.</p>
      : <>
        <div className="mct-pubdoor-nets" role="group" aria-label="Channel">
          {reads.networks.map((network) => network.readiness === "connected" && (!pieceKindIsMedia || network.key === "threads")
            ? <button key={network.key} type="button" className="mct-pubdoor-net" aria-pressed={platform === network.key} onClick={() => setPlatform(network.key)}>
                {network.label}<small>{network.note}</small>
              </button>
            : <span key={network.key} className="mct-pubdoor-net mct-pubdoor-net-off" aria-disabled="true">
                {network.label}<small>{network.readiness === "connected" && pieceKindIsMedia ? "Connected · this media format is not available here" : <>{network.note} — <a className="mov-lnk" href={connectionsHref}>Settings → Integrations</a></>}</small>
              </span>)}
        </div>
        {chosen && <>
          <label className="mct-pubdoor-caption" htmlFor="mct-pubdoor-words">The words that will post</label>
          <textarea id="mct-pubdoor-words" value={captionEdited ? caption : caption} maxLength={2200} rows={Math.min(6, Math.ceil(caption.length / 60) + 1)}
            readOnly={captionReadOnly} onChange={(event) => { setCaption(event.target.value); setCaptionEdited(true); }}/>
          {pieceKindIsMedia && <p className="mct-pubdoor-note">The saved media appears in the exact preview before approval. Media publishing currently supports Threads; other platform formats remain unavailable here.</p>}
          <div className="mct-pubdoor-timing" role="group" aria-label="When to publish"><button type="button" className="btn btn-s" aria-pressed={timing === "now"} onClick={() => setTiming("now")}>Publish now</button><button type="button" className="btn btn-s" aria-pressed={timing === "later"} onClick={() => setTiming("later")}>Schedule for later</button></div>
          {timing === "later" && <SocialScheduleFields value={schedule} onChange={setSchedule} disabled={busy} />}
          <div className="mct-pubdoor-acts">
            <button type="button" className="btn btn-s" disabled={busy || !caption.trim() || (timing === "later" && !schedule)} onClick={() => void prepare()}>{timing === "later" ? "Review schedule" : "Prepare to publish"}</button>
          </div>
        </>}
        <p className="mct-pubdoor-note">Review the exact caption, media, destination and time before approval. An accepted future schedule stays with the provider until a cancellation is confirmed.</p>
      </>}
      {reads.receiptsError && <p className="mct-pubdoor-state" role="status">Recent attempts could not be loaded. Reload this piece to check their results.</p>}
      {reads.receipts.length > 0 && <div className="mct-pubdoor-history">
        <h4>Recent attempts for this piece</h4>
        <ul>{reads.receipts.filter(receipt => !onlyPublicationId || receipt.id === onlyPublicationId).map((receipt) => <li key={receipt.id}>
          <span>{receipt.destination ?? receipt.platform ?? "Channel"}</span>
          <em className={receipt.status === "published" ? "mct-pubdoor-ok" : receipt.status === "outcome_unknown" || receipt.status === "publishing" || receipt.status === "approved" || receipt.status === "registered" ? "mct-pubdoor-warn" : ""}>
            {receipt.status === "outcome_unknown" && receipt.providerProcessing ? "Last reported as processing" : PUBLICATION_STATUS_WORDS[receipt.status] ?? receipt.status}
          </em>
          {receipt.url && <a href={receipt.url} target="_blank" rel="noreferrer">see the post</a>}
          {receipt.schedule && <p>{socialScheduleLabel(receipt.schedule)}</p>}
          {canCheckAttempt(receipt.status) &&
            <button type="button" className="mov-lnk" disabled={busy} onClick={() => void reconcile(receipt.id)}>Check this attempt</button>}
          {receipt.status === "scheduled" && onlyPublicationId === receipt.id && receipt.scheduleVersion && <div>
            <button type="button" className="btn btn-s" disabled={busy} onClick={() => {setMoving(v => !v);setSchedule(null);}}>Change scheduled time</button>
            <button type="button" className="btn btn-s" disabled={busy} onClick={() => void changeSchedule(receipt,"cancel_schedule")}>Review cancellation</button>
            {moving && <><p>The approved caption and media stay with this same provider job. Revise the saved draft separately for another post.</p><SocialScheduleFields value={schedule} onChange={setSchedule} disabled={busy} /><button type="button" className="btn btn-s" disabled={busy || !schedule} onClick={() => void changeSchedule(receipt,"reschedule")}>Review new time</button></>}
          </div>}
        </li>)}</ul>
      </div>}
    </>}
  </section>;
}
