import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PlanItem, PlanItemStatus, PlanPriority } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { workStatusLabel } from "./operations-presentation";
import { submitOperationsWorkUpdate, type WorkUpdate } from "./operations-work-update";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";

// Canonical plan_list excludes cancelled work. Cancellation needs a separate
// authorized detail/history readback before it can be offered in this editor.
const STATUSES: PlanItemStatus[] = ["open", "in_progress", "blocked", "done"];
type Readback = { original: PlanItem; update: WorkUpdate; acknowledged: boolean };
type EditPhase = "idle" | "saving" | "reading" | "uncertain" | "refused";
type RetainedDraft = { status: PlanItemStatus; due: string; assignee: string; priority: PlanPriority;
  version?: string; phase: EditPhase; message: string; submittedUpdate: WorkUpdate | null };
// Ephemeral editor presentation only, scoped to the original actor/workspace/item.
// No storage, write receipts, or automatic replay; a remounted in-flight request is unknown.
const linkedDrafts = new Map<string, RetainedDraft>();

/** Manual edits of existing work. No dispatch, approval bypass or alternate record store. */
export function OperationsWorkEditor({ item, actorId, tenantId, members, refresh, sourceError, proposedStage,
  onNavigationGuardChange }: {
  item: PlanItem; actorId: string; tenantId: string; members: TeamMemberRecord[];
  refresh: () => Promise<void>; sourceError: boolean;
  proposedStage?: PlanItemStatus;
  onNavigationGuardChange?: (guard: (() => string | null) | null) => void;
  /** Compatibility with existing callers; every guarded draft now survives departure. */
  retainDraftOnLeave?: boolean;
}) {
  const draftKey = `${actorId}:${tenantId}:${item.id}`;
  const retained = useRef(linkedDrafts.get(draftKey)).current;
  const [staff, setStaff] = useState<boolean | null>(null);
  const [status, setStatus] = useState<PlanItemStatus>(retained?.status ?? (proposedStage && STATUSES.includes(proposedStage) ? proposedStage : item.status));
  const [due, setDue] = useState(retained?.due ?? "");
  const [assignee, setAssignee] = useState(retained?.assignee ?? item.assigned_to_user_id ?? "");
  const [priority, setPriority] = useState<PlanPriority>(retained?.priority ?? item.priority);
  const [phase, setPhase] = useState<EditPhase>(retained?.phase === "saving" || retained?.phase === "reading" ? "uncertain" : retained?.phase ?? "idle");
  const [message, setMessage] = useState(retained?.phase === "saving" || retained?.phase === "reading"
    ? "The earlier change is unconfirmed. Refresh current work before making another change." : retained?.message ?? "");
  const [confirming, setConfirming] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message && ["idle", "uncertain", "refused"].includes(phase)) feedbackRef.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  }, [message, phase]);
  const readback = useRef<Readback | null>(null);
  // An unsolicited refresh must not lend a newer version to an older draft.
  const draftVersion = useRef(retained ? retained.version : item.updated_at);
  const submittedUpdate = useRef<WorkUpdate | null>(retained?.submittedUpdate ?? null);
  const mounted = useRef(true);
  useEffect(() => {
    let current = true; mounted.current = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("is_tenant_admin", {
          _tenant: tenantId,
        });
        if (current) setStaff(!error && data === true);
      } catch { if (current) setStaff(false); }
    })();
    return () => { current = false; mounted.current = false; };
  }, [actorId, tenantId]);
  useEffect(() => {
    const expected = readback.current;
    if (phase !== "reading" || !expected) return;
    if (sourceError) { setPhase("uncertain"); setMessage("Current work couldn’t be read. Refresh before making another change."); return; }
    if (item === expected.original) return;
    const matches = (!expected.update.status || item.status === expected.update.status)
      && (!expected.update.priority || item.priority === expected.update.priority)
      && (!expected.update.assigneeId || item.assigned_to_user_id === expected.update.assigneeId)
      && (!expected.update.dueAt || new Date(item.due_at ?? "").getTime() === new Date(expected.update.dueAt).getTime());
    setPhase(matches ? "idle" : "uncertain");
    setMessage(matches ? (expected.acknowledged ? "Saved and confirmed in current work." : "Current work refreshed. Review the details before making another change.") : "Current work differs from the requested change. Review it before editing again.");
    if (matches) { setStatus(item.status); setPriority(item.priority); setAssignee(item.assigned_to_user_id ?? ""); setDue(""); draftVersion.current = item.updated_at; readback.current = null; }
  }, [item, phase, sourceError]);
  const creator = item.created_by === actorId;
  const canStatus = staff === true || creator || item.assigned_to_user_id === actorId;
  const canDate = staff === true || creator;
  const busy = phase !== "idle";
  const changed = status !== item.status || priority !== item.priority || Boolean(due) || assignee !== (item.assigned_to_user_id ?? "");
  const navigationReason = phase === "saving" || phase === "reading" ? "Finish checking this work change before leaving."
    : phase === "uncertain" ? "Refresh and review the unconfirmed work change before leaving."
    : phase === "refused" ? "Refresh and review the refused work change before leaving."
    : changed || confirming ? "Save or discard your unsaved work changes before leaving." : null;
  const navigationReasonRef = useRef(navigationReason);
  navigationReasonRef.current = navigationReason;
  useBeforeUnloadGuard(Boolean(navigationReason));
  useEffect(() => registerAccountSwitchGuard(() => {
    if (navigationReasonRef.current) { setMessage(navigationReasonRef.current); return false; }
    return true;
  }), []);
  useLayoutEffect(() => {
    onNavigationGuardChange?.(() => navigationReasonRef.current);
    return () => onNavigationGuardChange?.(null);
  }, [onNavigationGuardChange]);
  useLayoutEffect(() => {
    // Reuse the same scoped ephemeral presentation for ordinary and linked work.
    // Shell navigation may unmount before a route guard can run; it must not erase intent.
    if (navigationReason) linkedDrafts.set(draftKey, { status, due, assignee, priority, phase, message,
      version: draftVersion.current, submittedUpdate: submittedUpdate.current });
    else linkedDrafts.delete(draftKey);
  }, [draftKey, navigationReason, status, due, assignee, priority, phase, message]);
  async function save() {
    if (busy || staff === null || !canStatus || !changed || item.tenant_id !== tenantId) return;
    const update: WorkUpdate = {};
    if (status !== item.status) update.status = status;
    if (canDate && priority !== item.priority) update.priority = priority;
    if (due && canDate) {
      const date = new Date(due);
      if (Number.isNaN(date.getTime())) { setMessage("Choose a valid due date and time."); return; }
      update.dueAt = date.toISOString();
    }
    if (staff && assignee && assignee !== item.assigned_to_user_id) update.assigneeId = assignee;
    submittedUpdate.current = update;
    setPhase("saving"); setMessage("Saving your change…");
    const result = await submitOperationsWorkUpdate({ actorId, tenantId, itemId: item.id, expectedUpdatedAt: draftVersion.current }, update);
    if (!mounted.current) return;
    if (result.kind !== "acknowledged") { setPhase(result.kind); setMessage(result.message); return; }
    readback.current = { original: item, update, acknowledged: true }; setPhase("reading"); setMessage("Checking current work…");
    try { await refresh(); } catch {
      if (mounted.current) { setPhase("uncertain"); setMessage("Current work couldn’t be read. Refresh before making another change."); }
    }
  }
  async function recoverReadback() {
    readback.current = { original: item, update: {}, acknowledged: false };
    setPhase("reading"); setMessage("Reading current work…");
    try { await refresh(); } catch {
      if (mounted.current) { setPhase("uncertain"); setMessage("Current work couldn’t be read. Try refreshing again."); }
    }
  }
  if (item.status === "cancelled") return <div><p>This work is cancelled. You can inspect its recorded details and activity.</p>
    {navigationReason && <><p role="status">{message || navigationReason}</p>
      <button type="button" disabled={phase === "saving" || phase === "reading"} onClick={() => void recoverReadback()}>Refresh and review</button></>}
  </div>;
  if (staff === null) return <p role="status">Checking your edit permissions…</p>;
  if (!canStatus) return <p>You can inspect this work. Its responsible person or an authorized manager can update it.</p>;
  if (!item.updated_at) return <p>This work’s current version is unavailable. Refresh before editing.</p>;
  return <form className="ops-work-editor" onSubmit={(event) => {
    event.preventDefault();
    if (busy || !changed) return;
    if (status !== item.status || assignee !== (item.assigned_to_user_id ?? "")) setConfirming(true);
    else void save();
  }}>
    <h2>Update this work</h2>
    <label>Status<select value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as PlanItemStatus)}>
      {STATUSES.map(value => <option key={value} value={value}>{workStatusLabel(value)}</option>)}
    </select></label>
    {canDate && <label>New due date and time<input type="datetime-local" value={due} disabled={busy} onChange={(event) => setDue(event.target.value)} /></label>}
    {canDate && <label>Priority<select aria-label="Priority" value={priority} disabled={busy} onChange={event => setPriority(event.target.value as PlanPriority)}>{["low", "normal", "high", "urgent"].map(value => <option key={value}>{value}</option>)}</select></label>}
    {staff && <label>Responsible person<select value={assignee} disabled={busy} onChange={(event) => setAssignee(event.target.value)}>
      {!members.some(member => member.user_id === assignee) && <option value={assignee}>{assignee ? "Current member unavailable" : "Unassigned"}</option>}
      {members.map(member => <option key={member.user_id} value={member.user_id}>{member.full_name ?? member.email ?? "Team member"}</option>)}
    </select></label>}
    <button type="submit" disabled={busy || !changed}>Save change</button>
    {!busy && changed && <button type="button" onClick={() => {
      setStatus(item.status); setPriority(item.priority); setAssignee(item.assigned_to_user_id ?? ""); setDue("");
      draftVersion.current = item.updated_at; submittedUpdate.current = null; setMessage("Unsaved changes discarded.");
    }}>Discard unsaved changes</button>}
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm this work change</AlertDialogTitle>
          <AlertDialogDescription>
            {status !== item.status && <span>Stage: {workStatusLabel(item.status)} → {workStatusLabel(status)}. </span>}
            {assignee !== (item.assigned_to_user_id ?? "") && <span>Responsibility will move to {members.find(member => member.user_id === assignee)?.full_name ?? "the selected team member"}. </span>}
            {due && <span>The due date will also change. </span>}
            {priority !== item.priority && <span>Priority: {item.priority} → {priority}. </span>}
            The change is saved only after permission checks and confirmed by reading current work.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Confirm change</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {message && <div ref={feedbackRef}><p role="status">{message}</p>
    {(phase === "uncertain" || phase === "refused") && <button type="button" onClick={() => void recoverReadback()}>Refresh and review</button>}</div>}
  </form>;
}
