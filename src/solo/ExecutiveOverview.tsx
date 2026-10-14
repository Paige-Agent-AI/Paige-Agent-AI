import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MessageSquareText, RefreshCw } from "lucide-react";
import { PaigePresence } from "@/components/paige/live/PaigePresence";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { routeLinkTarget } from "@/lib/links/workspaceLinks";
import type { ReadLinkDestination } from "../../supabase/functions/_shared/paige-turn/record-links";
import type { SnapshotPeriodKey } from "../../supabase/functions/_shared/paige-context/snapshot";
import { useBusinessReview, type ReviewDomain } from "./data/useBusinessReview";
import { useSoloPendingActions } from "./data/useSoloPendingActions";
import { useSoloActivityFeed, elapsedLabel } from "./data/useSoloActivityFeed";
import { useBusinessGamePlanMissions } from "./data/useBusinessGamePlanMissions";
import { businessCalendarHeldNote, businessDateLabel, useBusinessCalendarDay } from "./data/useBusinessTimeZone";
import { clearPaigeSurfaceScope } from "./paigeClientScope";
import { clearPaigePublicPresenceScope } from "./paigePublicPresenceScope";
import { executiveAreas, executivePriorities, formatReviewInstant, formatReviewMetric, reviewGapNote } from "./executive-review";
import "./executive-overview.css";

const BRIEFING = "How's my business doing, what needs attention, and what should we work on today?";
const PERIODS: Array<{ key: SnapshotPeriodKey; label: string }> = [
  { key: "last_7_days", label: "Last 7 days" }, { key: "last_30_days", label: "Last 30 days" },
  { key: "current_quarter", label: "This quarter" },
];

function Destination({ destination, account, children }: { destination: ReadLinkDestination; account?: string | null; children?: React.ReactNode }) {
  const target = routeLinkTarget({ destination, record_id: null }, "solo", account);
  return target ? <Link className="exec-link" to={target.to}>{children ?? target.label}<ArrowRight size={14} aria-hidden="true" /></Link>
    : <span className="exec-unresolved">{children ?? "Destination resolves with this workspace"}</span>;
}

function DomainEvidence({ domain, timezone }: { domain: ReviewDomain; timezone: string }) {
  return <>
    {domain.coverage_note && <p className="exec-note">{domain.coverage_note}</p>}
    <dl className="exec-figures">
      {domain.headline.map((metric) => <div key={metric.key}>
        <dt>{metric.label}<small>{metric.basis === "point_in_time" ? "As of the source read" : metric.basis === "all_time" ? "All time" : "In this period"}</small></dt>
        <dd>{formatReviewMetric(metric)}{metric.window_note && <small>{metric.window_note}</small>}</dd>
      </div>)}
    </dl>
    {!domain.headline.length && <p className="exec-note">This source returned no headline figures. No value is inferred.</p>}
    {domain.changes.map((change, i) => <p className="exec-change" key={i}>{change.summary}</p>)}
    <details className="exec-provenance">
      <summary>Source &amp; freshness</summary>
      <dl>
        <div><dt>Owning source</dt><dd>{domain.owner.replace(/_/g, " ")}</dd></div>
        <div><dt>Read at</dt><dd>{formatReviewInstant(domain.as_of, timezone, true)} · {timezone}</dd></div>
        <div><dt>Coverage</dt><dd>{domain.coverage === "full" ? "Full source coverage" : "Partial source coverage"}</dd></div>
        <div><dt>Freshness</dt><dd>{domain.freshness === "live_read" ? "Re-read from the records" : "Recorded snapshot"}</dd></div>
      </dl>
      {domain.domain === "payments" && <p>These are recorded receipts and receivables in Sales. They do not establish a connected bank balance or profit.</p>}
    </details>
  </>;
}

type ExecutiveProps = {
  account?: string | null; accountEpoch?: string | null; accountName?: string | null; openPaige?: () => void;
};

export function ExecutiveOverview(props: ExecutiveProps) {
  if (!props.accountEpoch) return <div className="executive-root"><p className="exec-read-state" role="status">Resolving this workspace…</p></div>;
  return <ResolvedExecutiveOverview {...props} key={props.accountEpoch} />;
}

function ResolvedExecutiveOverview({ account, accountEpoch, accountName, openPaige }: ExecutiveProps) {
  const [period, setPeriod] = useState<SnapshotPeriodKey>("last_7_days");
  const review = useBusinessReview(accountEpoch ?? null, period);
  const pending = useSoloPendingActions(accountEpoch ?? null);
  const activity = useSoloActivityFeed(accountEpoch ?? null);
  const missions = useBusinessGamePlanMissions(accountEpoch ?? null);
  const calendar = useBusinessCalendarDay(accountEpoch ?? null);
  const snapshot = review.state === "ready" ? review.snapshot : null;
  const areas = snapshot ? executiveAreas(snapshot) : [];
  const priorities = snapshot ? executivePriorities(snapshot) : [];
  const readable = areas.filter((area) => area.entry.status === "available" && area.entry.data);
  const gaps = areas.filter((area) => area.entry.status !== "available" || !area.entry.data);
  const total = pending.total ?? null;
  const ask = (prompt = BRIEFING + " Use the " + (PERIODS.find((p) => p.key === period)?.label ?? "Last 7 days") + " reporting period.") => {
    if (!openPaige) return;
    clearPaigeSurfaceScope();
    clearPaigePublicPresenceScope();
    handOffPaigePrompt(prompt);
    openPaige();
  };
  const refresh = () => { review.refresh(); pending.refresh(); activity.refresh(); void missions.refresh(); void calendar.refresh(); };
  const plays = missions.items.filter((play) => play.state !== "stopped").slice(0, 3);

  return <div className="executive-root" aria-label="Executive Command Center">
    <div className="executive-content">
      <header className="exec-header">
        <div><h1>{accountName ? accountName + " · Executive" : "Executive"}</h1><p>Your business, in view. Your next move, in context.</p></div>
        <button type="button" className="exec-button" onClick={refresh} disabled={review.state === "loading"}><RefreshCw size={15} aria-hidden="true" />Refresh evidence</button>
      </header>

      <section className="exec-briefing" aria-labelledby="exec-briefing-title">
        <div className="exec-presence"><PaigePresence state={review.state === "loading" && accountEpoch ? "working" : "held"} visible={review.state === "loading" && !!accountEpoch} /></div>
        <div className="exec-briefing-copy">
          <h2 id="exec-briefing-title">See the company. Talk through the next move.</h2>
          <p>PAIGE explains the same business records you can inspect below.</p>
          <button type="button" className="exec-button exec-primary" onClick={() => ask()} disabled={!openPaige}><MessageSquareText size={16} aria-hidden="true" /><span className="exec-button-label">How's my business doing?</span><ArrowRight size={15} aria-hidden="true" /></button>
          <small>Opens your existing Chat. Choose Talk live there to speak with PAIGE. The question is yours to send.</small>
        </div>
      </section>

      <div className="exec-layout">
        <section className="exec-intelligence" aria-labelledby="exec-intelligence-title">
          <div className="exec-section-head"><h2 id="exec-intelligence-title">Business intelligence</h2><label className="exec-period">Review period<select value={period} onChange={(event) => setPeriod(event.target.value as SnapshotPeriodKey)}>{PERIODS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>
          {snapshot && <p className="exec-period-note">{snapshot.period.label} · {formatReviewInstant(snapshot.period.start, snapshot.period.timezone)} – {formatReviewInstant(snapshot.period.end, snapshot.period.timezone)} · Reporting zone: {snapshot.period.timezone}<br />Read {formatReviewInstant(snapshot.composed_at, snapshot.period.timezone, true)}. Source windows below may be narrower.</p>}
          {review.state === "loading" && <p className="exec-read-state" role="status">{accountEpoch ? "Reading your business review…" : "Resolving this workspace…"}</p>}
          {review.state === "failed" && <div className="exec-read-state" role="alert"><p>{review.message}</p><button className="exec-button" type="button" onClick={review.refresh}>Try again</button></div>}
          {snapshot && <>
            {!readable.length && <p className="exec-read-state">No business figures could be read. The source gaps are listed below; they are not zero results.</p>}
            {readable.map((area) => <section key={area.key} className="exec-domain" aria-labelledby={"exec-domain-" + area.key}>
              <div className="exec-section-head"><h3 id={"exec-domain-" + area.key}>{area.label}</h3><span className={"exec-state " + (area.entry.data!.coverage === "partial" ? "is-held" : "")}>{area.entry.data!.coverage === "partial" ? "Partial" : "Source read"}</span></div>
              <DomainEvidence domain={area.entry.data!} timezone={snapshot.period.timezone} />
              <div className="exec-domain-links">{area.destination && <Destination destination={area.destination} account={account} />}{area.key === "payments" && <Destination destination="sales_collections" account={account} />}{area.key === "operations" && <Destination destination="operations_work" account={account} />}</div>
            </section>)}
            {gaps.length > 0 && <section className="exec-gaps" aria-labelledby="exec-gaps-title"><h3 id="exec-gaps-title">What this review cannot measure</h3><ul>{gaps.map((area) => <li key={area.key}><strong>{area.label}</strong><span>{area.entry.status === "degraded" ? "Read incomplete. " : ""}{reviewGapNote(area.entry.reason)}</span></li>)}</ul></section>}
            <p className="exec-note">Ad and social performance, numeric targets and unlisted sources are not included in this review. No results are inferred from their absence.</p>
          </>}
        </section>

        <aside className="exec-support">
          <section className="exec-priorities" aria-labelledby="exec-priorities-title">
            <h2 id="exec-priorities-title">What needs your attention</h2>
            {!snapshot ? <p className="exec-note">Priorities appear after the business evidence can be read.</p> : priorities.length ? <ol className="exec-priority-list">{priorities.slice(0, 3).map((priority, i) => <li key={priority.area.key + "-" + priority.kind + "-" + i}>
              <h3>{priority.summary}</h3><span className={"exec-state " + (priority.severity === "act" ? "is-attention" : "is-held")}>{priority.severity === "act" ? "Needs attention" : "Watch"} · {priority.area.label}</span>
              <p><span className="exec-recommendation">Recommended</span> {priority.area.recommendation}</p>
              {priority.area.destination && <Destination destination={priority.area.destination} account={account} />}
              <button type="button" className="exec-text-button" disabled={!openPaige} onClick={() => ask("Help me understand this " + priority.area.label + " finding and recommend a next step: " + priority.summary + ". Re-read the current business evidence; do not take an action.")}>Discuss with PAIGE</button>
            </li>)}</ol> : <p className="exec-note">{readable.length ? "No act or watch risk was reported by the sources that could be read." : "Risks cannot be ranked without readable evidence."} Unreadable sources remain unknown.</p>}
            {priorities.length > 3 && <p className="exec-note">Showing the first 3 of {priorities.length} reported act/watch risks. Open Systems Check and the departmental views for the full evidence.</p>}
          </section>

          <section className="exec-strategy" aria-labelledby="exec-strategy-title">
            <div className="exec-section-head"><h2 id="exec-strategy-title">Your direction &amp; strategic plays</h2></div>
            {missions.status === "loading" ? <p className="exec-note" role="status">Reading your recorded strategy…</p> : missions.status !== "ready" ? <div role="status"><p className="exec-note">{missions.status === "forbidden" ? "Strategic plays are not available to this role." : "Strategic plays could not be read."}</p><button type="button" className="exec-text-button" onClick={() => void missions.refresh()}>Try again</button></div> : !plays.length ? <p className="exec-note">No strategic plays recorded. Set the direction in Business Game Plan, or shape the next move with PAIGE.</p> : <ul className="exec-play-list">{plays.map((play) => <li key={play.id}><h3>{play.title}</h3><span className="exec-state">{play.stageLabel}</span><p>{play.desired_outcome}</p>{play.deadline_on && <small>Due {businessDateLabel(play.deadline_on)}{play.state === "active" && (calendar.day.kind === "configured" ? play.deadline_on < calendar.day.date ? " · Past due date" : "" : " · " + businessCalendarHeldNote(calendar.day.reason, "record"))}</small>}{play.next_action && <p>Recorded next step: {play.next_action}</p>}</li>)}</ul>}
            <Destination destination="business_game_plan" account={account} />
          </section>

          <section className="exec-decisions" aria-labelledby="exec-decisions-title">
            <h2 id="exec-decisions-title">Prepared work &amp; decisions</h2>
            {pending.loading ? <p className="exec-note" role="status">Reading held work…</p> : pending.error ? <div role="status"><p className="exec-note">Held work could not be read. This is not an empty queue.</p><button type="button" className="exec-text-button" onClick={pending.refresh}>Try again</button></div> : !pending.items.length && (total === null || total === 0) ? <p className="exec-note">No filed confirm-lane work was returned. Nothing is being claimed as executed.</p> : <>
              <p className="exec-queue-count">{total === null ? "Showing up to " + pending.items.length + " prepared items" : total + " prepared item" + (total === 1 ? "" : "s")} awaiting review</p>
              <ul className="exec-work-list">{pending.items.slice(0, 3).map((item) => <li key={item.id}><strong>{item.title}</strong><small>{item.department} · Prepared</small></li>)}</ul>
              {total !== null && total > 3 && <p className="exec-note">Previewing {Math.min(pending.items.length, 3)} of {total} filed items.</p>}
              <button type="button" className="exec-button" disabled={!openPaige} onClick={() => ask("Explain my prepared work and what is awaiting review. Re-read the current records and do not execute anything.")}>Review with PAIGE<ArrowRight size={14} aria-hidden="true" /></button>
            </>}
            <p className="exec-note">Prepared is not completed. Any available approval uses the existing PAIGE confirmation card and its current permissions.</p>
          </section>

          <section className="exec-recorded" aria-labelledby="exec-recorded-title">
            <h2 id="exec-recorded-title">Recorded activity</h2>
            {activity.status === "loading" ? <p className="exec-note" role="status">Reading recorded activity…</p> : activity.status !== "ready" ? <div role="status"><p className="exec-note">{activity.status === "forbidden" ? "Activity is not authorized for this role." : "Recorded activity could not be read."}</p><button type="button" className="exec-text-button" onClick={activity.refresh}>Try again</button></div> : !activity.items.length ? <p className="exec-note">No recent activity returned by the recorded feed.</p> : <ul className="exec-work-list">{activity.items.slice(0, 4).map((item) => <li key={item.id}><strong>{item.title}</strong><small>{item.byPaige ? item.actorAgent ?? "PAIGE" : item.byPerson ? "Person" : "Unattributed"} · Recorded {elapsedLabel(item.occurredAt)}</small>{item.summary && <p>{item.summary}</p>}</li>)}</ul>}
            <p className="exec-note">Existing receipts and recorded events only. Viewing this page records no business action.</p>
          </section>

          <nav className="exec-context-links" aria-label="Governance and business context">
            <Destination destination="systems_check" account={account} />
            <Destination destination="trust_compass" account={account} />
            <Destination destination="mind" account={account} />
          </nav>
        </aside>
      </div>
    </div>
  </div>;
}
