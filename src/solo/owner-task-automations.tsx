import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useOwnerTaskAutomations } from "./data/useOwnerTaskAutomations";
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

export function OwnerTaskAutomations() {
  const a = useOwnerTaskAutomations(), id = useId(), { pathname } = useLocation();
  const base = pathname.match(/^(\/solo\/[^/]+)(?:\/|$)/)?.[1];
  const [review, setReview] = useState<{ item: OwnerTaskReview; scope: string } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null), refreshRef = useRef<HTMLButtonElement>(null);
  const sourceRef = useRef<HTMLButtonElement | null>(null), scopeRef = useRef(a.scopeKey);
  scopeRef.current = a.scopeKey;
  const selected = review?.scope === a.scopeKey && a.read.status === "ready" && a.read.items.includes(review.item) && !a.needsRefresh ? review.item : null;
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
            <p className="sa-rule-meta">When a contact is created · {a.needsRefresh ? "Last read: " : ""}{supported ? stateWords(r) : "Unsupported configuration"} · Each task needs your approval</p>
            {r.acts.map(step => <div className="sa-owner-task-step" key={String(step.id)}>
              {object(step.config) && typeof step.config.title === "string" && <p className="sa-rule-sentence sa-owner-task-title">{step.config.title}</p>}
              {object(step.config) && typeof step.config.description === "string" && <p className="sa-note sa-owner-task-description">{step.config.description}</p>}
            </div>)}
            {!supported && <><p className="sa-note">This configuration cannot be enabled here. You can pause it.</p>
              <details className="sa-owner-task-config"><summary>Inspect saved configuration</summary>
                <pre>{JSON.stringify({ trigger: r.process.trigger_key, trigger_config: r.process.trigger_config, conditions: r.process.conditions, steps: r.acts }, null, 2)}</pre></details></>}
            {legacy && <p className="sa-note">This older process has no verified activation. Pause it, then review it again.</p>}
            <div className="sa-rule-controls">
              {canEnable && <button type="button" className="sa-ctl" disabled={a.busy || a.needsRefresh} aria-expanded={selected === r}
                aria-describedby={`${id}-${r.id}-name`}
                aria-controls={selected === r ? `${id}-${r.id}-review` : undefined}
                onClick={e => { sourceRef.current = e.currentTarget; setReview({ item: r, scope: a.scopeKey }); }}>Review to enable</button>}
              {r.process.state !== "paused" && (r.process.state === "live" || !supported) && <button type="button" className="sa-ctl"
                aria-describedby={`${id}-${r.id}-name`}
                disabled={a.busy || a.needsRefresh} onClick={() => void submit(r, "pause")}>Pause future contacts</button>}
            </div>
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
    {a.busy && <p className="sa-empty" role="status">Saving the reviewed configuration…</p>}
    {a.feedback && <p className="sa-empty" role="status">{feedbackWords(a.feedback)}</p>}
    {base && <footer className="sa-editor-foot"><Link to={`${base}/command-center/business-game-plan`} className="sa-note">Review pending tasks</Link>
      <Link to={`${base}/operations/work`} className="sa-note">Open work</Link></footer>}
  </section>;
}
