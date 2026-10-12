// Campaigns › dossier: the steps that carry a campaign out, and what came of them (INT-298 MBC slice 6b).
// Strategy → Campaign → Tactic → Step → Result → Judgement, read from the server's own lifecycle
// (useCampaignActions). Owners and admins plan a step (it waits for approval and sends nothing), remove one,
// record what happened once a step has finished, and judge it against its aim. Members read the plan.
// The screen never decides a state: a step marked done with nothing behind it says so and takes no result,
// and a failed step stays failed even once a result is recorded or judged.
import React from "react";
import { Ic as SharedIcons } from "./_shared";
import {
  FAMILIES, FAMILY_LABEL, VERDICT_LABEL, basisLine, canEvaluate, canRecordOutcome, lifecycleTone, localDayStart, removeWarning, stateLabel,
  useCampaignActions, type ActionFamily, type CampaignAction, type Verdict,
} from "./useCampaignActions";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;
type Toast = (message: string, kind: "ok" | "err") => void;

const day = (iso: string | null) => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const fig = (value: number | null) => (value === null ? "" : ` · ${value.toLocaleString()}`);
// A figure is digits, optionally with a decimal point; "1,000" or "12,5" are refused with a reason, not silently.
const FIGURE = /^-?\d+(\.\d+)?$/;
const newKey = () => crypto.randomUUID();

function StateChip({ action }: { action: CampaignAction }) {
  return <span className={`loop-state ca-state ${lifecycleTone(action)}`}><span className="sd"/>{stateLabel(action)}</span>;
}

function StepRow({ action, canManage, onRemove, onRecord, onEvaluate }: {
  action: CampaignAction; canManage: boolean;
  onRemove: () => Promise<boolean>; onRecord: (summary: string, value: number | null) => Promise<boolean>; onEvaluate: (verdict: Verdict, note: string | null) => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState<null | "record" | "judge" | "remove">(null);
  const [summary, setSummary] = React.useState("");
  const [value, setValue] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const rowRef = React.useRef<HTMLLIElement>(null);
  const due = day(action.dueAt);
  const basis = basisLine(action);
  const name = action.title ?? "A step";
  const figureBad = value.trim() !== "" && !FIGURE.test(value.trim());
  const figure = value.trim() === "" || figureBad ? null : Number(value.trim());
  // Closing a form returns focus to the step, so a keyboard user is never dropped onto the page.
  const close = () => { setOpen(null); requestAnimationFrame(() => rowRef.current?.focus()); };
  const run = async (fn: () => Promise<boolean>) => { if (busy) return; setBusy(true); try { if (await fn()) close(); } finally { setBusy(false); } };
  const escape = (event: React.KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  return (
    <li className="ca-step" ref={rowRef} tabIndex={-1}>
      <div className="ca-top">
        <span className="cc-k">{FAMILY_LABEL[action.family]}</span>
        <span className={`ca-n ${action.title ? "" : "cc-hidden"}`}>{action.title ?? "A step (owners and admins see its name)"}</span>
        <StateChip action={action}/>
        {canManage && <button type="button" className="ca-rm" disabled={busy} title="Remove from this campaign" aria-expanded={open === "remove"}
          aria-label={`Remove ${name} from this campaign`} onClick={() => setOpen(open === "remove" ? null : "remove")}><Ic.x size={12}/></button>}
      </div>
      {(due || action.waitingOnDependency || action.createdThrough === "paige" || action.lifecycle === "approval_required") && <div className="ca-meta">
        {action.lifecycle === "approval_required" && <span>{canManage ? "It's waiting in your approvals." : "It's waiting for approval."}</span>}
        {due && <span><Ic.cal size={11}/> Due {due}</span>}
        {action.waitingOnDependency && <span>Waits for an earlier step to finish.</span>}
        {action.createdThrough === "paige" && <span>PAIGE planned it.</span>}
      </div>}
      {(action.expected || action.observed) && <dl className="ca-res">
        {action.expected && <div><dt>Aim</dt><dd>{action.expected.summary}{fig(action.expected.target)}</dd></div>}
        {action.observed && <div><dt>Result</dt><dd>{action.observed.summary}{fig(action.observed.value)}
          <small> · {action.observedThrough === "paige" ? "recorded by PAIGE" : "recorded"} as stated</small></dd></div>}
        {action.verdict && <div><dt>Judged</dt><dd>{VERDICT_LABEL[action.verdict]}{action.verdictNote ? ` · ${action.verdictNote}` : ""}</dd></div>}
      </dl>}
      {basis && <p className={`ca-basis ${action.failed ? "is-failed" : ""}`}>{basis}</p>}
      {canManage && open === null && (canRecordOutcome(action) && !action.observed || canEvaluate(action)) && <div className="ca-acts">
        {canRecordOutcome(action) && !action.observed && <button type="button" className="btn btn-s" disabled={busy} onClick={() => setOpen("record")}>Record the result</button>}
        {canEvaluate(action) && <button type="button" className="btn btn-s" disabled={busy} onClick={() => setOpen("judge")}>Judge it</button>}
      </div>}
      {canManage && open === "remove" && <div className="ca-form ca-confirm" role="group" aria-label={`Remove ${name} from this campaign`} onKeyDown={escape}>
        <p className="ca-hint">{removeWarning(action)}</p>
        <div className="ca-row"><button type="button" className="btn btn-s" autoFocus disabled={busy} onClick={() => run(onRemove)}>Remove from campaign</button>
          <button type="button" className="btn btn-s ca-quiet" onClick={close}>Keep it</button></div>
      </div>}
      {canManage && open === "record" && <form className="ca-form" aria-label={`Record the result of ${name}`} onKeyDown={escape}
        onSubmit={(event) => { event.preventDefault(); if (summary.trim() && !figureBad) void run(() => onRecord(summary, figure)); }}>
        <label className="ca-field"><span>What happened</span><input autoFocus value={summary} maxLength={500} onChange={(event) => setSummary(event.target.value)} placeholder="e.g. Twelve people booked a call"/></label>
        <label className="ca-field ca-narrow"><span>Figure (optional)</span><input inputMode="decimal" value={value} aria-invalid={figureBad} aria-describedby={figureBad ? `ca-fig-${action.actionId}` : undefined}
          onChange={(event) => setValue(event.target.value)} placeholder="12"/></label>
        {figureBad && <p className="ca-hint ca-bad" id={`ca-fig-${action.actionId}`}>Use digits only, with a point for decimals: 1000 or 12.5.</p>}
        <p className="ca-hint">A result is recorded as you state it. It isn't counted as a measured figure.</p>
        <div className="ca-row"><button type="submit" className="btn btn-s btn-g" disabled={busy || !summary.trim() || figureBad}>Record result</button>
          <button type="button" className="btn btn-s" onClick={close}>Cancel</button></div>
      </form>}
      {canManage && open === "judge" && <div className="ca-form" role="group" aria-label={`Judge ${name} against its aim`} onKeyDown={escape}>
        <label className="ca-field"><span>Note (optional)</span><input autoFocus value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Above the aim of ten"/></label>
        <div className="ca-row">
          {(["met", "partly_met", "not_met"] as const).map((verdict) => <button key={verdict} type="button" className="btn btn-s" disabled={busy}
            onClick={() => run(() => onEvaluate(verdict, note))}>{VERDICT_LABEL[verdict]}</button>)}
          <button type="button" className="btn btn-s ca-quiet" onClick={close}>Cancel</button>
        </div>
      </div>}
    </li>
  );
}

// The kind picker is one radio group: one tab stop, arrow keys move the choice (the ARIA radiogroup pattern).
function FamilyPicker({ value, onChange }: { value: ActionFamily; onChange: (value: ActionFamily) => void }) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: React.KeyboardEvent, step: number) => {
    event.preventDefault();
    const next = FAMILIES[(FAMILIES.indexOf(value) + step + FAMILIES.length) % FAMILIES.length];
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="ca-chips" role="radiogroup" aria-labelledby="ca-family-l"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
      }}>
      {FAMILIES.map((family) => <button key={family} ref={(el) => { refs.current[family] = el; }} type="button" role="radio" aria-checked={family === value}
        tabIndex={family === value ? 0 : -1} className={`ca-chip ${family === value ? "is-on" : ""}`} onClick={() => onChange(family)}>{FAMILY_LABEL[family]}</button>)}
    </div>
  );
}

function PlanForm({ tactics, busy, onPlan, onCancel }: {
  tactics: readonly string[]; busy: boolean; onPlan: (input: { title: string; tactic: string; family: ActionFamily; dueAt: string | null; expected: string; key: string }) => void; onCancel: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [tactic, setTactic] = React.useState(tactics[0] ?? "");
  const [family, setFamily] = React.useState<ActionFamily>("email");
  const [due, setDue] = React.useState("");
  const [expected, setExpected] = React.useState("");
  // One key per plan: a retry after an unclear failure files the same step once, not twice.
  const [key] = React.useState(newKey);
  const ready = title.trim() && tactic.trim();
  return (
    <form className="ca-form ca-plan" aria-label="Plan a step"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}
      onSubmit={(event) => { event.preventDefault(); if (ready) onPlan({ title, tactic, family, dueAt: due ? localDayStart(due) : null, expected, key }); }}>
      <label className="ca-field"><span>Step</span><input autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Invite past clients to the spring intake"/></label>
      <label className="ca-field"><span>Tactic</span><input value={tactic} maxLength={120} onChange={(event) => setTactic(event.target.value)} placeholder="e.g. Win-back email"/></label>
      {tactics.length > 0 && <div className="ca-chips" role="group" aria-label="Use a tactic already in this campaign">
        {tactics.map((name) => <button key={name} type="button" className={`ca-chip ${name === tactic ? "is-on" : ""}`} aria-pressed={name === tactic} onClick={() => setTactic(name)}>{name}</button>)}
      </div>}
      <div className="ca-field"><span id="ca-family-l">Kind of step</span><FamilyPicker value={family} onChange={setFamily}/></div>
      <div className="ca-pair">
        <label className="ca-field ca-narrow"><span>Due (optional)</span><input type="date" value={due} onChange={(event) => setDue(event.target.value)}/></label>
        <label className="ca-field"><span>Aim (optional)</span><input value={expected} maxLength={500} onChange={(event) => setExpected(event.target.value)} placeholder="e.g. Ten replies"/></label>
      </div>
      <p className="ca-hint">A planned step waits for your approval. Planning it sends and publishes nothing.</p>
      <div className="ca-row"><button type="submit" className="btn btn-s btn-g" disabled={busy || !ready}>{busy ? "Planning…" : "Plan step"}</button>
        <button type="button" className="btn btn-s" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export function CampaignActions({ tenantId, briefId, onToast }: { tenantId: string | null; briefId: string; onToast: Toast }) {
  const state = useCampaignActions(tenantId, briefId);
  const [planning, setPlanning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const addRef = React.useRef<HTMLButtonElement>(null);
  if (state.phase === "loading") return <div className="campaigns-skeleton" style={{ padding: 0 }}><span style={{ height: 64 }}/></div>;
  if (state.phase === "error") return <div className="dw-note" role="alert">This campaign's steps couldn't load. Nothing was changed. <button type="button" className="btn btn-s" onClick={state.retry}>Try again</button></div>;
  const mine = state.actions.filter((action) => action.briefId === briefId);
  const tactics = [...new Set(mine.map((action) => action.tactic))];
  const say = (r: { ok: boolean; message: string }) => { onToast(r.message, r.ok ? "ok" : "err"); return r.ok; };
  const focusAdd = () => requestAnimationFrame(() => addRef.current?.focus());
  const close = () => { setPlanning(false); focusAdd(); };
  return (
    <div className="ca">
      {mine.length === 0 ? <p className="cc-empty">No steps planned yet.{state.canManage ? " Plan the first one; it waits for your approval." : ""}</p>
        : tactics.map((tactic) => {
          const steps = mine.filter((action) => action.tactic === tactic);
          return <section key={tactic} className="ca-tactic" aria-label={`Tactic: ${tactic}`}>
            <div className="cc-h"><h5>{tactic}</h5><span>{steps.length} step{steps.length === 1 ? "" : "s"}</span></div>
            <ul className="ca-list">{steps.map((action) => <StepRow key={action.actionId} action={action} canManage={state.canManage}
              onRemove={async () => { const ok = say(await state.remove(briefId, action.actionId)); if (ok) focusAdd(); return ok; }}
              onRecord={async (summary, value) => say(await state.recordOutcome(briefId, action.actionId, summary, value))}
              onEvaluate={async (verdict, note) => say(await state.evaluate(briefId, action.actionId, verdict, note))}/>)}</ul>
          </section>;
        })}
      {state.canManage && !planning && <button ref={addRef} type="button" className="ca-add" onClick={() => setPlanning(true)}><Ic.plus size={13}/> Plan a step</button>}
      {state.canManage && planning && <PlanForm tactics={tactics} busy={busy} onCancel={close}
        onPlan={async (input) => { if (busy) return; setBusy(true); try { if (say(await state.plan(briefId, input))) close(); } finally { setBusy(false); } }}/>}
      <p className="cc-foot">A step's state comes from the action list itself. Done means a run or your approval stands behind it; a result is what you or PAIGE recorded, never a measured figure.</p>
    </div>
  );
}
