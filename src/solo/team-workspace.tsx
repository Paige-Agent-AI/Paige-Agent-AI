import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Mail, MailX, MessageSquare, MessageSquareOff, Pause, Pencil, RefreshCw, Search, Send, ShieldCheck, Sparkles, Undo2, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { readFunctionErrorBody } from "@/lib/integrations/connectError";
import { TeamMemberContact } from "./team-member-contact";
import { Modal, NoticeBar, PermissionCards, RowMenu, TeamPicker, TeamSwitch, type MenuItem, type TeamNotice } from "./team-controls";
import { DepartureReview, type DepartureOutcome } from "./team-departure";
import {
  canActOn,
  inviteLifecycle,
  inviteIsFinished,
  deliveryPresentation,
  DELIVERY_STEPS,
  invitationRefusalMessage,
  lifecycleRefusal,
  memberVisibleIdentity,
  normalizeHoldings,
  normalizeTeamWorkspace,
  permissionPresentation,
  validateWorkProfile,
  type MemberHoldings,
  type TeamInviteRecord,
  type TeamMemberRecord,
  type TeamWorkspaceRecord,
} from "./team-workspace-contract";

// The dialog trap moved to ./team-controls so the drawer and the suspend dialog share it; it is
// re-exported for any caller that imported it from here.
export { Modal } from "./team-controls";

const PAGE_SIZE = 25;

function initials(member: TeamMemberRecord): string {
  return (member.full_name || member.email || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

// Colour hooks only (owner colour pass 2026-10-26). A stable tint per person, from the same id on
// every render and every device, and a tone per permission. Neither carries meaning on its own:
// the initials and the pill's word do.
function avatarHue(member: TeamMemberRecord): number {
  const key = member.user_id || member.email || member.full_name || "";
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 4;
}
function permissionTone(permission: string | null | undefined, isOwner: boolean): "owner" | "admin" | "member" | undefined {
  if (isOwner || permission === "owner") return "owner";
  return permission === "admin" || permission === "member" ? permission : undefined;
}

function useTeamWorkspace(search: string, permission: string) {
  const { activeTenantId, loading: tenantLoading } = useTenantContext();
  const seq = useRef(0);
  const [state, setState] = useState<{ tenantId: string | null; loading: boolean; loadingMore: boolean; error: string | null; value: TeamWorkspaceRecord | null }>({ tenantId: null, loading: true, loadingMore: false, error: null, value: null });

  const load = useCallback(async (offset = 0) => {
    const request = ++seq.current;
    if (!activeTenantId) { setState({ tenantId: null, loading: false, loadingMore: false, error: null, value: null }); return; }
    setState((current) => offset === 0
      ? { tenantId: null, loading: true, loadingMore: false, error: null, value: null }
      : { ...current, loadingMore: true, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
    const { data, error } = await (supabase as any).rpc("get_solo_team_workspace", {
      _search: search.trim() || null,
      _permission: permission,
      _limit: PAGE_SIZE,
      _offset: offset,
    });
    if (request !== seq.current) return;
    const next = normalizeTeamWorkspace(data);
    if (error || !next || next.tenant_id !== activeTenantId) {
      setState((current) => ({ ...current, tenantId: activeTenantId, loading: false, loadingMore: false, error: error?.message || "Team information is unavailable.", value: offset === 0 ? null : current.value }));
      return;
    }
    setState((current) => ({
      tenantId: activeTenantId,
      loading: false,
      loadingMore: false,
      error: null,
      value: offset === 0 ? next : { ...next, members: [...(current.value?.members ?? []), ...next.members] },
    }));
  }, [activeTenantId, permission, search]);

  useEffect(() => {
    const timer = setTimeout(() => { if (!tenantLoading) void load(0); }, 180);
    return () => { clearTimeout(timer); seq.current += 1; };
  }, [load, tenantLoading]);

  // RE-READ IN PLACE after a write on a row (the switch, suspend, reinstate, a removal). `refresh()`
  // nulls the roster before it awaits, which flashes the skeleton and drops every page past the
  // first: the row the operator just acted on would jump away. This keeps what is on screen until the
  // server's answer replaces it, and asks for as many rows as are showing, so the persisted state is
  // what the roster then shows. A failed re-read leaves the screen as it was rather than blanking it.
  const shownRef = useRef(0);
  useEffect(() => { shownRef.current = state.value?.members.length ?? 0; });
  const reload = useCallback(async () => {
    const request = ++seq.current;
    if (!activeTenantId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
    const { data, error } = await (supabase as any).rpc("get_solo_team_workspace", {
      _search: search.trim() || null,
      _permission: permission,
      _limit: Math.min(100, Math.max(PAGE_SIZE, shownRef.current)),
      _offset: 0,
    });
    if (request !== seq.current) return;
    const next = normalizeTeamWorkspace(data);
    if (error || !next || next.tenant_id !== activeTenantId) return;
    setState((current) => ({ ...current, tenantId: activeTenantId, loading: false, loadingMore: false, error: null, value: next }));
  }, [activeTenantId, permission, search]);

  return {
    ...state,
    loading: tenantLoading || state.loading || Boolean(activeTenantId && state.tenantId !== activeTenantId),
    refresh: () => load(0),
    reload,
    loadMore: () => load(state.value?.members.length ?? 0),
  };
}

export function MemberEditor({ member, workspace, onClose, onSaved, onContactDirtyChange, canRemove, onRequestRemoval }: { member: TeamMemberRecord; workspace: TeamWorkspaceRecord; onClose: () => void; onSaved: (saved?: { job_title: string; responsibilities: string }) => void | Promise<void>; /** Raised while contact edits are unsaved: a roster reload must not take them. */ onContactDirtyChange?: (dirty: boolean) => void; /** The viewer may remove this person (canActOn); the drawer is opened by the parent. */ canRemove?: boolean; onRequestRemoval?: () => void }) {
  const [title, setTitle] = useState(member.job_title ?? "");
  const [responsibilities, setResponsibilities] = useState(member.responsibilities ?? "");
  const [savedTitle, setSavedTitle] = useState(member.job_title ?? "");
  const [savedResponsibilities, setSavedResponsibilities] = useState(member.responsibilities ?? "");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<string | null>(null);
  const errors = validateWorkProfile(title, responsibilities);
  const permission = permissionPresentation(member.permission, member.is_owner);
  const identity = memberVisibleIdentity(member);
  const dirty = title !== savedTitle || responsibilities !== savedResponsibilities;
  const [contactDirty, setContactDirty] = useState(false);
  const reportContactDirty = useCallback((next: boolean) => { setContactDirty(next); onContactDirtyChange?.(next); }, [onContactDirtyChange]);
  // Leaving (close, removal, switch) releases the parent's hold.
  useEffect(() => () => onContactDirtyChange?.(false), [onContactDirtyChange]);
  useBeforeUnloadGuard(dirty || contactDirty || saving || permissionDraft !== null);

  const save = async () => {
    if (!workspace.can_manage_profiles || !dirty || Object.keys(errors).length) return;
    setSaving(true);
    // WRAPPED: an escaping rejection would skip `setSaving(false)` and leave Save and the way into
    // removal disabled, with nothing said, until the dialog is closed and reopened.
    let data: { job_title?: string | null; responsibilities?: string | null } | null = null;
    let error: { message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("set_solo_team_member_work_profile", {
        _member_user_id: member.user_id,
        _job_title: title,
        _responsibilities: responsibilities,
      }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : "We could not reach the server, so the result of this is unknown. Reopen Team to see the current values." };
    }
    setSaving(false);
    if (error) { toast.error(error.message ?? "The save did not complete. Please try again."); return; }

    const nextTitle = typeof data?.job_title === "string" ? data.job_title : data?.job_title === null ? "" : title.trim();
    const nextResponsibilities = typeof data?.responsibilities === "string" ? data.responsibilities : data?.responsibilities === null ? "" : responsibilities.trim();
    setTitle(nextTitle);
    setSavedTitle(nextTitle);
    setResponsibilities(nextResponsibilities);
    setSavedResponsibilities(nextResponsibilities);
    setSaveConfirmed(true);
    toast.success("Work details saved. Permission was not changed.");
    // HAND BACK WHAT WAS SAVED. `onSaved` is `team.refresh()`, which is `load(0)`, which sets the
    // roster to null BEFORE it awaits — so this dialog is unmounted and then remounted from the
    // parent's `selected` SNAPSHOT, taken when the row was clicked and never updated since. Local
    // state goes with the unmount, so the value the operator just saved reads back as the value it
    // replaced, and the "Work details saved" confirmation is wiped in the same instant the toast
    // claims success. The write itself always landed; the screen just threw it away.
    //
    // Reported by the owner on production against their own account: the field went back to empty
    // while the toast said saved, so they saved a second time sixteen seconds later. Both writes are
    // in the audit log. §70.2 — the person who cannot use it is right and the passing test is wrong.
    await onSaved({ job_title: nextTitle, responsibilities: nextResponsibilities });
  };
  const changePermission = async () => {
    if (!permissionDraft) return;
    setSaving(true);
    // WRAPPED: a transport rejection that skips `setSaving(false)` would wedge every control in this
    // dialog with nothing said.
    let error: { message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPC awaits generated types
      ({ error } = await (supabase as any).rpc("set_solo_team_member_permission", { _member_user_id: member.user_id, _new_permission: permissionDraft }));
    } catch (thrown) {
      error = { message: thrown instanceof Error ? thrown.message : "We could not reach the server, so the result of this is unknown. Reopen Team to see the current values." };
    }
    setSaving(false);
    if (error) { toast.error(error.message ?? "The permission change did not complete. Please try again."); return; }
    toast.success(`Permission changed to ${permissionPresentation(permissionDraft, false).label}.`); setPermissionDraft(null); onSaved(); onClose();
  };

  // REMOVAL moved to the departure review drawer (approved design, EXP08). This dialog only offers
  // the way in; the drawer owns the call and every guarantee the inline block used to carry.
  const suspended = member.status === "suspended";
  const firstName = member.full_name?.trim() ? member.full_name.trim().split(/\s+/)[0] : identity.primary;
  // Stage 0 (live): change_user_role refuses a target without an active seat, so a suspended
  // person's permission can't be changed directly. The control is not offered; the reason is.
  const permissionEditable = workspace.can_change_permissions && permission.mutable && !suspended;
  return <Modal title={identity.primary} description={`${member.email ?? "Email unavailable"} · ${suspended ? "Suspended" : "Active"}`}
    wide
    onClose={onClose}>
    <div className="stw-modal-body">
      <div className="stw-person-summary"><span className="stw-avatar" data-hue={avatarHue(member)}>{initials(member)}</span><div><strong>{identity.primary}</strong>{identity.secondary && <span>{identity.secondary}</span>}</div><span className="stw-perm" data-tone={permissionTone(member.permission, member.is_owner)}>{permission.label}</span></div>
      <TeamMemberContact member={member} workspace={workspace} onDirtyChange={reportContactDirty}/>
      <div className="stw-separation-note"><ShieldCheck/><span><strong>Permission and title are separate.</strong> Changing someone’s title never changes their access.</span></div>
      <label>Title<input value={title} disabled={!workspace.can_manage_profiles || saving} maxLength={121} onChange={(e) => { setTitle(e.target.value); setSaveConfirmed(false); }} placeholder="e.g. Client Success Manager"/>{errors.title && <small role="alert">{errors.title}</small>}</label>
      <label>Responsibilities<textarea value={responsibilities} disabled={!workspace.can_manage_profiles || saving} maxLength={2001} onChange={(e) => { setResponsibilities(e.target.value); setSaveConfirmed(false); }} rows={5} placeholder="What this person owns, decides, and hands off."/>{errors.responsibilities && <small role="alert">{errors.responsibilities}</small>}</label>
      {saveConfirmed && <div className="stw-separation-note" role="status"><ShieldCheck/><span>Work details saved. Permission was not changed.</span></div>}
      {permissionEditable
        ? <div className="stw-permission-change"><div className="stw-fieldlabel" id="stw-ed-perm-l">Permission</div>
          <PermissionCards value={permissionDraft ?? member.permission} labelledBy="stw-ed-perm-l" onChange={(next) => setPermissionDraft(next === member.permission ? null : next)} />
          {permissionDraft && permissionDraft !== member.permission && <div className="stw-confirm"><p>Change access from {permission.label} to {permissionPresentation(permissionDraft, false).label}? This changes authorization, not the title.</p><button type="button" className="stw-btn secondary" onClick={() => setPermissionDraft(null)}>Cancel</button><button type="button" className="stw-btn primary" disabled={saving} onClick={changePermission}>Confirm access change</button></div>}</div>
        : <div className="stw-permission-change"><div className="stw-fieldlabel">Permission</div><p className="stw-perm-ro"><span className="stw-perm" data-tone={permissionTone(member.permission, member.is_owner)}>{permission.label}</span><span className="stw-muted">{member.is_owner || member.permission === "owner" ? "Owner access is protected here." : suspended && workspace.can_change_permissions && permission.mutable ? `Reinstate ${firstName} before changing their permission.` : !permission.mutable ? "This access level isn't changed from Team settings." : "Only the owner changes permissions."}</span></p></div>}
    </div>
    <footer className="stw-modal-actions">{canRemove && onRequestRemoval && <button type="button" className="stw-quiet stw-danger-link" disabled={saving} onClick={onRequestRemoval}>Remove from team…</button>}<button type="button" className="stw-btn secondary" onClick={onClose}>{dirty || contactDirty ? "Cancel" : "Close"}</button>{workspace.can_manage_profiles && <button type="button" className="stw-btn primary" disabled={saving || !dirty || Object.keys(errors).length > 0} onClick={save}>{saving ? "Saving…" : "Save work details"}</button>}</footer>
  </Modal>;
}

/** What an invitation's Team conversations choice means, in the approved design's words. */
function conversationsCopy(on: boolean): string {
  return on ? "On: they join the open team channels as soon as they accept."
    : "Off: they can't open Team Hub (channels, direct messages or shared files) and work only on what they're assigned. Good for a spot-job contractor.";
}

export function InviteDialog({ workspace, onClose, onInvited }: { workspace: TeamWorkspaceRecord; onClose: () => void; onInvited: (outcome: { email: string; conversations: boolean; emailed: boolean }) => void }) {
  const [email, setEmail] = useState(""); const [permission, setPermission] = useState<"member" | "admin">("member"); const [title, setTitle] = useState(""); const [responsibilities, setResponsibilities] = useState(""); const [conversations, setConversations] = useState(true); const [sending, setSending] = useState(false); const [reviewing, setReviewing] = useState(false); const [touched, setTouched] = useState(false); const [failure, setFailure] = useState<string | null>(null);
  const errors = validateWorkProfile(title, responsibilities); const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Who may invite an Admin is an OPEN owner question (prototype open question 1). Until it is
  // ruled, the shipped behaviour stands (§58): the server lets any owner or admin invite an Admin
  // (solo_team_invite_authority + create_solo_team_invite), so the Admin card stays selectable.
  const emailRef = useRef<HTMLInputElement>(null);
  // The workspace is captured when the dialog opens, and it is what the review step names. If the
  // active workspace changes while a confirmation is on screen, it aborts: an invitation carries a
  // live access token, and a token cannot be recalled.
  const { activeTenantId } = useTenantContext();
  const send = async () => {
    if (activeTenantId && activeTenantId !== workspace.tenant_id) {
      toast.error(`This invitation was for ${workspace.tenant_name}, but you have since switched workspace. Nothing was sent. Reopen the invitation in the workspace you mean.`);
      return;
    }
    setSending(true); setFailure(null);
    // Team conversations travels only when it is OFF. On is the server's default, so an invitation
    // with it on keeps the exact body every deployed version of the function accepts.
    const { data, error } = await supabase.functions.invoke("solo-team-invitations", { body: { action: "create", expectedTenantId: workspace.tenant_id, email, permission, jobTitle: title, responsibilities, ...(conversations ? {} : { teamHubAccess: false }) } });
    setSending(false);
    if (error || data?.ok === false) {
      const message = invitationRefusalMessage(await readFunctionErrorBody(error, data), "The invitation wasn't sent. Nothing was created. Try again.");
      setFailure(message); toast.error(message); return;
    }
    if (!data?.emailed) toast.warning("Invitation is pending, but the email was not sent. You can retry from Team.");
    onInvited({ email: email.trim(), conversations, emailed: data?.emailed === true }); onClose();
  };
  return <Modal title={reviewing ? "Confirm invitation" : "Invite someone"} description={reviewing ? "Check who this goes to and what they can reach. One invitation is sent." : `New teammates join ${workspace.tenant_name}'s open team channels when they accept. Turn team conversations off for someone who should only see their assigned work.`} onClose={onClose} busy={sending}>
    {reviewing
      ? <div className="stw-modal-body"><dl className="stw-invite-review">
          <div><dt>Workspace</dt><dd>{workspace.tenant_name}</dd></div>
          <div><dt>Send to</dt><dd>{email.trim()}</dd></div>
          <div><dt>Permission</dt><dd>{permissionPresentation(permission, false).label}</dd></div>
          <div><dt>Team conversations</dt><dd>{conversations ? "On: joins the open team channels when they accept" : "Off: assigned work only, no Team Hub"}</dd></div>
          <div><dt>Title</dt><dd>{title.trim() || "Not set"}</dd></div>
          <div><dt>Responsibilities</dt><dd>{responsibilities.trim() || "Not set"}</dd></div>
        </dl>
        {failure && <div className="stw-alert" role="alert" tabIndex={-1}><AlertTriangle aria-hidden="true" /><p>{failure}</p></div>}</div>
      : <div className="stw-modal-body">
        <label>Email<input ref={emailRef} data-initial-focus type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !validEmail ? true : undefined} placeholder="person@company.com" autoComplete="off"/>{touched && !validEmail && <small role="alert">Enter an email address like name@company.com.</small>}</label>
        <div><div className="stw-fieldlabel" id="stw-inv-perm-l">Permission</div><PermissionCards value={permission} labelledBy="stw-inv-perm-l" onChange={setPermission} /></div>
        <label className="stw-optional">Title <span>optional</span><input maxLength={121} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Video Editor"/>{errors.title && <small role="alert">{errors.title}</small>}</label>
        <label className="stw-optional">Responsibilities <span>optional</span><textarea maxLength={2001} rows={3} value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} placeholder="What they'll own and where they hand work off."/>{errors.responsibilities && <small role="alert">{errors.responsibilities}</small>}</label>
        <div className="stw-convo">{conversations ? <MessageSquare aria-hidden="true" /> : <MessageSquareOff aria-hidden="true" />}<div><strong id="stw-inv-convo-l">Team conversations</strong><p id="stw-inv-convo-d">{conversationsCopy(conversations)}</p></div>
          <TeamSwitch checked={conversations} labelledBy="stw-inv-convo-l" describedBy="stw-inv-convo-d" onToggle={() => setConversations((c) => !c)} /></div>
      </div>}
    <footer className="stw-modal-actions">{reviewing
      ? <><button type="button" className="stw-btn secondary" disabled={sending} onClick={() => { setReviewing(false); setFailure(null); }}>Back</button><button type="button" data-initial-focus className="stw-btn act" disabled={sending} aria-busy={sending || undefined} onClick={send}>{sending ? "Sending…" : failure ? "Try again" : "Send invitation"}</button></>
      : <><button type="button" className="stw-btn secondary" onClick={onClose}>Cancel</button><button type="button" className="stw-btn primary" disabled={Object.keys(errors).length > 0} onClick={() => { setTouched(true); if (!validEmail) { emailRef.current?.focus(); return; } setReviewing(true); }}>Review invitation</button></>}</footer>
  </Modal>;
}

/**
 * Suspend: a brief, blocking decision with a consequence everywhere in the business. One alert
 * dialog, focus on Cancel. What it says about approvals and the mailbox comes from the departure
 * review read when it is available, and is said in general terms when it is not — never invented.
 */
function SuspendDialog({ member, workspace, onClose, onSuspended }: { member: TeamMemberRecord; workspace: TeamWorkspaceRecord; onClose: () => void; onSuspended: (approvals: number) => void }) {
  const identity = memberVisibleIdentity(member);
  const first = member.full_name?.trim() ? member.full_name.trim().split(/\s+/)[0] : identity.primary;
  const [stage, setStage] = useState<"idle" | "pending" | "error">("idle");
  const [refusal, setRefusal] = useState<{ message: string; retryable: boolean; unavailable: boolean } | null>(null);
  const [holdings, setHoldings] = useState<MemberHoldings | null>(null);
  const inFlight = useRef(false);
  const tenantAtOpen = useRef(workspace.tenant_id);
  // A workspace switch closes the dialog — but never under a call in flight, whose outcome is still
  // owed: that case is reported after it settles, below.
  const { activeTenantId } = useTenantContext();
  const activeRef = useRef(activeTenantId);
  useEffect(() => { activeRef.current = activeTenantId; }, [activeTenantId]);
  const switchedAway = () => Boolean(activeRef.current) && activeRef.current !== tenantAtOpen.current;
  useEffect(() => {
    if (!inFlight.current && activeTenantId && activeTenantId !== tenantAtOpen.current) {
      toast.error(`You switched workspace, so suspending ${identity.primary} in ${workspace.tenant_name} was closed. Nothing was changed.`);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a switch closes it
  }, [activeTenantId]);
  useEffect(() => {
    let live = true;
    // Best effort: the facts below are true without it; with it, they name what is waiting.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EXP08 RPC awaits generated types
    void Promise.resolve((supabase as any).rpc("team_member_holdings", { _member_user_id: member.user_id, _expected_tenant_id: workspace.tenant_id }))
      .then((r: { data: unknown; error: unknown }) => { if (live && !r?.error) setHoldings(normalizeHoldings(r?.data, member.user_id)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [member.user_id, workspace.tenant_id]);
  const approvals = holdings?.items.approvals ?? [];
  const mailbox = holdings?.items.mailboxes[0] as Extract<MemberHoldings["items"]["mailboxes"][number], { kind: "mailboxes" }> | undefined;
  const n = holdings ? holdings.counts.approvals : null;
  const approvalLine = n === null
    ? `Approvals assigned to ${first} stay assigned and wait. ${first} can't act on them while suspended. New approvals can still be assigned to ${first}, and ${first} is still emailed about them.`
    : n
      ? `${n === 1 ? `1 approval assigned to ${first}${approvals[0]?.kind === "approvals" && approvals[0].summary ? ` (“${approvals[0].summary}”)` : ""} stays assigned to ${first} and waits` : `${n} approvals assigned to ${first} stay assigned to ${first} and wait`}. ${first} can't act on ${n === 1 ? "it" : "them"} while suspended. New approvals can still be assigned to ${first}, and ${first} is still emailed about them.`
      : `No approvals are assigned to ${first}. New ones can still be assigned to ${first} while suspended, and ${first} is still emailed about them.`;
  const pending = stage === "pending";
  const suspend = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStage("pending"); setRefusal(null);
    let data: { tenant_id?: string; status?: string } | null = null;
    let error: { code?: string; message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EXP08 RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("suspend_solo_team_member", { _member_user_id: member.user_id, _expected_tenant_id: tenantAtOpen.current }));
    } catch (thrown) { error = { message: thrown instanceof Error ? thrown.message : "network request failed" }; }
    inFlight.current = false;
    if (error || data?.tenant_id !== tenantAtOpen.current || data?.status !== "suspended") {
      const r = error ? lifecycleRefusal(error, "suspend", identity.primary, workspace.tenant_name) : { message: "The answer didn't confirm the suspension, so nothing is being claimed. Reopen Team to see the current roster.", retryable: false, unavailable: false, reconciled: false };
      if (switchedAway()) { toast.error(r.message); onClose(); return; }
      setRefusal(r); setStage("error"); return;
    }
    if (switchedAway()) {
      toast.success(`${identity.primary} was suspended in ${workspace.tenant_name}. You have since switched workspace, so this roster does not show it.`);
      onClose();
      return;
    }
    onSuspended(n ?? 0);

  };
  return <Modal role="alertdialog" title={`Suspend ${identity.primary}?`} description={`${first} can't open ${workspace.tenant_name} until you reinstate them. They can still sign in to Paige.`} busy={pending} onClose={onClose}>
    <div className="stw-modal-body">
      <ul className="stw-facts">
        <li><Pause aria-hidden="true" /><span>Access to this workspace stops at once: Operations, clients, Team Hub and Paige here.</span></li>
        <li><CheckCircle2 aria-hidden="true" /><span>{approvalLine}</span></li>
        {mailbox && <li><Mail aria-hidden="true" /><span>Nothing can be sent from {mailbox.address ?? mailbox.label} while {first} is suspended, including emails Paige already prepared for {first}. It stays connected and keeps receiving mail.</span></li>}
        <li><ShieldCheck aria-hidden="true" /><span>Nothing is deleted or reassigned. Their work, clients and messages stay where they are.</span></li>
        <li><Undo2 aria-hidden="true" /><span>You can reinstate {first} at any time, with their permission and team conversations setting as they are then.</span></li>
      </ul>
      {stage === "error" && refusal && <div className="stw-alert" role="alert" tabIndex={-1}><AlertTriangle aria-hidden="true" /><p>{refusal.message}</p></div>}
      {pending && <p className="stw-status" role="status" tabIndex={-1}><RefreshCw className="stw-spin" aria-hidden="true" />Suspending {first}…</p>}
    </div>
    <footer className="stw-modal-actions"><button type="button" data-initial-focus className="stw-btn secondary" disabled={pending} onClick={onClose}>Cancel</button><button type="button" className="stw-btn primary" disabled={pending || (stage === "error" && refusal?.retryable === false)} aria-busy={pending || undefined} onClick={suspend}>{pending ? "Suspending…" : stage === "error" ? "Try again" : "Suspend access"}</button></footer>
  </Modal>;
}

/**
 * One invitation, and what actually happened to it.
 *
 * The delivery half is the reason this component exists. Before it, the strongest thing the screen
 * could say was that a fresh invitation had been "sent" — which meant the POST to the provider was
 * accepted, and was shown identically whether the address bounced, the mail server queued it, or
 * the person read it an hour ago. Now the row says which of those happened, and says "Not sent yet"
 * rather than inventing a status when nothing was ever recorded.
 */
function InviteRow({ invite, onManage }: {
  invite: TeamInviteRecord;
  onManage: (action: "resend" | "revoke" | "archive", invite: TeamInviteRecord) => void | Promise<void>;
}) {
  const state = inviteLifecycle(invite);
  const finished = inviteIsFinished(invite);
  const delivery = invite.delivery ?? null;
  const presentation = deliveryPresentation(delivery);
  // How far along the happy path this email got. No `tone === "bad"` special case here: the trail
  // is not RENDERED at all for a terminal failure (see the guard on the <ol> below), so a second
  // check would be unreachable — mutation confirmed it, and an unreachable guard that a comment
  // calls load-bearing is what the next reader would reason from.
  const reached = DELIVERY_STEPS.indexOf((delivery?.status ?? "") as (typeof DELIVERY_STEPS)[number]);
  const recipient = invite.email || "Recipient unavailable";

  return <article>
    <div>
      <strong>{recipient}</strong>
      {/* THE EXPIRY CLAUSE IS ONLY SHOWN WHERE IT MEANS SOMETHING — a pending invitation that will
          expire, or one that already did. It is omitted for accepted and revoked.

          Two wrong answers were shipped here before this one, in opposite directions. Keying the
          verb on `finished` said "Accepted · expired Sep 10" while Sep 10 was still ahead. Keying
          it on `state === "expired"` then said "Accepted · expires Sep 1" once Sep 1 had passed,
          because `inviteLifecycle` short-circuits on `uses`/`revoked_at` BEFORE it looks at the
          date, so a used invitation never reports `expired` however old it gets.

          No tense is correct, because the premise is wrong: an invitation that was accepted did
          not expire and is not going to. Its expiry stopped mattering the moment it was used, and
          the pill beside it already says what happened. So the clause goes away rather than being
          conjugated more carefully. */}
      <small>
        {permissionPresentation(invite.permission, false).label}
        {(state === "pending" || state === "expired") && <>
          {" · "}{state === "expired" ? "expired" : "expires"}{" "}
          {new Date(invite.expires_at).toLocaleDateString()}
        </>}
      </small>
    </div>
    <span className="stw-pill" data-tone={state}>{state}</span>

    <div className="stw-invite-delivery" data-tone={presentation.tone}>
      <strong>{presentation.label}</strong>
      {presentation.detail && <small>{presentation.detail}</small>}
      {/* The trail is only meaningful once something has been recorded. Rendering four grey steps
          against an invitation that was never emailed would imply a journey that never started. */}
      {delivery && presentation.tone !== "bad" && <ol className="stw-invite-steps" aria-label={`Delivery progress for ${recipient}`}>
        {DELIVERY_STEPS.map((step, index) => {
          const done = index <= reached;
          const at = delivery.history.find((entry) => entry.status === step)?.at;
          return <li key={step} data-done={done ? "true" : "false"}>
            {/* The state is in the text, not only in the styling: a screen reader and a
                colour-blind reader both need to know which steps happened. */}
            <span>{step === "clicked" ? "Link clicked" : step[0].toUpperCase() + step.slice(1)}</span>
            <small>{at ? new Date(at).toLocaleString() : done ? "" : "not yet"}</small>
            <span className="sr-only">{done ? "completed" : "not yet"}</span>
          </li>;
        })}
      </ol>}
    </div>

    <div className="stw-invite-actions">
      {state === "pending" && <>
        <button onClick={() => onManage("resend", invite)}>Resend</button>
        <button onClick={() => onManage("revoke", invite)}>Revoke</button>
      </>}
      {state === "expired" && <button onClick={() => onManage("resend", invite)}>Send fresh invite</button>}
      {/* Only offered where the server will accept it. `inviteIsFinished` is the same predicate the
          archive function enforces, so this button cannot be a dead end. */}
      {finished && <button onClick={() => onManage("archive", invite)}>Remove from list</button>}
    </div>
  </article>;
}

type Filter = "all" | "owner" | "admin" | "member" | "invited";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Everyone" }, { value: "owner", label: "Owner" }, { value: "admin", label: "Admins" }, { value: "member", label: "Members" }, { value: "invited", label: "Invited" },
];

/**
 * Team conversations for each seat. The roster read does not carry it (get_solo_team_workspace
 * returns neither the seat's nor the invitation's value), so it is read where it IS published:
 * Team Hub's own roster (team_hub_list_conversations → people[].team_conversations, active seats),
 * and, for a suspended seat this viewer may act on, the departure review's member row. A value no
 * source returned stays UNKNOWN, and the row says so instead of drawing a switch that guesses.
 */
function useConversationAccess(workspace: TeamWorkspaceRecord | null, viewerId: string | null) {
  const [known, setKnown] = useState<{ tenantId: string | null; map: Record<string, boolean> }>({ tenantId: null, map: {} });
  const seq = useRef(0);
  const read = useCallback(async () => {
    if (!workspace) return;
    const request = ++seq.current;
    const map: Record<string, boolean> = {};
    for (const m of workspace.members) if (typeof m.team_hub_access === "boolean") map[m.user_id] = m.team_hub_access;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC awaits generated types
      const { data, error } = await (supabase as any).rpc("team_hub_list_conversations", { p_expected_tenant: workspace.tenant_id });
      if (!error && data?.ok === true && data.tenant_id === workspace.tenant_id && Array.isArray(data.people)) {
        for (const p of data.people) if (p && typeof p.user_id === "string" && typeof p.team_conversations === "boolean" && !(p.user_id in map)) map[p.user_id] = p.team_conversations;
      }
    } catch { /* unknown stays unknown */ }
    const suspended = workspace.members.filter((m) => m.status === "suspended" && !(m.user_id in map) && canActOn(workspace.viewer_permission, viewerId, m)).slice(0, 10);
    await Promise.all(suspended.map(async (m) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EXP08 RPC awaits generated types
        const { data, error } = await (supabase as any).rpc("team_member_holdings", { _member_user_id: m.user_id, _expected_tenant_id: workspace.tenant_id });
        const h = error ? null : normalizeHoldings(data, m.user_id);
        if (h && typeof h.member.team_hub_access === "boolean") map[m.user_id] = h.member.team_hub_access;
      } catch { /* unknown stays unknown */ }
    }));
    if (request !== seq.current) return;
    setKnown({ tenantId: workspace.tenant_id, map });
  }, [workspace, viewerId]);
  useEffect(() => { void read(); }, [read]);
  const set = (userId: string, value: boolean) => setKnown((c) => ({ ...c, map: { ...c.map, [userId]: value } }));
  return { map: known.tenantId === workspace?.tenant_id ? known.map : {}, set };
}

function lastSeen(member: TeamMemberRecord): string {
  if (member.status === "suspended") return "Can't open this workspace";
  return member.last_sign_in_at ? `Signed in ${new Date(member.last_sign_in_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "No sign-in recorded";
}

export function SoloTeamWorkspace({ openPaige, openConnections }: { openPaige?: () => void; openConnections?: () => void } = {}) {
  const [view, setView] = useState<"team" | "roles">("team"); const [search, setSearch] = useState(""); const [filter, setFilter] = useState<Filter>("all"); const [selected, setSelected] = useState<TeamMemberRecord | null>(null);
  const permission = filter === "invited" ? "all" : filter;
  // The workspace an in-flight invitation was opened against. Held here rather than derived from
  // `team.value`, which is nulled by every roster refetch (see InviteDialog).
  const { activeTenantId, activeUserId } = useTenantContext();
  const [inviteWorkspace, setInviteWorkspace] = useState<TeamWorkspaceRecord | null>(null);
  // Every flow returns here, to one bottom notice (approved design). It lives OUTSIDE the dialogs,
  // so a roster reload that unmounts one cannot take its outcome with it.
  const [notice, setNotice] = useState<TeamNotice | null>(null);
  const noticeSeq = useRef(0);
  const announce = useCallback((n: Omit<TeamNotice, "key">) => setNotice({ ...n, key: ++noticeSeq.current }), []);
  const [suspending, setSuspending] = useState<{ member: TeamMemberRecord; workspace: TeamWorkspaceRecord } | null>(null);
  const [departing, setDeparting] = useState<{ member: TeamMemberRecord; workspace: TeamWorkspaceRecord } | null>(null);
  const [busy, setBusy] = useState<Record<string, "convo" | "reinstate">>({});
  const [flash, setFlash] = useState<string | null>(null);
  // Who is looking: from the account context when it carries it, else the session. An unknown viewer
  // is offered no act on anyone (canActOn), because "yourself" can't be ruled out.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  useEffect(() => {
    if (activeUserId) return;
    let live = true;
    try {
      void Promise.resolve(supabase.auth.getUser()).then((r) => { if (live) setSessionUserId(r?.data?.user?.id ?? null); }).catch(() => undefined);
    } catch { /* no session reader: stays unknown */ }
    return () => { live = false; };
  }, [activeUserId]);
  const viewerId = activeUserId ?? sessionUserId;

  useEffect(() => {
    setInviteWorkspace((current) => {
      if (!current || !activeTenantId || current.tenant_id === activeTenantId) return current;
      toast.error(`You switched workspace, so the invitation for ${current.tenant_name} was closed. Nothing was sent.`);
      return null;
    });
    // A notice names a workspace and a person. This component does NOT remount on a switch, so a
    // notice left standing would make a claim about the previous workspace over the next one. (The
    // suspend dialog and the departure review close THEMSELVES on a switch, because only they know
    // whether a call is in flight whose outcome must still be reported.)
    setNotice(null);
  }, [activeTenantId]);
  const team = useTeamWorkspace(search, permission); const workspace = team.value;
  const conversations = useConversationAccess(workspace, viewerId);
  // The last known roster, so the editor can outlive the null flash of a refetch.
  const lastWorkspace = useRef<TeamWorkspaceRecord | null>(null);
  const closeEditor = useCallback(() => setSelected(null), []);
  const openEditor = (member: TeamMemberRecord) => { setNotice(null); setSelected(member); };
  // Applied to the snapshot BEFORE the refresh is started, so the editor remounts onto the saved
  // values rather than the ones they replaced (the save flow the owner hit on production).
  const handleSaved = (saved?: { job_title: string; responsibilities: string }) => {
    if (saved) setSelected((current) => (current ? { ...current, job_title: saved.job_title, responsibilities: saved.responsibilities } : current));
    return team.refresh();
  };
  // A selection is a snapshot taken when the row was clicked. Once the roster no longer carries it,
  // rendering the editor would show a person who is gone — so it is CLEARED, not merely hidden.
  const selectedLive = selected && workspace ? workspace.members.some((row) => row.membership_id === selected.membership_id) : false;
  if (workspace) lastWorkspace.current = workspace;
  const editorWorkspace = workspace ?? lastWorkspace.current;
  // Unsaved contact edits hold the dialog open across a roster reload (saving work details reloads
  // it, and for a frame the roster is empty).
  const [contactHold, setContactHold] = useState(false);
  useEffect(() => { if (selected && workspace && !selectedLive) setSelected(null); }, [selected, workspace, selectedLive]);
  useEffect(() => { if (!flash) return; const t = window.setTimeout(() => setFlash(null), 1200); return () => window.clearTimeout(t); }, [flash]);
  const pending = useMemo(() => workspace?.invitations.filter((item) => inviteLifecycle(item) === "pending") ?? [], [workspace]);
  // Split ONCE, from the same predicate the database uses to decide what may be cleared, so the
  // screen cannot offer a "Remove from list" the server will refuse.
  const activeInvites = useMemo(() => workspace?.invitations.filter((item) => !inviteIsFinished(item)) ?? [], [workspace]);
  const pastInvites = useMemo(() => workspace?.invitations.filter((item) => inviteIsFinished(item)) ?? [], [workspace]);

  /** One invitation write, through the existing edge function. Returns the outcome; the caller decides how to say it. */
  const inviteWrite = async (action: "resend" | "revoke" | "archive", invite: TeamInviteRecord): Promise<{ ok: true; emailed: boolean } | { ok: false; message: string }> => {
    if (!workspace) return { ok: false, message: "This workspace is still loading. Try again in a moment." };
    const { data, error } = await supabase.functions.invoke("solo-team-invitations", { body: { action, expectedTenantId: workspace.tenant_id, inviteId: invite.id } });
    if (error || data?.ok === false) return { ok: false, message: invitationRefusalMessage(await readFunctionErrorBody(error, data), "The invitation could not be updated. Please try again.") };
    return { ok: true, emailed: data?.emailed === true };
  };
  const manageInvite = async (action: "resend" | "revoke" | "archive", invite: TeamInviteRecord) => {
    const result = await inviteWrite(action, invite);
    if ("message" in result) { toast.error(result.message); return; }
    if (action === "resend") {
      // `emailed` means the provider ACCEPTED it, which is still not delivery.
      result.emailed
        ? toast.success("Fresh invitation sent; the old link was revoked. Delivery will show on the invitation.")
        : toast.warning("Fresh invitation created, but it could not be emailed. Share the link directly, or try again.");
    } else if (action === "archive") {
      toast.success("Cleared from your list. The record is kept.");
    } else {
      toast.success("Invitation revoked.");
    }
    team.refresh();
  };
  const rowInvite = async (action: "resend" | "revoke", invite: TeamInviteRecord, again = false) => {
    const email = invite.email || "this address";
    const result = await inviteWrite(action, invite);
    if ("message" in result) { announce({ tone: "bad", text: result.message, spoken: result.message }); return; }
    void team.reload();
    if (action === "revoke") {
      const s = `The invitation to ${email} was withdrawn. Its link no longer works.`;
      announce({ text: <>The invitation to <strong>{email}</strong> was withdrawn. Its link no longer works.</>, spoken: s, focus: true, action: { label: "Send again", run: () => void rowInvite("resend", invite, true) } });
      return;
    }
    const s = result.emailed ? (again ? `A new invitation went to ${email}.` : `A fresh invitation went to ${email}. The old link no longer works.`) : `A new invitation was created for ${email}, but it couldn't be emailed. Share the link directly, or try again.`;
    announce({ tone: result.emailed ? "ok" : "bad", text: s, spoken: s });
  };

  const unavailable = useRef<Set<string>>(new Set());
  const conversationsSwitch = async (member: TeamMemberRecord, next: boolean) => {
    if (!workspace || busy[member.user_id]) return;
    const identity = memberVisibleIdentity(member).primary;
    if (unavailable.current.has("conversations")) { const s = `Changing team conversations isn't available in ${workspace.tenant_name} yet. Nothing was changed.`; announce({ tone: "bad", text: s, spoken: s }); return; }
    setBusy((b) => ({ ...b, [member.user_id]: "convo" }));
    let data: { tenant_id?: string; team_hub_access?: boolean } | null = null;
    let error: { code?: string; message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EXP08 RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("set_solo_team_member_team_hub_access", { _member_user_id: member.user_id, _expected_tenant_id: workspace.tenant_id, _on: next }));
    } catch (thrown) { error = { message: thrown instanceof Error ? thrown.message : "network request failed" }; }
    setBusy((b) => { const n = { ...b }; delete n[member.user_id]; return n; });
    if (error || data?.tenant_id !== workspace.tenant_id || data?.team_hub_access !== next) {
      const r = error ? lifecycleRefusal(error, "conversations", identity, workspace.tenant_name) : null;
      if (r?.unavailable) unavailable.current.add("conversations");
      // The refusal says what is known: a lost reply is "we can't say whether this changed", not a
      // definite non-change. The generic sentence is kept only for an answer that didn't echo the value.
      // A retry is safe: the switch does nothing if the value is already set.
      const s = r ? r.message : `Team conversations for ${identity} didn't change. Try again.`;
      const retry = !r || r.retryable;
      announce({ tone: "bad", text: s, spoken: s, ...(retry ? { action: { label: "Retry", run: () => void conversationsSwitch(member, next) } } : {}) });
      // Uncertain or reconciled: re-read, so the row shows what the server holds.
      if (retry || r?.reconciled) void team.reload();
      return;
    }
    conversations.set(member.user_id, next);
    setFlash(member.user_id);
    const first = member.full_name?.trim() ? member.full_name.trim().split(/\s+/)[0] : identity;
    const tail = member.status === "suspended"
      ? (next ? ` stays suspended. When reinstated, ${first} will be in every open team channel, including any they had left, and keeps the private channels they were in.` : ` stays suspended. When reinstated, ${first} won't have Team Hub and will work only on what they're assigned.`)
      : (next ? " is back in Team Hub, in every open team channel, including any they had left, and keeps the private channels they were in." : " can't open Team Hub now. They keep their channels, their assigned work and their permission.");
    announce({ text: <><strong>{identity}</strong>{tail}</>, spoken: `${identity}${tail}`, action: { label: next ? "Turn off again" : "Turn back on", run: () => void conversationsSwitch({ ...member }, !next) } });
    void team.reload();
  };

  const reinstate = async (member: TeamMemberRecord) => {
    if (!workspace || busy[member.user_id]) return;
    const identity = memberVisibleIdentity(member).primary;
    if (unavailable.current.has("reinstate")) { const s = `Reinstating isn't available in ${workspace.tenant_name} yet. Nothing was changed.`; announce({ tone: "bad", text: s, spoken: s }); return; }
    setBusy((b) => ({ ...b, [member.user_id]: "reinstate" }));
    let data: { tenant_id?: string; status?: string } | null = null;
    let error: { code?: string; message?: string } | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EXP08 RPC awaits generated types
      ({ data, error } = await (supabase as any).rpc("reinstate_solo_team_member", { _member_user_id: member.user_id, _expected_tenant_id: workspace.tenant_id }));
    } catch (thrown) { error = { message: thrown instanceof Error ? thrown.message : "network request failed" }; }
    setBusy((b) => { const n = { ...b }; delete n[member.user_id]; return n; });
    if (error || data?.tenant_id !== workspace.tenant_id || data?.status !== "active") {
      const r = error ? lifecycleRefusal(error, "reinstate", identity, workspace.tenant_name) : null;
      if (r?.unavailable) unavailable.current.add("reinstate");
      // As above: a lost reply is reported as unknown, never as "still suspended". A repeated
      // reinstate that already landed comes back as the already-reinstated refusal, so Retry is safe.
      const s = r ? r.message : `${identity} is still suspended. Try again.`;
      const retry = !r || r.retryable;
      announce({ tone: "bad", text: s, spoken: s, ...(retry ? { action: { label: "Retry", run: () => void reinstate(member) } } : {}) });
      if (retry || r?.reconciled) void team.reload();
      return;
    }
    setFlash(member.user_id);
    const label = permissionPresentation(member.permission, member.is_owner).label;
    announce({ text: <><strong>{identity}</strong> can open {workspace.tenant_name} again, as {label}.</>, spoken: `${identity} can open ${workspace.tenant_name} again, as ${label}.` });
    void team.reload();
  };

  const openSuspend = (member: TeamMemberRecord) => {
    if (!workspace) return;
    if (unavailable.current.has("suspend")) { const s = `Suspending isn't available in ${workspace.tenant_name} yet. Nothing was changed.`; announce({ tone: "bad", text: s, spoken: s }); return; }
    setNotice(null); setDeparting(null); setSuspending({ member, workspace });
  };
  const openDeparture = (member: TeamMemberRecord) => { if (!workspace) return; setNotice(null); setSelected(null); setDeparting({ member, workspace }); };

  const canInvite = Boolean(workspace?.can_manage_invitations);
  const viewerPermission = workspace?.viewer_permission ?? "member";
  const filterLabel = FILTERS.find((f) => f.value === filter)!.label;
  const needle = search.trim().toLowerCase();
  // Pending invitations are folded into the roster as Invited, after the people already on the
  // team. The Invitations section below stays the one home for the delivery trail and past ones.
  const invitedRows = workspace && (filter === "invited" || (filter === "all" && workspace.members.length >= workspace.total_members))
    ? pending.filter((i) => !needle || (i.email ?? "").toLowerCase().includes(needle)) : [];
  const memberRows = filter === "invited" ? [] : workspace?.members ?? [];
  const allLoaded = Boolean(workspace && workspace.members.length >= workspace.total_members);
  const suspendedCount = allLoaded ? workspace!.members.filter((m) => m.status === "suspended").length : 0;
  const countLine = workspace
    ? `${workspace.total_members} ${workspace.total_members === 1 ? "person" : "people"} in ${workspace.tenant_name}${suspendedCount ? ` (${suspendedCount} suspended)` : ""}${pending.length ? `, plus ${pending.length} invited` : ""}`
    : "Confirmed members of this workspace";

  const memberRow = (member: TeamMemberRecord) => {
    const identity = memberVisibleIdentity(member);
    const access = permissionPresentation(member.permission, member.is_owner);
    const act = workspace ? canActOn(viewerPermission, viewerId, member) : false;
    const me = Boolean(viewerId) && member.user_id === viewerId;
    const suspended = member.status === "suspended";
    const rowBusy = busy[member.user_id];
    const value = conversations.map[member.user_id];
    const owner = member.is_owner || member.permission === "owner";
    let sw: React.ReactNode;
    if (owner) sw = <span className="stw-ro-on">On</span>;
    else if (value === undefined) sw = <span className="stw-ro" title="This setting isn't shown here yet">Not shown yet</span>;
    else if (act) sw = <>{<TeamSwitch id={`stw-sw-${member.user_id}`} checked={value} busy={rowBusy === "convo"} label={`Team conversations for ${identity.primary}`} describedBy={suspended ? `stw-swcap-${member.user_id}` : undefined} onToggle={() => void conversationsSwitch(member, !value)} />}{suspended && <span className="stw-cap2" id={`stw-swcap-${member.user_id}`}>Takes effect when reinstated</span>}</>;
    else if (suspended) sw = value ? <span className="stw-ro-on">On<span className="sr-only"> · </span><span className="stw-paused">Paused while suspended</span></span> : <span className="stw-ro">Off</span>;
    else sw = <span className={value ? "stw-ro-on" : "stw-ro"}>{value ? "On" : "Off"}</span>;
    const items: MenuItem[] = act ? [
      { key: "edit", label: "Edit details", icon: <Pencil aria-hidden="true" />, onSelect: () => openEditor(member) },
      suspended
        ? { key: "reinstate", label: "Reinstate access", icon: <Undo2 aria-hidden="true" />, onSelect: () => void reinstate(member) }
        : { key: "suspend", label: "Suspend access…", icon: <Pause aria-hidden="true" />, onSelect: () => openSuspend(member) },
      { key: "remove", label: "Remove from team…", icon: <UserMinus aria-hidden="true" />, tone: "danger", separatorBefore: true, onSelect: () => openDeparture(member) },
    ] : [];
    return <div className="stw-row" role="listitem" key={member.membership_id} data-status={member.status} data-flash={flash === member.user_id ? "true" : undefined}>
      <span className="stw-avatar" aria-hidden="true" data-hue={avatarHue(member)}>{initials(member)}</span>
      <div className="stw-identity"><strong><button type="button" className="stw-namebtn" aria-label={`${identity.primary}, edit details`} onClick={() => openEditor(member)}>{member.full_name || member.email || "Name unavailable"}</button>{me && <span className="stw-you">You</span>}</strong><small>{member.email || "Email unavailable"}</small><small className="stw-t">{member.job_title || "Title not set"}</small></div>
      <div className="stw-work"><strong>{member.job_title || "Title not set"}</strong><small>{member.responsibilities || "Responsibilities not set"}</small></div>
      <div className="stw-permc"><span className="stw-perm" data-tone={permissionTone(member.permission, owner)}>{access.label}</span></div>
      <div className="stw-swc">{sw}</div>
      <div className="stw-stat" data-s={member.status}><span className="stw-dot" data-s={member.status} aria-hidden="true" />{rowBusy === "reinstate" ? <span className="stw-row-busy"><RefreshCw className="stw-spin" aria-hidden="true" />Reinstating…</span> : <div><strong>{suspended ? "Suspended" : "Active"}</strong><small>{lastSeen(member)}</small></div>}</div>
      <div className="stw-acts">{act && <RowMenu triggerId={`stw-more-${member.user_id}`} label={`Actions for ${identity.primary}`} items={items} busy={Boolean(rowBusy)} />}</div>
    </div>;
  };
  const inviteRow = (invite: TeamInviteRecord) => {
    const email = invite.email || "Recipient unavailable";
    // The same authority the Invitations section below uses: any owner or admin who manages
    // invitations may resend or withdraw any pending one (resend/revoke_solo_team_invite).
    const act = canInvite;
    const value = typeof invite.team_hub_access === "boolean" ? invite.team_hub_access : undefined;
    const items: MenuItem[] = act ? [
      { key: "resend", label: "Resend invitation", icon: <Send aria-hidden="true" />, onSelect: () => void rowInvite("resend", invite) },
      { key: "withdraw", label: "Withdraw invitation", icon: <MailX aria-hidden="true" />, tone: "danger", onSelect: () => void rowInvite("revoke", invite) },
    ] : [];
    return <div className="stw-row" role="listitem" key={`invite-${invite.id}`} data-status="invited">
      <span className="stw-avatar" aria-hidden="true">{email.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase()}</span>
      <div className="stw-identity"><strong>{email}</strong><small>Hasn't accepted yet</small><small className="stw-t">Title not set</small></div>
      <div className="stw-work"><strong>Title not set</strong><small>Responsibilities not set</small></div>
      <div className="stw-permc"><span className="stw-perm" data-tone={permissionTone(invite.permission, false)}>{permissionPresentation(invite.permission, false).label}</span></div>
      <div className="stw-swc">{value === undefined ? <span className="stw-ro">Not shown yet</span> : <span className={value ? "stw-ro-on" : "stw-ro"}>{value ? "On when they join" : "Off"}</span>}{act && value !== undefined && <span className="stw-cap2">Withdraw and invite again to change</span>}</div>
      <div className="stw-stat" data-s="invited"><span className="stw-dot" data-s="invited" aria-hidden="true" /><div><strong>Invited</strong><small>Invited {new Date(invite.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · expires {new Date(invite.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></div></div>
      <div className="stw-acts">{act && <RowMenu triggerId={`stw-more-invite-${invite.id}`} label={`Actions for ${email}`} items={items} />}</div>
    </div>;
  };

  const firstUse = workspace && workspace.total_members === 1 && workspace.members[0]?.is_owner && !search && filter === "all" && pending.length === 0;
  const denied = team.error ? /access denied|permission/i.test(team.error) : false;

  return <div className={notice ? "stw-workspace has-notice" : "stw-workspace"}><div className="stw-tabs" role="tablist" aria-label="Team settings"><button type="button" role="tab" aria-selected={view === "team"} onClick={() => setView("team")}>Team</button><button type="button" role="tab" aria-selected={view === "roles"} onClick={() => setView("roles")}>Roles &amp; access</button></div>
    {view === "roles" ? <section className="stw-access"><header><ShieldCheck/><div><h2>Roles &amp; access</h2><p>Permissions are enforced. Titles and responsibilities only describe work.</p></div></header><div className="stw-role-grid">
      <article><h3>Owner</h3><p>Everything, including permissions. Invites admins and members. Suspends, reinstates and removes admins and members, and switches their team conversations. Can't be suspended or removed.</p></article>
      <article><h3>Admin</h3><p>Manages invitations and work details, and invites admins and members. Suspends, reinstates and removes members, and switches their team conversations. Can't suspend, remove or switch another admin or the owner, and can't do any of these to themselves.</p></article>
      <article><h3>Member</h3><p>Works in the business: their own tasks, the clients they're assigned, and Team Hub when team conversations are on. Can't manage people or invitations.</p></article>
    </div><div className="stw-roles-note"><MessageSquare aria-hidden="true" /><p><strong>Team conversations is separate from permission.</strong> On: they're in Team Hub, and new teammates join the open team channels when they accept. Off: they can't open Team Hub (channels, direct messages or shared files) and work only on what they're assigned; they stay in their channels. Back on: they join every open team channel again, including any they had left, and keep the private channels they were in. Off suits a spot-job contractor, who is otherwise a member like anyone else.</p></div></section> : <>
      <section className="stw-toolbar" aria-labelledby="stw-people-h"><div><h2 id="stw-people-h">People</h2><p>{countLine}</p></div>{canInvite && <button type="button" className={firstUse ? "stw-btn secondary" : "stw-btn primary"} onClick={() => setInviteWorkspace(workspace)}><UserPlus/>Invite someone</button>}</section>
      <section className="stw-permission-note" aria-label="Workspace permissions"><ShieldCheck/><div><strong>Workspace permissions</strong><span>The owner manages admins and members; admins manage members. Permissions apply only to {workspace?.tenant_name ?? "this workspace"}.</span></div><button type="button" onClick={() => setView("roles")}>Review roles</button></section>
      <section className="stw-roster" aria-labelledby="stw-people-h"><div className="stw-filters"><label><span className="sr-only">Search team</span><Search/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, titles, responsibilities" autoComplete="off"/></label><TeamPicker value={filter} label="Show" prefix="Show:" options={FILTERS} onChange={(v) => setFilter(v as Filter)} className="stw-filter-pick" /></div>
        {team.loading ? <><p className="sr-only" role="status">Loading the team…</p><div aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="stw-skelrow"><div className="stw-skel c" /><div><div className="stw-skel" style={{ width: "70%", marginBottom: 7 }} /><div className="stw-skel" style={{ width: "52%" }} /></div><div><div className="stw-skel" style={{ width: "60%", marginBottom: 7 }} /><div className="stw-skel" style={{ width: "84%" }} /></div><div className="stw-skel" style={{ width: 64 }} /><div className="stw-skel" style={{ width: 70 }} /><div className="stw-skel" style={{ width: "76%" }} /><span /></div>)}</div></>
          : team.error && !workspace ? <div className="stw-rstate" role="alert"><AlertTriangle aria-hidden="true" /><strong>{denied ? "You don’t have access to this team" : "The team didn't load"}</strong><span>{denied ? "Your current workspace permission does not allow this roster to load." : "Check your connection and try again. Nothing on the team changed."}</span><button type="button" className="stw-btn secondary" onClick={team.refresh}><RefreshCw aria-hidden="true" />Try again</button></div>
          : <>{firstUse && <div className="stw-first-use"><Users/><div><strong>Your workspace starts with you</strong><span>Invite the first teammate, then give them a title and clear responsibilities.</span></div>{canInvite && <button type="button" className="stw-btn primary" onClick={() => setInviteWorkspace(workspace)}>Invite first teammate</button>}</div>}
            {memberRows.length + invitedRows.length === 0
              ? <div className="stw-empty"><strong>No one matches</strong><span>Clear the search or show everyone.</span><button type="button" className="stw-btn secondary" onClick={() => { setSearch(""); setFilter("all"); }}>Show everyone</button></div>
              : <><div className="stw-cols" aria-hidden="true"><span /><span>Person</span><span className="stw-c-work">Work</span><span>Permission</span><span>Team conversations</span><span>Status</span><span /></div>
                <div className="stw-list" role="list" aria-label="Team roster">{memberRows.map(memberRow)}{invitedRows.map(inviteRow)}</div></>}</>}
        {team.error && workspace && <div className="stw-inline-error" role="alert"><AlertTriangle aria-hidden="true" /><span>The next page didn't load.</span><button type="button" className="stw-quiet" onClick={team.loadMore}>Retry</button></div>}{workspace && filter !== "invited" && workspace.members.length < workspace.total_members && <button type="button" className="stw-load" disabled={team.loadingMore} aria-busy={team.loadingMore || undefined} onClick={team.loadMore}>{team.loadingMore ? <><RefreshCw className="stw-spin" aria-hidden="true" />Loading…</> : `Load more (${workspace.total_members - workspace.members.length} remaining)`}</button>}
      </section>
      {workspace?.can_manage_invitations && <section className="stw-invites">
        <header><Mail/><div><h2>Invitations</h2><p>Delivery is reported by the email provider. Accepted, expired, and revoked are derived from the invitation record.</p></div><span>{pending.length} pending</span></header>
        {workspace.invitations.length === 0
          ? <p className="stw-invite-empty">No team invitations yet.</p>
          : <>
            {/* ACTIVE first, and on their own. */}
            {activeInvites.length === 0
              ? <p className="stw-invite-empty">Nothing outstanding. Every invitation here has been accepted, expired, or withdrawn.</p>
              : <div>{activeInvites.map((invite) => <InviteRow key={invite.id} invite={invite} onManage={manageInvite}/>)}</div>}
            {/* PAST, collapsed. Not deleted: a revoked invitation is the evidence that somebody's
                access was withdrawn, so it stays available rather than vanishing. */}
            {pastInvites.length > 0 && <details className="stw-invite-past">
              <summary>{pastInvites.length} past {pastInvites.length === 1 ? "invitation" : "invitations"}</summary>
              <div>{pastInvites.map((invite) => <InviteRow key={invite.id} invite={invite} onManage={manageInvite}/>)}</div>
            </details>}
          </>}
      </section>}
      <section className="stw-paige" aria-labelledby="stw-paige-h"><span className="stw-plate" aria-hidden="true"><Sparkles/></span>
        <div><h2 id="stw-paige-h">Paige team context</h2>
          <p>Paige can read the confirmed roster, each person's permission, title and responsibilities for this workspace. Work details people write are reference for her, not instructions or authority.</p>
          <div className="stw-lanes">
            <div className="stw-now"><h3>She can do this for you today</h3><ul><li><CheckCircle2 aria-hidden="true" />Invite someone</li><li><CheckCircle2 aria-hidden="true" />Resend or withdraw an invitation</li><li><CheckCircle2 aria-hidden="true" />Edit someone's title and responsibilities</li><li><CheckCircle2 aria-hidden="true" />Change a permission (owner only)</li></ul></div>
            <div className="stw-soon"><h3>New to Paige, still being checked</h3><ul><li><Clock aria-hidden="true" />Suspend or reinstate someone</li><li><Clock aria-hidden="true" />Remove someone and hand over their work</li><li><Clock aria-hidden="true" />Turn someone's team conversations on or off</li></ul></div>
          </div>
          <p className="stw-rule">She's held to the same rules you are, and nobody can be made an owner from a conversation. Access changes and invitations are read back to you and wait for your approval, even on autopilot. Approvals assigned to someone and a mailbox they connected can't be handed over, by her or anyone, and open work can be handed over only on a standalone business account. Until her new actions have been checked, you can always do them here.</p>
        </div>{openPaige && <button type="button" className="stw-btn secondary" onClick={openPaige}>Open Paige</button>}</section>
    </>}
    {editorWorkspace && selected && (selectedLive || (contactHold && !workspace)) && <MemberEditor member={selected} workspace={editorWorkspace} onClose={closeEditor} onSaved={handleSaved} onContactDirtyChange={setContactHold}
      canRemove={canActOn(editorWorkspace.viewer_permission, viewerId, selected)} onRequestRemoval={() => openDeparture(selected)}/>}
    {inviteWorkspace && <InviteDialog workspace={inviteWorkspace} onClose={() => setInviteWorkspace(null)} onInvited={({ email, conversations: on, emailed }) => {
      void team.reload();
      const s = emailed ? `Invitation sent to ${email}. ${on ? "They'll join the open team channels when they accept." : "They won't join Team Hub; they'll see only their assigned work."}` : `The invitation for ${email} is pending, but the email wasn't sent. You can resend it from Team.`;
      announce({ tone: emailed ? "ok" : "bad", text: s, spoken: s, focus: true });
    }}/>}
    {suspending && <SuspendDialog member={suspending.member} workspace={suspending.workspace} onClose={() => setSuspending(null)} onSuspended={(approvals) => {
      const m = suspending.member; const name = memberVisibleIdentity(m).primary; const first = m.full_name?.trim() ? m.full_name.trim().split(/\s+/)[0] : name;
      setSuspending(null); setFlash(m.user_id); void team.reload();
      const tail = ` is suspended and can't open ${suspending.workspace.tenant_name}.${approvals ? ` ${approvals === 1 ? "1 approval stays" : `${approvals} approvals stay`} assigned to ${first}.` : ""}`;
      announce({ text: <><strong>{name}</strong>{tail}</>, spoken: `${name}${tail}`, focus: true, action: { label: "Reinstate", run: () => void reinstate({ ...m, status: "suspended" }) } });
    }}/>}
    {departing && viewerId && <DepartureReview member={departing.member} workspace={departing.workspace} viewerId={viewerId} members={departing.workspace.tenant_id === workspace?.tenant_id ? workspace.members : departing.workspace.members}
      onOpenConnections={openConnections}
      onSuspendInstead={departing.member.status === "active" ? () => { const d = departing; setDeparting(null); openSuspend(d.member); } : undefined}
      onClose={(outcome?: DepartureOutcome) => { const d = departing; setDeparting(null); if (outcome) announce({ text: outcome.text, spoken: outcome.spoken, focus: true, action: outcome.action === "review-again" ? { label: "Review again", run: () => setDeparting(d) } : undefined }); }}
      onRemoved={(outcome) => { setDeparting(null); void team.reload(); announce({ text: outcome.text, spoken: outcome.spoken, focus: true }); }}/>}
    <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />
  </div>;
}
