import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { ArrowUpRight, History, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { departmentLabel, type SoloActivityFeed, type SoloActivityItem } from "./data/useSoloActivityFeed";
import { formatReviewInstant } from "./executive-review";
import { routeLinkTarget } from "@/lib/links/workspaceLinks";
import type { ActivityEvidenceRead } from "../../supabase/functions/_shared/paige-context/activity-evidence";
import type { ActivityReturn, ActorFilter } from "./executive-activity-return";
import "./executive-activity.css";

function matches(item: SoloActivityItem, filter: ActorFilter) {
  return filter === "all" || (filter === "paige" ? item.byPaige : filter === "people" ? item.byPerson : !item.byPaige && !item.byPerson);
}
function OriginalResult({ read, account }: { read?: ActivityEvidenceRead; account?: string | null }) {
  if (!read || read.state !== "ready") return <><h4>Business result not provided</h4>
    <p>This event does not include a verified business result or a direct link to its original record and receipt.</p></>;
  const evidence = read.evidence;
  if (evidence.kind === "recorded_outcome") return <>
    <h4>Recorded outcome</h4><p>{evidence.recordedOutcome === "run_awaiting_approval" ? "Approval was requested."
      : evidence.recordedOutcome.endsWith("_failed") ? "Failure was recorded."
      : evidence.recordedOutcome.endsWith("_refused") ? "A refusal was recorded."
      : evidence.recordedOutcome === "plan_blocked" ? "A blocker was recorded."
      : evidence.recordedOutcome === "capability_outcome_unknown" || evidence.recordedOutcome === "capability_completed_unrecorded"
        ? "The result was not confirmed." : "An operation outcome was recorded."}</p>
    <p>Current approval and underlying business completion are not verified by this entry.</p>
    <details><summary>Original activity receipt</summary><code>{evidence.railReceiptId}</code></details>
  </>;
  const result = evidence.businessResult;
  const reference = evidence.recordLinks[0];
  const target = reference ? routeLinkTarget(reference, "solo", account) : null;
  return <>
    <p className="exec-activity-verified">Original target change verified</p>
    <dl className="exec-activity-figures"><div><dt>Saved revision</dt><dd>{result.revision}</dd></div>
      <div><dt>State at this revision</dt><dd>{result.state === "active" ? "Active" : result.state === "paused" ? "Paused" : "Retired"}</dd></div></dl>
    <p>The original saved revision and its receipt match. This does not mean the business target was achieved.</p>
    {target?.status === "exact" ? <Link data-activity-record-link className="exec-link" to={target.to}>{target.label}<ArrowUpRight size={16} aria-hidden /></Link>
      : <p>The original record link is unavailable in this workspace.</p>}
    <details><summary>Original receipts</summary><dl className="exec-activity-receipts">
      <div><dt>Saved-change receipt</dt><dd><code>{result.receiptId}</code></dd></div>
      <div><dt>Activity receipt</dt><dd><code>{evidence.railReceiptId}</code></dd></div>
    </dl></details>
  </>;
}
function actor(item: SoloActivityItem) {
  return item.byPaige ? item.actorAgent?.trim() || "PAIGE team · specialist not recorded"
    : item.byPerson ? "Person" : "Actor not recorded";
}
function recordedTime(item: SoloActivityItem, timezone: string) {
  // Only a source instant with an explicit zone is a date; never substitute read time.
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(item.occurredAt)
    && Number.isFinite(Date.parse(item.occurredAt));
  return valid ? <time dateTime={item.occurredAt}>{formatReviewInstant(item.occurredAt, timezone, true)} · {timezone}</time>
    : <>Recording time unavailable</>;
}
function ReadState({ feed }: { feed: SoloActivityFeed }) {
  return <div className="exec-activity-state" role="status">
    <p>{feed.status === "loading" ? "Reading recorded activity…" : feed.status === "forbidden"
      ? "Activity is not authorized for this role." : "Recorded activity could not be read."}</p>
    {feed.status !== "loading" && <button type="button" onClick={feed.refresh}><RefreshCw size={16} aria-hidden />Retry activity read</button>}
  </div>;
}

/** Original scoped facts/results only. Navigation and refresh execute no business work. */
export function ExecutiveActivity({ feed, timezone, account, selection, restore }: {
  feed: SoloActivityFeed; timezone: string; account?: string | null;
  selection?: { eventId: string | null; onChange: (id: string | null) => void }; restore?: ActivityReturn;
}) {
  const { resolvedTheme } = useTheme();
  const [localOpen, setLocalOpen] = useState(false);
  const [localId, setLocalId] = useState<string | null>(null);
  const open = selection ? selection.eventId !== null : localOpen;
  const selectedId = selection ? selection.eventId : localId;
  const setSelectedId = (id: string) => selection ? selection.onChange(id) : setLocalId(id);
  const [filter, setFilter] = useState<ActorFilter>(() => restore?.filter ?? "all");
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLElement>(null), detail = useRef<HTMLElement>(null), restored = useRef(false);
  useEffect(() => {
    if (!restore) return;
    const newerInput = () => { restored.current = true; };
    for (const name of ["pointerdown", "keydown", "wheel", "touchmove"]) document.addEventListener(name, newerInput, { capture: true, passive: true });
    return () => { for (const name of ["pointerdown", "keydown", "wheel", "touchmove"]) document.removeEventListener(name, newerInput, true); };
  }, [restore]);
  const available = feed.status === "ready";
  const rows = available ? feed.items : [];
  const visible = rows.filter(item => matches(item, filter));
  const inspection = feed.inspection;
  const selected = inspection ? inspection.eventId === selectedId && inspection.status === "ready" && inspection.item
    && inspection.item.id.toLowerCase() === selectedId?.toLowerCase()
    && matches(inspection.item, filter) ? inspection.item : null : visible.find(item => item.id.toLowerCase() === selectedId?.toLowerCase());
  const missing = selectedId !== null && !rows.some(item => item.id === selectedId);
  const restoreReading = useCallback(() => {
    if (!restore || restored.current || !open || !selected || restore.eventId !== selected.id || !list.current || !detail.current) return false;
    list.current.scrollTop = restore.listScroll;
    detail.current.scrollTop = restore.detailScroll;
    (detail.current.querySelector<HTMLElement>("[data-activity-record-link]") ?? detail.current.querySelector<HTMLElement>("h3"))?.focus({ preventScroll: true });
    restored.current = true;
    return true;
  }, [restore, open, selected]);
  useLayoutEffect(() => { restoreReading(); }, [restoreReading]);
  const restoreFocus = (event: Event) => {
    if (!trigger.current?.isConnected || typeof document.elementFromPoint !== "function") return;
    // A narrow PAIGE overlay may now cover the original page invoker. Keep
    // keyboard recovery in its EXISTING visible workspace, without folding it,
    // changing the composer or focusing a control behind the overlay.
    const visible = (element: HTMLElement) => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width > 0 && r.height > 0 && !!hit && (element === hit || element.contains(hit));
    };
    if (visible(trigger.current)) return;
    const target = [...document.querySelectorAll<HTMLButtonElement>("#tenant-paige-workspace header button")].find(visible);
    if (target) { event.preventDefault(); target.focus({ preventScroll: true }); return; }
    // A resize can move the invoker outside its EXISTING scroll owner. Radix's
    // default return prevents scrolling, leaving keyboard focus out of view.
    event.preventDefault();
    trigger.current.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    trigger.current.focus({ preventScroll: true });
  };

  return <section className="exec-recorded" aria-labelledby="exec-recorded-title">
    <h2 id="exec-recorded-title">Recorded activity</h2>
    {!available ? <ReadState feed={feed} /> : !rows.length ? <p className="exec-note">No recent events returned.</p>
      : <ul className="exec-work-list exec-activity-preview">{rows.slice(0, 4).map(item => <li key={item.id}>
        <strong>{item.title}</strong><small>{actor(item)}</small><small>{recordedTime(item, timezone)}</small>
        {item.summary && <p>{item.summary}</p>}
      </li>)}</ul>}
    <Dialog open={open} onOpenChange={next => {
      if (selection) { selection.onChange(next ? rows[0]?.id ?? "" : null); return; }
      if (next && selectedId === null) setLocalId(rows[0]?.id ?? null);
      setLocalOpen(next);
    }}>
      <DialogTrigger asChild><button ref={trigger} type="button" data-activity-inspect className="exec-button"><History size={16} aria-hidden />Inspect activity<ArrowUpRight size={14} aria-hidden /></button></DialogTrigger>
      <DialogContent data-pg={resolvedTheme === "dark" ? "dark" : "light"} className="exec-activity" overlayClassName="exec-activity-scrim"
        onOpenAutoFocus={event => { if (restoreReading()) event.preventDefault(); }} onCloseAutoFocus={restoreFocus}>
        <header className="exec-activity-heading"><DialogTitle>Recorded activity</DialogTitle>
          <DialogDescription>Inspect who recorded the work and what the original event says.</DialogDescription></header>
        {!available ? <ReadState feed={feed} /> : !rows.length && !selectedId ? <div className="exec-activity-state" role="status">
          <History size={24} aria-hidden /><h3>No recent events returned</h3>
          <p>This read is not a complete activity history. It does not establish that no work happened.</p>
          <button type="button" onClick={feed.refresh}><RefreshCw size={16} aria-hidden />Refresh activity</button>
        </div> : <>
          <div className="exec-activity-toolbar">
            <label>Recorded by<select value={filter} onChange={e => setFilter(e.target.value as ActorFilter)}>
              <option value="all">Everyone</option><option value="paige">PAIGE team</option>
              <option value="people">People</option><option value="unattributed">Unattributed</option>
            </select></label>
            <span role="status">{filter === "all" ? `${rows.length} returned events` : `${visible.length} of ${rows.length} returned events`}</span>
            <button type="button" onClick={feed.refresh}><RefreshCw size={16} aria-hidden />Refresh activity</button>
          </div>
          <div className="exec-activity-workspace">
            <nav ref={list} className="exec-activity-list" aria-label="Recorded events">
              {!visible.length ? <p>No matching returned events. Choose Everyone to see the sample.</p> : visible.map(item =>
                <button type="button" key={item.id} data-activity-id={item.id} aria-pressed={item.id.toLowerCase() === selectedId?.toLowerCase()} onClick={() => setSelectedId(item.id)}>
                  <small>{actor(item)}</small><strong>{item.title}</strong><small>{recordedTime(item, timezone)}</small>
                </button>)}
            </nav>
            {selected ? <article ref={detail} data-activity-original-id={selected.id} data-activity-filter={filter} className="exec-activity-detail" aria-label="Selected recorded event">
              <p className="exec-activity-attribution">{actor(selected)} · {selected.departmentSlug ? departmentLabel(selected.departmentSlug) : "Department not recorded"}</p>
              <h3 tabIndex={-1}>{selected.title}</h3><p className="exec-activity-time">{recordedTime(selected, timezone)}</p>
              <section aria-label="Original event"><h4>Recorded summary</h4>
                <p className="exec-activity-prose">{selected.summary || "No summary was returned for this event."}</p></section>
              <section className="exec-activity-result" aria-label="Business result and evidence">
                <OriginalResult read={inspection?.evidence} account={account} />
              </section>
            </article> : <div className="exec-activity-state" role="status"><p>{inspection?.status === "loading" ? "Reading the original event and receipt…"
              : inspection?.status === "not_found" ? "This original event was not returned for the current workspace and role. No other event has been substituted."
              : inspection?.status === "unavailable" || inspection?.status === "forbidden" ? "The original event could not be read or verified. Its result has been withheld."
              : missing
              ? "The selected event is not in this returned sample. Select another event or refresh; its original status has not been inferred."
              : "Select a returned event to inspect its recorded facts."}</p>
              {inspection && ["unavailable", "forbidden", "not_found"].includes(inspection.status)
                && <button type="button" onClick={feed.refresh}>Retry original read</button>}
            </div>}
          </div>
          <p className="exec-activity-footnote">Latest returned sample, not a complete activity history. Inspecting or refreshing does not execute work.</p>
        </>}
      </DialogContent>
    </Dialog>
    <p className="exec-note">Recorded events do not by themselves verify completed business work.</p>
  </section>;
}
