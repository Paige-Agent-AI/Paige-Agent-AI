// Marketing › Social › Go live (EXP07 broadcast slice — the live-room control surface).
//
// The customer outcome: "I want to go live from my business." This panel is the button the
// owner asked for on the Social tab. It opens a live room through the governed
// `broadcast-command` door — the provider (Cloudflare RealtimeKit), the platform credential
// and admission are the door's job, never this file's. Every state below mirrors what the
// door actually said: dormant says it isn't switched on yet (no dead button — the same
// honesty the missions panel practices), ready offers the act, live shows the room's own
// facts, ended names what the session was and was not. Nothing invented, nothing promised
// that a later slice doesn't already ship.
//
// Slice scope, stated so the copy can't drift: a live room is the host plus guests the host
// admits on a PAIGE-minted link. Simulcast to connected social channels and a public watch
// page arrive with the simulcast slice; replays arrive with the recording slice. The panel
// says exactly that much and no more.
//
// Reads/writes: ONLY `broadcast-command` (status/open/end). Social connections are consumed
// read-only and Connect/Reconnect stays in Settings → Integrations (owner alignment
// 2026-10-28) — this surface never grows a second connect flow.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { Ic } from "./_shared";

/** What the door said, in the four labels the Social surface already speaks. */
type GoLivePhase = "checking" | "unavailable" | "ready" | "live" | "ended";

/** The session facts the door mints. Every field is the door's own — none is synthesized here. */
type LiveSession = {
  id: string;
  title: string;
  started_at: string;
  guest_url: string;
};

const sessionFrom = (s: Record<string, unknown> | null | undefined): LiveSession | null =>
  s && typeof s.id === "string" && typeof s.title === "string" && typeof s.started_at === "string" && typeof s.guest_url === "string"
    ? { id: s.id, title: s.title, started_at: s.started_at, guest_url: s.guest_url }
    : null;

const TRUTH_LABEL: Record<GoLivePhase, string> = {
  checking: "UNAVAILABLE",
  unavailable: "UNAVAILABLE",
  ready: "PARTIAL",
  live: "LIVE",
  ended: "PARTIAL",
};

const minutesLive = (startedAt: string, now: number) => {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const mins = Math.max(0, Math.floor((now - started) / 60_000));
  return mins < 1 ? "under a minute" : `${mins} min`;
};

export function GoLive({ tenantId }: { tenantId: string }) {
  // Mounted only when the Social surface has resolved the workspace (the parent gates it):
  // contract mounts without a workspace never render this panel and never touch transport.
  const [phase, setPhase] = React.useState<GoLivePhase>("checking");
  const [session, setSession] = React.useState<LiveSession | null>(null);
  const [title, setTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const callDoor = async (body: Record<string, unknown>) => {
    const invoked = await supabase.functions.invoke("broadcast-command", { body: { ...body, expected_tenant_id: tenantId } });
    const errorBody = await readFunctionErrorBody(invoked.error, invoked.data);
    return { data: invoked.data as Record<string, unknown> | null, errorBody };
  };

  React.useEffect(() => {
    let alive = true;
    const readStatus = async () => {
      let data: Record<string, unknown> | null = null;
      try {
        data = (await callDoor({ action: "status" })).data;
      } catch {
        // Unreachable door (not deployed, network) — same honest answer as dormant.
        data = null;
      }
      if (!alive) return;
      // Fail-closed: a door that cannot be reached, isn't deployed, or reports itself
      // dormant all mean the same honest thing — broadcasting is not switched on. This
      // panel never renders readiness the door didn't assert.
      if (data?.ok && data.state === "ready") { setPhase("ready"); return; }
      if (data?.ok && data.state === "live" && data.session && typeof data.session === "object") {
        const live = sessionFrom(data.session as Record<string, unknown>);
        if (live) {
          setSession(live);
          setPhase("live");
          return;
        }
      }
      setPhase("unavailable");
    };
    void readStatus();
    return () => { alive = false; };
    // Status is read once per mount, the same rhythm the media library uses; the tenant
    // switch remounts the Social page and therefore this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  React.useEffect(() => {
    if (phase !== "live") return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const goLive = async () => {
    if (busy || phase !== "ready") return;
    setBusy(true); setNote("");
    let data: Record<string, unknown> | null = null;
    let errorBody: Record<string, unknown> | null = null;
    try {
      const answered = await callDoor({ action: "open", title: title.trim() || "Live from my business" });
      data = answered.data; errorBody = answered.errorBody;
    } catch {
      data = null; errorBody = null;
    }
    const live = data?.ok ? sessionFrom(data.session as Record<string, unknown> | undefined) : null;
    if (!data?.ok || !live) {
      // The door’s refusal vocabulary is closed; if it left a sentence, show it, else this
      // honest one. Provider prose never reaches the customer.
      const sentence = typeof errorBody?.error === "string" && !/non-2xx/i.test(errorBody.error) ? errorBody.error : "The room couldn’t be opened. Nothing is running — try again in a moment.";
      setNote(sentence); setBusy(false); return;
    }
    setSession(live);
    setPhase("live"); setBusy(false); setNote("");
  };

  const endBroadcast = async () => {
    if (busy || phase !== "live") return;
    setBusy(true); setNote("");
    let confirmed = false;
    try {
      confirmed = Boolean((await callDoor({ action: "end" })).data?.ok);
    } catch {
      confirmed = false;
    }
    // Ended is ended only when the door confirmed it — the next status read is the truth
    // the panel defers to rather than optimistically claiming the end.
    if (confirmed) { setPhase("ended"); setBusy(false); return; }
    setNote("The broadcast couldn’t be ended from here. Refresh in a moment — the room’s own state is the truth.");
    setBusy(false);
  };

  const copyLink = async () => {
    if (!session?.guest_url) return;
    try {
      await navigator.clipboard?.writeText(session.guest_url);
      setNote("Guest link copied.");
    } catch {
      setNote("The link couldn’t be copied — select it and copy manually.");
    }
  };

  const badge = TRUTH_LABEL[phase];

  return <section className="social-golive" aria-labelledby="social-golive-h" data-golive-phase={phase}>
    <div className="social-golive-head">
      <span className="social-golive-glyph"><Ic.broadcast size={16} style={{}} /></span>
      <div className="social-golive-title">
        <span className="social-eyebrow">Live broadcasting</span>
        <h2 id="social-golive-h">Go live</h2>
      </div>
      <span className={`social-truth social-truth--${badge.toLowerCase()}`}>{badge}</span>
    </div>

    {phase === "checking" && (
      <p className="social-golive-body" role="status">Checking whether live broadcasting is switched on…</p>
    )}

    {phase === "unavailable" && (
      <p className="social-golive-body">
        Live broadcasting isn’t switched on for your workspace yet. When it is, you’ll open a
        live room from here — your camera and voice, with people from your workspace joining
        you on a link PAIGE mints for the session.
      </p>
    )}

    {phase === "ready" && (
      <div className="social-golive-ready">
        <p className="social-golive-body">
          Open a live room and bring people from your workspace in on a private link — each
          joins with their own PAIGE sign-in. Broadcasting straight to your connected
          channels arrives once each platform grants live access; your connections live in
          Settings → Integrations.
        </p>
        <div className="social-golive-acts">
          <label className="social-golive-field">
            <span className="social-golive-field-label">Name this broadcast (optional)</span>
            <input
              type="text"
              value={title}
              maxLength={120}
              placeholder="Live from my business"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button type="button" className="btn btn-s btn-g social-golive-act" disabled={busy} onClick={() => void goLive()}>
            <Ic.arrow size={13} style={{}} />{busy ? "Opening…" : "Go live"}
          </button>
        </div>
      </div>
    )}

    {phase === "live" && session && (
      <div className="social-golive-live">
        <p className="social-golive-live-line">
          <span className="social-golive-live-dot" aria-hidden="true" />
          <strong>{session.title}</strong>
          {minutesLive(session.started_at, now) ? <span> · live for {minutesLive(session.started_at, now)}</span> : null}
        </p>
        <p className="social-golive-body">
          Your room is open — open it from here. People in this workspace join on the link
          below, each with their own PAIGE sign-in. Bringing in outside guests arrives with
          the guest-admission update.
        </p>
        <div className="social-golive-linkrow">
          <a className="btn btn-s btn-g" href={`/live/${session.id}`}>Open the room</a>
          <span className="social-golive-link mono" data-golive-guest-link>{session.guest_url}</span>
          <button type="button" className="btn btn-s" onClick={() => void copyLink()}>Copy join link</button>
          <button type="button" className="btn btn-s" disabled={busy} onClick={() => void endBroadcast()}>End broadcast</button>
        </div>
        {/* The room itself lives at /live/:id — one implementation for host and seated
            members, SDK code-split to that route; this panel is the control surface. */}
      </div>
    )}

    {phase === "ended" && session && (
      <div className="social-golive-ended">
        <p className="social-golive-body">
          “{session.title}” has ended. This session wasn’t recorded — replays arrive with the
          recording feature.
        </p>
        <div className="social-golive-acts">
          <button type="button" className="btn btn-s btn-g social-golive-act" disabled={busy} onClick={() => { setPhase("ready"); setNote(""); }}>
            <Ic.arrow size={13} style={{}} />Go live again
          </button>
        </div>
      </div>
    )}

    <p className="social-golive-note" role="status" aria-live="polite">{note}</p>
  </section>;
}
