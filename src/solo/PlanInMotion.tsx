import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, Check, CirclePause, Flag, Info, Pencil, Play, RefreshCw, Sparkles, SquareCheck, X } from "lucide-react";
import type { BusinessMissionDetail, MissionBriefInput, MissionOutcome, MissionState } from "@/types/businessMission";
import { setPaigeBusinessPlanScope } from "./paigeClientScope";
import { clearPaigePublicPresenceScope } from "./paigePublicPresenceScope";
import { createRequestKeyKeeper } from "./mission-retry";
import { useBusinessGamePlanMissions, type StrategicPlay } from "./data/useBusinessGamePlanMissions";
import { MissionTargetsPanel } from "./MissionTargetsPanel";
import { useOptionalTenantContext } from "@/hooks/useTenantContext";

type Props = { workspaceId?: string | null; openPaige?: () => void; onNotice?: (message: string) => void;
  selectedPlayId?: string | null; onSelectPlay?: (id: string) => void; onClosePlay?: () => void };
type Form = MissionBriefInput & { revisionReason: string };
type PendingAction = "decline" | "pause" | "block" | "complete" | "archive" | null;

const emptyForm = (): Form => ({
  title: "", desiredOutcome: "", deadlineOn: null, baseline: "", strategy: "",
  constraints: [], successDefinition: "", ownerAuthority: "", assumptions: [],
  missingInformation: [], nextAction: null, revisionReason: "",
});
const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const text = (value: string | null | undefined) => value?.trim() || "";
const friendlyError = (code?: string | null) =>
  code === "MISSION_OWNER_REQUIRED" ? "Only the verified Solo owner can change strategic plays."
  : code === "ACTIVE_ACCOUNT_CHANGED" ? "Your workspace changed. Reopen this play from the active workspace."
  : code === "MISSION_REVISION_CONFLICT" ? "This play changed elsewhere. The latest version has been reloaded."
  : code === "MISSION_CLOSED" ? "This play is closed and can no longer be revised."
  : "The change could not be verified. Nothing is being shown as complete.";

function formFrom(detail: BusinessMissionDetail): Form {
  return {
    title: detail.mission.title,
    desiredOutcome: detail.brief.desired_outcome,
    deadlineOn: detail.brief.deadline_on,
    baseline: detail.brief.baseline,
    strategy: detail.brief.strategy,
    constraints: detail.brief.constraints,
    successDefinition: detail.brief.success_definition,
    ownerAuthority: detail.brief.owner_authority,
    assumptions: detail.brief.assumptions,
    missingInformation: detail.brief.missing_information,
    nextAction: detail.mission.next_action,
    revisionReason: "",
  };
}

export function PlanInMotion(props: Props) {
  const context = useOptionalTenantContext();
  const allowed = context?.accountContextStatus === "ready" && !context.loading && !!context.activeUserId
    && !!props.workspaceId && context.activeTenantId === props.workspaceId;
  // Retire the entire drawer lifetime synchronously, including an A-B-A switch.
  // RPCs still decide authority; context only narrows which record can render.
  return <ScopedPlanInMotion key={`${context?.activeUserId}:${context?.activeTenantId}:${allowed}`}
    {...props} workspaceId={allowed ? props.workspaceId : null} />;
}
function ScopedPlanInMotion({ workspaceId, openPaige, onNotice, selectedPlayId, onSelectPlay, onClosePlay }: Props) {
  const brain = useBusinessGamePlanMissions(workspaceId);
  const lifetime = useRef({ alive: true, read: 0 });
  useEffect(() => {
    const instance = lifetime.current;
    instance.alive = true;
    return () => { instance.alive = false; instance.read++; };
  }, []);
  const [selected, setSelected] = useState<BusinessMissionDetail | null>(null);
  const [drawer, setDrawer] = useState<"view" | "create" | "edit" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<MissionOutcome>("achieved");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PR-B: outcome-unknown is its own state, never an ordinary failure. The
  // banner offers reconciliation of the SAME request, not a fresh write.
  const [unknown, setUnknown] = useState<string | null>(null);
  // The transition target of the most recent attempt, for reconcile() when
  // Approve/Resume skipped the pending-confirm step.
  const [lastToState, setLastToState] = useState<MissionState | null>(null);
  const saveKeeper = useRef(createRequestKeyKeeper());
  const transitionKeeper = useRef(createRequestKeyKeeper());
  const opener = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  const visible = useMemo(() => brain.items.filter((item) => item.state !== "stopped"), [brain.items]);
  const archived = useMemo(() => brain.items.filter((item) => item.state === "stopped"), [brain.items]);

  useEffect(() => {
    if (!drawer) {
      opener.current?.focus();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        lifetime.current.read++;
        setBusy(false); setDrawer(null); setSelected(null); setPending(null); setError(null); setUnknown(null);
        onClosePlay?.();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = closeButton.current?.closest<HTMLElement>('[role="dialog"]');
      const focusable = dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')] : [];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawer, onClosePlay]);

  const close = () => { lifetime.current.read++; setBusy(false); setDrawer(null); setSelected(null); setPending(null); setError(null); setUnknown(null); onClosePlay?.(); };
  const openCreate = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!workspaceId) return;
    lifetime.current.read++;
    opener.current = event.currentTarget;
    setForm(emptyForm());
    setError(null);
    setUnknown(null);
    setDrawer("create");
  };
  const getDetail = brain.getDetail;
  const routeSelection = useRef<string | null>(null);
  const readPlay = useCallback(async (id: string) => {
    const read = ++lifetime.current.read;
    setDrawer("view");
    setSelected(null);
    setError(null);
    setUnknown(null);
    try { const detail = await getDetail(id); if (lifetime.current.alive && lifetime.current.read === read) setSelected(detail); }
    catch (caught) { if (lifetime.current.alive && lifetime.current.read === read) setError(caught instanceof Error && caught.message === 'MISSION_OWNER_REQUIRED'
      ? 'Only the verified Solo owner can read this Play.' : 'This Play could not be verified in the current workspace.'); }
  }, [getDetail]);
  useEffect(() => {
    const previous = routeSelection.current;
    routeSelection.current = selectedPlayId ?? null;
    if (!workspaceId || !selectedPlayId) {
      if (previous) {
        lifetime.current.read++;
        setBusy(false); setDrawer(null); setSelected(null); setPending(null); setError(null); setUnknown(null);
      }
      return;
    }
    const instance = lifetime.current;
    void readPlay(selectedPlayId);
    return () => { instance.read++; };
  }, [workspaceId, selectedPlayId, readPlay]);
  const openPlay = async (play: StrategicPlay, event: React.MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    if (onSelectPlay && selectedPlayId !== play.id) { onSelectPlay(play.id); return; }
    await readPlay(play.id);
  };
  const planWithPaige = (play?: StrategicPlay | BusinessMissionDetail["mission"]) => {
    if (!workspaceId) return;
    clearPaigePublicPresenceScope();
    setPaigeBusinessPlanScope({
      tenantId: workspaceId,
      surface: "business_game_plan",
      businessMissionId: play?.id ?? null,
      label: play?.title ?? "Business Game Plan",
    });
    openPaige?.();
  };

  const finish = async (result: Awaited<ReturnType<typeof brain.mutate>>, success: string, expectedRead: number) => {
    const current = () => lifetime.current.alive && lifetime.current.read === expectedRead;
    if (!current()) return false;
    if (!result.ok) {
      if (result.outcomeUnknown) {
        // Outcome unknown ≠ failure: the write may have landed and only its
        // confirmation was lost. Keep the drawer open, show the reconcile
        // state, and RETAIN the request key so the next attempt replays the
        // original operation (the backend receipt reconciles it) instead of
        // executing a second independent write.
        setError(null);
        setUnknown("We couldn't confirm whether that change completed. Nothing new will be sent — the next check reconciles the original request before anything else happens.");
        return false;
      }
      setUnknown(null);
      setError(friendlyError(result.code));
      if (result.code === "MISSION_REVISION_CONFLICT") await brain.refresh();
      return false;
    }
    setUnknown(null);
    setLastToState(null);
    onNotice?.(result.railRecorded ? success : success + " The saved change is verified, but its Rail receipt is not yet confirmed.");
    if (result.missionId) {
      try { const detail = await brain.getDetail(result.missionId); if (current()) setSelected(detail); }
      catch { if (current()) setSelected(null); }
    }
    if (!current()) return false;
    setPending(null);
    setReason("");
    return true;
  };

  const save = async () => {
    if (busy) return;
    if (![form.title, form.desiredOutcome, form.baseline, form.strategy, form.successDefinition, form.ownerAuthority].every((value) => text(value))) {
      setError("Complete the title, outcome, starting point, approach, success criteria, and authority notes.");
      return;
    }
    if (drawer === "edit" && !text(form.revisionReason)) {
      setError("Add a short reason for this revision.");
      return;
    }
    setBusy(true); setError(null);
    const payload = {
      title: form.title,
      desired_outcome: form.desiredOutcome,
      deadline_on: form.deadlineOn,
      baseline: form.baseline,
      strategy: form.strategy,
      constraints: form.constraints,
      success_definition: form.successDefinition,
      owner_authority: form.ownerAuthority,
      assumptions: form.assumptions,
      missing_information: form.missingInformation,
      next_action: text(form.nextAction) || null,
      ...(drawer === "edit" && selected ? {
        mission_id: selected.mission.id,
        expected_revision: selected.mission.revision,
        revision_reason: form.revisionReason,
      } : {}),
    };
    // One logical intent = one stable request key. An unchanged payload
    // after an outcome-unknown reuses the ORIGINAL key, so the backend
    // replays the existing operation; changed content is a new intent and
    // gets a new key. Success settles the identity.
    const keyDecision = saveKeeper.current.keyFor(JSON.stringify(payload));
    if (!keyDecision.reused) setUnknown(null);
    const args = { ...payload, request_key: keyDecision.key };
    const read = lifetime.current.read;
    const result = await brain.mutate(drawer === "edit" ? "mission_revise" : "mission_create", args);
    const ok = await finish(result, drawer === "edit" ? "Strategic play revised and verified." : "Draft strategic play created and verified.", read);
    if (!lifetime.current.alive || lifetime.current.read !== read) return;
    if (ok) { saveKeeper.current.settle(); setDrawer("view"); }
    setBusy(false);
  };

  const transition = async (toState: MissionState) => {
    if (!selected || busy) return;
    setLastToState(toState);
    const isClosing = toState === "completed" || toState === "stopped";
    if (isClosing && !text(reason) && !(selected.mission.state === "completed" && toState === "stopped")) {
      setError(toState === "completed" ? "Record the truthful outcome before completing this play." : "Add a reason so the history remains useful.");
      return;
    }
    const preservingCompletion = selected.mission.state === "completed" && toState === "stopped";
    const payload = {
      mission_id: selected.mission.id,
      expected_revision: selected.mission.revision,
      to_state: toState,
      reason: text(reason) || null,
      closure_outcome: preservingCompletion ? selected.mission.closure_outcome : isClosing ? (toState === "stopped" ? "stopped" : outcome) : null,
      outcome_summary: preservingCompletion ? selected.mission.outcome_summary : isClosing ? reason.trim() : null,
      outcome_unknowns: preservingCompletion ? selected.mission.outcome_unknowns : null,
    };
    // Same stable-identity contract as save(): an outcome-unknown retry
    // reconciles the original transition under its original key.
    const keyDecision = transitionKeeper.current.keyFor(JSON.stringify(payload));
    if (!keyDecision.reused) setUnknown(null);
    const args = { ...payload, request_key: keyDecision.key };
    setBusy(true); setError(null);
    const read = lifetime.current.read;
    const result = await brain.mutate("mission_transition", args);
    const ok = await finish(result, toState === "active" ? "Strategic play is active and verified."
      : toState === "paused" ? "Strategic play paused and verified."
      : toState === "blocked" ? "Blocker recorded and verified."
      : toState === "completed" ? "Outcome recorded and completion verified."
      : "Strategic play archived with its history preserved.", read);
    if (!lifetime.current.alive || lifetime.current.read !== read) return;
    if (ok) transitionKeeper.current.settle();
    setBusy(false);
  };

  const beginEdit = () => {
    if (!selected) return;
    setForm(formFrom(selected));
    setPending(null);
    setError(null);
    setUnknown(null);
    setDrawer("edit");
  };

  // Reconcile = re-attempt the SAME operation under its ORIGINAL request key
  // (the keepers retain it while the payload is unchanged), so the backend
  // replays the existing receipt instead of writing a second time. Approve and
  // Resume call transition("active") directly without a pending confirm step,
  // so the last attempted transition target is remembered for this mapping —
  // otherwise Check again would be a dead button after an ambiguous
  // Approve/Resume (adversarial review finding).
  const reconcile = () => {
    if (drawer === "create" || drawer === "edit") return void save();
    const toState: MissionState | null = pending === "pause" ? "paused"
      : pending === "block" ? "blocked"
      : pending === "complete" ? "completed"
      : pending === "decline" || pending === "archive" ? "stopped"
      : pending ? null
      : lastToState;
    if (toState) void transition(toState);
  };

  return (
    <>
      <section className="sd-card pim" aria-labelledby="plan-in-motion-title">
        <div className="sd-card-hd pim-head">
          <div><span className="sd-eyebrow"><Flag /> Plan in Motion</span><p>Strategic plays you can revisit, approve, pause, and verify.</p></div>
          <button className="sd-btn sd-btn-sm" disabled={!workspaceId || brain.status !== "ready"} onClick={openCreate}>Add play</button>
        </div>
        {brain.status === "loading" && <div className="pim-state" aria-busy="true"><RefreshCw className="pim-spin" /> Loading strategic plays.</div>}
        {brain.status === "forbidden" && <div className="pim-state"><AlertTriangle /><span><b>Owner access required.</b> This workspace does not grant you permission to change strategic plays.</span></div>}
        {brain.status === "error" && <div className="pim-state"><AlertTriangle /><span><b>Couldn't load strategic plays.</b> No plan state is being assumed.</span><button className="sd-btn sd-btn-sm" onClick={brain.refresh}>Retry</button></div>}
        {brain.status === "ready" && visible.length === 0 && (
          <div className="pim-empty"><Sparkles /><h3>No strategic plays yet</h3><p>Create a draft yourself or shape one with Paige. Nothing becomes active without the existing owner-authority rules.</p><div><button className="sd-btn sd-act sd-btn-sm" onClick={openCreate}>Create a draft</button><button className="sd-btn sd-btn-sm" onClick={() => planWithPaige()}>Plan with Paige</button></div></div>
        )}
        {brain.status === "ready" && visible.map((play) => (
          <button key={play.id} className="pim-card" onClick={(event) => void openPlay(play, event)}>
            <span className="pim-card-top"><b>{play.title}</b><span className={"pim-stage pim-stage-" + play.state}>{play.stageLabel}</span></span>
            <span className="pim-meta"><span><small>Horizon</small>{play.horizonLabel}</span><span><small>Next owner</small>{play.nextOwner}</span></span>
            <span className="pim-line"><small>Desired outcome</small>{play.desired_outcome}</span>
            <span className="pim-line"><small>Next meaningful step</small>{play.next_action || "Not set"}</span>
            {play.blocker && <span className="pim-blocker"><AlertTriangle />{play.blocker}</span>}
          </button>
        ))}
        {brain.status === "ready" && archived.length > 0 && <details className="pim-archive"><summary>Archived plays ({archived.length})</summary>{archived.map((play) => <button key={play.id} onClick={(event) => void openPlay(play, event)}><Archive /> <span>{play.title}</span><small>{play.horizonLabel}</small></button>)}</details>}
      </section>

      {drawer && (
        <div className="ov-scrim" data-kind="drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="ov-sheet" role="dialog" aria-modal="true" aria-label={drawer === "create" ? "Create strategic play" : selected?.mission.title || "Strategic play"}>
            <div className="ov-hd"><span className="oh-ic"><Flag /></span><div><h3>{drawer === "create" ? "Create strategic play" : selected?.mission.title || "Loading strategic play"}</h3><div className="oh-sub">Business Game Plan - canonical record</div></div><button ref={closeButton} className="oh-x" aria-label="Close" onClick={close}><X /></button></div>
            {(drawer === "create" || drawer === "edit") ? (
              <>
                <div className="ov-body">
                  <div className="ov-note"><Info /><span>This saves as a governed plan record. A successful message appears only after canonical readback; Rail confirmation is reported separately.</span></div>
                  <Field label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
                  <Field label="Desired outcome" value={form.desiredOutcome} onChange={(value) => setForm({ ...form, desiredOutcome: value })} area />
                  <Field label="Horizon date" value={form.deadlineOn || ""} onChange={(value) => setForm({ ...form, deadlineOn: value || null })} type="date" />
                  <Field label="Starting point" value={form.baseline} onChange={(value) => setForm({ ...form, baseline: value })} area />
                  <Field label="Approach" value={form.strategy} onChange={(value) => setForm({ ...form, strategy: value })} area />
                  <Field label="Success criteria" value={form.successDefinition} onChange={(value) => setForm({ ...form, successDefinition: value })} area />
                  <Field label="Next meaningful step" value={form.nextAction || ""} onChange={(value) => setForm({ ...form, nextAction: value || null })} area />
                  <Field label="Constraints (one per line)" value={form.constraints.join("\n")} onChange={(value) => setForm({ ...form, constraints: lines(value) })} area />
                  <Field label="How Paige may help - not a grant of authority" value={form.ownerAuthority} onChange={(value) => setForm({ ...form, ownerAuthority: value })} area />
                  <Field label="Assumptions (one per line)" value={form.assumptions.join("\n")} onChange={(value) => setForm({ ...form, assumptions: lines(value) })} area />
                  <Field label="Missing information (one per line)" value={form.missingInformation.join("\n")} onChange={(value) => setForm({ ...form, missingInformation: lines(value) })} area />
                  {drawer === "edit" && <Field label="Why this changed" value={form.revisionReason} onChange={(value) => setForm({ ...form, revisionReason: value })} />}
                  {error && <div className="ov-err" role="alert">{error}</div>}
                </div>
                <div className="ov-foot"><button className="sd-btn sd-btn-sm" onClick={close}>Cancel</button><button className="sd-btn sd-btn-sm sd-act" disabled={busy} onClick={() => void save()}><Check />{busy ? "Verifying." : drawer === "edit" ? "Save revision" : "Save draft"}</button></div>
              </>
            ) : !selected ? (
              <div className="ov-body">{error ? <div className="sd-errbox"><AlertTriangle /><p>{error}</p>{selectedPlayId && <button className="sd-btn sd-btn-sm" onClick={() => void readPlay(selectedPlayId)}>Retry Play read</button>}</div> : <div className="pim-state" aria-busy="true">Loading the canonical play.</div>}</div>
            ) : (
              <PlayDetail workspaceId={workspaceId} detail={selected} pending={pending} setPending={setPending} reason={reason} setReason={setReason} outcome={outcome} setOutcome={setOutcome} error={error} busy={busy} onEdit={beginEdit} onPaige={() => planWithPaige(selected.mission)} onTransition={transition} />
            )}
            {unknown && (
              <div className="ov-err pim-reconcile" data-mission-reconcile role="status" aria-live="polite">
                <AlertTriangle />
                <span>
                  <b>We couldn&apos;t confirm whether that change completed.</b> {unknown}
                </span>
                <button className="sd-btn sd-btn-sm" disabled={busy} onClick={reconcile}><RefreshCw /> Check again</button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function PlayDetail({ workspaceId, detail, pending, setPending, reason, setReason, outcome, setOutcome, error, busy, onEdit, onPaige, onTransition }: {
  workspaceId?: string | null;
  detail: BusinessMissionDetail; pending: PendingAction; setPending: (value: PendingAction) => void; reason: string; setReason: (value: string) => void;
  outcome: MissionOutcome; setOutcome: (value: MissionOutcome) => void; error: string | null; busy: boolean; onEdit: () => void; onPaige: () => void; onTransition: (state: MissionState) => void;
}) {
  const state = detail.mission.state;
  const proposed = state === "proposed";
  return <><div className="ov-body">
    <div className="pim-detail-stage">{proposed && detail.mission.request_source === "paige_chat" ? "Awaiting owner approval" : state === "stopped" ? "Archived" : state === "completed" ? "Complete" : state[0].toUpperCase() + state.slice(1)} - revision {detail.mission.revision}</div>
    <MissionTargetsPanel workspaceId={workspaceId} mission={detail.mission} />
    <Fact label="Desired outcome" value={detail.brief.desired_outcome} /><Fact label="Horizon" value={detail.brief.deadline_on || "Open horizon"} /><Fact label="Starting point" value={detail.brief.baseline} /><Fact label="Approach" value={detail.brief.strategy} /><Fact label="Success criteria" value={detail.brief.success_definition} /><Fact label="Next meaningful step" value={detail.mission.next_action || "Not set"} /><Fact label="Next owner" value="Owner" />
    {state === "blocked" && detail.mission.state_reason && <div className="pim-blocker"><AlertTriangle />{detail.mission.state_reason}</div>}
    {(state === "completed" || state === "stopped") && detail.mission.outcome_summary && <Fact label="Recorded outcome" value={detail.mission.outcome_summary} />}
    <div className="ov-note"><Info /><span>Source: canonical Business Game Plan record, revision {detail.mission.revision}. Mind and durable Memory are unavailable for this play.</span></div>
    {pending && <div className="pim-confirm">
      <Field label={pending === "complete" ? "Truthful outcome summary" : pending === "block" ? "What is blocking this play?" : "Reason"} value={reason} onChange={setReason} area />
      {pending === "complete" && <label className="ov-field"><span>Outcome</span><select className="fin" value={outcome} onChange={(event) => setOutcome(event.target.value as MissionOutcome)}><option value="achieved">Achieved</option><option value="partly_achieved">Partly achieved</option><option value="blocked">Blocked</option></select></label>}
      <div className="pim-confirm-actions"><button className="sd-btn sd-btn-sm" onClick={() => setPending(null)}>Cancel</button><button className="sd-btn sd-btn-sm sd-act" disabled={busy} onClick={() => onTransition(pending === "pause" ? "paused" : pending === "block" ? "blocked" : pending === "complete" ? "completed" : "stopped")}>{busy ? "Verifying." : "Confirm"}</button></div>
    </div>}
    {error && <div className="ov-err" role="alert">{error}</div>}
  </div>
  <div className="ov-foot">
    <button className="sd-btn sd-btn-sm" onClick={onPaige}><Sparkles /> Plan with Paige</button>
    {!["completed", "stopped"].includes(state) && <button className="sd-btn sd-btn-sm" onClick={onEdit}><Pencil /> Revise</button>}
    {proposed && <><button className="sd-btn sd-btn-sm" onClick={() => setPending("decline")}>Decline</button><button className="sd-btn sd-btn-sm sd-act" disabled={busy} onClick={() => onTransition("active")}><Play /> Approve</button></>}
    {(state === "paused" || state === "blocked") && <button className="sd-btn sd-btn-sm sd-act" disabled={busy} onClick={() => onTransition("active")}><Play /> Resume</button>}
    {state === "active" && <><button className="sd-btn sd-btn-sm" onClick={() => setPending("pause")}><CirclePause /> Pause</button><button className="sd-btn sd-btn-sm" onClick={() => setPending("block")}><AlertTriangle /> Blocked</button><button className="sd-btn sd-btn-sm" onClick={() => setPending("complete")}><SquareCheck /> Complete</button></>}
    {(state === "paused" || state === "blocked") && <button className="sd-btn sd-btn-sm" onClick={() => setPending("complete")}><SquareCheck /> Complete</button>}
    {state !== "stopped" && <button className="sd-btn sd-btn-sm" onClick={() => setPending("archive")}><Archive /> Archive</button>}
  </div></>;
}

function Field({ label, value, onChange, area = false, type = "text" }: { label: string; value: string; onChange: (value: string) => void; area?: boolean; type?: string }) {
  return <label className="ov-field"><span>{label}</span>{area ? <textarea className="fin" value={value} onChange={(event) => onChange(event.target.value)} /> : <input className="fin" type={type} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div className="sd-fact"><span className="fl">{label}</span><span className="fv">{value}</span></div>; }
