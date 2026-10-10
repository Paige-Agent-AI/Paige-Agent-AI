// Marketing › Analytics (INT-342 S1d, owner-approved prototype v2, 2026-10-10).
// docs/product/int342-marketing-convergence.md §K.
//
// One sentence, then the path from a lead to an opportunity, how much of it can be traced to a source,
// which forms collected it, and how each channel did. Every figure comes from a read that already
// exists: submissions, published forms and briefs (passed in from the Marketing hub) and, for the email
// row only, read_email_marketing_dashboard. Nothing is estimated. Where a channel has no source
// (ads, social, page visits) it says so instead of showing a zero.
//
// The prototype's Year range is left out: the email read serves 7, 30 or 90 days, and a year of leads
// would almost always exceed the submissions read, so a year figure would be mostly a floor.
import React from "react";
import { Ic as SharedIcons } from "./_shared";
import type { CampaignArtifact, CampaignSubmission } from "./useSoloCampaigns";
import type { CampaignBrief } from "./useSoloCampaignBriefs";
import { SUBMISSION_READ_LIMIT } from "./marketing-overview-model";
import { RANGES, deriveMarketingAnalytics, rangeOf, type RangeKey } from "./marketing-analytics-model";
import { rate } from "./marketing-email-model";
import { useEmailStats, type EmailRead } from "./marketing-analytics-email";
import "./marketing-overview.css";
import "./marketing-analytics.css";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
const ROUTE_WORDS = { pipeline: "Routed to a pipeline", alert: "Email alert only, no pipeline", automations: "No pipeline", none: "Not routed" } as const;
const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
const n = (count: number) => count.toLocaleString();

export type MarketingAnalyticsProps = {
  tenantId: string | null;
  submissions: CampaignSubmission[];
  forms: CampaignArtifact[];
  briefs: CampaignBrief[];
  /** False when the briefs read failed: campaign matching can't be done, and the page says so. */
  briefsKnown: boolean;
  /** Shown above the summary, e.g. that the briefs read failed. */
  notice?: React.ReactNode;
  range: RangeKey;
  onRange: (range: RangeKey) => void;
  onOpenForm: (formId: string) => void;
  onOpenSales: () => void;
  onOpenEmail: () => void;
  onOpenAds: () => void;
  /** Vibe Studio's launcher, for someone who may build there; offered when no form is live. */
  studioLauncher?: React.ReactNode;
};

export function MarketingAnalytics({ tenantId, submissions, forms, briefs, briefsKnown, notice, range, onRange, onOpenForm, onOpenSales, onOpenEmail, onOpenAds, studioLauncher }: MarketingAnalyticsProps) {
  const current = rangeOf(range);
  const model = React.useMemo(() => deriveMarketingAnalytics({ submissions, briefs, forms, days: current.days }), [submissions, briefs, forms, current.days]);
  const email = useEmailStats(tenantId, current.days);
  const floor = (count: number) => `${count.toLocaleString()}${model.capped ? "+" : ""}`;
  const period = `the last ${current.days} days`;
  const liveForms = model.capture.length;

  const sum = model.leads
    ? <><b>{plural(model.leads, "lead")}</b>{model.capped ? " or more" : ""} in {period}. <b>{floor(model.tagged)}</b> can be traced to a source, and <b>{floor(model.opportunities)}</b> became {model.opportunities === 1 ? "an opportunity" : "opportunities"}.</>
    : liveForms
      ? <>No leads in {period}, so there’s nothing to trace yet. {liveForms === 1 ? "Your live form is" : `All ${liveForms} live forms are`} ready to record the source on its link.</>
      : <>No leads in {period}, and no form is live to collect them.</>;
  const prompt = `Look at my marketing for ${period}: ${floor(model.leads)} leads, ${floor(model.tagged)} with a source tag, ${floor(model.matched)} matched to a campaign, and ${floor(model.opportunities)} became opportunities. Where should I focus next? Use only what my records show; this workspace does not record visits, spend, reach or revenue.`;

  return <div className="mov mva">
    {notice}
    <div className="mov-top">
      <p className="mov-sum" tabIndex={-1}>{sum}</p>
      <div className="mov-acts">
        <div className="campaigns-segmented" role="group" aria-label="Range">{RANGES.map((r) => <button type="button" key={r.key} aria-pressed={range === r.key} onClick={() => onRange(r.key)}>{r.label}</button>)}</div>
        <button type="button" className="btn" onClick={() => askPaige(prompt)}><Ic.spark size={14}/>Ask PAIGE</button>
      </div>
    </div>
    <Funnel model={model} floor={floor} days={current.days} briefsKnown={briefsKnown} onOpenSales={onOpenSales}/>
    <div className="mva-two">
      <Coverage model={model} floor={floor} days={current.days} briefsKnown={briefsKnown}/>
      <Capture model={model} floor={floor} onOpenForm={onOpenForm} studioLauncher={studioLauncher}/>
    </div>
    <Channels days={current.days} email={email} onOpenEmail={onOpenEmail} onOpenAds={onOpenAds}/>
    {model.capped && <p className="mva-cap">Counted from the latest {SUBMISSION_READ_LIMIT} submissions, all inside this range, so each count is a floor.</p>}
  </div>;
}

const askPaige = (prompt: string) => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }));

type Model = ReturnType<typeof deriveMarketingAnalytics>;

function Funnel({ model, floor, days, briefsKnown, onOpenSales }: { model: Model; floor: (n: number) => string; days: number; briefsKnown: boolean; onOpenSales: () => void }) {
  const steps = [
    { key: "leads", label: "Leads received", value: model.leads, def: "Every form submission in the range" },
    { key: "tagged", label: "With a source tag", value: model.tagged, def: "The link it came from carried a source tag" },
    { key: "matched", label: "Matched to a campaign", value: briefsKnown ? model.matched : null, def: briefsKnown ? "Its campaign tag is a brief’s reference" : "Briefs couldn’t load, so nothing can be matched" },
    { key: "opps", label: "Became opportunities", value: model.opportunities, def: "Handed to Sales as a deal" },
  ];
  return <section className="mov-card" aria-labelledby="mva-funnel-h">
    <header className="mov-head"><div><h2 id="mva-funnel-h">From lead to opportunity</h2><p>Last {days} days · each bar is a share of the leads received</p></div></header>
    <ol className="mva-funnel">{steps.map((step) => {
      const share = step.value === null || !model.leads ? 0 : Math.round((step.value / model.leads) * 100);
      return <li key={step.key} className="mva-step">
        <div className="mva-step-l">
          <b className="mva-n">{step.value === null ? "—" : floor(step.value)}</b>
          <span className="mva-step-t">{step.label}</span>
          <small>{step.def}</small>
        </div>
        <div className="mva-bar" role="img" aria-label={step.value === null ? `${step.label}: not available` : !model.leads ? `${step.label}: none` : step.key === "leads" ? `${step.label}: ${floor(model.leads)}` : `${step.label}: ${share}% of leads received`}>
          <i style={{ transform: `scaleX(${step.value === null || !model.leads || !step.value ? 0 : Math.max(0.02, step.value / model.leads)})` }}/>
          {step.key !== "leads" && model.leads > 0 && step.value !== null && <em>{share}%</em>}
        </div>
      </li>;
    })}</ol>
    <p className="mov-foot mva-foot"><span>Won deals, value and revenue are Sales numbers. Marketing links to them and never recalculates them.</span><button type="button" className="mov-lnk" onClick={onOpenSales}>Open Sales performance</button></p>
  </section>;
}

function Coverage({ model, floor, days, briefsKnown }: { model: Model; floor: (n: number) => string; days: number; briefsKnown: boolean }) {
  const untagged = model.leads - model.tagged;
  const max = Math.max(1, ...model.sources.map((row) => row.count));
  return <section className="mov-card" aria-labelledby="mva-cov-h">
    <header className="mov-head"><div><h2 id="mva-cov-h">Source coverage</h2><p>How much of the last {days} days can be traced to a source</p></div></header>
    <div className="mva-body">
      {model.leads ? <>
        <div className="mva-cov" role="img" aria-label={`${floor(model.tagged)} of ${floor(model.leads)} leads carry a source tag`}><span style={{ flexGrow: model.tagged }}/><span className="is-u" style={{ flexGrow: untagged }}/></div>
        <div className="mva-cov-l"><span><i aria-hidden="true"/>{floor(model.tagged)} tagged</span><span><i className="is-u" aria-hidden="true"/>{floor(untagged)} untagged</span></div>
        {model.sources.length > 0 && <ul className="mva-rows" aria-label="Leads by source">{model.sources.map((row) => <li key={row.label}><span className="mva-row-t">{row.label}</span><span className="mva-row-b" aria-hidden="true"><i style={{ transform: `scaleX(${row.count / max})` }}/></span><b>{floor(row.count)}</b></li>)}</ul>}
        {model.campaignTags.length > 0 && <>
          <h3 className="mva-sub">Campaign tags · {floor(model.campaignTagged)} of {floor(model.leads)} leads tagged</h3>
          <ul className="mva-tags" aria-label="Leads by campaign tag">{model.campaignTags.map((row) => <li key={row.tag}><span className="mva-row-t">{row.tag}<small>{row.brief ? `Brief: ${row.brief}` : briefsKnown ? "No brief uses this reference" : "Briefs couldn’t load"}</small></span><b>{floor(row.count)}</b></li>)}</ul>
        </>}
      </> : <>
        <div className="mva-cov is-empty" aria-hidden="true"><span className="is-u" style={{ flexGrow: 1 }}/></div>
        <p className="mva-quiet">Nothing to measure yet.</p>
      </>}
    </div>
    <p className="mov-foot">Only the link a lead submitted from is known, not their earlier visits. Share a form’s link with a source tag, such as <code>?utm_source=newsletter</code>, so each lead says which channel sent it, and add a brief’s reference, such as <code>&amp;utm_campaign=CB-SPRING</code>, to match it to that brief.</p>
  </section>;
}

function Capture({ model, floor, onOpenForm, studioLauncher }: { model: Model; floor: (n: number) => string; onOpenForm: (formId: string) => void; studioLauncher?: React.ReactNode }) {
  return <section className="mov-card" aria-labelledby="mva-cap-h">
    <header className="mov-head"><div><h2 id="mva-cap-h">Capture points</h2><p>Leads by live form in this range</p></div></header>
    {model.capture.length ? <ul className="mva-cap-list">{model.capture.map((form) => <li key={form.id}>
      <button type="button" className="mva-cap-row" onClick={() => onOpenForm(form.id)}>
        <span className="mva-row-t">{form.name}<small className={form.route === "pipeline" ? undefined : "is-warn"}>{ROUTE_WORDS[form.route]}{form.failed ? ` · ${plural(form.failed, "automation run")} failed recently` : ""}</small></span>
        <b>{floor(form.count)}</b>
      </button>
    </li>)}
      {model.fromRetired > 0 && <li className="mva-cap-row is-static"><span className="mva-row-t">Forms no longer live<small>Leads in this range from a form since unpublished</small></span><b>{floor(model.fromRetired)}</b></li>}
    </ul> : <div className="mov-empty-block"><p>No form is live. Publish one in Vibe Studio and its leads are counted here.</p>{studioLauncher}</div>}
    <p className="mov-foot">Conversion rate needs visits, which public pages don’t record yet.</p>
  </section>;
}

function Channels({ days, email, onOpenEmail, onOpenAds }: { days: number; email: EmailRead; onOpenEmail: () => void; onOpenAds: () => void }) {
  const s = email.stats;
  const opened = s ? rate(s.opened, s.tracked) : null;
  const emailLine = email.phase === "loading" ? "Reading email…"
    : email.phase === "denied" ? "Email figures are for owners and admins"
    : email.phase === "error" ? "Email figures couldn’t load"
    : !s || !s.sent ? `Nothing sent in the last ${days} days`
    : `${n(s.sent)} sent · ${n(s.opened)} opened${opened === null ? "" : ` (${opened}% of ${n(s.tracked)} tracked)`} · ${n(s.clicked)} clicked${s.sent > s.tracked ? ` · ${n(s.sent - s.tracked)} sent through your own mail, not tracked` : ""}`;
  const rows: { name: string; line: string; flag?: string; act?: React.ReactNode }[] = [
    { name: "Email", line: emailLine, act: email.phase === "error" ? <button type="button" className="btn btn-s" onClick={email.retry}>Try again</button> : <button type="button" className="mov-lnk" onClick={onOpenEmail}>Open Email</button> },
    { name: "Ads", line: "Ad accounts aren’t read here, so no spend or ad leads are shown", flag: "Not available", act: <button type="button" className="mov-lnk" onClick={onOpenAds}>Open Ads</button> },
    { name: "Social", line: "Reach and engagement aren’t read from any provider", flag: "Not available" },
    { name: "Your pages", line: "Visits aren’t recorded on public pages", flag: "Not available" },
  ];
  return <section className="mov-card" aria-labelledby="mva-ch-h">
    <header className="mov-head"><div><h2 id="mva-ch-h">Channels</h2><p>How each channel did in the last {days} days</p></div></header>
    <ul className="mva-ch">{rows.map((row) => <li key={row.name}>
      <span className="mva-row-t">{row.name}<small aria-live={row.name === "Email" ? "polite" : undefined}>{row.line}</small></span>
      <span className="mva-ch-a">{row.flag && <span className="pill pill-n">{row.flag}</span>}{row.act}</span>
    </li>)}</ul>
  </section>;
}
