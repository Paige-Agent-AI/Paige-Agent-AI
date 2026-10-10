import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PlanItem, PlanItemStatus } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { workStatusLabel } from "./operations-presentation";
import { submitOperationsWorkUpdate, type WorkUpdate } from "./operations-work-update";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

// Canonical plan_list excludes cancelled work. Cancellation needs a separate
// authorized detail/history readback before it can be offered in this editor.
const STATUSES: PlanItemStatus[] = ["open", "in_progress", "blocked", "done"];
type Readback = { original: PlanItem; update: WorkUpdate; acknowledged: boolean };

/** Manual edits of existing work. No dispatch, approval bypass or alternate record store. */
export function OperationsWorkEditor({ item, actorId, tenantId, members, refresh, sourceError }: {
  item: PlanItem; actorId: string; tenantId: string; members: TeamMemberRecord[];
  refresh: () => Promise<void>; sourceError: boolean;
}) {
  const [staff, setStaff] = useState<boolean | null>(null);
  const [status, setStatus] = useState<PlanItemStatus>(item.status);
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(item.assigned_to_user_id ?? "");
  const [phase, setPhase] = useState<"idle" | "saving" | "reading" | "uncertain" | "refused">("idle");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message && ["idle", "uncertain", "refused"].includes(phase)) feedbackRef.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  }, [message, phase]);
  const readback = useRef<Readback | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    let current = true; mounted.current = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("has_any_role", {
          _user_id: actorId, _roles: ["admin", "super_admin", "coach"],
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
      && (!expected.update.assigneeId || item.assigned_to_user_id === expected.update.assigneeId)
      && (!expected.update.dueAt || new Date(item.due_at ?? "").getTime() === new Date(expected.update.dueAt).getTime());
    setPhase(matches ? "idle" : "uncertain");
    setMessage(matches ? (expected.acknowledged ? "Saved and confirmed in current work." : "Current work refreshed. Review the details before making another change.") : "Current work differs from the requested change. Review it before editing again.");
    if (matches) { setStatus(item.status); setAssignee(item.assigned_to_user_id ?? ""); setDue(""); readback.current = null; }
  }, [item, phase, sourceError]);
  const creator = item.created_by === actorId;
  const canStatus = staff === true || creator || item.assigned_to_user_id === actorId;
  const canDate = staff === true || creator;
  const busy = phase !== "idle";
  const changed = status !== item.status || Boolean(due) || assignee !== (item.assigned_to_user_id ?? "");
  async function save() {
    if (busy || staff === null || !canStatus || !changed || item.tenant_id !== tenantId) return;
    const update: WorkUpdate = {};
    if (status !== item.status) update.status = status;
    if (due && canDate) {
      const date = new Date(due);
      if (Number.isNaN(date.getTime())) { setMessage("Choose a valid due date and time."); return; }
      update.dueAt = date.toISOString();
    }
    if (staff && assignee && assignee !== item.assigned_to_user_id) update.assigneeId = assignee;
    setPhase("saving"); setMessage("Saving your change…");
    const result = await submitOperationsWorkUpdate({ actorId, tenantId, itemId: item.id }, update);
    if (!mounted.current) return;
    if (result.kind !== "acknowledged") { setPhase(result.kind); setMessage(result.message); return; }
    readback.current = { original: item, update, acknowledged: true }; setPhase("reading"); setMessage("Checking current work…");
    try { await refresh(); } catch {
      if (mounted.current) { setPhase("uncertain"); setMessage("Current work couldn’t be read. Refresh before making another change."); }
    }
  }
  if (staff === null) return <p role="status">Checking your edit permissions…</p>;
  if (!canStatus) return <p>You can inspect this work. Its responsible person or an authorized manager can update it.</p>;
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
    {staff && <label>Responsible person<select value={assignee} disabled={busy} onChange={(event) => setAssignee(event.target.value)}>
      {!members.some(member => member.user_id === assignee) && <option value={assignee}>{assignee ? "Current member unavailable" : "Unassigned"}</option>}
      {members.map(member => <option key={member.user_id} value={member.user_id}>{member.full_name ?? member.email ?? "Team member"}</option>)}
    </select></label>}
    <button type="submit" disabled={busy || !changed}>Save change</button>
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm this work change</AlertDialogTitle>
          <AlertDialogDescription>
            {status !== item.status && <span>Stage: {workStatusLabel(item.status)} → {workStatusLabel(status)}. </span>}
            {assignee !== (item.assigned_to_user_id ?? "") && <span>Responsibility will move to {members.find(member => member.user_id === assignee)?.full_name ?? "the selected team member"}. </span>}
            {due && <span>The due date will also change. </span>}
            The change is saved only after permission checks and confirmed by reading current work.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Confirm change</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {message && <div ref={feedbackRef}><p role="status">{message}</p>
    {(phase === "uncertain" || phase === "refused") && <button type="button" onClick={async () => {
      readback.current = { original: item, update: {}, acknowledged: false };
      setPhase("reading"); setMessage("Reading current work…");
      try { await refresh(); } catch {
        if (mounted.current) { setPhase("uncertain"); setMessage("Current work couldn’t be read. Try refreshing again."); }
      }
    }}>Refresh and review</button>}</div>}
  </form>;
}
