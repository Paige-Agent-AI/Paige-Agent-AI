import { useEffect, useRef, useState } from "react";
import type { Plan, PlanPriority } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { supabase } from "@/integrations/supabase/client";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { registerAccountSwitchGuard } from "@/lib/auth/accountSwitchGuard";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { OperationsAssignee } from "./OperationsAssignee";
import { createOperationsProjectRecord, type ProjectCreationResult } from "./operations-project-create";

export function OperationsProjectCreator({ actorId, tenantId, members, project, theme, invoker, onClose, onCreated, onRecover }: {
  actorId: string; tenantId: string; members: TeamMemberRecord[]; project?: Plan;
  theme: string; invoker?: HTMLElement | null; onClose: () => void; onCreated: () => Promise<void>;
  onRecover: (id?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(""); const [summary, setSummary] = useState("");
  const [ownerId, setOwnerId] = useState(actorId); const [scope, setScope] = useState<"individual" | "team">("individual");
  const [horizon, setHorizon] = useState("custom"); const [startsOn, setStartsOn] = useState(""); const [endsOn, setEndsOn] = useState("");
  const [priority, setPriority] = useState<PlanPriority>("normal"); const [due, setDue] = useState("");
  const [staff, setStaff] = useState<boolean | null>(null); const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false); const [discarding, setDiscarding] = useState(false);
  const [result, setResult] = useState<ProjectCreationResult | null>(null); const [notice, setNotice] = useState("");
  const mounted = useRef(true); const submitted = useRef(false); const feedback = useRef<HTMLDivElement>(null);
  const dirty = Boolean(title || summary || startsOn || endsOn || due || ownerId !== actorId || scope !== "individual" || priority !== "normal" || horizon !== "custom");
  const locked = busy || result?.kind === "uncertain" || result?.kind === "verified";
  useBeforeUnloadGuard(busy || (dirty && result?.kind !== "verified"));
  useEffect(() => {
    mounted.current = true;
    void supabase.rpc("is_tenant_admin", { _tenant: tenantId })
      .then(({ data, error }) => { if (mounted.current) setStaff(!error && data === true); }, () => { if (mounted.current) setStaff(false); });
    return () => { mounted.current = false; };
  }, [actorId, tenantId]);
  useEffect(() => registerAccountSwitchGuard(() => {
    if (busy || (dirty && result?.kind !== "verified")) { setNotice("Finish or discard this draft before switching workspaces."); return false; }
    return true;
  }), [busy, dirty, result]);
  useEffect(() => { if (notice || result) feedback.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" }); }, [notice, result]);
  const eligible = members.filter(member => member.status === "active" && (staff === true || member.user_id === actorId));
  const person = eligible.find(member => member.user_id === ownerId);
  const allowed = Boolean(person && staff !== null && (!project || staff === true));
  const requestClose = () => { if (busy) setNotice("Wait for the save result before closing."); else if (dirty && result?.kind !== "verified") setDiscarding(true); else onClose(); };
  const save = async () => {
    if (locked || submitted.current || !allowed || !title.trim()) return;
    if ((!project && (!startsOn || !endsOn || endsOn < startsOn)) || (due && !Number.isFinite(Date.parse(due)))) {
      setReviewing(false); setNotice("Choose a valid date window or deadline."); return;
    }
    submitted.current = true; setBusy(true); setReviewing(false); setNotice("");
    const saved = await createOperationsProjectRecord({ actorId, tenantId }, project
      ? { kind: "milestone", title, summary, ownerId, planId: project.id, priority, dueAt: due ? new Date(due).toISOString() : undefined }
      : { kind: "project", title, summary, ownerId, scope, horizon, startsOn, endsOn });
    if (!mounted.current) return;
    setResult(saved); setBusy(false);
    if (saved.kind === "refused") submitted.current = false;
    if (saved.kind === "verified") {
      try { await onCreated(); } catch { if (mounted.current) setNotice("The record was verified, but current projects need a refresh."); }
    }
  };
  const recover = async () => {
    if (busy || result?.kind !== "uncertain") return;
    setBusy(true); setNotice("");
    try { await onRecover(result.id); } catch { if (mounted.current) setNotice("Current work couldn’t be refreshed. Do not recreate the record yet."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const attrs = { "data-pg": theme, "data-theme": theme }; const noun = project ? "milestone" : "project";
  return <>
    <Sheet open onOpenChange={open => { if (!open) requestClose(); }}><SheetContent className="ops-detail-sheet paige-solo" {...attrs} onCloseAutoFocus={event => {
      if (invoker?.isConnected) { event.preventDefault(); invoker.focus(); }
    }}><SheetHeader><SheetTitle>{project ? "Mark the next meaningful step" : "Give the work a clear path"}</SheetTitle>
      <SheetDescription>{project ? `Add a milestone to ${project.title}.` : "Create a project with an accountable owner and a real time window."}</SheetDescription></SheetHeader>
      <form className="ops-work-editor" onSubmit={event => { event.preventDefault(); if (!locked && allowed) setReviewing(true); }}>
        <fieldset className="ops-create-fields" disabled={locked || !allowed}>
          <label>{project ? "Milestone" : "Project name"}<input autoFocus required maxLength={500} value={title} onChange={event => { setTitle(event.target.value); setResult(null); }} /></label>
          <label>Context<textarea rows={3} maxLength={10000} value={summary} onChange={event => { setSummary(event.target.value); setResult(null); }} /></label>
          <label>Accountable person<select aria-label="Accountable person" required value={person ? ownerId : ""} onChange={event => { setOwnerId(event.target.value); setResult(null); }}>
            {!person && <option value="">Choose an available team member</option>}{eligible.map(member => <option key={member.user_id} value={member.user_id}>{member.full_name || "Team member"}</option>)}
          </select></label>{person && <OperationsAssignee member={person} />}
          {project ? <div className="ops-create-pair"><label>Priority<select aria-label="Priority" value={priority} onChange={event => setPriority(event.target.value as PlanPriority)}>{["low", "normal", "high", "urgent"].map(value => <option key={value}>{value}</option>)}</select></label><label>Due date<input type="datetime-local" value={due} onChange={event => setDue(event.target.value)} /></label></div>
            : <><label>Visibility<select aria-label="Visibility" value={scope} onChange={event => setScope(event.target.value as "individual" | "team")}><option value="individual">Individual</option>{staff === true && <option value="team">Team</option>}</select></label>
              <label>Planning window<select aria-label="Planning window" value={horizon} onChange={event => setHorizon(event.target.value)}>{["week", "month", "quarter", "semiannual", "year", "custom"].map(value => <option key={value}>{value}</option>)}</select></label>
              <div className="ops-create-pair"><label>Start<input required type="date" value={startsOn} onChange={event => setStartsOn(event.target.value)} /></label><label>Finish<input required type="date" min={startsOn || undefined} value={endsOn} onChange={event => setEndsOn(event.target.value)} /></label></div></>}
        </fieldset>
        <div ref={feedback} role={result?.kind === "refused" ? "alert" : "status"} aria-live="polite">
          {result?.kind === "verified" ? <p>{project ? "Milestone saved and verified." : "Project saved and verified as a draft."}</p> : result && <p>{result.message}</p>}
          {notice && <p>{notice}</p>}{staff !== null && !allowed && <p>{project ? "Milestone creation requires an authorized workspace administrator." : "Your active team identity is unavailable."}</p>}
          {result?.kind === "uncertain" && <button type="button" disabled={busy} onClick={() => void recover()}>{busy ? "Checking current work…" : result.id ? `Inspect saved ${noun}` : "Refresh current work"}</button>}
        </div>
        <button type="submit" disabled={locked || !allowed || !title.trim()}>{busy ? "Saving and checking…" : `Review ${noun}`}</button>
        <button type="button" disabled={busy} onClick={requestClose}>{result?.kind === "verified" ? "Done" : "Close"}</button>
      </form>
    </SheetContent></Sheet>
    <AlertDialog open={reviewing} onOpenChange={setReviewing}><AlertDialogContent className="paige-solo ops-detail-sheet" {...attrs}><AlertDialogHeader>
      <AlertDialogTitle>Create this {noun}?</AlertDialogTitle><AlertDialogDescription>{title.trim()} · Owned by {person?.full_name || "your selected person"}{project ? ` · ${project.title} · ${priority} priority · ${due ? `Due ${new Date(due).toLocaleString()}` : "No deadline"}` : ` · ${startsOn} to ${endsOn} · ${scope} · Draft`}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Create {noun}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={discarding} onOpenChange={setDiscarding}><AlertDialogContent className="paige-solo ops-detail-sheet" {...attrs}><AlertDialogHeader>
      <AlertDialogTitle>{result?.kind === "uncertain" ? "Close an unconfirmed record?" : "Discard this draft?"}</AlertDialogTitle><AlertDialogDescription>{result?.kind === "uncertain" ? "It may have been saved. Inspect current work before creating it again." : "Your unsaved details will be cleared."}</AlertDialogDescription>
    </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep open</AlertDialogCancel><AlertDialogAction onClick={onClose}>Close draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>
}
