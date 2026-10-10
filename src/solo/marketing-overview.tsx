// Marketing › Overview (INT-342, owner-approved prototype v2, 2026-10-10 — §28: the approved design is
// frozen; change it only on the owner's word). docs/product/int342-marketing-convergence.md §K.
//
// The tab already says where the owner is, so there is no page title: Overview opens on one live
// sentence and the Marketing chain — capture points → leads → forms that route leads → opportunities
// in Sales — with the broken link lit. Below it: lead flow, what needs the owner, every capture point,
// and the latest leads. Lead capture's jobs live here now; a form's routing and submissions open in
// one form panel (`?form=`), addressable so any surface can link to it.
//
// Every figure comes from reads this hub already makes (useSoloCampaigns, useSoloCampaignBriefs).
// Nothing is estimated: no visits, spend, reach or revenue exist here, so none is shown.
import React from "react";
import { Ic as SharedIcons } from "./_shared";
import type { CampaignArtifact, CampaignDraft, CampaignSubmission } from "./useSoloCampaigns";
import type { CampaignBrief } from "./useSoloCampaignBriefs";
import { SUBMISSION_READ_LIMIT, deriveMarketingOverview, isBlockedBrief } from "./marketing-overview-model";
import "./marketing-overview.css";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;

export type CaptureFilter = "all" | "form" | "page" | "funnel";
export const CAPTURE_FILTERS: CaptureFilter[] = ["all", "form", "page", "funnel"];
const FILTER_LABEL: Record<CaptureFilter, string> = { all: "All", form: "Forms", page: "Pages", funnel: "Funnels" };
const TYPE_LABEL = { page: "Page", funnel: "Funnel", form: "Form" } as const;
const WINDOW_DAYS = 30;
const RECENT_LEADS = 6;
// growth_form_submissions.processing_state, in the owner's words (never the raw value).
const STATE_WORDS: Record<string, string> = { pending: "Waiting to be processed", claimed: "Being processed", done: "Saved" };
const ATTENTION_SHOWN = 5;

type PipelineRef = { id: string; name: string };
type StageRef = { id: string; label: string };

export type OverviewProps = {
  data: {
    tenantId: string | null;
    artifacts: CampaignArtifact[];
    drafts?: CampaignDraft[];
    submissions?: CampaignSubmission[];
    pipelineWorkspace?: { pipelines?: PipelineRef[]; stages?: StageRef[] } | null;
  };
  briefs: CampaignBrief[];
  canManage: boolean;
  captureFilter: CaptureFilter;
  onCaptureFilter: (filter: CaptureFilter) => void;
  onGo: (target: string) => void;
  onCreateBrief: () => void;
  onOpenSales: () => void;
  onOpenForm: (formId: string) => void;
  onOpenAsset: (artifact: CampaignArtifact) => void;
  onOpenContact: (contactId: string) => void;
  onOpenDeal: (dealId: string) => void;
  studioLauncher: (label?: string) => React.ReactNode;
  /** Bring Capture points into view on arrival (an old Lead capture or filtered link landed here). */
  scrollToCapture?: boolean;
  /** Set when the briefs read failed: Overview still shows everything else, and says so. */
  briefsNotice?: React.ReactNode;
  /** False while who may edit is unknown (the briefs read failed): never claim "view only" then. */
  authorityKnown?: boolean;
};

/**
 * The chain's "forms that route leads" link means a lead reaches a pipeline: an enabled
 * pipeline_attach automation, or the form's own intake route. Other automations (alerts, contact
 * upserts, webhooks) still run, but they do not close the link (Codex review, PR #1900).
 */
export const sendsToPipeline = (form: Pick<CampaignArtifact, "routingTargets" | "intakePipelineId">) =>
  (form.routingTargets ?? []).includes("pipeline_attach") || Boolean(form.intakePipelineId);
const unroutedDetail = (form: CampaignArtifact) =>
  form.intakeAlert ? "Leads are emailed to you but never reach a pipeline"
    : form.routingConfigured ? "Its automations run, but leads never reach a pipeline"
      : "A lead from this form goes nowhere: no pipeline, no alert";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const askPaige = (prompt: string) => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }));

export function MarketingOverview(props: OverviewProps) {
  const { data, briefs, canManage, onGo, onCreateBrief, onOpenSales, onOpenForm, studioLauncher, scrollToCapture, briefsNotice, authorityKnown = true } = props;
  const artifacts = data.artifacts;
  const drafts = data.drafts ?? [];
  const submissions = data.submissions ?? [];
  const today = new Date().toDateString(); // re-derive when the day turns
  const model = React.useMemo(() => deriveMarketingOverview({ briefs, artifacts, drafts, submissions, periodDays: WINDOW_DAYS }), [briefs, artifacts, drafts, submissions, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveForms = artifacts.filter((item) => item.type === "form");
  const unrouted = liveForms.filter((item) => !sendsToPipeline(item));
  const floor = (count: number) => (model.capped ? `${count}+` : String(count));
  const leads = model.leads.count;
  const opportunities = model.opportunities.count;
  const firstUse = !briefs.length && !artifacts.length && !drafts.length && !submissions.length;

  const create = canManage ? <button className="btn btn-g" onClick={onCreateBrief}><Ic.plus size={14}/>New campaign brief</button> : null;
  const ask = <button className="btn" onClick={() => askPaige(`Look at my Marketing for the last ${WINDOW_DAYS} days: ${floor(leads)} leads, ${floor(opportunities)} became opportunities, ${unrouted.length} of ${liveForms.length} live forms not routed. What should I do first? Use only what my records show; this workspace does not record visits, spend, reach or revenue.`)}><Ic.spark size={14}/>Ask PAIGE</button>;

  const viewOnly = canManage || !authorityKnown ? null : <p className="mov-ro">View only. An owner or admin can change this.</p>;

  React.useEffect(() => {
    if (!scrollToCapture) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("mov-capture")?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [scrollToCapture]);

  if (firstUse) {
    const draftBrief = canManage ? <button className="btn" onClick={() => askPaige("Help me write my first campaign brief: who it is for, what I am offering, and where they land. Ask me what you need to know first.")}><Ic.spark size={14}/>Draft it with PAIGE</button> : null;
    return <div className="mov">
      {viewOnly}{briefsNotice}
      <div className="mov-top"><p className="mov-sum" tabIndex={-1}>Nothing is being marketed yet.</p></div>
      <section className="mov-card mov-first" aria-labelledby="mov-first-h">
        <div className="mov-first-art" aria-hidden="true"><FirstUseArt/></div>
        <div className="mov-first-copy">
          <h2 id="mov-first-h">Three steps to your first lead</h2>
          <ol className="mov-steps">
            <li><b>Write a campaign brief.</b> Who it’s for, what you’re offering, and where they land.</li>
            <li><b>Publish a page or form</b> in Vibe Studio.</li>
            <li><b>Route the form</b> to a pipeline, so every lead lands in Sales.</li>
          </ol>
          <div className="mov-row-acts">{create}{draftBrief}{canManage && studioLauncher("Open Vibe Studio")}</div>
        </div>
      </section>
    </div>;
  }

  const sum = leads
    ? <><b>{plural(leads, "lead")}</b>{model.capped ? " or more" : ""} in the last {WINDOW_DAYS} days, and <b>{floor(opportunities)}</b> became {opportunities === 1 ? "an opportunity" : "opportunities"} in Sales.</>
    : <><b>{plural(artifacts.length, "capture point")} live</b>, no leads in the last {WINDOW_DAYS} days{unrouted.length ? <>, and <b>{unrouted.length} of {plural(liveForms.length, "form")}</b> {unrouted.length === 1 ? "doesn’t route its leads" : "don’t route their leads"}</> : ""}.</>;

  return <div className="mov">
    {viewOnly}{briefsNotice}
    <div className="mov-top"><p className="mov-sum" tabIndex={-1}>{sum}</p><div className="mov-acts">{ask}{create}</div></div>
    <Chain model={model} liveForms={liveForms} unrouted={unrouted} floor={floor} canManage={canManage} onOpenForm={onOpenForm} onOpenSales={onOpenSales}/>
    <div className={`mov-grid${leads ? "" : " is-quiet"}`}>
      <LeadFlow model={model} floor={floor} onGo={onGo}/>
      <Attention {...props} drafts={drafts} submissions={submissions} unrouted={unrouted}/>
    </div>
    <Capture {...props} drafts={drafts}/>
    {submissions.length > 0 && <RecentLeads {...props} submissions={submissions} drafts={drafts}/>}
  </div>;
}

type Model = ReturnType<typeof deriveMarketingOverview>;

function Chain({ model, liveForms, unrouted, floor, canManage, onOpenForm, onOpenSales }: { model: Model; liveForms: CampaignArtifact[]; unrouted: CampaignArtifact[]; floor: (n: number) => string; canManage: boolean; onOpenForm: (id: string) => void; onOpenSales: () => void }) {
  const routed = liveForms.length - unrouted.length;
  const broken = unrouted.length > 0;
  const rate = model.leads.count ? `${Math.round((model.opportunities.count / model.leads.count) * 100)}%` : null;
  const parts = [model.published.forms && plural(model.published.forms, "form"), model.published.pages && plural(model.published.pages, "page"), model.published.funnels && plural(model.published.funnels, "funnel")].filter(Boolean).join(" · ") || "Nothing published yet";
  return <section className="mov-card mov-chain-card" aria-label="How leads move through your marketing">
    <ol className="mov-chain">
      <li className="mov-node"><span className="mov-v">{model.published.total}</span><span className="mov-k">Live capture points</span><span className="mov-s">{parts}</span></li>
      <li className="mov-link" aria-hidden="true"><span className="mov-ln"/></li>
      <li className="mov-node"><span className="mov-v">{floor(model.leads.count)}</span><span className="mov-k">Leads received</span><span className="mov-s">Last {WINDOW_DAYS} days</span></li>
      <li className={`mov-link${broken ? " is-broken" : ""}`} aria-hidden="true"><span className="mov-ln"/></li>
      <li className={`mov-node${broken ? " is-broken" : ""}`}>
        <span className="mov-v">{routed}<small> of {liveForms.length}</small></span>
        <span className="mov-k">Forms that route leads</span>
        <span className="mov-s">{!liveForms.length ? "No live form yet" : broken ? "The chain breaks here" : "Every live form routes its leads"}</span>
        {broken && canManage && <button className="btn btn-s" onClick={() => onOpenForm(unrouted[0].id)}>{unrouted.length > 1 ? "Route the forms" : "Route it"}</button>}
      </li>
      <li className="mov-link" aria-hidden="true"><span className="mov-ln"/>{rate && <span className="mov-rate" title={`${rate} of leads became opportunities`}>{rate}</span>}</li>
      <li className="mov-node"><span className="mov-v">{floor(model.opportunities.count)}</span><span className="mov-k">Opportunities</span><span className="mov-s">{rate ? `${rate} of leads, now in Sales` : "Handed to Sales"}</span><button className="mov-lnk" onClick={onOpenSales}>Open Sales</button></li>
    </ol>
    {model.capped && <p className="mov-note">Counted from the latest {SUBMISSION_READ_LIMIT} submissions, so lead counts are a floor.</p>}
  </section>;
}

function LeadFlow({ model, floor, onGo }: { model: Model; floor: (n: number) => string; onGo: (target: string) => void }) {
  const total = model.leads.count;
  const max = model.sources.reduce((m, s) => Math.max(m, s.count), 0);
  return <section className="mov-card" aria-labelledby="mov-flow-h">
    <header className="mov-head"><div><h2 id="mov-flow-h">Lead flow</h2><p>Leads per day, last {WINDOW_DAYS} days</p></div></header>
    <div className={`mov-flow${total ? "" : " is-empty"}`}>
      <FlowChart daily={model.daily}/>
      {total > 0 && <div className="mov-src">
        <h3>Where they came from</h3>
        {model.sources.map((slice) => <div key={slice.key} className={`mov-srcrow${slice.kind === "untagged" ? " is-muted" : ""}`}><span title={slice.label}>{slice.label}</span><span className="mov-b" aria-hidden="true"><i style={{ width: `${max ? Math.max(4, (slice.count / max) * 100) : 0}%` }}/></span><span className="mov-n">{floor(slice.count)}</span></div>)}
        <button className="mov-lnk" onClick={() => onGo("analytics")}>All sources in Analytics</button>
      </div>}
    </div>
    <table className="campaigns-sr-only"><caption>Leads and opportunities by day, last {WINDOW_DAYS} days</caption><thead><tr><th>Day</th><th>Leads</th><th>Became opportunities</th></tr></thead><tbody>{model.daily.map((point) => <tr key={point.day}><td>{point.label}</td><td>{point.leads}</td><td>{point.opportunities}</td></tr>)}</tbody></table>
  </section>;
}

// The one chart Overview draws: a single series, its scale written on the axis, the busiest day
// marked, and a crosshair on hover or arrow keys. Zero is drawn as zero, never left blank.
function FlowChart({ daily }: { daily: Model["daily"] }) {
  const W = 640, H = 200, L = 30, R = 8, T = 14, B = 26;
  const values = daily.map((point) => point.leads);
  const peak = Math.max(0, ...values);
  const top = Math.max(4, Math.ceil(peak / 2) * 2);
  const cw = W - L - R, ch = H - T - B, sx = values.length > 1 ? cw / (values.length - 1) : cw;
  const x = (i: number) => L + i * sx;
  const y = (n: number) => T + ch - (n / top) * ch;
  const path = values.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(" ");
  const peakIndex = peak ? values.lastIndexOf(peak) : -1;
  const [hover, setHover] = React.useState<number | null>(null);
  const [fromKeys, setFromKeys] = React.useState(false);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const ticks = [0, top / 2, top];
  const labels = [0, Math.floor((values.length - 1) / 3), Math.floor(((values.length - 1) * 2) / 3), values.length - 1];
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !values.length) return;
    const px = ((event.clientX - box.left) / box.width) * W;
    setFromKeys(false);
    setHover(Math.max(0, Math.min(values.length - 1, Math.round((px - L) / sx))));
  };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setFromKeys(true);
    setHover((current) => Math.max(0, Math.min(values.length - 1, (current ?? values.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
  };
  const point = hover === null ? null : daily[hover];
  const summary = peak ? `Leads per day over the last ${WINDOW_DAYS} days. Busiest day: ${daily[peakIndex].label}, ${plural(peak, "lead")}.` : `Leads per day over the last ${WINDOW_DAYS} days: zero every day.`;
  return <div className="mov-chart">
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} tabIndex={0} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
      <defs><linearGradient id="mov-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--violet)" stopOpacity=".26"/><stop offset="1" stopColor="var(--violet)" stopOpacity="0"/></linearGradient></defs>
      {ticks.map((tick) => <g key={tick}><line className="mov-gr" x1={L} x2={W - R} y1={y(tick)} y2={y(tick)}/><text x={L - 8} y={y(tick) + 3.5} textAnchor="end">{tick}</text></g>)}
      {labels.map((i) => daily[i] && <text key={i} x={x(i)} y={H - 7} textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}>{daily[i].label}</text>)}
      <path className="mov-area" d={`${path} L${x(values.length - 1)} ${y(0)} L${L} ${y(0)}Z`}/>
      <path className="mov-line" d={path}/>
      {peakIndex >= 0 && <><circle className="mov-peak" cx={x(peakIndex)} cy={y(peak)} r={4.5}/><text className="mov-peak-t" x={x(peakIndex)} y={y(peak) - 10} textAnchor="middle">{peak}</text></>}
      {!peak && <text className="mov-zero" x={L + cw / 2} y={y(0) - 14} textAnchor="middle">Zero every day. The line moves with your first lead.</text>}
      {point && <><line className="mov-xh" x1={x(hover!)} x2={x(hover!)} y1={T} y2={T + ch}/><circle className="mov-xd" cx={x(hover!)} cy={y(point.leads)} r={4}/></>}
    </svg>
    {point && <div className="mov-tip" style={{ left: `${Math.min(88, Math.max(12, (x(hover!) / W) * 100))}%`, top: `${(y(point.leads) / H) * 100}%` }}>{point.label} · {plural(point.leads, "lead")}</div>}
    <span className="campaigns-sr-only" aria-live="polite">{point && fromKeys ? `${point.label}: ${plural(point.leads, "lead")}` : ""}</span>
  </div>;
}

type AttentionItem = { key: string; tone: "bad" | "warn" | "v" | "n"; title: string; detail: string; action?: React.ReactNode };

function Attention({ data, briefs, canManage, unrouted, drafts, submissions, onGo, onOpenForm, studioLauncher }: OverviewProps & { unrouted: CampaignArtifact[]; drafts: CampaignDraft[]; submissions: CampaignSubmission[] }) {
  const failed = new Map<string, number>();
  for (const submission of submissions) if (submission.state === "error") failed.set(submission.formId, (failed.get(submission.formId) ?? 0) + 1);
  const formName = (id: string) => [...data.artifacts, ...drafts].find((item) => item.id === id)?.name;
  const items: AttentionItem[] = [];
  for (const [formId, count] of failed) items.push({ key: `fail-${formId}`, tone: "bad", title: formName(formId) ?? "A form", detail: `${plural(count, "submission")} couldn’t be processed`, action: canManage ? <button className="btn btn-s" onClick={() => onOpenForm(formId)}>Review</button> : undefined });
  // The broken link in the chain comes first: it is what the chain lights.
  for (const form of unrouted) items.push({ key: `route-${form.id}`, tone: "warn", title: form.name, detail: unroutedDetail(form), action: canManage ? <button className="btn btn-s" onClick={() => onOpenForm(form.id)}>Route it</button> : undefined });
  for (const brief of briefs.filter((item) => item.lifecycleStatus === "ready_for_review")) items.push({ key: `review-${brief.id}`, tone: "v", title: brief.name, detail: "A campaign brief is waiting for your decision", action: <button className="btn btn-s" onClick={() => onGo("campaigns")}>Review</button> });
  for (const brief of briefs.filter(isBlockedBrief)) items.push({ key: `blocked-${brief.id}`, tone: "bad", title: brief.name, detail: brief.blocker || "Marked blocked on the brief", action: <button className="btn btn-s" onClick={() => onGo("campaigns")}>Open</button> });
  for (const draft of drafts) items.push({ key: `draft-${draft.type}-${draft.id}`, tone: "n", title: draft.name, detail: `Draft ${TYPE_LABEL[draft.type].toLowerCase()}: collects nothing until it’s published`, action: canManage ? studioLauncher("Finish in Vibe") : undefined });
  const shown = items.slice(0, ATTENTION_SHOWN);
  return <section className="mov-card" aria-labelledby="mov-att-h">
    <header className="mov-head"><div><h2 id="mov-att-h">Needs you</h2><p>{items.length ? `${plural(items.length, "thing")}, most urgent first` : "Nothing right now"}</p></div></header>
    {shown.length ? <ul className="mov-att">{shown.map((item) => <li key={item.key}><span className={`mov-sev is-${item.tone}`} aria-hidden="true"/><span className="mov-att-main"><strong>{item.title}</strong><small>{item.detail}</small></span>{item.action}</li>)}</ul>
      : <p className="mov-empty">{data.artifacts.some((item) => item.type === "form") ? "Every live form is routed and nothing has failed." : "Nothing needs you yet."}</p>}
    {items.length > shown.length && <p className="mov-note">{items.length - shown.length} more below and in Campaigns.</p>}
  </section>;
}

function Capture({ data, drafts, captureFilter, onCaptureFilter, onOpenForm, onOpenAsset, canManage, studioLauncher }: OverviewProps & { drafts: CampaignDraft[] }) {
  const pipelines = data.pipelineWorkspace?.pipelines ?? [];
  const stages = data.pipelineWorkspace?.stages ?? [];
  const routeOf = (item: CampaignArtifact) => {
    const pipeline = pipelines.find((p) => p.id === item.intakePipelineId)?.name;
    const stage = stages.find((s) => s.id === item.intakeStageId)?.label;
    return pipeline ? [pipeline, stage].filter(Boolean).join(" → ") : "Sent to a pipeline by an automation";
  };
  const live = data.artifacts.filter((item) => captureFilter === "all" || item.type === captureFilter);
  const waiting = drafts.filter((item) => captureFilter === "all" || item.type === captureFilter);
  return <section className="mov-card" id="mov-capture" aria-labelledby="mov-cap-h">
    <header className="mov-head"><div><h2 id="mov-cap-h">Capture points</h2><p>Every page, form and funnel that collects people. Built in Vibe Studio.</p></div>
      <div className="campaigns-segmented" role="group" aria-label="Filter capture points">{CAPTURE_FILTERS.map((filter) => <button key={filter} aria-pressed={captureFilter === filter} onClick={() => onCaptureFilter(filter)}>{FILTER_LABEL[filter]}</button>)}</div>
    </header>
    {live.length + waiting.length === 0 ? <div className="mov-empty-block"><p>No {captureFilter === "all" ? "capture points" : FILTER_LABEL[captureFilter].toLowerCase()} yet. Build one in Vibe Studio and publish it.</p>{canManage && studioLauncher("Open Vibe Studio")}</div>
      : <div className="mov-gal">
        {live.map((item) => {
          const issue = item.type === "form" && !sendsToPipeline(item);
          return <button key={`${item.type}-${item.id}`} className={`mov-cp${issue ? " is-issue" : ""}`} onClick={() => item.type === "form" ? onOpenForm(item.id) : onOpenAsset(item)}>
            <Mini type={item.type}/>
            <span className="mov-cp-b">
              <span className="mov-cp-t">{item.name}</span>
              <span className="mov-cp-s"><span className="mov-dot is-on" aria-hidden="true"/>{TYPE_LABEL[item.type]} · Live</span>
              {item.type === "form" ? <span className="mov-cp-m"><b>{item.recentSubmissions}</b> recent submission{item.recentSubmissions === 1 ? "" : "s"}</span> : <span className="mov-cp-m">Collects through its form</span>}
              {item.type === "form" && <span className={`mov-cp-r${issue ? " is-warn" : ""}`}>{issue ? (item.intakeAlert ? "Email alert only, no pipeline" : item.routingConfigured ? "No pipeline" : "Not routed") : routeOf(item)}</span>}
            </span>
          </button>;
        })}
        {waiting.map((item) => <div key={`draft-${item.type}-${item.id}`} className="mov-cp is-draft">
          <Mini type={item.type}/>
          <span className="mov-cp-b">
            <span className="mov-cp-t">{item.name}</span>
            <span className="mov-cp-s"><span className="mov-dot" aria-hidden="true"/>{TYPE_LABEL[item.type]} · Draft</span>
            <span className="mov-cp-m">Collects nothing until published</span>
            {canManage && <span className="mov-cp-a">{studioLauncher("Finish in Vibe Studio")}</span>}
          </span>
        </div>)}
      </div>}
    <p className="mov-foot">Building and editing stay in Vibe Studio. Marketing shows how each one is doing. Counts cover the latest {SUBMISSION_READ_LIMIT} submissions.</p>
  </section>;
}

function Mini({ type }: { type: "page" | "form" | "funnel" }) {
  return <span className={`mov-mini is-${type}`} aria-hidden="true"><i/><i/><i/><i/></span>;
}

function RecentLeads({ data, drafts, submissions, onOpenContact, onOpenDeal, onOpenForm, canManage }: OverviewProps & { drafts: CampaignDraft[]; submissions: CampaignSubmission[] }) {
  const names = new Map<string, string>([...data.artifacts, ...drafts].map((item) => [item.id, item.name]));
  const recent = submissions.slice(0, RECENT_LEADS);
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "Date not recorded" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  return <section className="mov-card" aria-labelledby="mov-leads-h">
    <header className="mov-head"><div><h2 id="mov-leads-h">Recent leads</h2><p>The latest submissions, and where each one went</p></div></header>
    <ul className="mov-leads">{recent.map((submission) => {
      const tag = submission.trackingSource ? `source: ${submission.trackingSource}${submission.trackingCampaign ? ` · campaign: ${submission.trackingCampaign}` : ""}` : "no source tag";
      return <li key={submission.id}>
        <span className="mov-ini" aria-hidden="true"><Ic.users size={14}/></span>
        <span className="mov-lead-main"><strong>{names.get(submission.formId) ?? "A form no longer listed"}</strong><small>{when(submission.createdAt)} · {tag}</small></span>
        <span className="mov-lead-out">{submission.dealId ? <><span className="pill pill-ok">Opportunity opened</span><button className="btn btn-s" onClick={() => onOpenDeal(submission.dealId!)}>Open deal</button></>
          : submission.contactId ? <><span className="pill pill-v">Added to Clients</span><button className="btn btn-s" onClick={() => onOpenContact(submission.contactId!)}>Open contact</button></>
          : submission.state === "error" ? <><span className="pill pill-bad">Couldn’t process</span>{canManage && <button className="btn btn-s" onClick={() => onOpenForm(submission.formId)}>Review</button>}</>
          : <span className="pill pill-n">{STATE_WORDS[submission.state] ?? "Not processed yet"}</span>}</span>
      </li>;
    })}</ul>
  </section>;
}

function FirstUseArt() {
  return <svg viewBox="0 0 360 120" width="100%" height="120"><g fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="6" y="38" width="64" height="44" rx="12"/><rect x="148" y="38" width="64" height="44" rx="12"/><rect x="290" y="38" width="64" height="44" rx="12"/><path d="M74 60h70M216 60h70" strokeDasharray="4 5"/></g><g fontSize="11" fill="currentColor" textAnchor="middle"><text x="38" y="100">Brief</text><text x="180" y="100">Page or form</text><text x="322" y="100">Route</text></g></svg>;
}
