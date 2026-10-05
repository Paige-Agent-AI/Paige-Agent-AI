// Marketing › Email: email series (E3) — welcome, nurture and win-back emails that send by themselves once
// the owner approves the series. The Automations panel on the dashboard lists them; the series view builds,
// files, approves, runs and stops one.
//
// Reads:  read_email_sequences (the panel) · read_email_sequence (one series, as it sends)
//         email_audience_preview (who a rule reaches today) — the same read the campaign editor uses
// Acts:   email_sequence_create · email_sequence_update_draft · email_sequence_step_save · _step_delete ·
//         _step_move · email_sequence_request_approval · email_sequence_approve · email_sequence_decline ·
//         email_sequence_edit · email_sequence_discard_draft · email_sequence_pause · _resume · _stop ·
//         email_sequence_remove_contact · email_sequence_delete
// Every act is an RPC PAIGE can call too (§10). Only email_sequence_approve lets a series send, and only a
// person who owns or administers the business can call it; the database refuses everyone else.
// Sending itself is the campaign substrate's (email-campaign-worker): nothing on this page sends.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Ic as SharedIcons } from "./_shared";
import { blockReason } from "./marketing-email-model";
import { Reach, RuleBuilder, errorWords, roveRadios, ruleSummary, useAudiencePreview, type Rule } from "./marketing-email-editor";
import { markupToHtml, previewDocument, renderCampaignEmail, sourceOf } from "./email-markup";
import { Frame, type Phase } from "./marketing-planned";
import { AskPaige } from "./marketing-ui";
import {
  LEFT_REASON, MAX_STEPS, SERIES_ERROR, SERIES_KIND_LABEL, dayWords, hoursFromJoin, joinWait, seriesState, spanWords, splitWait,
  startSummary, waitWords, type SeriesKind, type SeriesRead, type SeriesRow, type SeriesSender,
} from "./marketing-email-series-model";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
type RpcError = { message?: string; details?: string; code?: string } | null;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);

/** A series refusal in the owner's words. */
export const seriesErrorWords = (error: RpcError) =>
  error?.message === "step_incomplete" ? (error.details || "Every email needs a subject and words.")
    : SERIES_ERROR[error?.message ?? ""] ?? errorWords(error);

const GOALS = [
  { key: "form_submission", label: "Fills in a form" }, { key: "booking", label: "Books a meeting" },
  { key: "deal_created", label: "Becomes a deal" }, { key: "invoice_paid", label: "Pays an invoice" },
];
const QUICK_WAITS = [{ minutes: 0, first: "Right away", rest: "Right after" }, { minutes: 1440, label: "1 day" }, { minutes: 2880, label: "2 days" }, { minutes: 10080, label: "1 week" }];

const STARTERS: { kind: SeriesKind; icon: string; title: string; detail: string }[] = [
  { kind: "welcome", icon: "users", title: "Welcome new contacts", detail: "New leads get 3 emails over their first week" },
  { kind: "nurture", icon: "trend", title: "Nurture leads", detail: "Leads get 4 emails over about two weeks" },
  { kind: "reengagement", icon: "clock", title: "Win back quiet contacts", detail: "Anyone not contacted in 90+ days" },
];

const when = (iso: string | null) => {
  if (!iso) return null;
  const t = new Date(iso);
  if (t.getTime() <= Date.now()) return "Due now";
  if (t.getTime() <= Date.now() + 60_000) return "Within a minute";
  const sameDay = t.toDateString() === new Date().toDateString();
  return sameDay ? `Today, ${t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Start a series of one kind and open it. */
export async function createSeries(kind: SeriesKind): Promise<{ id: string } | { error: string }> {
  const { data, error } = await rpc("email_sequence_create", { p_kind: kind });
  const id = (data as { sequence_id?: string } | null)?.sequence_id;
  if (error || !id) return { error: seriesErrorWords(error) };
  return { id };
}

/** The dashboard's Automations panel: the business's series, or three starters when it has none. */
export function SeriesPanel({ tenantId, onOpen }: { tenantId: string | null; onOpen: (id: string) => void }) {
  const [state, setState] = React.useState<{ phase: Phase; rows: SeriesRow[] }>({ phase: "loading", rows: [] });
  const [attempt, setAttempt] = React.useState(0);
  const [creating, setCreating] = React.useState<SeriesKind | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState((s) => ({ phase: "loading", rows: s.rows }));
    rpc("read_email_sequences").then(({ data, error: e }) => {
      if (!live) return;
      if (e) { console.error("[marketing-email] series list failed", e); setState({ phase: "error", rows: [] }); return; }
      setState({ phase: "ready", rows: ((data as { sequences?: SeriesRow[] } | null)?.sequences) ?? [] });
    });
    return () => { live = false; };
  }, [tenantId, attempt]);
  const start = async (kind: SeriesKind) => {
    setCreating(kind); setError(null);
    const made = await createSeries(kind);
    setCreating(null);
    if ("error" in made) { setError(made.error); return; }
    onOpen(made.id);
  };
  const line = (r: SeriesRow) => {
    const emails = `${r.emails} email${r.emails === 1 ? "" : "s"}`;
    if (r.status === "draft") return `${emails} · not started`;
    if (r.status === "pending_approval") return `${emails} · waiting for your approval`;
    if (r.status === "stopped") return `Stopped · ${r.entered.toLocaleString()} went through it`;
    if (r.status === "blocked") return `${blockReason(r.blocked_reason)} ${r.in_now.toLocaleString()} waiting.`;
    const next = r.status === "paused" ? "paused" : r.next_send_at ? `next ${(when(r.next_send_at) ?? "").toLowerCase()}` : "nothing due";
    return <>{emails} · <b>{r.in_now.toLocaleString()}</b> in it now · {r.sent_30d.toLocaleString()} sent in 30 days · {next}</>;
  };
  return <>
    {error && <p className="mo-note mp-inline-note" role="alert">{error}</p>}
    <Frame phase={state.phase === "loading" && state.rows.length ? "ready" : state.phase} retry={() => setAttempt((n) => n + 1)} noun="series">
      {state.rows.length === 0 ? <ul className="ms-starters">{STARTERS.map((s) => {
        const Icon = Ic[s.icon];
        return <li key={s.kind}><button type="button" onClick={() => void start(s.kind)} disabled={creating !== null} aria-busy={creating === s.kind}>
          <span className="ms-starter-icon" aria-hidden="true"><Icon size={18}/></span>
          <span><strong>{s.title}</strong><small>{creating === s.kind ? "Creating…" : s.detail}</small></span>
          <span aria-hidden="true"><Ic.chev size={14}/></span>
        </button></li>;
      })}</ul> : <>
        <ul className="ms-rows">{state.rows.map((r) => {
          const st = seriesState(r.status);
          return <li key={r.id}><button type="button" onClick={() => onOpen(r.id)}>
            <strong>{r.name}</strong><span className={`mk-flag ${st.tone}`}>{st.label}</span>
            <small>{line(r)}{r.change_state ? " · changes being made" : ""}</small>
          </button></li>;
        })}</ul>
        <div className="ms-more"><span>New series:</span>{STARTERS.map((s) => <button type="button" key={s.kind} className="me-chip" disabled={creating !== null} onClick={() => void start(s.kind)}>{creating === s.kind ? "Creating…" : s.title.replace(" new contacts", "").replace(" quiet contacts", "")}</button>)}</div>
      </>}
    </Frame>
  </>;
}

type Settings = { name: string; entry_mode: "new_contacts" | "matching"; audience: Rule; segment_id: string | null; exit_on_goal: string; exit_when_unmatched: boolean; sender: SeriesSender };
type StepDraft = { position: number; delay_minutes: number; subject: string; preheader: string; source: string | null; html: string };
const stepHtml = (s: StepDraft) => (s.source !== null ? markupToHtml(s.source) : s.html);

/** One series: build it, file it, approve it, run it. */
export function EmailSeriesView({ sequenceId, onBack, onOpenSettings, onOpenConnections }: {
  sequenceId: string; onBack: () => void; onOpenSettings: (() => void) | null; onOpenConnections: (() => void) | null;
}) {
  const [read, setRead] = React.useState<{ phase: Phase; data: SeriesRead | null; missing?: boolean }>({ phase: "loading", data: null });
  const [attempt, setAttempt] = React.useState(0);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [steps, setSteps] = React.useState<StepDraft[]>([]);
  const [save, setSave] = React.useState<"saved" | "saving" | "dirty" | "failed">("saved");
  const [open, setOpen] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "bad" | "ok"; text: string } | null>(null);
  const [width, setWidth] = React.useState<"desktop" | "phone">("desktop");
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  const [focusStep, setFocusStep] = React.useState<string | null>(null);
  // Adding, moving or deleting an email renumbers them; editing waits until the re-read lands, so a keystroke
  // is never dropped by the re-read or saved onto the email that took its place.
  const [reshaping, setReshaping] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    rpc("read_email_sequence", { p_sequence_id: sequenceId }).then(({ data, error }) => {
      if (!live) return;
      setReshaping(false);
      if (error) { console.error("[marketing-email] series read failed", error); setRead({ phase: "error", data: null, missing: error.message === "series_not_found" }); return; }
      const d = data as SeriesRead;
      setRead({ phase: "ready", data: d });
      setSettings({ name: d.sequence.name, entry_mode: d.version.entry_mode, audience: d.version.audience ?? {}, segment_id: d.version.segment_id,
        exit_on_goal: d.version.exit_on_goal, exit_when_unmatched: d.version.exit_when_unmatched, sender: d.version.sender });
      setSteps(d.version.steps.map((s) => ({ position: s.position, delay_minutes: s.delay_minutes, subject: s.subject, preheader: s.preheader, source: sourceOf(s.body_html), html: s.body_html })));
      dirtySettings.current = false; dirtySteps.current = new Set();
      setSave("saved");
    });
    return () => { live = false; };
  }, [sequenceId, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  const data = read.data;
  const editable = Boolean(data && data.version.state === "draft" && data.sequence.status !== "stopped");
  const preview = useAudiencePreview(settings?.segment_id ? {} : (settings?.audience ?? {}), "standard", settings?.segment_id ?? null, Boolean(settings && editable));

  // Saves run one at a time, in order, a moment after typing stops; each edit bumps the revision, and a
  // save that finishes after a newer edit leaves the series marked unsaved so the newer edit is saved next.
  const dirtySettings = React.useRef(false);
  const dirtySteps = React.useRef<Set<number>>(new Set());
  const revision = React.useRef(0);
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const latest = React.useRef<{ settings: Settings | null; steps: StepDraft[] }>({ settings: null, steps: [] });
  latest.current = { settings, steps };
  const write = async (rev: number) => {
    const s = latest.current.settings;
    if (!s) return true;
    setSave("saving");
    if (dirtySettings.current) {
      dirtySettings.current = false;
      const { error } = await rpc("email_sequence_update_draft", {
        p_sequence_id: sequenceId, p_name: s.name, p_entry_mode: s.entry_mode, p_audience: s.audience, p_segment_id: s.segment_id,
        p_clear_segment: !s.segment_id, p_exit_on_goal: s.exit_on_goal, p_exit_when_unmatched: s.exit_when_unmatched,
        p_sender: s.sender.mode === "connector" ? { mode: "connector", connector_id: s.sender.connector_id } : { mode: "managed" },
      });
      if (error) { dirtySettings.current = true; console.error("[marketing-email] series save failed", error); setSave("failed"); setNotice({ tone: "bad", text: seriesErrorWords(error) }); return false; }
    }
    for (const pos of Array.from(dirtySteps.current)) {
      const st = latest.current.steps.find((x) => x.position === pos);
      dirtySteps.current.delete(pos);
      if (!st) continue;
      const { error } = await rpc("email_sequence_step_save", { p_sequence_id: sequenceId, p_position: pos, p_delay_minutes: st.delay_minutes,
        p_subject: st.subject, p_preheader: st.preheader, p_body_html: stepHtml(st) });
      if (error) { dirtySteps.current.add(pos); console.error("[marketing-email] series email save failed", error); setSave("failed"); setNotice({ tone: "bad", text: seriesErrorWords(error) }); return false; }
    }
    setSave(rev === revision.current ? "saved" : "dirty");
    return true;
  };
  const persist = React.useCallback(() => {
    const rev = revision.current;
    const run = queue.current.then(() => write(rev));
    queue.current = run.catch(() => undefined);
    return run;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!editable || save !== "dirty") return;
    const timer = setTimeout(() => { void persist(); }, 800);
    return () => clearTimeout(timer);
  }, [settings, steps, editable, save, persist]);
  const unsaved = editable && save !== "saved";
  /** Everything typed so far is saved before a structural change, a review or leaving. */
  const flush = async () => (unsaved || dirtySettings.current || dirtySteps.current.size ? persist() : true);

  const changeSettings = (patch: Partial<Settings>) => { revision.current += 1; dirtySettings.current = true; setSettings((s) => (s ? { ...s, ...patch } : s)); setSave("dirty"); setNotice(null); };
  const changeStep = (position: number, patch: Partial<StepDraft>) => {
    revision.current += 1; dirtySteps.current.add(position);
    setSteps((list) => list.map((s) => (s.position === position ? { ...s, ...patch } : s))); setSave("dirty"); setNotice(null);
  };

  // Leaving never drops edits: Back saves first, unmounting saves what is pending, and the browser asks
  // before a reload or a closed tab while anything is unsaved.
  const pending = React.useRef({ unsaved, persist });
  pending.current = { unsaved, persist };
  React.useEffect(() => () => { if (pending.current.unsaved) void pending.current.persist(); }, []);
  React.useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  const leave = async () => {
    if (unsaved) {
      pending.current.unsaved = false;
      if (!(await flush()) && !window.confirm("Your latest changes did not save. Leave anyway and lose them?")) { pending.current.unsaved = true; return; }
    }
    onBack();
  };

  const act = async (key: string, fn: string, args: Record<string, unknown>, done?: string) => {
    setBusy(key); setNotice(null);
    if (editable && !(await flush())) { setBusy(null); return false; }
    const { error } = await rpc(fn, args);
    setBusy(null);
    if (error) { console.error(`[marketing-email] ${fn} failed`, error); setNotice({ tone: "bad", text: seriesErrorWords(error) }); return false; }
    if (done) setNotice({ tone: "ok", text: done });
    reload();
    return true;
  };

  // Focus the subject of an email just added, or the summary of one just moved.
  React.useEffect(() => {
    if (focusStep === null || !data) return;
    const el = document.querySelector<HTMLElement>(`[data-series-focus="${focusStep}"]`);
    if (el) { el.focus(); setFocusStep(null); }
  }, [focusStep, data, steps]);

  if (!data || !settings) return <div className="mk-view mo me me-editor"><button type="button" className="mo-link me-back" onClick={onBack}><Ic.arrow size={12}/>Email</button>
    {read.missing ? <section className="campaigns-surface"><div className="campaigns-state"><h2>This series no longer exists</h2><p>It may have been deleted.</p><button className="btn btn-s" onClick={onBack}>Back to Email</button></div></section>
      : <Frame phase={read.phase} retry={reload} noun="series">{null}</Frame>}
  </div>;

  const s = data.sequence, v = data.version;
  const live = Boolean(s.live_version_id);
  const changing = live && data.live !== null; // the version shown is a change to a running series
  const st = seriesState(s.status);
  const locked = v.state === "locked";
  const fromSender = editable ? (settings.sender.mode === "connector" ? data.senders.find((x) => x.connector_id === settings.sender.connector_id) : data.managed_sender) : (v.sender_snapshot ?? data.resolves);
  const fromLine = fromSender?.from_address ? (fromSender.from_name ? `${fromSender.from_name} <${fromSender.from_address}>` : fromSender.from_address) : "No sender set up";
  const anyChosen = settings.sender.mode === "managed" ? data.managed_sender.ok : data.senders.some((x) => x.connector_id === settings.sender.connector_id && x.healthy);
  const tabStop = (chosen: boolean) => (chosen || !anyChosen ? 0 : -1);
  const shownStep = steps.find((x) => x.position === open) ?? steps[0] ?? null;
  const sentEmail = shownStep ? renderCampaignEmail({ bodyHtml: stepHtml(shownStep), preheader: shownStep.preheader, businessName: data.business_name, postalAddress: data.postal_address ?? "" }) : "";
  const goalLabel = GOALS.find((g) => g.key === v.exit_on_goal)?.label.toLowerCase();
  const audienceWords = v.segment_name ? `the segment “${v.segment_name}”` : ruleSummary(v.audience ?? {});
  const hours = hoursFromJoin(steps);
  const stats = (pos: number) => data.emails.find((e) => e.position === pos);
  const totalSent = data.emails.reduce((t, e) => t + e.sent, 0);

  const review = () => void act("review", "email_sequence_request_approval", { p_sequence_id: s.id, p_source: "owner" });
  const addStep = async () => {
    setBusy("add"); setReshaping(true);
    if (!(await flush())) { setBusy(null); setReshaping(false); return; }
    const { data: made, error } = await rpc("email_sequence_step_save", { p_sequence_id: s.id });
    setBusy(null);
    if (error) { setReshaping(false); setNotice({ tone: "bad", text: seriesErrorWords(error) }); return; }
    const pos = (made as { position?: number } | null)?.position ?? null;
    setOpen(pos); if (pos !== null) setFocusStep(`s${pos}`); reload();
  };
  const moveStep = async (from: number, to: number) => {
    setReshaping(true);
    if (await act(`move-${from}`, "email_sequence_step_move", { p_sequence_id: s.id, p_from: from, p_to: to })) { setOpen(open === from ? to : open === to ? from : open); setFocusStep(`m${to}`); }
    else setReshaping(false);
  };
  const deleteStep = async (pos: number) => {
    const shown = steps.find((x) => x.position === pos);
    if (!window.confirm(`Delete email ${pos}${shown?.subject ? ` (“${shown.subject}”)` : ""}?`)) return;
    setReshaping(true);
    if (await act(`del-${pos}`, "email_sequence_step_delete", { p_sequence_id: s.id, p_position: pos }, `Email ${pos} removed.`)) setOpen(null);
    else setReshaping(false);
  };

  return <div className="mk-view mo me me-editor ms">
    <div className="me-editor-head">
      <button type="button" className="mo-link me-back" onClick={() => void leave()}><Ic.arrow size={12}/>Email</button>
      <div className="me-title">
        {editable && !changing ? <label className="me-name-input"><span className="campaigns-sr-only">Series name</span><input value={settings.name} maxLength={200} onChange={(e) => changeSettings({ name: e.target.value })}/></label> : <h2>{s.name}</h2>}
        <span className={`me-kind is-${s.kind}`}>{SERIES_KIND_LABEL[s.kind]}</span>
        <span className={`mk-flag ${st.tone}`}>{st.label}</span>
        {changing && <span className="mk-flag is-review">{locked ? "Changes waiting for approval" : "Editing a new version"}</span>}
        {editable && <span className="me-save" aria-live="polite">{save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "failed" ? "Not saved" : "Saved"}</span>}
      </div>
      <div className="me-editor-acts">
        {editable && !live && <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => { if (window.confirm("Delete this draft series? Nothing was sent.")) void act("delete", "email_sequence_delete", { p_sequence_id: s.id }).then((ok) => { if (ok) onBack(); }); }}>Delete</button>}
        {editable && changing && <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("discard", "email_sequence_discard_draft", { p_sequence_id: s.id }, "Changes discarded. The running version is unchanged.")}>Discard changes</button>}
        {editable && <button type="button" className="btn btn-s btn-p" disabled={busy !== null || !data.postal_address} aria-describedby={!data.postal_address ? "ms-postal-why" : undefined} onClick={review}>{busy === "review" ? "Preparing…" : changing ? "Review changes" : "Review and start"}</button>}
        {!editable && !locked && (s.status === "active" || s.status === "paused" || s.status === "blocked") && <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("edit", "email_sequence_edit", { p_sequence_id: s.id })}><Ic.edit size={14}/>Edit</button>}
        {s.status === "active" && <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("pause", "email_sequence_pause", { p_sequence_id: s.id }, "Paused. Nothing sends until you resume.")}><Ic.pause size={14}/>Pause</button>}
        {(s.status === "active" || s.status === "paused" || s.status === "blocked") && <button type="button" className="btn btn-s ms-danger" disabled={busy !== null} onClick={() => {
          if (window.confirm(`Stop “${s.name}”? This can’t be undone. The ${data.people.in_now.toLocaleString()} ${data.people.in_now === 1 ? "person" : "people"} in it leave now and their scheduled emails are cancelled. What was already sent stays recorded, and nobody who was in it can go through it again.`))
            void act("stop", "email_sequence_stop", { p_sequence_id: s.id }, "Stopped. Everyone in it left and their scheduled emails were cancelled.");
        }}>Stop</button>}
        {s.status === "paused" && <button type="button" className="btn btn-s btn-p" disabled={busy !== null} onClick={() => void act("resume", "email_sequence_resume", { p_sequence_id: s.id }, "Resumed. Emails that were waiting go out now, within today’s limit.")}><Ic.play size={14}/>Resume</button>}
      </div>
    </div>
    {notice && <p className={`me-notice ${notice.tone === "bad" ? "is-bad" : "is-ok"}`} role={notice.tone === "bad" ? "alert" : "status"}>{notice.text}</p>}
    {data.last_declined && editable && <p className="me-notice is-warn" role="status">You chose not now{data.last_declined.reason ? `: “${data.last_declined.reason}”` : "."} It’s a draft again and nothing changed in what sends. Change what you need, then review it again.</p>}
    {changing && editable && <p className="me-notice is-info" role="status"><b>You’re editing a new version.</b> The running version keeps sending until you approve this one. Then the {data.people.in_now.toLocaleString()} {data.people.in_now === 1 ? "person" : "people"} in it carry on with the new emails from where they are.</p>}
    {!data.postal_address && editable && <div className="mo-next me-warn" role="status"><span className="mo-next-plate" aria-hidden="true"><Ic.shield size={16}/></span><div><h2>Add your postal address before you start</h2><p id="ms-postal-why">Every marketing email shows your business’s postal address. This series can’t start until it’s added in Settings › Connections › Registration.</p></div>{onOpenSettings && <button type="button" className="btn btn-s" onClick={onOpenSettings}>Open Settings</button>}</div>}

    {locked && <section className="campaigns-surface mo-panel me-review" aria-labelledby="ms-review-h">
      <div className="mo-panel-head"><div><h2 id="ms-review-h">{changing ? "Ready to update" : "Ready to start"}</h2>
        <p>{startSummary({ name: s.name, emails: v.steps.length, mode: v.entry_mode, matching: v.expected_entrants, from: fromLine, cap: data.sending.daily_cap, change: changing })}</p></div></div>
      <dl className="me-facts">
        <div><dt>Who enters</dt><dd>{v.entry_mode === "new_contacts" ? "New contacts from now on" : "Anyone who matches, now or later"}: {audienceWords}</dd></div>
        <div><dt>Emails</dt><dd>{v.steps.length} {v.steps.length === 1 ? "email" : "emails"} {spanWords(v.steps)}</dd></div>
        <div><dt>From</dt><dd>{fromLine}</dd></div>
        <div><dt>Daily limit</dt><dd>Up to {data.sending.daily_cap.toLocaleString()} a day across all your marketing email; series emails wait, never dropped</dd></div>
      </dl>
      <p className="me-hint">Someone leaves when they unsubscribe, bounce or are marked do not contact{v.exit_on_goal !== "none" && goalLabel ? `, or ${goalLabel}` : ""}{v.exit_when_unmatched ? ", or they stop matching" : ""}. Each person goes through this series once. Nothing has been sent.</p>
      <div className="me-review-acts">
        <button type="button" className="btn btn-s btn-g" disabled={busy !== null} onClick={() => void act("approve", "email_sequence_approve", { p_version_id: v.id }, changing ? "Updated. People carry on with the new emails from where they are." : v.entry_mode === "new_contacts" ? `Started. “${s.name}” sends by itself from now on. New contacts who match join as they arrive.` : `Started. People who match join within a few minutes; their first email goes out ${v.steps[0]?.delay_minutes ? waitWords(v.steps[0].delay_minutes, 0) : "within today’s limit"}.`)}>{busy === "approve" ? "Approving…" : changing ? "Approve changes" : "Approve and start"}</button>
        <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("changes", "email_sequence_edit", { p_sequence_id: s.id }, "Back to draft. The waiting approval is withdrawn; nothing was sent.")}>Make changes</button>
        <button type="button" className="btn btn-s btn-q" disabled={busy !== null} onClick={() => setDeclineOpen((o) => !o)} aria-expanded={declineOpen}>Not now</button>
      </div>
      {declineOpen && <form className="me-decline" onSubmit={(e) => { e.preventDefault(); void act("decline", "email_sequence_decline", { p_version_id: v.id, p_reason: declineReason.trim() || null }).then((ok) => { if (ok) { setDeclineOpen(false); setDeclineReason(""); } }); }}>
        <label><span>What should change? (optional)</span><input value={declineReason} maxLength={500} onChange={(e) => setDeclineReason(e.target.value)}/></label>
        <button type="submit" className="btn btn-s" disabled={busy !== null}>Not now, back to draft</button>
      </form>}
      <p className="mo-note">Only an owner or admin of this business can start a series.</p>
    </section>}

    {live && <section className={`campaigns-surface mo-panel me-review ${s.status === "blocked" ? "is-blocked" : s.status === "paused" ? "is-paused" : ""}`} aria-labelledby="ms-live-h">
      <div className="mo-panel-head"><div><h2 id="ms-live-h">{s.status === "stopped" ? "Stopped" : s.status === "paused" ? "Paused" : s.status === "blocked" ? "Needs attention" : "Running"}</h2>
        <p>{s.status === "stopped" ? "Everyone in it left and their scheduled emails were cancelled. What was sent, and its results, stay here."
          : s.status === "paused" ? `Nothing sends while it’s paused. Emails that come due wait and go out after you resume. The ${data.people.in_now.toLocaleString()} people in it stay where they are; people who match while it’s paused join when you resume.`
          : s.status === "blocked" ? `${blockReason(s.blocked_reason)} Nothing more sends until it’s fixed, and nothing was sent from a different address. The people in it stay where they are.`
          : `Sends by itself${s.activated_at ? ` since ${new Date(s.activated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}. ${data.live?.entry_mode === "new_contacts" || (!data.live && v.entry_mode === "new_contacts") ? "New contacts who match join as they arrive." : "Anyone who matches joins, now or later."}`}</p></div></div>
      {s.status === "blocked" && <div className="me-review-acts">
        {s.blocked_reason === "postal_address_missing" && onOpenSettings && <button type="button" className="btn btn-s" onClick={onOpenSettings}>Open Settings</button>}
        {(s.blocked_reason === "sender_needs_attention" || s.blocked_reason === "sender_changed" || s.blocked_reason === "sender_not_found") && onOpenConnections && <button type="button" className="btn btn-s" onClick={onOpenConnections}>Open Connections</button>}
        <button type="button" className="btn btn-s btn-p" disabled={busy !== null} onClick={() => void act("resume", "email_sequence_resume", { p_sequence_id: s.id }, "Running again. People carry on from where they were.")}>Try again</button>
      </div>}
      <dl className="me-facts ms-facts">
        <div><dt>In it now</dt><dd>{data.people.in_now.toLocaleString()}</dd></div>
        <div><dt>Joined since start</dt><dd>{(data.people.in_now + data.people.completed + data.people.left).toLocaleString()}</dd></div>
        <div><dt>Emails sent</dt><dd>{totalSent.toLocaleString()}</dd></div>
        <div><dt>Next send</dt><dd className="is-small">{s.status === "paused" ? "None while paused" : s.status === "blocked" ? "On hold until fixed" : s.status === "stopped" ? "—" : when(data.emails.map((e) => e.next_at).filter(Boolean).sort()[0] ?? null) ?? "Nothing due yet"}</dd></div>
      </dl>
      {data.sending.remaining_today === 0 && s.status === "active" && data.people.in_now > 0 && <p className="me-notice is-warn">Today’s {data.sending.daily_cap.toLocaleString()} are used up across your email. Series emails that are due wait for tomorrow, and the emails after them wait too. Nothing is dropped.</p>}
      {(data.people.in_now + data.people.completed + data.people.left) === 0 ? <p className="me-hint">Nobody yet. {v.entry_mode === "new_contacts" ? "The next new contact who matches joins and gets email 1." : "People who match join within a few minutes."}</p>
        : <div className="ms-two">
          <div><p className="ms-sub">How far people got</p><ul className="ms-funnel">
            <li><span>Joined</span><Bar value={1}/><b>{(data.people.in_now + data.people.completed + data.people.left).toLocaleString()}</b></li>
            {data.emails.map((e) => <li key={e.position}><span>Email {e.position} sent</span><Bar value={e.sent / Math.max(1, data.people.in_now + data.people.completed + data.people.left)}/><b>{e.sent.toLocaleString()}</b></li>)}
          </ul>{data.emails.some((e) => e.sent > e.tracked) && <p className="mo-note">Opens and clicks are counted only on PAIGE’s sender.</p>}</div>
          <div><p className="ms-sub">Who left, and why</p><ul className="me-rows ms-left">
            <li className={data.people.completed ? "" : "is-zero"}><span>Finished every email</span><b>{data.people.completed.toLocaleString()}</b></li>
            {Object.entries(data.people.left_because).sort((a, b) => b[1] - a[1]).map(([k, n]) => <li key={k}><span>{LEFT_REASON[k]?.label ?? k}{LEFT_REASON[k]?.detail && <small>{LEFT_REASON[k].detail}</small>}</span><b>{n.toLocaleString()}</b></li>)}
          </ul></div>
        </div>}
      {data.people.recent.length > 0 && <details className="ms-people"><summary>Recent people ({data.people.recent.length})</summary><ul className="me-rows">
        {data.people.recent.map((p) => <li key={`${p.email}-${p.entered_at}`}><span><strong>{p.name ?? p.email}</strong><small>{p.status === "active" ? (p.position ? `On email ${p.position}` : "Just joined") : p.status === "completed" ? "Finished" : LEFT_REASON[p.exit_reason ?? ""]?.label ?? "Left"}</small></span>
          {p.status === "active" && p.client_id && s.status !== "stopped" ? <button type="button" className="btn btn-s btn-q" disabled={busy !== null} onClick={() => { if (window.confirm(`Take ${p.name ?? p.email} out of this series? Anything scheduled for them is cancelled.`)) void act(`rm-${p.client_id}`, "email_sequence_remove_contact", { p_sequence_id: s.id, p_client_id: p.client_id }, "Removed. Nothing more from this series goes to them."); }}>Remove</button> : <span/>}
        </li>)}
      </ul></details>}
    </section>}

    <div className="me-compose">
      <div className="me-compose-form">
        <section className="campaigns-surface mo-panel" aria-labelledby="ms-who">
          <div className="mo-panel-head"><div><h2 id="ms-who">Who enters</h2><p>Contacts who opted out, unsubscribed or bounced never enter. Each person goes through a series once.</p></div></div>
          {editable ? <>
            <div className="me-senders" role="radiogroup" aria-label="When people enter" onKeyDown={roveRadios}>
              <button type="button" role="radio" aria-checked={settings.entry_mode === "new_contacts"} tabIndex={settings.entry_mode === "new_contacts" ? 0 : -1} onClick={() => changeSettings({ entry_mode: "new_contacts" })}><strong>New contacts from now on</strong><small>Contacts added after you start, who match. Best for a welcome.</small></button>
              <button type="button" role="radio" aria-checked={settings.entry_mode === "matching"} tabIndex={settings.entry_mode === "matching" ? 0 : -1} onClick={() => changeSettings({ entry_mode: "matching" })}><strong>Anyone who matches, now or later</strong><small>Everyone who matches when it starts, and anyone who matches later.</small></button>
            </div>
            {data.segments.length > 0 && <div className="campaigns-segmented me-seg" role="group" aria-label="Choose by">
              <button type="button" aria-pressed={!settings.segment_id} onClick={() => changeSettings({ segment_id: null })}>A rule</button>
              <button type="button" aria-pressed={Boolean(settings.segment_id)} onClick={() => changeSettings({ segment_id: data.segments[0].id })}>A saved segment</button>
            </div>}
            {settings.segment_id ? <div className="me-chips" role="group" aria-label="Segment">{data.segments.map((g) => <button type="button" key={g.id} className="me-chip" aria-pressed={settings.segment_id === g.id} onClick={() => changeSettings({ segment_id: g.id })}>{g.name}</button>)}</div>
              : <RuleBuilder rule={settings.audience} onChange={(audience) => changeSettings({ audience })} choices={data.choices}/>}
            {settings.entry_mode === "new_contacts"
              ? <p className="me-reach" aria-live="polite"><span>Starts empty. Contacts added from now on who match join it.</span>{preview.data && <small>Today {preview.data.matched.toLocaleString()} {preview.data.matched === 1 ? "contact matches" : "contacts match"}; they don’t join.</small>}</p>
              : <Reach preview={preview} newsletter={false}/>}
          </> : <p className="me-reach"><span><b>{v.entry_mode === "new_contacts" ? "New contacts from now on" : "Anyone who matches, now or later"}</b>: {audienceWords}. {data.entry_preview.eligible.toLocaleString()} can get these emails today.</span></p>}
        </section>

        <section className="campaigns-surface mo-panel" aria-labelledby="ms-emails">
          <div className="mo-panel-head"><div><h2 id="ms-emails">Emails <span className="ms-count">{steps.length} of up to {MAX_STEPS}</span></h2><p>Each wait counts from when the email before it was sent; the first, from when they join. If an email waits for the daily limit, the next one waits for it.</p></div></div>
          <ol className="ms-spine" aria-label="Emails in order">{steps.map((step, i) => {
            const isOpen = editable && open === step.position;
            const sx = stats(step.position);
            const { days, hours: hrs } = splitWait(step.delay_minutes);
            return <li key={step.position}>
              <div className="ms-wait"><span className="ms-wait-chip"><Ic.clock size={13}/>{waitWords(step.delay_minutes, i)}</span>{(i > 0 || step.delay_minutes > 0) && <small>{dayWords(hours[i])}</small>}</div>
              <div className={`ms-card${isOpen ? " is-open" : ""}`}>
                <div className="ms-card-head">
                  <span className="ms-num" aria-hidden="true">{step.position}</span>
                  <button type="button" className="ms-sum" data-series-focus={`m${step.position}`} disabled={!editable} aria-expanded={editable ? isOpen : undefined} onClick={() => setOpen(isOpen ? null : step.position)}
                    aria-label={`Email ${step.position}: ${step.subject || "no subject yet"}${editable ? (isOpen ? ". Close" : ". Edit") : ""}`}>
                    <strong>{step.subject || <span className="is-none">No subject yet</span>}</strong><small>{step.preheader || "No preview text"}</small>
                  </button>
                  {editable ? <div className="ms-tools">
                    <button type="button" className="ms-icon" disabled={i === 0 || busy !== null} aria-label={`Move email ${step.position} up`} onClick={() => void moveStep(step.position, step.position - 1)}><Ic.up size={15}/></button>
                    <button type="button" className="ms-icon" disabled={i === steps.length - 1 || busy !== null} aria-label={`Move email ${step.position} down`} onClick={() => void moveStep(step.position, step.position + 1)}><Ic.down size={15}/></button>
                    <button type="button" className="ms-icon" disabled={steps.length === 1 || busy !== null} aria-label={`Delete email ${step.position}`} title={steps.length === 1 ? "A series needs at least one email" : undefined} onClick={() => void deleteStep(step.position)}><Ic.trash size={15}/></button>
                  </div> : <span/>}
                </div>
                {live && !isOpen && sx && <p className="ms-cardstats"><span>Sent <b>{sx.sent.toLocaleString()}</b></span>{sx.tracked > 0 && <><span>Opened <b>{Math.round((sx.opened / sx.tracked) * 100)}%</b></span><span>Clicked <b>{Math.round((sx.clicked / sx.tracked) * 100)}%</b></span></>}{sx.waiting > 0 && <span><b>{sx.waiting.toLocaleString()}</b> waiting for this email</span>}{sx.not_delivered > 0 && <span><b>{sx.not_delivered}</b> not delivered</span>}</p>}
                {isOpen && <div className="ms-card-body"><fieldset className="ms-lock" disabled={reshaping}>
                  <fieldset className="me-field"><legend>When it sends</legend>
                    <div className="me-chips">{QUICK_WAITS.map((q) => <button type="button" key={q.minutes} className="me-chip" aria-pressed={step.delay_minutes === q.minutes} onClick={() => changeStep(step.position, { delay_minutes: q.minutes })}>{q.label ?? (i === 0 ? q.first : q.rest)}</button>)}</div>
                    <div className="ms-waitnums">
                      <label>Days <input type="number" min={0} max={90} inputMode="numeric" value={days} onChange={(e) => changeStep(step.position, { delay_minutes: joinWait(Number(e.target.value) || 0, hrs) })}/></label>
                      <label>Hours <input type="number" min={0} max={23} inputMode="numeric" value={hrs} onChange={(e) => changeStep(step.position, { delay_minutes: joinWait(days, Number(e.target.value) || 0) })}/></label>
                      <span>{i === 0 ? "after they join" : `after email ${i} is sent`}</span>
                    </div>
                  </fieldset>
                  <label className="me-input"><span>Subject</span><input data-series-focus={`s${step.position}`} value={step.subject} maxLength={300} onChange={(e) => changeStep(step.position, { subject: e.target.value })} placeholder="What the inbox shows first"/></label>
                  <label className="me-input"><span>Preview text</span><input value={step.preheader} maxLength={300} onChange={(e) => changeStep(step.position, { preheader: e.target.value })} placeholder="The line shown after the subject"/></label>
                  <label className="me-input"><span>{step.source !== null ? "Message" : "Message (HTML)"}</span>
                    <textarea rows={10} value={step.source !== null ? step.source : step.html} onChange={(e) => changeStep(step.position, step.source !== null ? { source: e.target.value } : { html: e.target.value })}
                      placeholder={"Hi there,\n\nWrite your email here.\n\n[[Book a call|https://…]]"}/></label>
                  <p className="me-hint">A line starting “# ” is a heading, “- ” a list item. [text](https://…) is a link. [[Button text|https://…]] on its own line is a button. The footer with your business name, postal address and unsubscribe link is added for you.</p>
                </fieldset></div>}
              </div>
            </li>;
          })}</ol>
          {editable && <div className="ms-add"><button type="button" className="btn btn-s" disabled={busy !== null || steps.length >= MAX_STEPS} onClick={() => void addStep()}><Ic.plus size={14}/>{busy === "add" ? "Adding…" : "Add an email"}</button>{steps.length >= MAX_STEPS && <span className="me-hint">A series holds up to {MAX_STEPS} emails.</span>}</div>}
          {editable && <AskPaige prompt={`Help me write the emails for my email series "${settings.name}" (${SERIES_KIND_LABEL[s.kind]}, ${steps.length} emails). Ask me who it is for and what I want them to do, then draft each email here in chat with a subject line and a preview line so I can paste them in. You can't save into a series yet, and nothing is sent until I approve it.`}/>}
        </section>

        <section className="campaigns-surface mo-panel" aria-labelledby="ms-leave">
          <div className="mo-panel-head"><div><h2 id="ms-leave">When someone leaves</h2></div></div>
          <ul className="ms-always">
            <li><Ic.check size={13}/><span>Always, before their next email: they unsubscribe, an email to them bounces, or they’re marked do not contact.</span></li>
            <li><Ic.check size={13}/><span>If an email to them can’t be sent or confirmed, their series ends there. It’s never retried or guessed.</span></li>
          </ul>
          <button type="button" className="ms-switch" role="switch" aria-checked={settings.exit_on_goal !== "none"} disabled={!editable} onClick={() => changeSettings({ exit_on_goal: settings.exit_on_goal === "none" ? "booking" : "none" })}>
            <span className="ms-track" aria-hidden="true"/><span><strong>They reach a goal</strong><small>Counted after they join, so earlier activity doesn’t count.</small></span></button>
          {settings.exit_on_goal !== "none" && <div className="me-chips ms-goal" role="group" aria-label="Goal">{GOALS.map((g) => <button type="button" key={g.key} className="me-chip" disabled={!editable} aria-pressed={settings.exit_on_goal === g.key} onClick={() => changeSettings({ exit_on_goal: g.key })}>{g.label}</button>)}</div>}
          <button type="button" className="ms-switch" role="switch" aria-checked={settings.exit_when_unmatched} disabled={!editable} onClick={() => changeSettings({ exit_when_unmatched: !settings.exit_when_unmatched })}>
            <span className="ms-track" aria-hidden="true"/><span><strong>They stop matching who enters</strong><small>{s.kind === "reengagement" ? "Someone who becomes active again stops getting win-back emails." : "For example, a lead who becomes a customer."}</small></span></button>
        </section>

        <section className="campaigns-surface mo-panel" aria-labelledby="ms-from">
          <div className="mo-panel-head"><div><h2 id="ms-from">Send from</h2><p>The same choice as a campaign. Opens and clicks are counted only on PAIGE’s sender.</p></div>{onOpenConnections && editable && <button type="button" className="mo-link" onClick={onOpenConnections}>Connections<Ic.arrow size={12}/></button>}</div>
          {editable ? <div className="me-senders" role="radiogroup" aria-label="Sender" onKeyDown={roveRadios}>
            {data.senders.map((x) => <button type="button" role="radio" key={x.connector_id} aria-checked={settings.sender.mode === "connector" && settings.sender.connector_id === x.connector_id} tabIndex={tabStop(settings.sender.mode === "connector" && settings.sender.connector_id === x.connector_id)} disabled={!x.healthy} onClick={() => changeSettings({ sender: { mode: "connector", connector_id: x.connector_id } })}>
              <strong>{x.from_name ? `${x.from_name} <${x.from_address}>` : x.from_address ?? "No address"}</strong><small>{x.healthy ? "Your email connection" : "Needs attention in Connections"}</small></button>)}
            <button type="button" role="radio" aria-checked={settings.sender.mode === "managed"} tabIndex={tabStop(settings.sender.mode === "managed")} disabled={!data.managed_sender.ok} onClick={() => changeSettings({ sender: { mode: "managed" } })}>
              <strong>{data.managed_sender.ok ? (data.managed_sender.from_name ? `${data.managed_sender.from_name} <${data.managed_sender.from_address}>` : data.managed_sender.from_address) : "PAIGE’s sender"}</strong>
              <small>{data.managed_sender.ok ? "PAIGE’s sender · up to 500 a day · opens and clicks reported" : "Not set up for this business yet"}</small></button>
          </div> : <p className="me-reach"><span>{fromLine}</span></p>}
        </section>
      </div>

      <aside className="campaigns-surface mo-panel me-preview" aria-labelledby="ms-prev">
        <div className="mo-panel-head"><div><h2 id="ms-prev">Preview</h2><p>{shownStep ? `Email ${shownStep.position} of ${steps.length}, as it’s sent, footer included.` : "No emails yet."}</p></div>
          <div className="campaigns-segmented me-seg" role="group" aria-label="Preview width"><button type="button" aria-pressed={width === "desktop"} onClick={() => setWidth("desktop")}>Desktop</button><button type="button" aria-pressed={width === "phone"} onClick={() => setWidth("phone")}>Phone</button></div></div>
        {shownStep && <>
          <div className="me-inbox"><span className="me-inbox-from">{fromSender?.from_name || fromSender?.from_address || "Your business"}</span><strong>{shownStep.subject || "No subject yet"}</strong><small>{shownStep.preheader || "No preview text"}</small></div>
          <iframe title={`Email ${shownStep.position} preview`} className={`me-frame is-${width}`} sandbox="" srcDoc={previewDocument(sentEmail)}/>
        </>}
        {!data.postal_address && <p className="mo-note">The footer shows your postal address once it is added in Settings.</p>}
      </aside>
    </div>
  </div>;
}

function Bar({ value }: { value: number }) {
  return <span className="ms-bar" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }}/></span>;
}
