import { useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ArrowUpRight, History, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { departmentLabel, type SoloActivityFeed, type SoloActivityItem } from "./data/useSoloActivityFeed";
import { formatReviewInstant } from "./executive-review";
import "./executive-activity.css";

type ActorFilter = "all" | "paige" | "people" | "unattributed";
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

/** Presentation of the ORIGINAL feed only. No write, inferred result or receipt lookup. */
export function ExecutiveActivity({ feed, timezone }: { feed: SoloActivityFeed; timezone: string }) {
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActorFilter>("all");
  const trigger = useRef<HTMLButtonElement>(null);
  const available = feed.status === "ready";
  const rows = available ? feed.items : [];
  const visible = rows.filter(item => filter === "all" || (filter === "paige" ? item.byPaige
    : filter === "people" ? item.byPerson : !item.byPaige && !item.byPerson));
  const selected = visible.find(item => item.id === selectedId);
  const missing = selectedId !== null && !rows.some(item => item.id === selectedId);
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
    if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
  };

  return <section className="exec-recorded" aria-labelledby="exec-recorded-title">
    <h2 id="exec-recorded-title">Recorded activity</h2>
    {!available ? <ReadState feed={feed} /> : !rows.length ? <p className="exec-note">No recent events returned.</p>
      : <ul className="exec-work-list exec-activity-preview">{rows.slice(0, 4).map(item => <li key={item.id}>
        <strong>{item.title}</strong><small>{actor(item)}</small><small>{recordedTime(item, timezone)}</small>
        {item.summary && <p>{item.summary}</p>}
      </li>)}</ul>}
    <Dialog open={open} onOpenChange={next => { if (next && selectedId === null) setSelectedId(rows[0]?.id ?? null); setOpen(next); }}>
      <DialogTrigger asChild><button ref={trigger} type="button" data-activity-inspect className="exec-button"><History size={16} aria-hidden />Inspect activity<ArrowUpRight size={14} aria-hidden /></button></DialogTrigger>
      <DialogContent data-pg={resolvedTheme === "dark" ? "dark" : "light"} className="exec-activity" overlayClassName="exec-activity-scrim" onCloseAutoFocus={restoreFocus}>
        <header className="exec-activity-heading"><DialogTitle>Recorded activity</DialogTitle>
          <DialogDescription>Inspect who recorded the work and what the original event says.</DialogDescription></header>
        {!available ? <ReadState feed={feed} /> : !rows.length ? <div className="exec-activity-state" role="status">
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
            <nav className="exec-activity-list" aria-label="Recorded events">
              {!visible.length ? <p>No matching returned events. Choose Everyone to see the sample.</p> : visible.map(item =>
                <button type="button" key={item.id} data-activity-id={item.id} aria-pressed={item.id === selectedId} onClick={() => setSelectedId(item.id)}>
                  <small>{actor(item)}</small><strong>{item.title}</strong><small>{recordedTime(item, timezone)}</small>
                </button>)}
            </nav>
            {selected ? <article className="exec-activity-detail" aria-label="Selected recorded event">
              <p className="exec-activity-attribution">{actor(selected)} · {selected.departmentSlug ? departmentLabel(selected.departmentSlug) : "Department not recorded"}</p>
              <h3>{selected.title}</h3><p className="exec-activity-time">{recordedTime(selected, timezone)}</p>
              <section aria-label="Original event"><h4>Recorded summary</h4>
                <p className="exec-activity-prose">{selected.summary || "No summary was returned for this event."}</p></section>
              <section className="exec-activity-result" aria-label="Business result and evidence">
                <h4>Business result not provided</h4><p>This event does not include a verified business result or a direct link to its original record and receipt.</p>
              </section>
            </article> : <div className="exec-activity-state" role="status"><p>{missing
              ? "The selected event is not in this returned sample. Select another event or refresh; its original status has not been inferred."
              : "Select a returned event to inspect its recorded facts."}</p></div>}
          </div>
          <p className="exec-activity-footnote">Latest returned sample, not a complete activity history. Inspecting or refreshing does not execute work.</p>
        </>}
      </DialogContent>
    </Dialog>
    <p className="exec-note">Recorded events do not by themselves verify completed business work.</p>
  </section>;
}
