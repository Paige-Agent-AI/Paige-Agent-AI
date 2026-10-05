// Marketing › Email (owner reference 2026-10-04): the business's marketing email at a glance, and where
// every campaign starts. Every figure is read through read_email_marketing_dashboard (one read, the
// caller's own business, owner or admin) and derived in marketing-email-model.ts; nothing is estimated.
//
// Acts (all through the E1 RPCs, so PAIGE can do the same from chat, §10):
//   email_campaign_create       a new draft (campaign, newsletter, re-engagement, welcome)
//   email_campaign_update_draft the starting audience for re-engagement and welcome
//   email_sequence_create       a new email series (marketing-email-series.tsx builds and runs it)
// The campaign itself is written, addressed, previewed and sent for approval in the editor
// (marketing-email-editor.tsx). Nothing on this page sends anything.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Ic as SharedIcons } from "./_shared";
import { ACTIVITY_LABEL, EMAIL_PERIODS, KIND_LABEL, activityDetail, ago, campaignState, deriveStats, ratePoints, type CampaignRow, type Dashboard, type Delta } from "./marketing-email-model";
import { AskPaige, ChartBoundary, OverviewStat } from "./marketing-ui";
import { AskPaigeButton, Frame, TabActions, type Phase } from "./marketing-planned";
import { EmailCampaignEditor, EmailCampaignList, SegmentDialog } from "./marketing-email-editor";
import { EmailSeriesView, SeriesPanel, createSeries } from "./marketing-email-series";

// The shared icon set is untyped; these views pass only a size.
const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
const EmailRatesChart = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.EmailRatesChart })));

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/** The dashboard read for one business and period; a stale answer for another business or period is dropped. */
function useDashboard(tenantId: string | null, days: number) {
  const [state, setState] = React.useState<{ key: string; phase: Phase; data: Dashboard | null }>({ key: "", phase: "loading", data: null });
  const [attempt, setAttempt] = React.useState(0);
  const key = `${tenantId}:${days}`;
  React.useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setState((s) => ({ key, phase: "loading", data: s.key.startsWith(`${tenantId}:`) ? s.data : null }));
    rpc("read_email_marketing_dashboard", { p_days: days, p_tz: zone() })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { console.error("[marketing-email] dashboard read failed", error); setState({ key, phase: "error", data: null }); return; }
        setState({ key, phase: "ready", data: data as Dashboard });
      });
    return () => { live = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = state.key === key;
  return { phase: current ? state.phase : "loading", data: state.data, retry: () => setAttempt((n) => n + 1) };
}

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

function CountDelta({ delta, days, fallback }: { delta: Delta; days: number; fallback: string }) {
  if (!delta) return <span className="mo-delta">{fallback}</span>;
  if (delta.change === 0) return <span className="mo-delta">Same as the previous {days} days</span>;
  const up = delta.change > 0;
  const amount = delta.percent === null ? `${up ? "+" : ""}${delta.change}` : `${up ? "+" : ""}${delta.percent}%`;
  return <span className={`mo-delta ${up ? "is-up" : "is-down"}`}><Ic.arrow size={12}/>{amount} vs previous {days} days</span>;
}

function PointsDelta({ points, days, fallback }: { points: number | null; days: number; fallback: string }) {
  if (points === null) return <span className="mo-delta">{fallback}</span>;
  if (points === 0) return <span className="mo-delta">Same as the previous {days} days</span>;
  const up = points > 0;
  return <span className={`mo-delta ${up ? "is-up" : "is-down"}`}><Ic.arrow size={12}/>{up ? "+" : ""}{points} pts vs previous {days} days</span>;
}

type Starter = { key: string; icon: React.ReactNode; title: string; detail: string; act: () => void };

export function MarketingEmail({ tenantId, onOpenAudience, onOpenConnections, onOpenSettings }: {
  tenantId: string | null;
  onOpenAudience: () => void;
  onOpenConnections: (() => void) | null;
  onOpenSettings: (() => void) | null;
}) {
  const [days, setDays] = React.useState<number>(30);
  const [view, setView] = React.useState<{ kind: "dashboard" } | { kind: "campaign"; id: string } | { kind: "series"; id: string } | { kind: "all" }>(() => {
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const id = q?.get("campaign"), series = q?.get("series");
    return id ? { kind: "campaign", id } : series ? { kind: "series", id: series } : { kind: "dashboard" };
  });
  const [segment, setSegment] = React.useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [creating, setCreating] = React.useState<string | null>(null);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const read = useDashboard(tenantId, days);


  // The open campaign lives in the address, so a reload or a shared link reopens it.
  const go = React.useCallback((next: typeof view) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next.kind === "campaign") url.searchParams.set("campaign", next.id); else url.searchParams.delete("campaign");
    if (next.kind === "series") url.searchParams.set("series", next.id); else url.searchParams.delete("series");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  // Another business: whatever was open belonged to the last one, so go back to the dashboard and drop it
  // from the address.
  const shownTenant = React.useRef(tenantId);
  React.useEffect(() => {
    if (shownTenant.current === tenantId) return;
    shownTenant.current = tenantId;
    setSegment({ open: false, id: null });
    setCreateError(null);
    go({ kind: "dashboard" });
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (key: string, kind: string, name: string, audience?: Record<string, unknown>, segmentId?: string) => {
    setCreating(key); setCreateError(null);
    const made = await rpc("email_campaign_create", { p_kind: kind, p_name: name });
    const row = made.data as { campaign_id?: string; version_id?: string } | null;
    if (made.error || !row?.campaign_id || !row.version_id) {
      setCreating(null);
      setCreateError(made.error?.message === "not_permitted" ? "Only an owner or admin of this business can create campaigns." : "The campaign could not be created. Nothing was saved; try again.");
      return;
    }
    if (audience || segmentId) {
      // Without its audience a draft would address every contact, so it is never opened that way: remove it
      // and say so. (If even the removal fails, the draft is left unopened for the owner to find and fix.)
      const set = await rpc("email_campaign_update_draft", { p_version_id: row.version_id, p_audience: audience ?? null, p_segment_id: segmentId ?? null });
      if (set.error) {
        console.error("[marketing-email] starting audience not set", set.error);
        const undo = await rpc("email_campaign_delete", { p_campaign_id: row.campaign_id });
        if (undo.error) console.error("[marketing-email] incomplete draft not removed", undo.error);
        setCreating(null);
        setCreateError(undo.error
          ? `"${name}" was created but its audience could not be set, so it would reach every contact. Open it from All campaigns and choose who it is for before sending.`
          : "The campaign's audience could not be set, so nothing was saved. Try again.");
        read.retry();
        return;
      }
    }
    setCreating(null);
    go({ kind: "campaign", id: row.campaign_id });
  };

  const startSeries = async () => {
    setCreating("nurture"); setCreateError(null);
    const made = await createSeries("nurture");
    setCreating(null);
    if ("error" in made) { setCreateError(made.error); return; }
    go({ kind: "series", id: made.id });
  };

  if (view.kind === "campaign") return <EmailCampaignEditor campaignId={view.id} onBack={() => { go({ kind: "dashboard" }); read.retry(); }} onOpenSettings={onOpenSettings} onOpenConnections={onOpenConnections}/>;
  if (view.kind === "series") return <EmailSeriesView key={view.id} sequenceId={view.id} onBack={() => { go({ kind: "dashboard" }); read.retry(); }} onOpen={(id) => go({ kind: "series", id })} onOpenSettings={onOpenSettings} onOpenConnections={onOpenConnections}/>;
  if (view.kind === "all") return <EmailCampaignList key={tenantId ?? "none"} tenantId={tenantId} onBack={() => go({ kind: "dashboard" })} onOpen={(id) => go({ kind: "campaign", id })}/>;

  const d = read.data;
  // While another period loads, the figures on screen are still the old period's: label them as such.
  const shownDays = d?.period_days ?? days;
  const stats = d ? deriveStats(d.stats) : null;
  const points = d ? ratePoints(d.series) : [];
  const busy = creating !== null;
  const starters: Starter[] = [
    { key: "campaign", icon: <Ic.send size={20}/>, title: "Create a campaign", detail: "One-time send", act: () => void create("campaign", "standard", "Untitled campaign") },
    { key: "newsletter", icon: <Ic.doc size={20}/>, title: "Create a newsletter", detail: "To people who opted in", act: () => void create("newsletter", "newsletter", "Newsletter") },
    { key: "welcome", icon: <Ic.users size={20}/>, title: "Send a one-time welcome email", detail: "One email to current leads", act: () => void create("welcome", "welcome", "Welcome", { stages: ["new_lead", "lead"] }) },
    { key: "reengagement", icon: <Ic.clock size={20}/>, title: "Re-engagement campaign", detail: "Not contacted in 90 days", act: () => void create("reengagement", "reengagement", "We miss you", { inactive_days: 90 }) },
    { key: "nurture", icon: <Ic.trend size={20}/>, title: "Plan a nurture series", detail: "Sends by itself once you approve it", act: () => void startSeries() },
    { key: "paige", icon: <Ic.spark size={20}/>, title: "Use PAIGE", detail: "Describe what you need", act: () => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: "Draft a marketing email for my business. Ask me who it is for and what it should say before you write it, then save it as a campaign draft in Marketing › Email. Do not file it for approval unless I ask, and never say it was sent." } })) },
  ];

  const audienceRows = d ? [
    { key: "all", icon: <Ic.users size={14}/>, tone: "is-violet", label: "All contacts", value: d.audience.contacts },
    { key: "leads", icon: <Ic.plus size={14}/>, tone: "is-aqua", label: "New leads", value: d.audience.new_leads },
    { key: "customers", icon: <Ic.check size={14}/>, tone: "is-blue", label: "Customers", value: d.audience.customers },
    { key: "newsletter", icon: <Ic.mail size={14}/>, tone: "is-violet", label: "Newsletter subscribers", value: d.audience.newsletter_subscribers },
    { key: "inactive", icon: <Ic.clock size={14}/>, tone: "is-orange", label: "Inactive (90+ days)", value: d.audience.inactive_90 },
  ] : [];

  return <div className="mk-view mo mp me">
    <TabActions>
      <div className="campaigns-segmented" role="group" aria-label="Period">{EMAIL_PERIODS.map((n) => <button type="button" key={n} aria-pressed={days === n} onClick={() => setDays(n)}>Last {n} days</button>)}</div>
      <AskPaigeButton label="Ask PAIGE to draft an email" prompt="Draft a marketing email for my business. Ask me who it is for and what it should say before you write it, then save it as a campaign draft in Marketing › Email. Do not file it for approval unless I ask, and never say it was sent."/>
      {onOpenConnections && <button type="button" className="btn btn-s" onClick={onOpenConnections}><Ic.gear size={14}/>Sending settings</button>}
      <button type="button" className="btn btn-s btn-p" disabled={busy} onClick={() => void create("campaign", "standard", "Untitled campaign")}><Ic.plus size={14}/>New campaign</button>
    </TabActions>
    {createError && <p className="mo-note mp-inline-note" role="alert">{createError}</p>}
    <Frame phase={d ? "ready" : read.phase} retry={read.retry} noun="email dashboard">
      {d && stats && <>
        <div className="mo-stats me-stats" aria-busy={read.phase === "loading"}>
          <OverviewStat icon={<Ic.send size={18}/>} tone="is-violet" label="Emails sent" value={stats.sent.value.toLocaleString()} foot={<CountDelta delta={stats.sent.delta} days={shownDays} fallback={stats.sent.value ? "No earlier sends to compare" : "Nothing sent in this period"}/>}/>
          <OverviewStat icon={<Ic.mail size={18}/>} tone="is-aqua" label="Open rate" value={pct(stats.openRate.value)} foot={<PointsDelta points={stats.openRate.points} days={shownDays} fallback={stats.openRate.value === null ? (stats.untracked ? "Your own mail server does not report opens" : "Shown once an email is sent") : "No earlier period to compare"}/>}/>
          <OverviewStat icon={<Ic.arrow size={18}/>} tone="is-blue" label="Click rate" value={pct(stats.clickRate.value)} foot={<PointsDelta points={stats.clickRate.points} days={shownDays} fallback={stats.clickRate.value === null ? (stats.untracked ? "Your own mail server does not report clicks" : "Shown once an email is sent") : "No earlier period to compare"}/>}/>
          <OverviewStat icon={<Ic.plus size={18}/>} tone="is-violet" label="New subscribers" value={stats.subscribers.value.toLocaleString()} foot={<CountDelta delta={stats.subscribers.delta} days={shownDays} fallback="Newsletter opt-ins"/>}/>
          <OverviewStat icon={<Ic.chart size={18}/>} tone="is-orange" label="Conversions" value={stats.conversions.value.toLocaleString()} foot={<CountDelta delta={stats.conversions.delta} days={shownDays} fallback="A campaign's goal, within 7 days of a click"/>}/>
        </div>
        {stats.untracked > 0 && stats.untracked < stats.sent.value && <p className="mo-note mp-inline-note">Rates count the {(stats.sent.value - stats.untracked).toLocaleString()} emails sent through PAIGE’s sender. The {stats.untracked.toLocaleString()} sent through your own mail server do not report opens or clicks.</p>}
        {!d.sending.postal_address_set && <div className="mo-next me-warn" role="status"><span className="mo-next-plate" aria-hidden="true"><Ic.shield size={16}/></span><div><h2>Add your postal address before you send</h2><p>Every marketing email shows the sender’s postal address. Campaigns stay in draft until your business has one.</p></div>{onOpenSettings && <button type="button" className="btn btn-s" onClick={onOpenSettings}>Open Settings</button>}</div>}

        <div className="mo-grid me-grid-a">
          <section className="campaigns-surface mo-panel" aria-labelledby="me-start">
            <div className="mo-panel-head"><div><h2 id="me-start">Start creating</h2><p>Choose what to send. PAIGE can write it with you; nothing goes out until you approve it.</p></div></div>
            <ul className="me-starters">{starters.map((s) => <li key={s.key}><button type="button" onClick={s.act} disabled={busy} aria-busy={creating === s.key}>
              <span className="me-starter-icon" aria-hidden="true">{s.icon}</span><strong>{s.title}</strong><small>{creating === s.key ? "Creating…" : s.detail}</small>
            </button></li>)}</ul>
          </section>
          <section className="campaigns-surface mo-panel" aria-labelledby="me-audience">
            <div className="mo-panel-head"><div><h2 id="me-audience">Your audience</h2></div><button type="button" className="mo-link" onClick={onOpenAudience}>Open Audience<Ic.arrow size={12}/></button></div>
            <p className="me-total"><strong>{d.audience.with_email.toLocaleString()}</strong><span>contacts with an email address</span></p>
            <ul className="me-rows">{audienceRows.map((row) => <li key={row.key}><span className={`me-dot mo-plate ${row.tone}`} aria-hidden="true">{row.icon}</span><span>{row.label}</span><b>{row.value.toLocaleString()}</b></li>)}</ul>
          </section>
        </div>

        <div className="mo-grid me-grid-a">
          <section className="campaigns-surface mo-panel" aria-labelledby="me-recent">
            <div className="mo-panel-head"><div><h2 id="me-recent">Recent campaigns</h2>{d.campaign_count === 0 && <p>Your campaigns appear here once you start one.</p>}</div>{d.campaign_count > 0 && <button type="button" className="mo-link" onClick={() => go({ kind: "all" })}>All {d.campaign_count} campaign{d.campaign_count === 1 ? "" : "s"}<Ic.arrow size={12}/></button>}</div>
            {d.campaigns.length ? <CampaignTable rows={d.campaigns} onOpen={(id) => go({ kind: "campaign", id })}/>
              : <div className="mp-empty"><p className="mo-note">No campaigns yet. Start one above, or ask PAIGE to draft one for you.</p></div>}
          </section>
          <section className="campaigns-surface mo-panel" aria-labelledby="me-segments">
            <div className="mo-panel-head"><div><h2 id="me-segments">Segments</h2><p>Saved groups of contacts. Counts are who can be emailed today.</p></div><button type="button" className="mo-link" onClick={() => setSegment({ open: true, id: null })}><Ic.plus size={12}/>New segment</button></div>
            {d.segments.length ? <ul className="me-rows me-segments">{d.segments.map((s) => <li key={s.id}><button type="button" onClick={() => setSegment({ open: true, id: s.id })} aria-label={`${s.name}: ${s.eligible} can be emailed. Open segment`}>
              <span className="me-dot mo-plate is-violet" aria-hidden="true"><Ic.filter size={14}/></span><span>{s.name}</span><b>{s.eligible.toLocaleString()}</b><span className="me-chev" aria-hidden="true"><Ic.chev size={14}/></span>
            </button></li>)}</ul>
              : <div className="mp-empty"><p className="mo-note">No segments yet. Save one by stage, tag, source or how long since you were last in touch, and reuse it in any campaign.</p></div>}
            {d.segment_count > d.segments.length && <p className="mo-note">Showing the {d.segments.length} most recently changed of {d.segment_count}.</p>}
          </section>
        </div>

        <div className="mo-grid me-grid-b">
          <section className="campaigns-surface mo-panel" aria-labelledby="me-perf">
            <div className="mo-panel-head"><div><h2 id="me-perf">Email performance</h2><p>Open and click rate by day.</p></div><div className="mo-panel-tools"><ul className="mo-legend" aria-hidden="true"><li><i className="is-s1"/>Open rate</li><li><i className="is-s2"/>Click rate</li></ul></div></div>
            {points.some((p) => p.openRate !== null)
              ? <ChartBoundary className="mo-chart me-chart-rates"><EmailRatesChart points={points} label={`Open and click rate over the last ${shownDays} days`}/></ChartBoundary>
              : <div className="campaigns-state me-chart-empty"><h2>{stats.sent.value ? "Opens are not reported for these emails" : "Nothing sent in this period"}</h2><p>{stats.sent.value ? "Emails sent through your own mail server do not report opens or clicks." : "Rates appear here after your first campaign goes out."}</p></div>}
          </section>
          <section className="campaigns-surface mo-panel" aria-labelledby="me-auto">
            <div className="mo-panel-head"><div><h2 id="me-auto">Automations</h2><p>Email series that send by themselves once you approve them.</p></div></div>
            <SeriesPanel tenantId={tenantId} onOpen={(id) => go({ kind: "series", id })}/>
            <AskPaige prompt="Which email series would help my business most (a welcome for new contacts, a nurture for leads, or a win-back for quiet contacts), and what should each email say? Use only what you know about my business. Draft the emails here in chat; do not send or schedule anything."/>
            <p className="mo-note">Series share the {d.sending.daily_cap.toLocaleString()}-a-day limit with your campaigns. Series emails that don’t fit today wait; they’re never dropped.</p>
          </section>
          <section className="campaigns-surface mo-panel" aria-labelledby="me-activity">
            <div className="mo-panel-head"><div><h2 id="me-activity">Recent activity</h2></div></div>
            {d.activity.length ? <ul className="me-activity">{d.activity.map((a, i) => <li key={`${a.kind}-${a.at}-${i}`}>
              <span className={`me-dot mo-plate ${a.kind === "unsubscribed" || a.kind === "bounced" ? "is-orange" : a.kind === "subscribed" ? "is-aqua" : "is-violet"}`} aria-hidden="true">{a.kind === "campaign_sent" ? <Ic.send size={14}/> : a.kind === "subscribed" ? <Ic.plus size={14}/> : <Ic.x size={14}/>}</span>
              <span className="mp-list-main"><strong>{ACTIVITY_LABEL[a.kind]}</strong><small>{activityDetail(a)}</small></span>
              <time dateTime={a.at}>{ago(a.at)}</time>
            </li>)}</ul> : <p className="mo-note">Sends, new subscribers and unsubscribes appear here.</p>}
          </section>
        </div>
        <p className="mo-note me-cap">Up to {d.sending.daily_cap.toLocaleString()} marketing emails a day through PAIGE’s sender; {d.sending.remaining_today.toLocaleString()} left in the last 24 hours.</p>
      </>}
    </Frame>
    {segment.open && <SegmentDialog segmentId={segment.id} segment={d?.segments.find((s) => s.id === segment.id) ?? null}
      onClose={(changed) => { setSegment({ open: false, id: null }); if (changed) read.retry(); }}
      onEmail={(id, name) => { setSegment({ open: false, id: null }); void create("segment", "standard", `Email to ${name}`, undefined, id); }}/>}
  </div>;
}

function CampaignTable({ rows, onOpen }: { rows: CampaignRow[]; onOpen: (id: string) => void }) {
  const when = (c: CampaignRow) => c.first_sent_at ? new Date(c.first_sent_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : c.status === "scheduled" && c.scheduled_for ? `Sends ${new Date(c.scheduled_for).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "—";
  const r = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");
  return <div className="me-table-wrap"><table className="me-table">
    <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Audience</th><th scope="col">Sent</th><th scope="col" className="is-num">Open rate</th><th scope="col" className="is-num">Click rate</th><th scope="col">Status</th></tr></thead>
    <tbody>{rows.map((c) => {
      const s = campaignState(c);
      return <tr key={c.id}>
        <th scope="row"><button type="button" className="me-name" onClick={() => onOpen(c.id)}><strong>{c.name}</strong><small>{c.subject || "No subject yet"}</small></button></th>
        <td><span className={`me-kind is-${c.kind}`}>{KIND_LABEL[c.kind] ?? "Campaign"}</span></td>
        <td><span className="me-cell"><span>{c.segment_name ?? (c.kind === "newsletter" ? "Newsletter subscribers" : "Chosen contacts")}</span><small>{c.recipients === null ? "Not counted yet" : `${c.recipients.toLocaleString()} recipient${c.recipients === 1 ? "" : "s"}`}</small></span></td>
        <td>{when(c)}</td>
        <td className="is-num">{r(c.opened, c.tracked)}</td>
        <td className="is-num">{r(c.clicked, c.tracked)}</td>
        <td><span className={`mk-flag ${s.tone}`} title={s.detail}>{s.label}</span></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
