// Marketing › Analytics (INT-342 S1d, owner-approved prototype v2, 2026-10-10).
// docs/product/int342-marketing-convergence.md §K.
//
// The most visual tab in Marketing (owner, 2026-10-10: "Analytics HAS to be more visual than anything
// else we have done"). One sentence; five headline figures with sparklines and, where the read covers it,
// the previous period; leads over time; what became of each lead; the path from a lead to an
// opportunity; the source mix; which forms collected them; when leads arrive; and how each channel did. Every figure comes from a read that already
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
import { rate, ratePoints } from "./marketing-email-model";
import { ChartBoundary } from "./marketing-ui";
import type { DonutSlice } from "./marketing-overview-charts";
import { useEmailStats, type EmailRead } from "./marketing-analytics-email";
import "./marketing-overview.css";
import "./marketing-analytics.css";

// recharts loads lazily, so the figures beside each chart paint first (as on Overview and Audience).
const Donut = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.Donut })));
const LeadsTrend = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.LeadsTrend })));
const EmailRatesChart = React.lazy(() => import("./marketing-overview-charts").then((module) => ({ default: module.EmailRatesChart })));
type Token = DonutSlice["colorToken"];
const SERIES: Token[] = ["--chart-1", "--chart-2", "--chart-3", "--chart-4"];

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

  const prev = model.previous;
  const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
  // Why a figure has no comparison, in the owner's words: the read is full, it doesn't reach back far
  // enough, or (for a share) the period before had no leads to take a share of.
  const noCompare = model.capped ? "No comparison: the read is full" : !prev ? `The read doesn’t reach the previous ${current.days} days` : `No leads in the previous ${current.days} days`;
  const rateSpark = (pick: (p: (typeof model.trend)[number]) => number) => model.trend.map((p) => (p.leads ? pick(p) / p.leads : null));
  const kpis: Kpi[] = [
    { key: "leads", icon: "users", label: "Leads", value: floor(model.leads), foot: `in the last ${current.days} days`, spark: model.trend.map((p) => p.leads), delta: prev && { now: model.leads, before: prev.leads } },
    { key: "traced", icon: "filter", label: "Traced to a source", value: model.leads ? `${share(model.tagged, model.leads)}%` : "—", foot: model.leads ? `${floor(model.tagged)} of ${floor(model.leads)} carry a source tag` : "No leads to measure", spark: rateSpark((p) => p.tagged), delta: prev && model.leads && prev.leads ? { now: share(model.tagged, model.leads), before: share(prev.tagged, prev.leads), points: true } : null },
    { key: "matched", icon: "bolt", label: "Matched to a campaign", value: briefsKnown ? floor(model.matched) : "—", foot: briefsKnown ? "Their campaign tag is a brief’s reference" : "Briefs couldn’t load", spark: briefsKnown ? model.trend.map((p) => p.matched) : [], delta: briefsKnown && prev ? { now: model.matched, before: prev.matched } : null, why: briefsKnown ? undefined : "Briefs couldn’t load" },
    { key: "opps", icon: "trend", label: "Became opportunities", value: floor(model.opportunities), foot: "Handed to Sales as a deal", spark: model.trend.map((p) => p.opportunities), delta: prev && { now: model.opportunities, before: prev.opportunities } },
    { key: "rate", icon: "pulse", label: "Lead to opportunity", value: model.leads ? `${share(model.opportunities, model.leads)}%` : "—", foot: model.leads ? "Of the leads in this range" : "No leads to measure", spark: rateSpark((p) => p.opportunities), delta: prev && model.leads && prev.leads ? { now: share(model.opportunities, model.leads), before: share(prev.opportunities, prev.leads), points: true } : null },
  ];

  return <div className="mov mva">
    {notice}
    <div className="mov-top">
      <p className="mov-sum" tabIndex={-1}>{sum}</p>
      <div className="mov-acts">
        <div className="campaigns-segmented" role="group" aria-label="Range">{RANGES.map((r) => <button type="button" key={r.key} aria-pressed={range === r.key} onClick={() => onRange(r.key)}>{r.label}</button>)}</div>
        <button type="button" className="btn" onClick={() => askPaige(prompt)}><Ic.spark size={14}/>Ask PAIGE</button>
      </div>
    </div>
    <ul className="mva-kpis" aria-label="Headline figures">{kpis.map((kpi) => <KpiTile key={kpi.key} kpi={kpi} days={current.days} noCompare={kpi.why ?? noCompare}/>)}</ul>
    <div className="mva-pair is-wide">
      <TrendCard model={model} days={current.days}/>
      <OutcomesCard model={model} floor={floor}/>
    </div>
    <Funnel model={model} floor={floor} days={current.days} briefsKnown={briefsKnown} onOpenSales={onOpenSales}/>
    <div className="mva-pair">
      <Coverage model={model} floor={floor} days={current.days} briefsKnown={briefsKnown}/>
      <Capture model={model} floor={floor} onOpenForm={onOpenForm} studioLauncher={studioLauncher}/>
    </div>
    <HeatCard model={model} days={current.days}/>
    <Channels days={current.days} email={email} onOpenEmail={onOpenEmail} onOpenAds={onOpenAds}/>
    {model.capped && <p className="mva-cap">Counted from the latest {SUBMISSION_READ_LIMIT} submissions, all inside this range, so each count is a floor and nothing is compared with the period before.</p>}
  </div>;
}

type Kpi = { key: string; icon: string; label: string; value: string; foot: string; spark: (number | null)[]; delta: { now: number; before: number; points?: boolean } | null | false | 0; why?: string };

function KpiTile({ kpi, days, noCompare }: { kpi: Kpi; days: number; noCompare: string }) {
  const Icon = Ic[kpi.icon] ?? Ic.pulse;
  const delta = kpi.delta || null;
  const change = delta ? delta.now - delta.before : 0;
  return <li className="mva-kpi">
    <span className="mva-kpi-h"><span className="mva-kpi-i" aria-hidden="true"><Icon size={15}/></span>{kpi.label}</span>
    <strong className="mva-kpi-v">{kpi.value}</strong>
    <span className="mva-kpi-f">{kpi.foot}</span>
    {delta ? <span className={`mva-kpi-d${change > 0 ? " is-up" : change < 0 ? " is-down" : ""}`}>{change === 0 ? `Same as the previous ${days} days` : `${change > 0 ? "+" : "−"}${Math.abs(change).toLocaleString()}${delta.points ? " pts" : ""} vs the previous ${days} days`}</span>
      : <span className="mva-kpi-d">{noCompare}</span>}
    {kpi.spark.filter((v) => v !== null).length > 1 && <Spark values={kpi.spark}/>}
  </li>;
}

/** A small trend line under a figure: plain SVG, so it paints with the number. A point with nothing to
 *  measure (a share on a day with no leads) is a gap in the line, never a dip to zero. */
function Spark({ values }: { values: (number | null)[] }) {
  const max = Math.max(1e-9, ...values.map((v) => v ?? 0));
  const w = 100, h = 28;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const xy = (v: number, i: number) => `${(i * step).toFixed(2)},${(h - 2 - (v / max) * (h - 4)).toFixed(2)}`;
  let line = "";
  values.forEach((v, i) => { if (v === null) return; line += `${i === 0 || values[i - 1] === null ? "M" : "L"}${xy(v, i)} `; });
  const whole = values.every((v) => v !== null);
  return <svg className="mva-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
    {whole && <path className="mva-spark-a" d={`M0,${h} L${values.map((v, i) => xy(v as number, i)).join(" L")} L${w},${h} Z`}/>}
    <path className="mva-spark-l" d={line.trim()}/>
  </svg>;
}

function TrendCard({ model, days }: { model: Model; days: number }) {
  return <section className="mov-card" aria-labelledby="mva-trend-h">
    <header className="mov-head"><div><h2 id="mva-trend-h">Leads over time</h2><p>{model.trendStep === "week" ? "Each week" : "Each day"} of the last {days} days, and the opportunities they became</p></div>
      <ul className="mva-legend" aria-hidden="true"><li><i className="is-bar"/>Leads</li><li><i className="is-line"/>Opportunities</li></ul></header>
    <div className="mva-chart-pad"><ChartBoundary className="mo-chart mva-chart-trend"><LeadsTrend points={model.trend} step={model.trendStep} label={`Leads over the last ${days} days`}/></ChartBoundary></div>
  </section>;
}

const OUTCOME_TOKEN: Record<string, Token> = { opportunity: "--chart-2", client: "--chart-1", saved: "--chart-4", waiting: "--chart-other", failed: "--bad" };

function OutcomesCard({ model, floor }: { model: Model; floor: (n: number) => string }) {
  const [active, setActive] = React.useState<string | null>(null);
  const slices: DonutSlice[] = model.outcomes.map((o) => ({ key: o.key, label: o.label, count: o.count, colorToken: OUTCOME_TOKEN[o.key] }));
  return <section className="mov-card" aria-labelledby="mva-out-h">
    <header className="mov-head"><div><h2 id="mva-out-h">What happened to each lead</h2><p>From each submission’s own record</p></div></header>
    <div className="mva-body"><RingWithKeys slices={slices} total={floor(model.leads)} caption="Leads" label="What happened to each lead" active={active} setActive={setActive} floor={floor} whole={model.leads}/></div>
  </section>;
}

/** A ring and its legend, highlighting the same slice from either side (Audience's pattern). */
function RingWithKeys({ slices, total, caption, label, active, setActive, floor, whole, onPick }: { slices: DonutSlice[]; total: string; caption: string; label: string; active: string | null; setActive: (key: string | null) => void; floor: (n: number) => string; whole: number; onPick?: (key: string) => void }) {
  const shown = slices.filter((slice) => slice.count > 0);
  const pct = (count: number) => (whole ? Math.round((count / whole) * 100) : 0);
  // A grouped slice ("Other forms") opens nothing, so it never offers to.
  const picks = (key: string) => Boolean(onPick) && key !== "rest";
  if (!shown.length) return <p className="mva-quiet">Nothing to show in this range yet.</p>;
  return <div className="mo-split mva-split">
    <ChartBoundary className="mo-donut"><Donut slices={shown} total={total} caption={caption} label={label} activeKey={active} onActiveKey={setActive} onSelect={onPick ? (slice) => { if (picks(slice.key)) onPick(slice.key); } : undefined}/></ChartBoundary>
    <ul className="mo-keys">{shown.map((slice) => <li key={slice.key}><button type="button" className={active === slice.key ? "is-active" : ""} onMouseEnter={() => setActive(slice.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(slice.key)} onBlur={() => setActive(null)} onClick={picks(slice.key) ? () => onPick!(slice.key) : undefined} aria-label={`${slice.label}: ${floor(slice.count)}, ${pct(slice.count)}%${picks(slice.key) ? ". Open it" : ""}`}><i style={{ background: `var(${slice.colorToken})` }} aria-hidden="true"/><span>{slice.label}</span><b>{floor(slice.count)}</b><em>{pct(slice.count)}%</em></button></li>)}</ul>
  </div>;
}

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function HeatCard({ model, days }: { model: Model; days: number }) {
  const max = Math.max(0, ...model.heat.flat());
  let peakDay = 0, peakHour = 0;
  model.heat.forEach((row, day) => row.forEach((count, hour) => { if (count > model.heat[peakDay][peakHour]) { peakDay = day; peakHour = hour; } }));
  const busiestDay = model.weekdays.reduce((top, d, i) => (d.count > model.weekdays[top].count ? i : top), 0);
  // A "busiest" claim only when it stands out: at least three leads, and no tie.
  const dayCounts = model.weekdays.map((d) => d.count);
  const dayClear = dayCounts[busiestDay] >= 3 && dayCounts.filter((c) => c === dayCounts[busiestDay]).length === 1;
  const hourClear = max >= 3 && model.heat.flat().filter((c) => c === max).length === 1;
  const summary = !max ? "No leads in this range yet"
    : dayClear ? `Most leads arrive on ${DAY_NAMES[busiestDay]}s${hourClear ? `; the busiest hour is ${DAY_NAMES[peakDay]} around ${hourLabel(peakHour)}m` : ""}`
    : "Leads are spread across the week, with no clear busiest day";
  return <section className="mov-card" aria-labelledby="mva-heat-h">
    <header className="mov-head"><div><h2 id="mva-heat-h">When leads arrive</h2><p>{summary}. Last {days} days, your local time.</p></div>
      <span className="mva-heat-key" aria-hidden="true">Fewer<i/><i/><i/><i/>More</span></header>
    <div className="mva-heat" role="img" aria-label={`Leads by day and hour over the last ${days} days. ${summary}.`}>
      <span/>{Array.from({ length: 24 }, (_, h) => <span key={h} className="mva-heat-x">{HOURS.includes(h) ? hourLabel(h) : ""}</span>)}
      {model.heat.map((row, day) => <React.Fragment key={day}>
        <span className="mva-heat-y">{model.weekdays[day].label}<b>{model.weekdays[day].count}</b></span>
        {row.map((count, hour) => <i key={hour} className={count ? "is-on" : undefined} title={`${DAY_NAMES[day]} ${hourLabel(hour)}m: ${count} lead${count === 1 ? "" : "s"}`} style={count ? { "--mva-heat": `${Math.round(18 + (count / max) * 82)}%` } as React.CSSProperties : undefined}/>)}
      </React.Fragment>)}
    </div>
  </section>;
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
  const [active, setActive] = React.useState<string | null>(null);
  const slices: DonutSlice[] = model.sourceSlices.map((slice, index) => ({ key: slice.key, label: slice.label, count: slice.count, colorToken: slice.kind === "tag" ? SERIES[index % SERIES.length] : slice.kind === "other" ? "--chart-other" : "--chart-untagged" }));
  return <section className="mov-card" aria-labelledby="mva-cov-h">
    <header className="mov-head"><div><h2 id="mva-cov-h">Source mix</h2><p>Where the leads of the last {days} days came from · {floor(model.tagged)} of {floor(model.leads)} carry a source tag</p></div></header>
    <div className="mva-body">
      {model.leads ? <>
        <RingWithKeys slices={slices} total={floor(model.leads)} caption="Leads" label="Leads by source" active={active} setActive={setActive} floor={floor} whole={model.leads}/>
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
  const [active, setActive] = React.useState<string | null>(null);
  const counted = model.capture.filter((form) => form.count > 0);
  const named = counted.slice(0, SERIES.length);
  const rest = counted.slice(SERIES.length).reduce((sum, form) => sum + form.count, 0) + model.fromRetired;
  const slices: DonutSlice[] = [
    ...named.map((form, index) => ({ key: form.id, label: form.name, count: form.count, colorToken: SERIES[index] })),
    ...(rest ? [{ key: "rest", label: model.fromRetired && counted.length <= SERIES.length ? "Forms no longer live" : "Other forms", count: rest, colorToken: "--chart-other" as Token }] : []),
  ];
  return <section className="mov-card" aria-labelledby="mva-cap-h">
    <header className="mov-head"><div><h2 id="mva-cap-h">Capture points</h2><p>Leads by live form in this range</p></div></header>
    {model.capture.length ? <>
      {model.leads > 0 && <div className="mva-body mva-body-tight"><RingWithKeys slices={slices} total={floor(model.leads)} caption="Leads" label="Leads by form" active={active} setActive={setActive} floor={floor} whole={model.leads} onPick={(key) => { if (key !== "rest") onOpenForm(key); }}/></div>}
      <ul className="mva-cap-list">{model.capture.map((form) => <li key={form.id}>
        <button type="button" className="mva-cap-row" onClick={() => onOpenForm(form.id)}>
          <span className="mva-row-t">{form.name}<small className={form.route === "pipeline" ? undefined : "is-warn"}>{ROUTE_WORDS[form.route]}{form.failed ? ` · ${plural(form.failed, "automation run")} failed recently` : ""}</small></span>
          <b>{floor(form.count)}</b>
        </button>
      </li>)}
        {model.fromRetired > 0 && <li className="mva-cap-row is-static"><span className="mva-row-t">Forms no longer live<small>Leads in this range from a form since unpublished</small></span><b>{floor(model.fromRetired)}</b></li>}
      </ul>
    </> : <div className="mov-empty-block"><p>No form is live. Publish one in Vibe Studio and its leads are counted here.</p>{studioLauncher}</div>}
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
  const points = s && s.tracked > 0 && s.series?.length ? ratePoints(s.series) : null;
  return <section className="mov-card" aria-labelledby="mva-ch-h">
    <header className="mov-head"><div><h2 id="mva-ch-h">Channels</h2><p>How each channel did in the last {days} days</p></div></header>
    {points && <div className="mva-ch-chart"><h3 className="mva-sub">Email open and click rates</h3><ChartBoundary className="mo-chart me-chart-rates"><EmailRatesChart points={points} label={`Email open and click rates, last ${days} days`}/></ChartBoundary></div>}
    <ul className="mva-ch">{rows.map((row) => <li key={row.name}>
      <span className="mva-row-t">{row.name}<small aria-live={row.name === "Email" ? "polite" : undefined}>{row.line}</small></span>
      <span className="mva-ch-a">{row.flag && <span className="pill pill-n">{row.flag}</span>}{row.act}</span>
    </li>)}</ul>
  </section>;
}
