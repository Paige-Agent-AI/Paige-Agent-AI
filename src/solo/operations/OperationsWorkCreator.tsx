import { useEffect, useRef, useState } from "react";
import type { Plan, PlanPriority } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { supabase } from "@/integrations/supabase/client";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { OperationsAssignee } from "./OperationsAssignee";
import { createOperationsWork, type WorkCreationResult } from "./operations-work-create";

/**
 * `contact` (E09 Slice 3): opened from a client's record, the task is created FOR that client — the
 * client is fixed, shown as a chip, and passed to the scoped writer as `contactId`, whose readback
 * already proves `contact_id`. The new task is private to the team; sharing it with the client is a
 * separate, explicit act on the record (owner decision D2), and the sheet says so before anything is
 * typed. `firstName` is how the sentence names them ("…share it with Jordan."); the chip keeps the
 * full name. Without `contact`, nothing changes.
 *
 * The submit button is named for what the flow does — it creates the task, after one confirming
 * review — rather than "Review task", which read as if nothing would be saved.
 */
export function OperationsWorkCreator({ actorId, tenantId, members, plans, theme, onClose, onCreated, onRecover, invoker, contact }: {
  actorId: string; tenantId: string; members: TeamMemberRecord[]; plans: Plan[];
  theme: string; onClose: () => void; onCreated: () => Promise<void>;
  onRecover: (itemId?: string) => Promise<void>;
  invoker?: HTMLElement | null;
  contact?: { id: string; name: string; firstName?: string };
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [assigneeId, setAssigneeId] = useState(actorId);
  const [planId, setPlanId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [priority, setPriority] = useState<PlanPriority>("normal");
  const [due, setDue] = useState("");
  const [staff, setStaff] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [result, setResult] = useState<WorkCreationResult | null>(null);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  const submitted = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const dirty = Boolean(title || summary || due || planId || assigneeId !== actorId || priority !== "normal");
  const locked = busy || result?.kind === "uncertain" || result?.kind === "verified";
  useBeforeUnloadGuard(busy || (dirty && result?.kind !== "verified"));
  useEffect(() => {
    mounted.current = true;
    let current = true;
    setStaff(null);
    void supabase.rpc("is_tenant_admin", { _tenant: tenantId })
      .then(({ data, error }) => { if (current) setStaff(!error && data === true); }, () => { if (current) setStaff(false); });
    return () => { current = false; mounted.current = false; };
  }, [actorId, tenantId]);
  useEffect(() => registerAccountSwitchGuard(() => {
    if (busy || (dirty && result?.kind !== "verified")) {
      setNotice("Finish or discard this task draft before switching workspaces."); return false;
    }
    return true;
  }), [busy, dirty, result]);
  useEffect(() => { if (notice || result) feedback.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" }); }, [notice, result]);
  const eligible = members.filter(member => member.status === "active" && (staff === true || member.user_id === actorId));
  const person = eligible.find(member => member.user_id === assigneeId);
  const project = plans.find(plan => plan.id === planId);
  const milestones = project?.items.filter(item => item.item_type === "milestone" && item.status !== "cancelled") ?? [];
  const requestClose = () => {
    if (busy) { setNotice("Wait for the save result before closing this task."); return; }
    if (dirty && result?.kind !== "verified") setDiscarding(true); else onClose();
  };
  const save = async () => {
    if (locked || submitted.current || !person || !title.trim() || staff === null) return;
    if (due && !Number.isFinite(Date.parse(due))) { setReviewing(false); setNotice("Choose a valid due date."); return; }
    submitted.current = true;
    setReviewing(false); setBusy(true); setNotice("");
    const saved = await createOperationsWork({ actorId, tenantId }, { title, summary, assigneeId, priority,
      planId: planId || undefined, milestoneId: milestoneId || undefined,
      dueAt: due ? new Date(due).toISOString() : undefined, ...(contact ? { contactId: contact.id } : {}) });
    if (!mounted.current) return;
    setResult(saved); setBusy(false);
    if (saved.kind === "refused") submitted.current = false;
    if (saved.kind === "verified") {
      try { await onCreated(); } catch { if (mounted.current) setNotice("The task was verified, but the work list needs a refresh."); }
    }
  };
  const recover = async () => {
    if (busy || result?.kind !== "uncertain") return;
    setBusy(true); setNotice("");
    try { await onRecover(result.itemId); }
    catch { if (mounted.current) setNotice("Current work couldn’t be refreshed. Try inspecting again; do not recreate the task yet."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const alertTheme = { "data-pg": theme, "data-theme": theme };
  return <>
    <Sheet open onOpenChange={open => { if (!open) requestClose(); }}>
      <SheetContent className="ops-detail-sheet ops-work-create-sheet paige-solo" {...alertTheme} onCloseAutoFocus={event => {
        if (invoker?.isConnected) { event.preventDefault(); invoker.focus(); }
      }}>
        <SheetHeader><SheetTitle>Give the next step an owner</SheetTitle><SheetDescription>Create a task with a clear responsibility and deadline.{contact && ` It stays private until you share it with ${contact.firstName || contact.name}.`}</SheetDescription></SheetHeader>
        <form className="ops-work-editor" onSubmit={event => { event.preventDefault(); if (!locked && person) setReviewing(true); }}>
          <fieldset disabled={locked || staff === null} className="ops-create-fields">
            {contact && <p className="ops-create-client"><span>For client</span><strong>{contact.name}</strong></p>}
            <label>Task<input autoFocus required maxLength={500} value={title} onChange={event => { setTitle(event.target.value); setResult(null); }} placeholder="What needs to happen?" /></label>
            <label>Context<textarea maxLength={10000} rows={3} value={summary} onChange={event => { setSummary(event.target.value); setResult(null); }} placeholder="What does good work look like?" /></label>
            <label>Responsible person<select aria-label="Responsible person" required value={person ? assigneeId : ""} onChange={event => { setAssigneeId(event.target.value); setResult(null); }}>
              {!person && <option value="">Choose an available team member</option>}
              {eligible.map(member => <option key={member.user_id} value={member.user_id}>{member.full_name || "Team member"}{member.user_id === actorId ? " (you)" : ""}</option>)}
            </select></label>
            {person && <OperationsAssignee member={person} />}
            <label>Project<select aria-label="Project" value={planId} onChange={event => { setPlanId(event.target.value); setMilestoneId(""); setResult(null); }}><option value="">Standalone work</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label>
            {planId && <label>Milestone<select aria-label="Milestone" value={milestoneId} onChange={event => { setMilestoneId(event.target.value); setResult(null); }}><option value="">No milestone</option>{milestones.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
            <div className="ops-create-pair"><label>Priority<select value={priority} onChange={event => { setPriority(event.target.value as PlanPriority); setResult(null); }}>{["low", "normal", "high", "urgent"].map(value => <option key={value}>{value}</option>)}</select></label>
              <label>Due date<input type="datetime-local" value={due} onChange={event => { setDue(event.target.value); setResult(null); }} /></label></div>
          </fieldset>
          <div ref={feedback} role={result?.kind === "refused" ? "alert" : "status"} aria-live="polite">
            {result?.kind === "verified" ? <p>Task saved and verified. {person?.full_name || "Its owner"} can find it in their work.{contact && ` It stays private to your team until you share it with ${contact.name}.`}</p> : result && <p>{result.message}</p>}
            {notice && <p>{notice}</p>}
            {result?.kind === "uncertain" && <button type="button" disabled={busy} onClick={() => void recover()}>{busy ? "Checking current work…" : result.itemId ? "Inspect saved task" : "Refresh current work"}</button>}
            {!person && staff !== null && <p>Your active team identity is unavailable. Refresh team profiles before creating a task.</p>}
          </div>
          <button type="submit" disabled={locked || !person || staff === null || !title.trim()}>{busy ? "Saving and checking…" : "Create task"}</button>
          <button type="button" onClick={requestClose} disabled={busy}>{result?.kind === "verified" ? "Done" : "Close"}</button>
        </form>
      </SheetContent>
    </Sheet>
    <AlertDialog open={reviewing} onOpenChange={setReviewing}><AlertDialogContent className="paige-solo ops-detail-sheet" {...alertTheme}>
      <AlertDialogHeader><AlertDialogTitle>Create this task?</AlertDialogTitle><AlertDialogDescription>{title.trim()}{contact ? ` · For ${contact.name}` : ""} · Assigned to {person?.full_name || "your selected team member"}{project ? ` · ${project.title}` : ""}{due ? ` · Due ${new Date(due).toLocaleString()}` : " · No due date"}.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Create task</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={discarding} onOpenChange={setDiscarding}><AlertDialogContent className="paige-solo ops-detail-sheet" {...alertTheme}>
      <AlertDialogHeader><AlertDialogTitle>{result?.kind === "uncertain" ? "Close an unconfirmed task?" : "Discard this draft?"}</AlertDialogTitle><AlertDialogDescription>{result?.kind === "uncertain" ? "The task may have been saved. Check current work before creating it again." : "Your unsaved task details will be cleared."}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Keep open</AlertDialogCancel><AlertDialogAction onClick={onClose}>Close task</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </>;
}
