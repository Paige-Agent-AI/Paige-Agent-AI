import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, History, Pause, Pencil, Play, Plus, RefreshCw } from "lucide-react";
import { useOptionalTenantContext } from "@/hooks/useTenantContext";
import type { MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";
import type { TargetActual, TargetHistory } from "./mission-target-client";
import type { TargetAttempt } from "./mission-target-recovery";
import { useMissionTargets } from "./data/useMissionTargets";
import { MissionTargetEditor } from "./MissionTargetEditor";
import { formatTargetValue } from "./mission-target-form";
import "./mission-targets.css";

type Props = { workspaceId?: string | null; mission: { id: string; revision: number; state: string } };
type Editor = { key: string; target: MissionTarget | null } | null;
const display = (target: MissionTarget, value: string) => formatTargetValue(value, target.metric.value_kind, target.metric.currency);
const instant = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export function MissionTargetsPanel({ workspaceId, mission }: Props) {
  // Context only narrows/stamps the browser read. The real SDK user, current
  // workspace and owner-only RPCs independently decide authority on every act.
  const context = useOptionalTenantContext(), actor = context?.activeUserId ?? null;
  const tenant = context?.accountContextStatus === "ready" && !context.loading && context.activeTenantId === workspaceId ? workspaceId ?? null : null;
  const key = `${actor}:${tenant}:${mission.id}`;
  return <ScopedTargetsPanel key={key} actor={actor} tenant={tenant} mission={mission} />;
}
function ScopedTargetsPanel({ actor, tenant, mission }: { actor: string | null; tenant: string | null; mission: Props["mission"] }) {
  const model = useMissionTargets(actor, tenant, mission.id), offset = model.offset;
  const key = `${actor}:${tenant}:${mission.id}`;
  const [editor, setEditor] = useState<Editor>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const add = useRef<HTMLButtonElement>(null);
  const closed = ["completed", "stopped"].includes(mission.state);
  const finish = async (attempt: TargetAttempt) => {
    const result = await model.run(attempt);
    if (!alive.current) return false;
    if (result?.kind === "verified") { setEditor(null); add.current?.focus(); return true; }
    return false;
  };
  const closeEditor = () => { setEditor(null); add.current?.focus(); };
  if (model.list.kind === "loading") return <section className="mgt" aria-label="Measured targets" aria-busy="true"><h4>Measured targets</h4><div className="sd-sk mgt-skeleton" /><span className="sr-only">Reading this Play's targets.</span></section>;
  if (model.list.kind !== "ready") return <section className="mgt" aria-label="Measured targets"><h4>Measured targets</h4><p><AlertTriangle />{model.list.kind === "refused" ? "Owner access is required to read this Play's targets." : "Targets could not be verified for this workspace."}</p><button className="sd-btn sd-btn-sm" onClick={() => void model.refresh(offset)}><RefreshCw /> Retry target read</button></section>;
  const locked = model.busy || !!model.pending || model.recoveryUnavailable;
  return <section className="mgt" aria-label="Measured targets">
    <div className="mgt-heading"><h4>Measured targets <span className="mgt-count">{model.list.totalCount}</span></h4>{!closed && <button ref={add} className="sd-btn sd-btn-sm" disabled={locked} onClick={() => setEditor({ key, target: null })}><Plus /> Add target</button>}</div>
    {model.notice && <p className="mgt-status" role="status">{model.notice}</p>}
    {model.receipt && <details className="mgt-receipt"><summary><Check /> Saved revision {model.receipt.revision} · {model.railRecorded ? "Activity recorded" : "Activity unconfirmed"}</summary><p>Receipt reference: <span>{model.receipt.id}</span></p></details>}
    {model.pending && <div className="mgt-recovery" role="status"><p>Your original target request is retained. Checking it uses the same request and original revisions.</p><button className="sd-btn sd-btn-sm" disabled={model.busy} onClick={() => void model.reconcile()}><RefreshCw />{model.busy ? "Checking original request" : "Check original request"}</button></div>}
    {model.recoveryUnavailable && <p className="ov-err" role="alert">Safe request recovery is unavailable. No new change will be sent.</p>}
    {editor?.key === key && actor && tenant && !model.pending && <MissionTargetEditor key={editor.target?.id ?? "new-target"} actorId={actor} tenantId={tenant} missionId={mission.id} missionRevision={mission.revision} target={editor.target} busy={locked} readMetric={model.readMetric} onSave={async attempt => { await finish(attempt); }} onCancel={closeEditor} />}
    {model.list.targets.length === 0 && !editor && <p className="mgt-empty">No measured targets on this Play yet. Add a target to compare it with a verified business measurement.</p>}
    <div className="mgt-list">{model.list.targets.map(target => <TargetRow key={`${key}:${target.id}:${target.revision}`} target={target} actual={model.actuals[target.id]} locked={locked} closed={closed}
      onEdit={() => setEditor({ key, target })} history={model.history} onTransition={async (state, reason) => {
        if (!actor || !tenant) return false;
        return finish({ version: 1, scope: { actorId: actor, tenantId: tenant, missionId: mission.id }, tool: "mission_target_transition",
          args: { request_key: crypto.randomUUID(), mission_id: mission.id, expected_mission_revision: mission.revision,
            target_id: target.id, expected_target_revision: target.revision, to_state: state, reason } });
      }} />)}</div>
    {(offset > 0 || model.list.hasMore) && <div className="mgt-actions" role="group" aria-label="Target pages"><button className="sd-btn sd-btn-sm" disabled={offset === 0 || model.busy} onClick={() => void model.refresh(Math.max(0, offset - 40))}>Previous targets</button><span>{offset + 1}–{offset + model.list.targets.length} of {model.list.totalCount}</span><button className="sd-btn sd-btn-sm" disabled={!model.list.hasMore || model.busy} onClick={() => void model.refresh(offset + 40)}>More targets</button></div>}
  </section>;
}

function TargetRow({ target, actual, locked, closed, onEdit, history, onTransition }: { target: MissionTarget; actual?: TargetActual; locked: boolean; closed: boolean; onEdit(): void;
  history(id: string, offset?: number): Promise<TargetHistory>; onTransition(state: MissionTarget["state"], reason: string): Promise<boolean> }) {
  const [change, setChange] = useState<MissionTarget["state"] | null>(null), [reason, setReason] = useState("");
  const [versions, setVersions] = useState<TargetHistory | null>(null), [historyOffset, setHistoryOffset] = useState(0);
  const rowTitle = useRef<HTMLHeadingElement>(null);
  const lifetime = useRef({ alive: true, historySequence: 0 });
  useEffect(() => { const instance = lifetime.current; instance.alive = true; return () => { instance.alive = false; instance.historySequence++; }; }, []);
  const evidence = actual?.kind === "ready" && Date.parse(actual.metric.reference_expires_at) > Date.now() ? actual : null;
  const observation = evidence?.observation;
  const comparable = observation?.state === "available" || observation?.state === "partial" ? observation : null;
  const attainment = comparable?.attainment === "met" ? comparable.period_complete ? "Target met" : "At target now"
    : comparable?.attainment === "not_met" ? target.comparison === "at_most" ? "Above limit" : target.comparison === "within_range" ? "Outside target range" : "Below target"
      : "Attainment unverified";
  const range = target.comparison === "within_range" ? `${display(target, target.desired_value)}–${display(target, target.upper_value!)}` : display(target, target.desired_value);
  const readHistory = async (offset = 0) => {
    const sequence = ++lifetime.current.historySequence;
    setHistoryOffset(offset); setVersions(null);
    const result = await history(target.id, offset);
    if (lifetime.current.alive && lifetime.current.historySequence === sequence) setVersions(result);
  };
  return <article className="mgt-row">
    <div className="mgt-heading"><h5 ref={rowTitle} tabIndex={-1}>{target.title}</h5><span className="mgt-state">{target.state} · revision {target.revision}</span></div>
    <p>{target.comparison === "at_least" ? "At least" : target.comparison === "at_most" ? "At most" : "Within"} <b>{range}</b></p>
    <p className="mgt-caption">{new Date(target.period.start).toLocaleDateString(undefined, { timeZone: target.period.time_zone })}–{new Date(Date.parse(target.period.end) - 1).toLocaleDateString(undefined, { timeZone: target.period.time_zone })} · {target.period.time_zone}</p>
    {target.state !== "active" ? <p className="mgt-caption">{target.state === "paused" ? "Target paused. Its saved definition and history remain available." : "Target retired. Its history is preserved."}</p>
      : actual === undefined ? <p className="mgt-caption" role="status">Checking the actual measurement.</p>
        : comparable ? <><dl className="mgt-values"><div><dt>Actual</dt><dd>{display(target, comparable.actual)}</dd></div><div><dt>Variance</dt><dd>{comparable.variance === null ? "Unverified" : display(target, comparable.variance)}</dd></div></dl><p className="mgt-caption">{attainment} · {comparable.state === "partial" ? "Partial coverage" : "Verified measurement"} · {instant(comparable.as_of)}</p></>
          : <p className="mgt-caption">{observation?.state === "unavailable" && observation.reason === "historical_snapshot_unavailable" ? "A current snapshot cannot verify this past period's actual." : "Actual unavailable. No zero or attainment is assumed."}</p>}
    {evidence && <details className="mgt-evidence"><summary>Measurement evidence</summary><p>{evidence.metric.definition}</p><p>Read {instant(evidence.metric.as_of)}. Coverage: {evidence.metric.coverage.contributing_count} of {evidence.metric.coverage.candidate_count} records; {evidence.metric.coverage.excluded_count} excluded.</p>{evidence.metric.caveats.map((item, index) => <p key={index}>{item}</p>)}</details>}
    <div className="mgt-actions">{!closed && target.state !== "retired" && <button className="sd-btn sd-btn-sm" disabled={locked} onClick={onEdit}><Pencil /> Revise target</button>}
      {!closed && target.state !== "retired" && <button className="sd-btn sd-btn-sm" disabled={locked} onClick={() => setChange(target.state === "paused" ? "active" : "paused")}>{target.state === "paused" ? <Play /> : <Pause />}{target.state === "paused" ? "Resume target" : "Pause target"}</button>}
      {target.state !== "retired" && <button className="sd-btn sd-btn-sm" disabled={locked} onClick={() => setChange("retired")}>Retire target</button>}
    </div>
    {change && <form className="mgt-transition" onSubmit={event => { event.preventDefault(); if (!reason.trim() || locked) return; void onTransition(change, reason.trim()).then(verified => { if (verified && lifetime.current.alive) { setChange(null); rowTitle.current?.focus(); } }); }}>
      <p>{change === "retired" ? "Retiring keeps the target and all its revisions in history. It cannot be resumed." : change === "paused" ? "Pause this target while preserving its definition and history." : "Resume this saved target. Its next actual will be read from business records."}</p>
      <label className="ov-field"><span>Reason for this change</span><textarea className="fin" required maxLength={1200} value={reason} disabled={locked} onChange={event => setReason(event.target.value)} /></label>
      <div className="mgt-actions"><button type="button" className="sd-btn sd-btn-sm" onClick={() => { setChange(null); rowTitle.current?.focus(); }}>Cancel</button><button type="submit" className="sd-btn sd-btn-sm sd-act" disabled={locked}>{change === "retired" ? "Retire and keep history" : change === "paused" ? "Pause target" : "Resume target"}</button></div>
    </form>}
    <details className="mgt-history" onToggle={event => { if (event.currentTarget.open && versions === null) void readHistory(); }}><summary><History /> Saved history</summary>
      {versions === null ? <p role="status">Reading saved revisions.</p> : versions.kind !== "ready" ? <p>History could not be verified. <button className="sd-btn sd-btn-sm" onClick={() => void readHistory(historyOffset)}>Retry history</button></p>
        : <><ol>{versions.versions.map(version => <li key={version.target.revision}><b>Revision {version.target.revision} · {version.target.state}</b><span>{version.target.title} · {display(version.target, version.target.desired_value)}</span><span>{version.reason}</span><time dateTime={version.at}>{instant(version.at)}</time>{version.receipt ? <details><summary>Saved receipt</summary><p>Receipt: {version.receipt.id}</p><p>Original request: {version.receipt.requestKey}</p><p>This verifies the saved target revision. Activity confirmation and business performance are separate.</p></details> : <span>Receipt could not be verified for this revision.</span>}</li>)}</ol>{(versions.hasMore || historyOffset > 0) && <div className="mgt-actions"><button className="sd-btn sd-btn-sm" disabled={historyOffset === 0} onClick={() => void readHistory(Math.max(0, historyOffset - 20))}>Newer revisions</button><span>{versions.totalCount} saved revisions</span><button className="sd-btn sd-btn-sm" disabled={!versions.hasMore} onClick={() => void readHistory(historyOffset + 20)}>Older revisions</button></div>}</>}
    </details>
  </article>;
}
