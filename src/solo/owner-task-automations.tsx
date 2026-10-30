import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useOwnerTaskAutomations } from "./data/useOwnerTaskAutomations";
import { OwnerTaskProcessHistory } from "./owner-task-process-history";
import type { OwnerTaskReview } from "./data/ownerTaskAutomation";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Presentation guard only; the native writer independently validates every reviewed byte. */
function reviewableOwnerTask(r: OwnerTaskReview): boolean {
  const p = r.process, a = r.acts[0];
  if (r.acts.length !== 1 || !a || a.position !== 1 || a.action_kind !== "owner.task" || a.tool_key !== null
    || p.trigger_key !== "contact.created" || typeof p.created_by !== "string" || !object(p.trigger_config)
    || Object.keys(p.trigger_config).length || !Array.isArray(p.conditions) || p.conditions.length || !object(a.config)) return false;
  const c = a.config;
  return typeof c.title === "string" && c.title.trim().length > 0 && [...c.title.trim()].length <= 500
    && (!Object.prototype.hasOwnProperty.call(c, "description") || typeof c.description === "string" && [...c.description].length <= 10_000)
    && Object.keys(c).every(k => ["title", "description"].includes(k))
    && !/(\{\{|\$\{|\{%|<%)/.test(c.title + (typeof c.description === "string" ? c.description : ""));
}
/** Display only known literal task fields; this never admits an execution. */
function SavedProcessDesign({ review }: { review: OwnerTaskReview }) {
  const literal = (value: unknown, limit: number): value is string => {
    if (typeof value !== "string" || value.length > limit * 2) return false;
    const chars = [...value];
    return chars.length <= limit && !/(\{\{|\$\{|\{%|<%|[\u202a-\u202e\u2066-\u2069])/.test(value)
      && !chars.some(char => { const code = char.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) || code >= 127 && code <= 159; });
  };
  const steps = review.acts.slice(0, 20);
  const ordered = review.acts.every((step, index) => step.position === index + 1);
  const settings = !object(review.process.trigger_config) || Object.keys(review.process.trigger_config).length > 0
    || !Array.isArray(review.process.conditions) || review.process.conditions.length > 0;
  return <div className="sa-owner-task-design">
    <p>Saved status: {review.process.state === "draft" ? "Draft" : review.process.state === "paused" ? "Paused"
      : review.process.state === "live" ? "Recorded live; activation is unverified" : "Unverified"}.</p>
    {review.acts.length > 1 && <p>Multiple steps are saved for design review. This control currently enables only one supported internal-task step.</p>}
    {!ordered && <p>Saved step order needs review. Recorded positions are shown without rearranging them.</p>}
    {settings && <p>Trigger settings and conditions need separate review. Their values are not displayed here.</p>}
    <ol aria-label="Saved process steps">{steps.map((step, index) => {
      const config = object(step.config) ? step.config : null;
      const native = step.action_kind === "owner.task" && step.tool_key === null;
      const title = native && config && literal(config.title, 500) && config.title.trim() ? config.title : null;
      const description = native && config && literal(config.description, 10_000) ? config.description : null;
      const extra = config && Object.keys(config).some(key => !["title", "description"].includes(key));
      const position = typeof step.position === "number" && Number.isSafeInteger(step.position) && step.position > 0 ? step.position : null;
      return <li key={`${String(step.id)}:${index}`}>
        <strong>{position === null ? "Position unavailable" : `Step ${position}`}</strong>
        {!native ? <p>Action support is unverified. Its configuration is not displayed here.</p>
          : title ? <><p className="sa-rule-sentence sa-owner-task-title">{title}</p>
            {description && <p className="sa-note sa-owner-task-description">{description}</p>}
            {config && "description" in config && description === null && <p>Saved description needs review.</p>}</>
            : <p>Literal task details need review. No ready task is inferred.</p>}
        {extra && <p>Additional saved settings are not displayed. This preview does not verify their execution support.</p>}
      </li>;
    })}</ol>
    {review.acts.length > steps.length && <p>{review.acts.length - steps.length} additional saved {review.acts.length - steps.length === 1 ? "step is" : "steps are"} not shown. Review the complete process before making a decision.</p>}
    {!steps.length && <p>No saved steps are available to inspect.</p>}
    <p>Reading this design does not approve, enable or execute work. Provider readiness and results are not verified by saved settings.</p>
  </div>;
}
function stateWords(r: OwnerTaskReview): string {
  if (r.process.state === "live") return r.process.granted_lane === "confirm"
    && typeof r.process.owner_task_armed_at === "string" && Number.isFinite(Date.parse(r.process.owner_task_armed_at))
    ? "Enabled for future contacts" : "Activation unverified";
  return r.process.state === "paused" ? "Paused" : r.process.state === "draft" ? "Draft" : "State unverified";
}
const feedbackWords = (feedback: NonNullable<ReturnType<typeof useOwnerTaskAutomations>["feedback"]>) => {
  switch (feedback.result.status) {
    case "saved": return feedback.action === "arm" ? "Enabled for future contacts. No task was created. Refresh to read the current configuration."
      : "Paused for future contacts. Existing approvals and completed tasks remain. Refresh to read the current configuration.";
    case "unknown": return "The outcome could not be confirmed. The process may have changed. Refresh before making another decision.";
    case "stale": return "This process changed since you reviewed it. Refresh and review the current version.";
    case "busy": return "The process is busy. Refresh before reviewing it again.";
    case "unsupported": return "This saved configuration is unsupported. Refresh to inspect it before making another decision.";
    case "unavailable": return "The request could not be started. Refresh before reviewing it again.";
    case "refused": return "Your workspace or permissions changed. Refresh in your current workspace.";
  }
};

export function OwnerTaskAutomations({ navigationHeld = false, onNavigationGuardChange, canLeave }: { navigationHeld?: boolean; onNavigationGuardChange?: (guard: (()=>string|null)|null)=>void; canLeave?: ()=>boolean }) {
  const a = useOwnerTaskAutomations(), id = useId(), { pathname } = useLocation();
  const base = pathname.match(/^(\/solo\/[^/]+)(?:\/|$)/)?.[1];
  const [review, setReview] = useState<{ item: OwnerTaskReview; scope: string } | null>(null);
  const historySourceRef = useRef<HTMLButtonElement | null>(null);
  const closeHistory = () => {
    a.closeHistory();
    if (historySourceRef.current?.isConnected) historySourceRef.current.focus();
  };
  const cancelRef = useRef<HTMLButtonElement>(null), refreshRef = useRef<HTMLButtonElement>(null);
  const previousRead = useRef(a.read.status);
  useLayoutEffect(() => {
    const retired = previousRead.current === "ready" && a.read.status === "refused" && a.needsRefresh;
    previousRead.current = a.read.status;
    // Restore focus only when the requesting control disappeared. A user who
    // moved to another connected control keeps their chosen focus.
    if (retired && document.activeElement === document.body) refreshRef.current?.focus({ preventScroll: true });
  }, [a.read.status, a.needsRefresh]);
  const sourceRef = useRef<HTMLButtonElement | null>(null), scopeRef = useRef(a.scopeKey);
  scopeRef.current = a.scopeKey;
  const selected = review?.scope === a.scopeKey && a.read.status === "ready" && a.read.items.includes(review.item) && !a.needsRefresh ? review.item : null;
  useLayoutEffect(() => {
    const reason = a.busy ? "Wait for the current process decision to finish."
      : selected ? "Finish or cancel the process review before leaving." : null;
    onNavigationGuardChange?.(() => reason);
    return () => onNavigationGuardChange?.(null);
  }, [a.busy, selected, onNavigationGuardChange]);
  useEffect(() => { if (selected) cancelRef.current?.focus(); }, [selected]);
  const cancel = () => { setReview(null); sourceRef.current?.focus(); };
  const submit = async (item: OwnerTaskReview, action: "arm" | "pause") => {
    const scope = a.scopeKey; setReview(null);
    await a.control(item, action);
    if (scopeRef.current === scope) refreshRef.current?.focus();
  };
  return <section className="sa-panel sa-owner-tasks" aria-labelledby={`${id}-title`} aria-busy={a.busy || a.read.status === "loading"}>
    <header className="sa-panel-head"><div><h2 id={`${id}-title`}>Internal task processes</h2>
      <p>A new contact can prepare a task for your approval.</p></div>
      <button type="button" className="sa-ctl" ref={refreshRef} disabled={a.busy || a.read.status === "loading"}
        onClick={() => { setReview(null); void a.refresh(); }}>Refresh</button></header>
    {a.busy && <p className="sa-empty" role="status">Saving the reviewed configuration…</p>}
    {a.feedback && <p className="sa-empty" role="status">{feedbackWords(a.feedback)}</p>}
    {a.read.status === "loading" ? <p className="sa-empty" role="status">Checking internal task processes…</p>
      : a.read.status === "refused" ? <p className="sa-empty" role="status">An active owner or admin in this workspace is required.</p>
      : a.read.status !== "ready" ? <p className="sa-empty" role="status">Internal task processes could not be read. Refresh to check again.</p>
      : <>
        {a.read.items.length === 0 && <p className="sa-empty">{a.read.hasMore
          ? "No internal task process appeared among the contact-created processes checked."
          : "No internal task process is saved. Ask PAIGE to create a contact-created task process."}</p>}
        <ul className="sa-rules">{a.read.items.map(r => {
          const supported = reviewableOwnerTask(r), legacy = r.process.state === "live" && stateWords(r) === "Activation unverified";
          const canEnable = supported && ["draft", "paused"].includes(String(r.process.state));
          return <li className="sa-rule sa-owner-task-rule" key={r.id}><div className="sa-rule-copy">
            <h3 className="sa-rule-sentence" id={`${id}-${r.id}-name`}>{String(r.process.name)}</h3>
            <p className="sa-rule-meta">When a contact is created · {a.needsRefresh ? "Last read: " : ""}{supported ? stateWords(r) : "Unsupported configuration"} · {supported ? "Each task needs your approval" : "Execution support is not verified"}</p>
            {supported && r.acts.map(step => <div className="sa-owner-task-step" key={String(step.id)}>
              {object(step.config) && typeof step.config.title === "string" && <p className="sa-rule-sentence sa-owner-task-title">{step.config.title}</p>}
              {object(step.config) && typeof step.config.description === "string" && <p className="sa-note sa-owner-task-description">{step.config.description}</p>}
            </div>)}
            {!supported && <><p className="sa-note">This configuration cannot be enabled here. You can pause it.</p>
              <details className="sa-owner-task-config"><summary>Inspect saved configuration</summary>
                <SavedProcessDesign review={r} /></details></>}
            {legacy && <p className="sa-note">This older process has no verified activation. Pause it, then review it again.</p>}
            <div className="sa-rule-controls">
              {canEnable && <button type="button" className="sa-ctl" disabled={a.busy || a.needsRefresh} aria-expanded={selected === r}
                aria-describedby={`${id}-${r.id}-name`}
                aria-controls={selected === r ? `${id}-${r.id}-review` : undefined}
                onClick={e => { a.closeHistory(); sourceRef.current = e.currentTarget; setReview({ item: r, scope: a.scopeKey }); }}>Review to enable</button>}
              {r.process.state !== "paused" && (r.process.state === "live" || !supported) && <button type="button" className="sa-ctl"
                aria-describedby={`${id}-${r.id}-name`}
                disabled={a.busy || a.needsRefresh} onClick={() => void submit(r, "pause")}>Pause future contacts</button>}
            </div>
            <div className="sa-rule-controls"><button type="button" className="sa-ctl sa-owner-task-history-open" disabled={a.busy || a.needsRefresh}
              aria-expanded={a.history.status !== "closed" && a.history.processId === r.id}
              aria-controls={a.history.status !== "closed" && a.history.processId === r.id ? `${id}-${r.id}-history` : undefined}
              aria-describedby={`${id}-${r.id}-name`}
              onClick={event => { historySourceRef.current = event.currentTarget; setReview(null); void a.openHistory(r); }}>View history</button></div>
            <OwnerTaskProcessHistory source={a} review={r} account={base?.split("/")[2] ?? null}
              id={`${id}-${r.id}-history`} close={closeHistory} navigationHeld={navigationHeld} />
            {selected === r && <div id={`${id}-${r.id}-review`} className="sa-editor" onKeyDown={e => { if (e.key === "Escape" && !a.busy) { e.preventDefault(); cancel(); } }}>
              <div className="sa-field"><p className="sa-note">Enable this exact task for contacts created after you enable it. Each occurrence waits for your approval. No task is created by enabling.</p></div>
              <div className="sa-editor-foot"><button type="button" className="sa-action" data-primary disabled={a.busy}
                onClick={() => void submit(r, "arm")}>Enable future contacts</button>
                <button type="button" className="sa-ctl" ref={cancelRef} disabled={a.busy} onClick={cancel}>Cancel</button></div>
            </div>}
          </div></li>;
        })}</ul>
        {a.read.hasMore && <p className="sa-empty">Only the first 50 contact-created processes were checked. Older processes may not appear here.</p>}
      </>}
    {base && <footer className="sa-editor-foot"><Link to={`${base}/command-center/business-game-plan`} className="sa-note" onClick={event=>{if(canLeave&&!canLeave())event.preventDefault();}}>Review pending tasks</Link>
      <Link to={`${base}/operations/work`} className="sa-note" onClick={event=>{if(canLeave&&!canLeave())event.preventDefault();}}>Open work</Link></footer>}
  </section>;
}
