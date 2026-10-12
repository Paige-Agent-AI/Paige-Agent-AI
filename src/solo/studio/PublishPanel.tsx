// "Ready to go live?" — the one going-live act, through the one publish door (growth-publish-command,
// the executor chat publishing uses too). Opening the panel asks the door to prepare: the server runs
// its readiness checks and, when nothing blocks, returns a fingerprint. The owner's click is the
// approval that redeems it. The panel never calls a publish RPC, never invents a check, and reports
// "It's live" only with the address the door's readback returned. Gold is spent on Publish and
// nowhere else.
import React from "react";
import { Check, X, Circle } from "lucide-react";
import {
  confirmPublication, plainError, preparePublication, PublishForbidden, PublishNotDone, PublishOff, PublishRefused,
  PublishUnverified, type Prepared, type PublishAction, type PublishCheck, type PublishForbiddenReason,
} from "./studio-data";
import { artifactId, hasPendingChanges, isLive, type LoadedArtifact } from "./artifact-state";

// "error": nothing armed. The message says why; the button re-prepares ("Try again" when the door
// said nothing ran, "Check again" otherwise). A used fingerprint is never left armed.
type Prep = Prepared | { state: "preparing" } | { state: "error"; message: string; retry?: boolean };

/** Who or where the door refused, in the owner's words: a heading for the fact, a line for the way out. */
const FORBIDDEN_COPY: Record<PublishForbiddenReason, [string, string]> = {
  not_admin: ["Only an owner or admin can publish", "Ask this workspace's owner to publish it, or to give you admin access."],
  no_workspace: ["Open this workspace first", "Paige publishes only in the workspace you're working in. Open the one this piece belongs to, then try again."],
  other_workspace: ["This piece belongs to another workspace", "Switch into that workspace to publish it from here."],
};
const UNPUBLISH_OFF = "Unpublishing is switched off in your Trust Compass, so it stays live from here. To take it offline, turn it on in Command Center › Trust Compass.";

const CHECK_FAILED = "Paige couldn't check this just now. Try again in a moment.";

/** The door may return a path; the owner always sees a full address they can copy. */
function absolute(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `${window.location.origin}${u.startsWith("/") ? "" : "/"}${u}`;
}

function CheckList({ checks, label }: { checks: PublishCheck[]; label: string }) {
  if (!checks.length) return null;
  return (
    <ul className="vs-checks" aria-label={label}>
      {checks.map((c) => (
        <li key={c.key}>
          {/* A failed check that doesn't block (an alert email, a thank-you message) is advice: the
              neutral optional mark, never a cross. */}
          {c.ok ? <Check size={15} color="var(--vs-good)" aria-label="Done" />
            : c.blocking ? <X size={15} color="var(--vs-bad)" aria-label="Blocks this" />
            : <Circle size={13} color="var(--vs-faint)" aria-label="Optional" />}
          <span>{c.label}{c.detail && <small>{c.detail}</small>}</span>
        </li>
      ))}
    </ul>
  );
}

/** While the server checks: three quiet rows in the checklist's own shape, and a line naming the work. */
function Checking({ text }: { text: string }) {
  return (
    <>
      <p className="vs-pop-status" role="status">{text}</p>
      <ul className="vs-checks vs-checks-skel" aria-hidden="true"><li><i /><b /></li><li><i /><b /></li><li><i /><b /></li></ul>
    </>
  );
}

export function PublishPanel({ artifact, onClose, onDone, onRefresh }: {
  artifact: LoadedArtifact;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Re-read the artifact without announcing success (an unverified publish). */
  onRefresh?: () => void;
}) {
  const live = isLive(artifact);
  const pending = hasPendingChanges(artifact);
  const kind = artifact.kind;
  const id = artifactId(artifact);
  // Saved copy and documents live in the project but are never published from the Studio; the door
  // would refuse them, so the panel says so without asking.
  const notPublishable = artifact.kind === "content" && artifact.image.contentKind !== "image";
  const [republish, setRepublish] = React.useState(false); // a live funnel's "Publish again"
  // After an unverified publish the re-read may report the piece as live, but nothing proved an
  // address: the panel keeps its "may not be live" answer instead of turning into "This is live".
  const [unproven, setUnproven] = React.useState(false);
  const view: "publish" | "live" = live && !pending && !republish && !unproven ? "live" : "publish";

  const [preps, setPreps] = React.useState<Partial<Record<PublishAction, Prep>>>({});
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState<PublishAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);

  const firstRef = React.useRef<HTMLButtonElement | null>(null);
  const primaryRef = React.useRef<HTMLButtonElement | null>(null);
  const keepRef = React.useRef<HTMLButtonElement | null>(null);
  const doneRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const alive = React.useRef(true);
  const finished = React.useRef(false);
  const seq = React.useRef<Record<PublishAction, number>>({ publish: 0, unpublish: 0 });
  const refreshRef = React.useRef(onRefresh);
  refreshRef.current = onRefresh;
  const busyRef = React.useRef(busy);
  busyRef.current = busy;
  const confirmingRef = React.useRef(confirming);
  confirmingRef.current = confirming;

  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** Ask the door to prepare an act. Only the latest request for that act lands. */
  const prepare = React.useCallback(async (action: PublishAction): Promise<Prep> => {
    const n = ++seq.current[action];
    setPreps((p) => ({ ...p, [action]: { state: "preparing" } }));
    let next: Prep;
    try {
      next = await preparePublication(kind, id, action);
    } catch (e) {
      next = { state: "error", message: plainError(e, CHECK_FAILED) };
      if (e instanceof PublishUnverified) refreshRef.current?.();
    }
    if (alive.current && n === seq.current[action]) setPreps((p) => ({ ...p, [action]: next }));
    return next;
  }, [kind, id]);

  // Opening the panel prepares its main act: publish, or, for something already live, unpublish
  // (so a refusal such as "a live funnel uses this page" is on screen before anyone clicks).
  React.useEffect(() => {
    if (notPublishable || finished.current) return;
    void prepare(view === "live" ? "unpublish" : "publish");
  }, [view, notPublishable, prepare]);

  React.useEffect(() => { firstRef.current?.focus(); }, []);
  React.useEffect(() => { if (url) doneRef.current?.focus(); }, [url]);
  React.useEffect(() => { if (confirming) keepRef.current?.focus(); }, [confirming]);
  // When the panel's body changes under the focused control (a state replaced it, or the pressed
  // button went disabled while the door answered), focus drops to the page. Put it back: on the
  // act after a re-check ("press Publish now to go ahead"), otherwise on the panel's safe exit.
  React.useEffect(() => {
    const el = panelRef.current;
    if (busy || !el || (document.activeElement && document.activeElement !== document.body)) return;
    const usable = (b: HTMLButtonElement | null) => (b && el.contains(b) && !b.disabled ? b : null);
    (usable(note ? primaryRef.current : null) ?? usable(firstRef.current) ?? el.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
  });
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (busyRef.current) return; // an act in flight keeps the panel until its answer lands
      if (confirmingRef.current) { setConfirming(false); return; }
      onClose();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);

  const pub = preps.publish;
  const out = preps.unpublish;
  const publishLabel = republish ? "Publish again" : pending ? "Publish changes" : "Publish now";

  const redeem = async (action: PublishAction) => {
    const p = preps[action];
    if (!p || p.state !== "ready" || busy) return;
    setBusy(action); setError(null); setNote(null);
    try {
      const res = await confirmPublication(kind, id, action, p.fingerprint);
      if (!alive.current) return;
      finished.current = true;
      if (action === "publish") {
        // confirmPublication only returns a publish once the door's readback proves the address.
        const full = absolute(res.url ?? "");
        setUrl(full);
        onDone(`Live at ${full}`);
      } else {
        onDone("Unpublished. It's back to a draft here in the Studio.");
        onClose();
      }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof PublishRefused) {
        // Usually the fingerprint went stale (the piece changed, or the approval expired). The used
        // fingerprint is never left armed: one fresh prepare for this click, and the owner's next
        // click is a fresh approval — never an automatic retry.
        const again = await prepare(action);
        if (!alive.current) return;
        if (again.state === "ready") {
          setNote(`${e.message} Paige checked it again. Press ${action === "publish" ? publishLabel : "Take it offline"} to go ahead.`);
        } else {
          setError(e.message);
        }
      } else if (e instanceof PublishOff) {
        setPreps((s) => ({ ...s, [action]: { state: "disabled", message: e.message } }));
      } else if (e instanceof PublishForbidden) {
        setPreps((s) => ({ ...s, [action]: { state: "forbidden", reason: e.reason, message: e.message } }));
      } else if (e instanceof PublishNotDone) {
        // The door says nothing ran. Disarm the fingerprint; "Try again" prepares afresh.
        setPreps((s) => ({ ...s, [action]: { state: "error", message: e.message, retry: true } }));
      } else {
        // It may have run (unverified, or the answer was lost). The fingerprint is spent either way.
        const message = plainError(e, action === "publish" ? "It didn't go live. Nothing changed; try again." : "It couldn't be taken down. It's still live.");
        setPreps((s) => ({ ...s, [action]: { state: "error", message } }));
        // The server may have changed the piece without proving it: re-read so the Studio shows
        // what is stored, not the state from before the click.
        if (e instanceof PublishUnverified) {
          if (action === "publish") setUnproven(true);
          refreshRef.current?.();
        }
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const startUnpublish = () => {
    setError(null); setNote(null); setConfirming(true);
    if (!out || out.state === "error" || out.state === "refused") void prepare("unpublish");
  };
  const againLabel = (p: Prep | undefined) => (p?.state === "error" && p.retry ? "Try again" : "Check again");
  const unpublishOff = out?.state === "disabled" ? <p>{UNPUBLISH_OFF}</p> : null;

  // ── States that replace the panel's body ─────────────────────────────────────
  // Only publishing itself being off replaces the panel. Unpublishing off (a live piece prepares its
  // unpublish on open) keeps the live view and says so where the Unpublish control is.
  const offBy = pub?.state === "disabled";
  const forbiddenBy = [pub, out].find((p) => p?.state === "forbidden") as { reason: PublishForbiddenReason } | undefined;

  if (url) {
    return (
      <div ref={panelRef} className="vs-pop" role="dialog" aria-label="It's live">
        <h2>It's live</h2>
        <p>Anyone with the link can open it, and it's in Marketing › Overview.</p>
        <a href={url} target="_blank" rel="noreferrer" className="vs-link" style={{ wordBreak: "break-all" }}>{url}</a>
        <div className="vs-pop-foot"><button ref={doneRef} type="button" className="vs-btn" onClick={onClose}>Done</button></div>
      </div>
    );
  }
  if (offBy || forbiddenBy) {
    return (
      <div ref={panelRef} className="vs-pop" role="dialog" aria-label={offBy ? "Publishing is switched off" : FORBIDDEN_COPY[forbiddenBy!.reason][0]}>
        <h2>{offBy ? "Publishing is switched off" : FORBIDDEN_COPY[forbiddenBy!.reason][0]}</h2>
        {/* The heading carries the fact; the body says what to do, so nothing is said twice. */}
        <p>{offBy
          ? "Your Trust Compass doesn't let Paige publish in this workspace, so nothing goes live from here. To publish, turn it back on in Command Center › Trust Compass."
          : FORBIDDEN_COPY[forbiddenBy!.reason][1]}</p>
        <div className="vs-pop-foot"><button ref={firstRef} type="button" className="vs-btn" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  /** The inline "Take it offline?" step: the second call redeems the prepared unpublish. */
  const confirmOut = (
    <div className="vs-pop-confirm" role="group" aria-labelledby="vs-out-title">
      <h3 id="vs-out-title">Take it offline?</h3>
      {/* The "This is live" text above already says it returns to a draft; don't say it twice. */}
      <p>{view === "live" ? "Visitors lose the link right away." : "Visitors lose the link right away, and it goes back to a draft here in the Studio."}</p>
      {out?.state === "preparing" && <Checking text="Paige is checking whether it can come down…" />}
      {out?.state === "blocked" && <CheckList checks={out.preview.checks.filter((c) => !c.ok && c.blocking)} label="Why it can't come down yet" />}
      {(out?.state === "refused" || out?.state === "error") && <p className="vs-alert" role="alert">{out.message}</p>}
      {unpublishOff}
      <div className="vs-pop-foot">
        <button ref={keepRef} type="button" className="vs-btn vs-btn-quiet" disabled={busy === "unpublish"} onClick={() => setConfirming(false)}>Keep it live</button>
        {out?.state === "error" ? (
          <button type="button" className="vs-btn" onClick={() => void prepare("unpublish")}>{againLabel(out)}</button>
        ) : (
          <button type="button" className="vs-btn vs-btn-danger" disabled={out?.state !== "ready" || !!busy} onClick={() => void redeem("unpublish")}>
            {busy === "unpublish" ? "Taking it offline…" : "Take it offline"}
          </button>
        )}
      </div>
    </div>
  );
  const messages = (
    <>
      {note && <p className="vs-pop-note" role="status">{note}</p>}
      {error && <p className="vs-alert" role="alert">{error}</p>}
    </>
  );

  if (view === "live") {
    return (
      <div ref={panelRef} className="vs-pop" role="dialog" aria-label="This is live">
        <h2>This is live</h2>
        <p>Visitors see the published version. Unpublishing moves it back to a draft here; anything that depends on it stays as it is.</p>
        {kind === "funnel" && <p>Changed one of its pages or forms? Publish again to put every step's latest saved version live.</p>}
        {!confirming && out?.state === "blocked" && <CheckList checks={out.preview.checks.filter((c) => !c.ok && c.blocking)} label="Why it can't come down yet" />}
        {!confirming && unpublishOff}
        {!confirming && (out?.state === "refused" || out?.state === "error") && (
          <p className="vs-alert" role="alert">{out.message}</p>
        )}
        {messages}
        {confirming ? confirmOut : (
          <div className="vs-pop-foot">
            <button ref={firstRef} type="button" className="vs-btn vs-btn-quiet" onClick={onClose}>Close</button>
            {out?.state === "error"
              ? <button type="button" className="vs-btn" onClick={() => void prepare("unpublish")}>{againLabel(out)}</button>
              : <button type="button" className="vs-btn vs-btn-danger" disabled={out?.state !== "ready" || !!busy} aria-busy={out?.state === "preparing"} onClick={startUnpublish}>Unpublish</button>}
            {kind === "funnel" && <button type="button" className="vs-btn vs-btn-gold" disabled={!!busy} onClick={() => { setError(null); setNote(null); setRepublish(true); }}>Publish again</button>}
          </div>
        )}
      </div>
    );
  }

  const ready = pub?.state === "ready";
  const blocked = pub?.state === "blocked";
  // The prepared address is a promise; once a publish failed to prove it, stop showing it.
  const address = ready && !unproven && pub.preview.address ? absolute(pub.preview.address) : null;
  const heading = republish ? "Put every step live again?" : pending ? "Put your changes live?" : "Ready to go live?";
  return (
    <div ref={panelRef} className="vs-pop" role="dialog" aria-label={heading}>
      <h2>{heading}</h2>
      <p>{republish ? "Each page and form in it goes live at its latest saved version." : pending ? "Visitors keep seeing the current version until you do." : "It gets a public link and moves to Marketing › Overview."}</p>
      {notPublishable ? (
        <ul className="vs-checks">
          <li>
            <X size={15} color="var(--vs-bad)" aria-label="Blocks this" />
            <span>{artifact.kind === "content" && artifact.image.contentKind === "document" ? "Documents aren't published from the Studio" : "Copy isn't published from the Studio"}<small>Use it in a page, an email or a post instead.</small></span>
          </li>
        </ul>
      ) : (
        <>
          {(!pub || pub.state === "preparing") && <Checking text="Paige is checking it against what's saved…" />}
          {(ready || blocked) && <CheckList checks={pub.preview.checks} label="Paige's checks" />}
          {ready && pub.preview.checks.length === 0 && (
            <ul className="vs-checks"><li><Circle size={13} color="var(--vs-faint)" aria-hidden="true" /><span>Nothing blocks it.</span></li></ul>
          )}
          {blocked && <p>Fix what's marked, or ask Paige to, then publish.</p>}
          {address && <p className="vs-pop-address">Goes live at <b>{address}</b></p>}
          {(pub?.state === "refused" || pub?.state === "error") && <p className="vs-alert" role="alert">{pub.message}</p>}
        </>
      )}
      {messages}
      {confirming ? confirmOut : (
        <div className="vs-pop-foot">
          {live && <button type="button" className="vs-btn vs-btn-danger" disabled={!!busy} onClick={startUnpublish}>Unpublish</button>}
          <button ref={firstRef} type="button" className="vs-btn vs-btn-quiet" disabled={!!busy} onClick={republish ? () => setRepublish(false) : onClose}>{republish ? "Back" : "Not yet"}</button>
          {pub?.state === "error" ? (
            <button type="button" className="vs-btn" onClick={() => void prepare("publish")}>{againLabel(pub)}</button>
          ) : (
            <button ref={primaryRef} type="button" className="vs-btn vs-btn-gold" disabled={notPublishable || !ready || !!busy} onClick={() => void redeem("publish")}>
              {busy === "publish" ? "Publishing…" : !notPublishable && (!pub || pub.state === "preparing") ? "Checking…" : publishLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
