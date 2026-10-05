// Marketing › Email: one campaign, from blank draft to sent, and the segments it can go to.
//
// Reads:  read_email_campaign (the campaign as sent: footer facts, senders, approval, progress)
//         email_audience_preview (who a rule reaches today, and why anyone is left out)
//         read_email_rule_choices (stages, sources and tags the business's contacts carry)
//         email_campaigns (the full list; RLS: owner or admin of the business)
// Acts:   email_campaign_update_draft · email_campaign_request_approval · email_campaign_approve
//         email_campaign_decline · email_campaign_new_version · email_campaign_cancel · email_campaign_resume
//         email_campaign_delete · email_segment_save · email_segment_delete
// Every act is an RPC PAIGE can call too (§10). Only email_campaign_approve releases a send, and only a
// person who owns or administers the business can call it; the database refuses everyone else.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Ic as SharedIcons } from "./_shared";
import { KIND_LABEL, blockReason, costWords, unsent, type SegmentRow } from "./marketing-email-model";
import { SOURCE_LABEL, STAGE_LABEL } from "./marketing-audience";
import { markupToHtml, previewDocument, renderCampaignEmail, sourceOf } from "./email-markup";
import { Frame, type Phase } from "./marketing-planned";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; details?: string; code?: string } | null }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);

export type Rule = { stages?: string[]; sources?: string[]; tags?: string[]; inactive_days?: number };
type Choice = { key: string; count: number };
type Choices = { stages: Choice[]; sources: Choice[]; tags: Choice[] };
type Sender = { mode: "managed" | "connector"; connector_id?: string; provider?: string; from_address?: string | null; from_name?: string | null; healthy?: boolean; ok?: boolean; reason?: string };
type CampaignRead = {
  campaign: { id: string; name: string; kind: string; status: string; blocked_reason: string | null; updated_at: string };
  version: { id: string; version_no: number; state: string; subject: string; preheader: string; body_html: string; sender: Sender;
    sender_snapshot: Sender | null; audience: Rule; segment_id: string | null; scheduled_for: string | null; conversion_goal: string;
    expected_recipients: number | null; cost_bound_usd: number | null; approval_id: string | null; approved_at: string | null };
  approval: { status: string; source: string } | null;
  last_declined: { reason: string | null; at: string; version_no: number } | null;
  progress: { total: number; planned: number; sending: number; sent: number; failed: number; not_confirmed: number; skipped: number; cancelled: number; tracked: number; opened: number; clicked: number };
  senders: Sender[]; managed_sender: Sender; resolves: Sender;
  postal_address: string | null; business_name: string | null;
  segments: { id: string; name: string; rule: Rule }[];
  choices: Choices;
};
type Preview = { matched: number; eligible: number; no_address: number; opted_out: number; suppressed: number; no_consent: number; daily_cap: number; remaining_today: number; postal_address_set: boolean };

/** What an RPC refusal means, in the owner's words. */
export function errorWords(error: { message?: string; details?: string } | null): string {
  const code = error?.message ?? "";
  const words: Record<string, string> = {
    not_permitted: "Only an owner or admin of this business can do that.",
    not_signed_in: "Your session ended. Sign in again.",
    subject_required: "Add a subject line first.",
    body_required: "Write the email first.",
    postal_address_missing: "Add your business's postal address in Settings first. Every marketing email shows it.",
    no_eligible_recipients: "Nobody in this audience can be emailed: no address, opted out, or already reached by this campaign.",
    over_daily_cap: `This audience is larger than today's sending limit. ${error?.details ?? ""}`.trim(),
    schedule_in_past: "The send time has passed. Choose a later time.",
    sender_not_found: "That sender no longer exists. Choose another.",
    sender_needs_attention: "This sender needs attention in Settings › Connections before it can send.",
    not_an_editable_draft: "This version is no longer a draft. Reload to see where it stands.",
    not_awaiting_approval: "This campaign is no longer waiting for approval. Reload to see where it stands.",
    campaign_has_history: "A campaign that has sent cannot be deleted.",
    cancel_first: "Stop the send first.",
    nothing_to_cancel: "There is nothing to stop.",
    business_inactive: "This business is not active, so nothing can send.",
    segment_not_found: "That segment no longer exists.",
    campaign_not_found: "That campaign no longer exists.",
    segment_in_use: "A campaign uses this segment. Choose another audience for that campaign first, or keep the segment.",
    sender_changed: "The sender changed since this was approved. Make changes to approve it with the new sender.",
    approval_stale: "Something changed since this was sent for approval. Reload, check it, and approve again.",
    not_blocked: "This campaign is not paused any more. Reload to see where it stands.",
    version_not_found: "That version no longer exists. Reload to see the current one.",
    not_the_current_version: "A newer version of this campaign exists. Reload to see it.",
  };
  return words[code] ?? "That did not work. Nothing was changed; try again.";
}

const GOALS: { key: string; label: string }[] = [
  { key: "none", label: "No goal" }, { key: "form_submission", label: "Fills in a form" }, { key: "booking", label: "Books a meeting" },
  { key: "deal_created", label: "Becomes a deal" }, { key: "invoice_paid", label: "Pays an invoice" },
];
const INACTIVE = [0, 30, 60, 90, 180];
const words = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
const stageLabel = (k: string) => STAGE_LABEL[k] ?? words(k);
const sourceLabel = (k: string) => SOURCE_LABEL[k] ?? words(k);

function ruleSummary(rule: Rule): string {
  const parts: string[] = [];
  if (rule.stages?.length) parts.push(rule.stages.map(stageLabel).join(" or "));
  if (rule.sources?.length) parts.push(`from ${rule.sources.map(sourceLabel).join(" or ")}`);
  if (rule.tags?.length) parts.push(`tagged ${rule.tags.join(" or ")}`);
  if (rule.inactive_days) parts.push(`not contacted in ${rule.inactive_days} days`);
  return parts.length ? parts.join(", ") : "All contacts";
}

/** Who a rule reaches today; re-read a moment after the rule stops changing. */
function useAudiencePreview(rule: Rule, kind: string, segmentId: string | null, enabled = true) {
  const [state, setState] = React.useState<{ phase: Phase; data: Preview | null }>({ phase: "loading", data: null });
  const key = JSON.stringify([rule, kind, segmentId]);
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => ({ phase: "loading", data: s.data }));
    const timer = setTimeout(() => {
      rpc("email_audience_preview", { p_rule: rule, p_kind: kind, p_segment_id: segmentId })
        .then(({ data, error }) => { if (!live) return; if (error) { console.error("[marketing-email] audience preview failed", error); setState({ phase: "error", data: null }); } else setState({ phase: "ready", data: data as Preview }); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function Chips({ label, options, chosen, onToggle, render }: { label: string; options: Choice[]; chosen: string[]; onToggle: (key: string) => void; render: (key: string) => string }) {
  if (!options.length) return null;
  return <fieldset className="me-field"><legend>{label}</legend><div className="me-chips">
    {options.map((o) => <button type="button" key={o.key} className="me-chip" aria-pressed={chosen.includes(o.key)} onClick={() => onToggle(o.key)}>{render(o.key)}<small>{o.count}</small></button>)}
  </div></fieldset>;
}

export function RuleBuilder({ rule, onChange, choices, disabled }: { rule: Rule; onChange: (rule: Rule) => void; choices: Choices | null; disabled?: boolean }) {
  const toggle = (field: "stages" | "sources" | "tags", key: string) => {
    const list = rule[field] ?? [];
    const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
    onChange({ ...rule, [field]: next.length ? next : undefined });
  };
  if (!choices) return <div className="campaigns-skeleton mp-skeleton" role="status" aria-label="Loading contact groups"><span/><span/></div>;
  return <fieldset className="me-rule" disabled={disabled}>
    <legend className="campaigns-sr-only">Who receives it</legend>
    <p className="me-hint">Choose any mix. Nothing chosen means every contact.</p>
    <Chips label="Stage" options={choices.stages} chosen={rule.stages ?? []} onToggle={(k) => toggle("stages", k)} render={stageLabel}/>
    <Chips label="Source" options={choices.sources} chosen={rule.sources ?? []} onToggle={(k) => toggle("sources", k)} render={sourceLabel}/>
    <Chips label="Tag" options={choices.tags} chosen={rule.tags ?? []} onToggle={(k) => toggle("tags", k)} render={(k) => k}/>
    <fieldset className="me-field"><legend>Last contacted</legend><div className="me-chips" role="group">
      {INACTIVE.map((n) => <button type="button" key={n} className="me-chip" aria-pressed={(rule.inactive_days ?? 0) === n} onClick={() => onChange({ ...rule, inactive_days: n || undefined })}>{n ? `${n}+ days ago` : "Any time"}</button>)}
    </div></fieldset>
  </fieldset>;
}

function Reach({ preview, newsletter }: { preview: { phase: Phase; data: Preview | null }; newsletter: boolean }) {
  const p = preview.data;
  if (!p) return <p className="me-reach" aria-live="polite">{preview.phase === "error" ? "The count could not load." : "Counting…"}</p>;
  const out = [
    p.no_address && `${p.no_address} without an email address`,
    p.opted_out && `${p.opted_out} opted out`,
    p.suppressed && `${p.suppressed} unsubscribed or bounced`,
    newsletter && p.no_consent && `${p.no_consent} not subscribed to your newsletter`,
  ].filter(Boolean);
  return <div className="me-reach" aria-live="polite" aria-busy={preview.phase === "loading"}>
    <strong>{p.eligible.toLocaleString()}</strong><span> {p.eligible === 1 ? "person" : "people"} can receive it</span>
    {out.length > 0 && <small>Left out: {out.join(", ")}.</small>}
    {p.eligible > p.remaining_today && <small className="is-warn">Today’s limit leaves room for {p.remaining_today.toLocaleString()}. Narrow the audience or send tomorrow.</small>}
  </div>;
}

type Draft = { name: string; kind: string; subject: string; preheader: string; source: string | null; html: string; sender: Sender; audience: Rule; segment_id: string | null; scheduled_for: string | null; conversion_goal: string };
// What a draft holds on the server, in one comparable string: key order and time formats normalised, so
// only a real change differs.
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
const heldKey = (h: { name: string; kind: string; state: string; subject: string; preheader: string; html: string; audience: unknown; segment_id: string | null; scheduled_for: string | null; conversion_goal: string }) =>
  JSON.stringify(canon({ ...h, name: h.name.trim(), scheduled_for: h.scheduled_for ? Date.parse(h.scheduled_for) : null }));
const serverKey = (d: CampaignRead) => heldKey({ name: d.campaign.name, kind: d.campaign.kind, state: `${d.campaign.status}/${d.version.id}/${d.version.state}`,
  subject: d.version.subject, preheader: d.version.preheader, html: d.version.body_html, audience: d.version.audience ?? {},
  segment_id: d.version.segment_id, scheduled_for: d.version.scheduled_for, conversion_goal: d.version.conversion_goal });
const toLocalInput = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function EmailCampaignEditor({ campaignId, onBack, onOpenSettings, onOpenConnections }: { campaignId: string; onBack: () => void; onOpenSettings: (() => void) | null; onOpenConnections: (() => void) | null }) {
  const [read, setRead] = React.useState<{ phase: Phase; data: CampaignRead | null; missing?: boolean }>({ phase: "loading", data: null });
  const [attempt, setAttempt] = React.useState(0);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [save, setSave] = React.useState<"saved" | "saving" | "dirty" | "failed">("saved");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "bad" | "ok"; text: string } | null>(null);
  const [width, setWidth] = React.useState<"desktop" | "phone">("desktop");
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState("");
  // PAIGE can change this draft from chat while it is open here. `held` is what the server held when this
  // screen last loaded or saved it; a chat turn that leaves something different behind was PAIGE's.
  const held = React.useRef<string | null>(null);
  const [changedByPaige, setChangedByPaige] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    rpc("read_email_campaign", { p_campaign_id: campaignId }).then(({ data, error }) => {
      if (!live) return;
      if (error) { console.error("[marketing-email] campaign read failed", error); setRead({ phase: "error", data: null, missing: error.message === "campaign_not_found" }); return; }
      const d = data as CampaignRead;
      setRead({ phase: "ready", data: d });
      held.current = serverKey(d);
      setChangedByPaige(false);
      const source = sourceOf(d.version.body_html);
      setDraft({ name: d.campaign.name, kind: d.campaign.kind, subject: d.version.subject, preheader: d.version.preheader, source,
        html: d.version.body_html, sender: d.version.sender, audience: d.version.audience ?? {}, segment_id: d.version.segment_id,
        scheduled_for: d.version.scheduled_for, conversion_goal: d.version.conversion_goal });
      setSave("saved");
    });
    return () => { live = false; };
  }, [campaignId, attempt]);
  const reload = () => setAttempt((n) => n + 1);

  const data = read.data;
  const editable = data?.version.state === "draft" && data.campaign.status === "draft";
  const bodyHtml = draft ? (draft.source !== null ? markupToHtml(draft.source) : draft.html) : "";
  const preview = useAudiencePreview(draft?.segment_id ? {} : (draft?.audience ?? {}), draft?.kind ?? "standard", draft?.segment_id ?? null, Boolean(draft && editable));

  // Save a moment after typing stops. Each edit bumps the revision; a save that finishes after a newer
  // edit leaves the draft marked unsaved, so the newer edit is saved next and never lost.
  const revision = React.useRef(0);
  // Saves run one at a time, in order: a slow earlier save can never land after a later one, so Review
  // (which saves, then freezes) always freezes the latest edit.
  const queue = React.useRef<Promise<unknown>>(Promise.resolve());
  const persist = React.useCallback((d: Draft) => {
    const rev = revision.current;
    const run = queue.current.then(() => write(d, rev));
    queue.current = run.catch(() => undefined);
    return run;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const write = async (d: Draft, rev: number) => {
    if (!data) return false;
    setSave("saving");
    const html = d.source !== null ? markupToHtml(d.source) : d.html;
    const { error } = await rpc("email_campaign_update_draft", {
      p_version_id: data.version.id, p_name: d.name, p_kind: d.kind, p_subject: d.subject, p_preheader: d.preheader, p_body_html: html,
      p_sender: d.sender.mode === "connector" ? { mode: "connector", connector_id: d.sender.connector_id } : { mode: "managed" },
      p_audience: d.audience, p_segment_id: d.segment_id, p_clear_segment: !d.segment_id,
      p_scheduled_for: d.scheduled_for, p_clear_schedule: !d.scheduled_for, p_conversion_goal: d.conversion_goal,
    });
    if (error) { console.error("[marketing-email] draft save failed", error); setSave("failed"); setNotice({ tone: "bad", text: errorWords(error) }); return false; }
    held.current = heldKey({ name: d.name, kind: d.kind, state: `${data.campaign.status}/${data.version.id}/${data.version.state}`, subject: d.subject,
      preheader: d.preheader, html, audience: d.audience, segment_id: d.segment_id, scheduled_for: d.scheduled_for, conversion_goal: d.conversion_goal });
    setChangedByPaige(false);
    setSave(rev === revision.current ? "saved" : "dirty");
    return true;
  };
  React.useEffect(() => {
    if (!draft || !editable || save !== "dirty") return;
    const timer = setTimeout(() => { void persist(draft); }, 800);
    return () => clearTimeout(timer);
  }, [draft, editable, save, persist]);
  const change = (patch: Partial<Draft>) => { revision.current += 1; setDraft((d) => (d ? { ...d, ...patch } : d)); setSave("dirty"); setNotice(null); };

  // Leaving must never drop the last edits: Back saves first, unmounting saves what is pending, and the
  // browser asks before a reload or a closed tab while anything is unsaved.
  const unsaved = Boolean(editable && draft && save !== "saved");
  const pending = React.useRef<{ draft: Draft | null; unsaved: boolean; persist: typeof persist }>({ draft: null, unsaved: false, persist });
  pending.current = { draft, unsaved, persist };
  React.useEffect(() => () => {
    const { draft: last, unsaved: open, persist: flush } = pending.current;
    if (open && last) void flush(last);
  }, []);
  React.useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  // When a chat turn ends, look again. A change PAIGE made replaces what is shown, unless there are edits
  // here not yet saved: then say so, so neither version is lost without the owner seeing it.
  React.useEffect(() => {
    const check = () => {
      rpc("read_email_campaign", { p_campaign_id: campaignId }).then(({ data, error }) => {
        if (error || !data || held.current === null || serverKey(data as CampaignRead) === held.current) return;
        if (pending.current.unsaved) { setChangedByPaige(true); return; }
        reload();
        setNotice({ tone: "ok", text: "PAIGE updated this campaign." });
      });
    };
    window.addEventListener("paige:turn-settled", check);
    return () => window.removeEventListener("paige:turn-settled", check);
  }, [campaignId]);
  const takePaigeVersion = () => { pending.current.unsaved = false; revision.current += 1; setChangedByPaige(false); reload(); };

  const leave = async () => {
    if (unsaved && draft) {
      pending.current.unsaved = false; // this save is the one; unmounting need not repeat it
      if (!(await persist(draft)) && !window.confirm("Your latest changes did not save. Leave anyway and lose them?")) { pending.current.unsaved = true; return; }
    }
    onBack();
  };

  const act = async (key: string, fn: string, args: Record<string, unknown>, done?: string) => {
    setBusy(key); setNotice(null);
    const { error } = await rpc(fn, args);
    setBusy(null);
    if (error) { console.error(`[marketing-email] ${fn} failed`, error); setNotice({ tone: "bad", text: errorWords(error) }); return false; }
    if (done) setNotice({ tone: "ok", text: done });
    reload();
    return true;
  };
  const review = async () => {
    if (!draft || !data) return;
    if (!(await persist(draft))) return;
    await act("review", "email_campaign_request_approval", { p_version_id: data.version.id, p_source: "owner" });
  };
  const remove = async () => {
    if (!window.confirm("Delete this campaign? This cannot be undone.")) return;
    if (await act("delete", "email_campaign_delete", { p_campaign_id: campaignId })) onBack();
  };

  if (!data || !draft) return <div className="mk-view mo me me-editor"><button type="button" className="mo-link me-back" onClick={onBack}><Ic.arrow size={12}/>Email</button>
    {read.missing ? <section className="campaigns-surface"><div className="campaigns-state"><h2>This campaign no longer exists</h2><p>It may have been deleted.</p><button className="btn btn-s" onClick={onBack}>Back to Email</button></div></section>
      : <Frame phase={read.phase} retry={reload} noun="campaign">{null}</Frame>}
  </div>;

  const c = data.campaign, v = data.version, p = data.progress;
  const newsletter = draft.kind === "newsletter";
  const sentEmail = renderCampaignEmail({ bodyHtml, preheader: draft.preheader, businessName: data.business_name, postalAddress: data.postal_address ?? "" });
  const from = editable ? (draft.sender.mode === "connector" ? data.senders.find((s) => s.connector_id === draft.sender.connector_id) : data.managed_sender) : (v.sender_snapshot ?? data.resolves);
  const fromLine = from?.from_address ? `${from.from_name ? `${from.from_name} <${from.from_address}>` : from.from_address}` : "No sender set up";
  // One tab stop for the sender group (the chosen sender, or the first one when none is chosen yet).
  const anyChosen = draft.sender.mode === "managed" ? data.managed_sender.ok : data.senders.some((x) => x.connector_id === draft.sender.connector_id && x.healthy);
  const tabStop = (chosen: boolean) => (chosen || !anyChosen ? 0 : -1);
  const later = Boolean(v.scheduled_for && Date.parse(v.scheduled_for) > Date.now());
  const state = { draft: "Draft", pending_approval: "Awaiting approval", scheduled: later ? "Scheduled" : "Approved", sending: "Sending", completed: "Sent", partially_completed: "Partly sent", failed: p.not_confirmed ? "Not confirmed" : "Not sent", blocked: "Paused", cancelled: "Cancelled" }[c.status] ?? c.status;
  const at = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return <div className="mk-view mo me me-editor">
    <div className="me-editor-head">
      <button type="button" className="mo-link me-back" onClick={() => void leave()}><Ic.arrow size={12}/>Email</button>
      <div className="me-title">
        {editable ? <label className="me-name-input"><span className="campaigns-sr-only">Campaign name</span><input value={draft.name} maxLength={200} onChange={(e) => change({ name: e.target.value })}/></label> : <h2>{c.name}</h2>}
        <span className="me-kind">{KIND_LABEL[draft.kind] ?? "Campaign"}</span>
        <span className={`mk-flag ${c.status === "completed" ? "is-live" : c.status === "blocked" || (c.status === "failed" && !p.not_confirmed) ? "is-blocked" : c.status === "partially_completed" || c.status === "failed" ? "is-warn" : c.status === "draft" || c.status === "cancelled" ? "" : "is-review"}`}>{state}</span>
        {editable && <span className="me-save" aria-live="polite">{save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "failed" ? "Not saved" : "Saved"}</span>}
      </div>
      <div className="me-editor-acts">
        {editable && <button type="button" className="btn btn-s" onClick={() => void remove()} disabled={busy !== null}>Delete</button>}
        {editable && <button type="button" className="btn btn-s btn-p" onClick={() => void review()} disabled={busy !== null || !data.postal_address}>{busy === "review" ? "Preparing…" : "Review and send"}</button>}
      </div>
    </div>
    {notice && <p className={`me-notice ${notice.tone === "bad" ? "is-bad" : "is-ok"}`} role={notice.tone === "bad" ? "alert" : "status"}>{notice.text}</p>}
    {changedByPaige && <p className="me-notice is-warn" role="status">PAIGE changed this campaign while you were editing. Your edits will save over hers.{" "}
      <button type="button" className="btn btn-s" onClick={takePaigeVersion}>Show PAIGE's version</button></p>}
    {data.last_declined && editable && <p className="me-notice is-warn" role="status">Version {data.last_declined.version_no} was declined{data.last_declined.reason ? `: “${data.last_declined.reason}”` : "."} This is a new draft; change what you need and send it for approval again.</p>}
    {!data.postal_address && editable && <div className="mo-next me-warn"><span className="mo-next-plate" aria-hidden="true"><Ic.shield size={16}/></span><div><h2>Add your postal address</h2><p>Every marketing email shows the sender’s postal address. You can write this campaign now; it sends once the address is added.</p></div>{onOpenSettings && <button type="button" className="btn btn-s" onClick={onOpenSettings}>Open Settings</button>}</div>}

    {c.status === "pending_approval" && <section className="campaigns-surface mo-panel me-review" aria-labelledby="me-review-h">
      <div className="mo-panel-head"><div><h2 id="me-review-h">Ready to send</h2><p>Approve to send this exact email. Any change makes a new draft that needs approving again.</p></div></div>
      <dl className="me-facts">
        <div><dt>To</dt><dd>{(v.expected_recipients ?? 0).toLocaleString()} {v.expected_recipients === 1 ? "person" : "people"}</dd></div>
        <div><dt>From</dt><dd>{fromLine}</dd></div>
        <div><dt>When</dt><dd>{later && v.scheduled_for ? at(v.scheduled_for) : "As soon as you approve"}</dd></div>
        <div><dt>Cost</dt><dd>{v.cost_bound_usd ? `About ${costWords(Number(v.cost_bound_usd))} on PAIGE’s sender (an estimate)` : "Sent through your own connection"}</dd></div>
      </dl>
      <div className="me-review-acts">
        <button type="button" className="btn btn-s btn-g" disabled={busy !== null} onClick={() => void act("approve", "email_campaign_approve", { p_version_id: v.id }, later && v.scheduled_for ? `Approved. It sends ${at(v.scheduled_for)}.` : "Approved. Sending starts within a minute.")}>{busy === "approve" ? "Approving…" : "Approve and send"}</button>
        <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("edit", "email_campaign_new_version", { p_campaign_id: c.id })}>Make changes</button>
        <button type="button" className="btn btn-s btn-q" disabled={busy !== null} onClick={() => setDeclineOpen((o) => !o)} aria-expanded={declineOpen}>Decline</button>
      </div>
      {declineOpen && <form className="me-decline" onSubmit={(e) => { e.preventDefault(); void act("decline", "email_campaign_decline", { p_version_id: v.id, p_reason: declineReason.trim() || null }).then((ok) => { if (ok) { setDeclineOpen(false); setDeclineReason(""); } }); }}>
        <label><span>What should change? (optional)</span><input value={declineReason} maxLength={500} onChange={(e) => setDeclineReason(e.target.value)}/></label>
        <button type="submit" className="btn btn-s" disabled={busy !== null}>Decline and return to draft</button>
      </form>}
    </section>}

    {(c.status === "scheduled" || c.status === "sending") && <section className="campaigns-surface mo-panel me-review">
      <div className="mo-panel-head"><div><h2>{c.status === "sending" ? "Sending" : "Approved"}</h2><p>{c.status === "scheduled" && later && v.scheduled_for ? `Sends ${at(v.scheduled_for)}.` : c.status === "scheduled" && !p.sent ? "Approved, waiting to send." : `${p.sent.toLocaleString()} of ${p.total.toLocaleString()} sent${unsent(p)}.`}</p></div></div>
      <div className="me-progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.sent} aria-label="Sent so far"><i style={{ transform: `scaleX(${p.total ? p.sent / p.total : 0})` }}/></div>
      <div className="me-review-acts"><button type="button" className="btn btn-s" onClick={reload}>Refresh</button><button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => { if (window.confirm("Stop sending? Emails already sent stay sent.")) void act("cancel", "email_campaign_cancel", { p_campaign_id: c.id }, "Stopped. Nobody else will receive it."); }}>Stop sending</button></div>
    </section>}

    {c.status === "blocked" && <section className="campaigns-surface mo-panel me-review is-blocked">
      <div className="mo-panel-head"><div><h2>Sending is paused</h2><p>{blockReason(c.blocked_reason)} Nothing more sends until it is fixed. Nothing was sent from a different address.</p></div></div>
      <div className="me-review-acts">
        {c.blocked_reason === "postal_address_missing" && onOpenSettings && <button type="button" className="btn btn-s" onClick={onOpenSettings}>Open Settings</button>}
        {(c.blocked_reason === "sender_needs_attention" || c.blocked_reason === "sender_changed") && onOpenConnections && <button type="button" className="btn btn-s" onClick={onOpenConnections}>Open Connections</button>}
        <button type="button" className="btn btn-s btn-p" disabled={busy !== null} onClick={() => void act("resume", "email_campaign_resume", { p_campaign_id: c.id }, "Resumed.")}>Try again</button>
        <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("cancel", "email_campaign_cancel", { p_campaign_id: c.id })}>Cancel campaign</button>
      </div>
    </section>}

    {["completed", "partially_completed", "failed", "cancelled"].includes(c.status) && <section className="campaigns-surface mo-panel me-review">
      <div className="mo-panel-head"><div><h2>Results</h2><p>{!p.sent && p.not_confirmed ? `No send was confirmed. ${p.not_confirmed.toLocaleString()} ${p.not_confirmed === 1 ? "was" : "were"} handed to the sender with no reply; they may have arrived, and they are never sent again.` : p.tracked ? "Opens and clicks are reported by PAIGE’s sender." : p.sent ? "Your own mail server does not report opens or clicks." : "Nothing was sent."}</p></div>
        <button type="button" className="btn btn-s" disabled={busy !== null} onClick={() => void act("again", "email_campaign_new_version", { p_campaign_id: c.id })}>Edit and send again</button></div>
      <dl className="me-results">
        <div><dt>Sent</dt><dd>{p.sent.toLocaleString()}</dd></div>
        <div><dt>Opened</dt><dd>{p.tracked ? `${p.opened.toLocaleString()} · ${Math.round((p.opened / p.tracked) * 1000) / 10}%` : "—"}</dd></div>
        <div><dt>Clicked</dt><dd>{p.tracked ? `${p.clicked.toLocaleString()} · ${Math.round((p.clicked / p.tracked) * 1000) / 10}%` : "—"}</dd></div>
        <div><dt>Failed</dt><dd>{p.failed.toLocaleString()}</dd></div>
        <div><dt>Not confirmed</dt><dd>{p.not_confirmed.toLocaleString()}</dd></div>
        <div><dt>Skipped</dt><dd>{p.skipped.toLocaleString()}</dd></div>
      </dl>
      <p className="mo-note">“Edit and send again” never goes to someone this campaign already reached.</p>
    </section>}

    <div className="me-compose">
      <div className="me-compose-form">
        <section className="campaigns-surface mo-panel" aria-labelledby="me-to">
          <div className="mo-panel-head"><div><h2 id="me-to">To</h2><p>{newsletter ? "A newsletter goes only to contacts who opted in to it." : "Contacts who opted out, unsubscribed or bounced are always left out."}</p></div></div>
          {editable ? <>
            {data.segments.length > 0 && <div className="campaigns-segmented me-seg" role="group" aria-label="Audience">
              <button type="button" aria-pressed={!draft.segment_id} onClick={() => change({ segment_id: null })}>Choose contacts</button>
              <button type="button" aria-pressed={Boolean(draft.segment_id)} onClick={() => change({ segment_id: data.segments[0].id })}>A saved segment</button>
            </div>}
            {draft.segment_id ? <div className="me-chips" role="group" aria-label="Segment">{data.segments.map((s) => <button type="button" key={s.id} className="me-chip" aria-pressed={draft.segment_id === s.id} onClick={() => change({ segment_id: s.id })}>{s.name}</button>)}</div>
              : <RuleBuilder rule={draft.audience} onChange={(audience) => change({ audience })} choices={data.choices}/>}
            <Reach preview={preview} newsletter={newsletter}/>
          </> : <p className="me-reach"><strong>{(v.expected_recipients ?? p.total).toLocaleString()}</strong><span> {ruleSummary(v.audience ?? {})}</span></p>}
        </section>

        <section className="campaigns-surface mo-panel" aria-labelledby="me-from">
          <div className="mo-panel-head"><div><h2 id="me-from">From</h2><p>Your own email connection sends first. PAIGE’s sender is used only if you choose it.</p></div>{onOpenConnections && editable && <button type="button" className="mo-link" onClick={onOpenConnections}>Connections<Ic.arrow size={12}/></button>}</div>
          {editable ? <div className="me-senders" role="radiogroup" aria-label="Sender" onKeyDown={roveRadios}>
            {data.senders.map((s) => <button type="button" role="radio" key={s.connector_id} aria-checked={draft.sender.mode === "connector" && draft.sender.connector_id === s.connector_id} tabIndex={tabStop(draft.sender.mode === "connector" && draft.sender.connector_id === s.connector_id)} disabled={!s.healthy} onClick={() => change({ sender: { mode: "connector", connector_id: s.connector_id } })}>
              <strong>{s.from_name ? `${s.from_name} <${s.from_address}>` : s.from_address ?? "No address"}</strong><small>{s.healthy ? `Your ${words(s.provider ?? "email")} connection` : "Needs attention in Connections"}</small></button>)}
            <button type="button" role="radio" aria-checked={draft.sender.mode === "managed"} tabIndex={tabStop(draft.sender.mode === "managed")} disabled={!data.managed_sender.ok} onClick={() => change({ sender: { mode: "managed" } })}>
              <strong>{data.managed_sender.ok ? (data.managed_sender.from_name ? `${data.managed_sender.from_name} <${data.managed_sender.from_address}>` : data.managed_sender.from_address) : "PAIGE’s sender"}</strong>
              <small>{data.managed_sender.ok ? "PAIGE’s sender · up to 500 a day · opens and clicks reported" : "Not set up for this business yet"}</small></button>
          </div> : <p className="me-reach"><span>{fromLine}</span></p>}
        </section>

        <section className="campaigns-surface mo-panel" aria-labelledby="me-write">
          <div className="mo-panel-head"><div><h2 id="me-write">Email</h2></div>{editable && <button type="button" className="mo-ask" onClick={() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: `Write the email for my campaign "${draft.name}" (campaign ${campaignId}, ${KIND_LABEL[draft.kind] ?? "Campaign"}${draft.subject ? `, subject "${draft.subject}"` : ""}). Ask me who it is for and what I want them to do before you write it. Then save the subject line, preview line and body into this campaign's draft. Do not file it for approval unless I ask, and never say it was sent.` } }))}><Ic.spark size={12}/>Write with PAIGE</button>}</div>
          <label className="me-input"><span>Subject</span><input value={draft.subject} maxLength={300} disabled={!editable} onChange={(e) => change({ subject: e.target.value })} placeholder="What the inbox shows first"/></label>
          <label className="me-input"><span>Preview text</span><input value={draft.preheader} maxLength={300} disabled={!editable} onChange={(e) => change({ preheader: e.target.value })} placeholder="The line shown after the subject"/></label>
          <label className="me-input"><span>{draft.source !== null ? "Message" : "Message (HTML)"}</span>
            <textarea rows={14} disabled={!editable} value={draft.source !== null ? draft.source : draft.html}
              onChange={(e) => (draft.source !== null ? change({ source: e.target.value }) : change({ html: e.target.value }))}
              placeholder={"Hi there,\n\nWrite your email here.\n\n[[Book a call|https://…]]"}/></label>
          {draft.source !== null ? <p className="me-hint">A line starting “# ” is a heading, “- ” a list item. [text](https://…) is a link. [[Button text|https://…]] on its own line is a button.</p>
            : <p className="me-hint">This email was written as HTML. Edit it here, or clear it to write in plain text.{editable && <> <button type="button" className="mo-link" onClick={() => change({ source: "", html: "" })}>Start over in plain text</button></>}</p>}
        </section>

        <section className="campaigns-surface mo-panel" aria-labelledby="me-when">
          <div className="mo-panel-head"><div><h2 id="me-when">When and goal</h2></div></div>
          <div className="campaigns-segmented me-seg" role="group" aria-label="When">
            <button type="button" disabled={!editable} aria-pressed={!draft.scheduled_for} onClick={() => change({ scheduled_for: null })}>When I approve</button>
            <button type="button" disabled={!editable} aria-pressed={Boolean(draft.scheduled_for)} onClick={() => change({ scheduled_for: new Date(Date.now() + 86_400_000).toISOString() })}>At a set time</button>
          </div>
          {draft.scheduled_for && <label className="me-input"><span>Send at</span><input type="datetime-local" disabled={!editable} value={toLocalInput(draft.scheduled_for)} onChange={(e) => change({ scheduled_for: e.target.value ? new Date(e.target.value).toISOString() : null })}/></label>}
          <fieldset className="me-field" disabled={!editable}><legend>Counts as a conversion when someone, within 7 days of a click…</legend><div className="me-chips">
            {GOALS.map((g) => <button type="button" key={g.key} className="me-chip" aria-pressed={draft.conversion_goal === g.key} onClick={() => change({ conversion_goal: g.key })}>{g.label}</button>)}
          </div></fieldset>
        </section>
      </div>

      <aside className="campaigns-surface mo-panel me-preview" aria-labelledby="me-prev">
        <div className="mo-panel-head"><div><h2 id="me-prev">Preview</h2><p>The email as it is sent, footer included.</p></div>
          <div className="campaigns-segmented me-seg" role="group" aria-label="Preview width"><button type="button" aria-pressed={width === "desktop"} onClick={() => setWidth("desktop")}>Desktop</button><button type="button" aria-pressed={width === "phone"} onClick={() => setWidth("phone")}>Phone</button></div></div>
        <div className="me-inbox"><span className="me-inbox-from">{from?.from_name || from?.from_address || "Your business"}</span><strong>{draft.subject || "No subject yet"}</strong><small>{draft.preheader || "No preview text"}</small></div>
        <iframe title="Email preview" className={`me-frame is-${width}`} sandbox="" srcDoc={previewDocument(sentEmail)}/>
        {!data.postal_address && <p className="mo-note">The footer shows your postal address once it is added in Settings.</p>}
      </aside>
    </div>
  </div>;
}

/** Every campaign, newest first. */
export function EmailCampaignList({ tenantId, onBack, onOpen }: { tenantId: string | null; onBack: () => void; onOpen: (id: string) => void }) {
  const [state, setState] = React.useState<{ phase: Phase; rows: { id: string; name: string; kind: string; status: string; updated_at: string }[] }>({ phase: "loading", rows: [] });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    const db = supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: unknown }> } } } } };
    db.from("email_campaigns").select("id,name,kind,status,updated_at").eq("tenant_id", tenantId).order("updated_at", { ascending: false }).limit(200)
      .then(({ data, error }) => { if (!live) return; if (error) { console.error("[marketing-email] list failed", error); setState({ phase: "error", rows: [] }); } else setState({ phase: "ready", rows: (data ?? []) as typeof state.rows }); });
    return () => { live = false; };
  }, [tenantId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="mk-view mo me">
    <button type="button" className="mo-link me-back" onClick={onBack}><Ic.arrow size={12}/>Email</button>
    <section className="campaigns-surface mo-panel"><div className="mo-panel-head"><div><h2>All campaigns</h2><p>{state.rows.length >= 200 ? "The 200 most recently changed." : "Newest first."}</p></div></div>
      <Frame phase={state.phase} retry={() => setAttempt((n) => n + 1)} noun="campaigns">
        {state.rows.length ? <ul className="mp-list">{state.rows.map((r) => <li key={r.id} className="me-list-row"><button type="button" className="me-name" onClick={() => onOpen(r.id)}><strong>{r.name}</strong><small>{KIND_LABEL[r.kind] ?? "Campaign"} · changed {new Date(r.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></button><span className="mk-flag">{{ draft: "Draft", pending_approval: "Awaiting approval", scheduled: "Scheduled", sending: "Sending", completed: "Sent", partially_completed: "Partly sent", failed: "Not sent", blocked: "Paused", cancelled: "Cancelled" }[r.status] ?? r.status}</span></li>)}</ul>
          : <p className="mo-note">No campaigns yet.</p>}
      </Frame>
    </section>
  </div>;
}

/** Arrow keys move through a radio group and choose, as a native radio group does. */
function roveRadios(e: React.KeyboardEvent<HTMLElement>) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (!radios.length) return;
  e.preventDefault();
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

/** Escape closes; Tab and Shift+Tab stay inside the drawer, since the page behind it is inert to the reader. */
function trapKeys(e: React.KeyboardEvent, root: HTMLElement | null, close: () => void) {
  if (e.key === "Escape") { close(); return; }
  if (e.key !== "Tab" || !root) return;
  const stops = Array.from(root.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])"))
    .filter((el) => !(el as HTMLButtonElement).disabled);
  if (!stops.length) return;
  const first = stops[0], last = stops[stops.length - 1];
  if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Create, change or delete a saved segment; or start a campaign to it. */
export function SegmentDialog({ segmentId, segment, onClose, onEmail }: { segmentId: string | null; segment: SegmentRow | null; onClose: (changed: boolean) => void; onEmail: (id: string, name: string) => void }) {
  const [name, setName] = React.useState(segment?.name ?? "");
  const [rule, setRule] = React.useState<Rule>((segment?.rule as Rule) ?? {});
  const [choices, setChoices] = React.useState<Choices | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const preview = useAudiencePreview(rule, "standard", null);
  const panel = React.useRef<HTMLElement>(null);
  const opener = React.useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);
  React.useEffect(() => {
    rpc("read_email_rule_choices").then(({ data, error: e }) => { if (e) console.error("[marketing-email] choices failed", e); else setChoices(data as Choices); });
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const back = opener.current;
    return () => { (back as HTMLElement | null)?.focus?.(); };
  }, []);
  const saveIt = async (thenEmail: boolean) => {
    setBusy(true); setError(null);
    const { data, error: e } = await rpc("email_segment_save", { p_id: segmentId, p_name: name.trim() || "Untitled segment", p_rule: rule });
    setBusy(false);
    if (e) { setError(errorWords(e)); return; }
    if (thenEmail) onEmail(String(data), name.trim() || "Untitled segment"); else onClose(true);
  };
  const del = async () => {
    if (!segmentId || !window.confirm("Delete this segment? Campaigns already sent to it keep their recipients.")) return;
    setBusy(true);
    const { error: e } = await rpc("email_segment_delete", { p_id: segmentId });
    setBusy(false);
    if (e) setError(errorWords(e)); else onClose(true);
  };
  return <div className="me-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false); }} onKeyDown={(e) => trapKeys(e, panel.current, () => onClose(false))}>
    <section ref={panel} className="me-drawer" role="dialog" aria-modal="true" aria-labelledby="me-seg-title">
      <div className="me-drawer-head"><h2 id="me-seg-title">{segmentId ? "Segment" : "New segment"}</h2><button type="button" className="me-x" aria-label="Close" onClick={() => onClose(false)}><Ic.x size={16}/></button></div>
      <label className="me-input"><span>Name</span><input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Leads from my website"/></label>
      <RuleBuilder rule={rule} onChange={setRule} choices={choices}/>
      <Reach preview={preview} newsletter={false}/>
      <p className="me-hint">A segment is a rule, so it keeps up as contacts change. A campaign takes a fixed list from it at the moment you send it for approval.</p>
      {error && <p className="me-notice is-bad" role="alert">{error}</p>}
      <div className="me-drawer-acts">
        {segmentId && <button type="button" className="btn btn-s btn-q" disabled={busy} onClick={() => void del()}>Delete</button>}
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => void saveIt(false)}>Save</button>
        <button type="button" className="btn btn-s btn-p" disabled={busy} onClick={() => void saveIt(true)}>Save and email them</button>
      </div>
    </section>
  </div>;
}
