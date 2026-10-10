import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Plan } from "@/hooks/usePlanList";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
import { submitOperationsProjectUpdate, type ProjectUpdate } from "./operations-project-update";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
const fields = (plan: Plan): ProjectUpdate => ({ status: plan.status, ownerId: plan.owner_user_id ?? "", startsOn: plan.starts_on ?? "", endsOn: plan.ends_on ?? "" });
export function OperationsProjectEditor({ plan, actorId, tenantId, members, refresh, sourceError }: {
  plan: Plan; actorId: string; tenantId: string; members: TeamMemberRecord[]; refresh: () => Promise<void>; sourceError: boolean;
}) {
  const [staff, setStaff] = useState<boolean | null>(null), [draft, setDraft] = useState(() => fields(plan));
  const [phase, setPhase] = useState<"idle" | "saving" | "reading" | "refused" | "uncertain">("idle");
  const [notice, setNotice] = useState(""), [confirming, setConfirming] = useState(false);
  const version = useRef(plan.updated_at), mounted = useRef(true), submitted = useRef(false);
  const readback = useRef<{ original: Plan; intended: ProjectUpdate | null } | null>(null);
  useEffect(() => { let current = true; mounted.current = true;
    void supabase.rpc("has_any_role", { _user_id: actorId, _roles: ["admin", "super_admin", "coach"] })
      .then(({ data, error }) => { if (current) setStaff(!error && data === true); }).catch(() => { if (current) setStaff(false); });
    return () => { current = false; mounted.current = false; };
  }, [actorId, tenantId]);
  useEffect(() => {
    const expected = readback.current;
    if (phase !== "reading" || !expected) return;
    if (sourceError) { setPhase("uncertain"); setNotice("Current projects couldn’t be read. Refresh before editing again."); return; }
    if (plan === expected.original) return;
    const current = fields(plan), matches = !expected.intended || Object.entries(expected.intended).every(([key, value]) => current[key as keyof ProjectUpdate] === value);
    if (!matches) { setPhase("uncertain"); setNotice("Current project differs from the requested change. Review it before editing again."); return; }
    setDraft(current); version.current = plan.updated_at; submitted.current = false; setPhase("idle");
    setNotice(expected.intended ? "Saved and confirmed in current projects." : "Current project refreshed. Review it before making another change."); readback.current = null;
  }, [plan, phase, sourceError]);
  const eligible = staff === true || plan.owner_user_id === actorId || plan.created_by === actorId;
  const changed = Object.entries(draft).some(([key, value]) => fields(plan)[key as keyof ProjectUpdate] !== value);
  async function save() {
    if (submitted.current || phase !== "idle" || !eligible || staff === null || !changed || plan.tenant_id !== tenantId || sourceError) return;
    submitted.current = true; setPhase("saving"); setNotice("Saving project change…");
    const intended = { ...draft };
    const result = await submitOperationsProjectUpdate({ actorId, tenantId, planId: plan.id, expectedUpdatedAt: version.current }, intended);
    if (!mounted.current) return;
    if (result.kind !== "acknowledged") { setPhase(result.kind); setNotice(result.message); return; }
    readback.current = { original: plan, intended }; setPhase("reading"); setNotice("Checking current project…");
    try { await refresh(); } catch { if (mounted.current) { setPhase("uncertain"); setNotice("Current projects couldn’t be read. Refresh before editing again."); } }
  }
  if (staff === null) return <p role="status">Checking project permissions…</p>;
  if (!eligible) return <p>You can inspect this project. Its owner or an authorized manager can change it.</p>;
  if (!plan.updated_at) return <p>This project’s current version is unavailable. Refresh before editing.</p>;
  const busy = phase !== "idle";
  return <form className="ops-work-editor" onSubmit={event => { event.preventDefault(); if (!busy && changed && !sourceError) setConfirming(true); }}>
    <h2>Manage this project</h2>
    <label>Project status<select aria-label="Project status" value={draft.status} disabled={busy} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))}>{["draft", "active", "completed", "archived"].map(status => <option key={status}>{status}</option>)}</select></label>
    {staff && <label>Accountable owner<select aria-label="Accountable owner" value={draft.ownerId} required disabled={busy} onChange={event => setDraft(value => ({ ...value, ownerId: event.target.value }))}>
      {!members.some(person => person.user_id === draft.ownerId) && <option value={draft.ownerId}>{draft.ownerId ? "Current owner unavailable" : "Choose an owner"}</option>}
      {members.map(person => <option key={person.user_id} value={person.user_id}>{person.full_name ?? "Team member"}</option>)}</select></label>}
    <label>Project starts<input aria-label="Project starts" type="date" required disabled={busy} value={draft.startsOn} onChange={event => setDraft(value => ({ ...value, startsOn: event.target.value }))} /></label>
    <label>Project finishes<input aria-label="Project finishes" type="date" required min={draft.startsOn || undefined} disabled={busy} value={draft.endsOn} onChange={event => setDraft(value => ({ ...value, endsOn: event.target.value }))} /></label>
    <button type="submit" disabled={busy || !changed || sourceError}>Review project change</button>
    <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogContent><AlertDialogHeader>
      <AlertDialogTitle>Confirm project change</AlertDialogTitle><AlertDialogDescription>
        Status: {plan.status} → {draft.status}. Owner: {members.find(person => person.user_id === draft.ownerId)?.full_name ?? "current recorded owner"}. Dates: {draft.startsOn} → {draft.endsOn}.
        Completion or archive requires remaining work to be resolved. Internal project completion does not record client acceptance.
      </AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Confirm project change</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {notice && <p role="status">{notice}</p>}
    {(phase === "refused" || phase === "uncertain") && <button type="button" onClick={async () => {
      readback.current = { original: plan, intended: null }; setPhase("reading"); setNotice("Reading current project…");
      try { await refresh(); } catch { if (mounted.current) { setPhase("uncertain"); setNotice("Current projects couldn’t be read. Try refreshing again."); } }
    }}>Refresh and review project</button>}
  </form>;
}
